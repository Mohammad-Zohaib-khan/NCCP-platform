/**
 * Minimal, repeatable, forward-only migration runner.
 *  - Files in ./migrations named NNNN_description.sql, applied in filename order.
 *  - Each file runs in its own transaction; applied files are recorded with a SHA-256 checksum.
 *  - A modified already-applied file aborts the run (migrations are immutable once shipped).
 *  - A Postgres advisory lock prevents concurrent runners (e.g. multiple replicas booting).
 */
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const MIGRATION_NAME = /^\d{4}_[a-z0-9_]+\.sql$/
const LOCK_KEY = 7_265_301 // arbitrary constant shared by all runners
const here = path.dirname(fileURLToPath(import.meta.url))
export const MIGRATIONS_DIR = path.join(here, 'migrations')

export interface MigrationFile { name: string; sql: string; checksum: string }

export async function loadMigrationFiles(dir = MIGRATIONS_DIR): Promise<MigrationFile[]> {
  const names = (await readdir(dir)).filter((n) => n.endsWith('.sql')).sort()
  const bad = names.filter((n) => !MIGRATION_NAME.test(n))
  if (bad.length) throw new Error(`Invalid migration file name(s): ${bad.join(', ')} (expected NNNN_snake_case.sql)`)
  const files: MigrationFile[] = []
  for (const name of names) {
    const sql = await readFile(path.join(dir, name), 'utf8')
    files.push({ name, sql, checksum: createHash('sha256').update(sql).digest('hex') })
  }
  return files
}

export async function migrateUp(databaseUrl: string, log: (m: string) => void = console.log, dir = MIGRATIONS_DIR): Promise<string[]> {
  const files = await loadMigrationFiles(dir)
  const client = new pg.Client({ connectionString: databaseUrl })
  await client.connect()
  const applied: string[] = []
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY])
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name        text PRIMARY KEY,
        checksum    text NOT NULL,
        applied_at  timestamptz NOT NULL DEFAULT now()
      )`)
    const { rows } = await client.query<{ name: string; checksum: string }>('SELECT name, checksum FROM schema_migrations')
    const done = new Map(rows.map((r) => [r.name, r.checksum]))

    for (const f of files) {
      const prior = done.get(f.name)
      if (prior) {
        if (prior !== f.checksum) throw new Error(`Migration ${f.name} was modified after being applied. Add a new migration instead.`)
        continue
      }
      log(`applying ${f.name}`)
      try {
        await client.query('BEGIN')
        await client.query(f.sql)
        await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [f.name, f.checksum])
        await client.query('COMMIT')
        applied.push(f.name)
      } catch (err) {
        await client.query('ROLLBACK')
        throw new Error(`Migration ${f.name} failed: ${(err as Error).message}`)
      }
    }
    return applied
  } finally {
    try { await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]) } catch { /* ignore */ }
    await client.end()
  }
}

export async function migrationStatus(databaseUrl: string, dir = MIGRATIONS_DIR): Promise<{ name: string; applied: boolean }[]> {
  const files = await loadMigrationFiles(dir)
  const client = new pg.Client({ connectionString: databaseUrl })
  await client.connect()
  try {
    const exists = await client.query(`SELECT to_regclass('public.schema_migrations') AS t`)
    const done = new Set<string>()
    if (exists.rows[0]?.t) {
      const { rows } = await client.query<{ name: string }>('SELECT name FROM schema_migrations')
      rows.forEach((r) => done.add(r.name))
    }
    return files.map((f) => ({ name: f.name, applied: done.has(f.name) }))
  } finally {
    await client.end()
  }
}

// CLI: `tsx src/db/migrate.ts up|status`
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const url = process.env.DATABASE_URL
  if (!url) { console.error('DATABASE_URL is required'); process.exit(1) }
  const cmd = process.argv[2] ?? 'up'
  const run = cmd === 'status'
    ? migrationStatus(url).then((s) => s.forEach((m) => console.log(`${m.applied ? '[x]' : '[ ]'} ${m.name}`)))
    : cmd === 'up'
      ? migrateUp(url).then((a) => console.log(a.length ? `applied ${a.length} migration(s)` : 'database is up to date'))
      : Promise.reject(new Error(`unknown command "${cmd}" (use: up | status)`))
  run.catch((e) => { console.error(e.message); process.exit(1) })
}
