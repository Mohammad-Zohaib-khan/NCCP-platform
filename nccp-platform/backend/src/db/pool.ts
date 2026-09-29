import pg from 'pg'
import type { AppConfig } from '../config/env.js'

export type Db = pg.Pool
export type Tx = pg.PoolClient

export function createPool(config: AppConfig): Db {
  const pool = new pg.Pool({
    connectionString: config.db.url,
    max: config.db.poolMax,
    ssl: config.db.ssl ? { rejectUnauthorized: true } : undefined,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 30_000,
    application_name: 'nccp-backend',
  })
  // An idle client erroring must not crash the process; the pool discards it.
  pool.on('error', (err) => console.error('[pg] idle client error', err.message))
  return pool
}

/** Run `fn` inside a transaction; commits on success, rolls back on any throw. */
export async function withTransaction<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    try { await client.query('ROLLBACK') } catch { /* connection already broken */ }
    throw err
  } finally {
    client.release()
  }
}
