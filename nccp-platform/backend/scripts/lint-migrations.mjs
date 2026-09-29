#!/usr/bin/env node
// Dependency-free structural lint for SQL migrations. NOT a substitute for running them on
// PostgreSQL (CI does that), but catches ordering / reference / trigger mistakes cheaply.
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'db', 'migrations')
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
const errors = []
const tables = new Map() // name -> { file, cols:Set, hasVersion, hasUpdatedAt, pk }
const touched = new Set()

const strip = (sql) => sql.replace(/--.*$/gm, '')

for (const file of files) {
  if (!/^\d{4}_[a-z0-9_]+\.sql$/.test(file)) errors.push(`${file}: bad file name`)
  const sql = strip(readFileSync(path.join(dir, file), 'utf8'))

  // balanced parens
  let depth = 0
  for (const ch of sql) { if (ch === '(') depth++; if (ch === ')') depth-- ; if (depth < 0) break }
  if (depth !== 0) errors.push(`${file}: unbalanced parentheses`)
  if (!sql.trim().endsWith(';')) errors.push(`${file}: last statement not terminated with ;`)

  // CREATE TABLE blocks
  const re = /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?([a-z_]+)\s*\(/g
  let m
  while ((m = re.exec(sql))) {
    const name = m[1]
    let i = re.lastIndex, d = 1
    while (i < sql.length && d > 0) { if (sql[i] === '(') d++; else if (sql[i] === ')') d--; i++ }
    const body = sql.slice(re.lastIndex, i - 1)
    if (tables.has(name)) errors.push(`${file}: table ${name} already created in ${tables.get(name).file}`)
    const cols = new Set()
    // split top-level by commas
    let part = '', dd = 0; const parts = []
    for (const ch of body) { if (ch === '(') dd++; if (ch === ')') dd--; if (ch === ',' && dd === 0) { parts.push(part); part = '' } else part += ch }
    parts.push(part)
    for (const p of parts.map((s) => s.trim()).filter(Boolean)) {
      const first = p.split(/\s+/)[0]
      if (!/^(PRIMARY|UNIQUE|CHECK|CONSTRAINT|FOREIGN)$/i.test(first)) cols.add(first)
    }
    const hasPk = /PRIMARY KEY/i.test(body)
    if (!hasPk) errors.push(`${file}: table ${name} has no primary key`)
    // FK targets must exist already (or be self-reference)
    for (const r of body.matchAll(/REFERENCES\s+([a-z_]+)\s*\(/g)) {
      const target = r[1]
      if (target !== name && !tables.has(target)) errors.push(`${file}: ${name} references ${target} which is not created yet`)
    }
    tables.set(name, { file, cols, hasVersion: cols.has('version'), hasUpdatedAt: cols.has('updated_at') })
  }

  for (const t of sql.matchAll(/CREATE TRIGGER\s+[a-z_]+\s+BEFORE UPDATE ON\s+([a-z_]+)\s+FOR EACH ROW EXECUTE FUNCTION touch_row\(\)/g)) touched.add(t[1])

  // ALTER TABLE ... REFERENCES targets exist
  for (const a of sql.matchAll(/ALTER TABLE\s+([a-z_]+)\s+ADD CONSTRAINT[\s\S]*?REFERENCES\s+([a-z_]+)\s*\(/g)) {
    if (!tables.has(a[1])) errors.push(`${file}: ALTER on unknown table ${a[1]}`)
    if (!tables.has(a[2])) errors.push(`${file}: ALTER references unknown table ${a[2]}`)
  }
}

// every table with version+updated_at must have the touch trigger (optimistic concurrency depends on it)
for (const [name, t] of tables) {
  if (t.hasVersion && t.hasUpdatedAt && !touched.has(name)) errors.push(`table ${name} has version/updated_at but no touch_row trigger`)
  if (t.hasVersion !== t.hasUpdatedAt && name !== 'system_settings') {
    if (t.cols.has('version') || t.cols.has('updated_at')) { /* partial – allowed only where intentional */ }
  }
}
for (const t of touched) if (!tables.has(t)) errors.push(`trigger for unknown table ${t}`)

if (errors.length) { console.error(errors.map((e) => `✗ ${e}`).join('\n')); process.exit(1) }
console.log(`✓ ${files.length} migration files, ${tables.size} tables, ${touched.size} touch triggers — structure OK`)
