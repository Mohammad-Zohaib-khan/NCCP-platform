import type { Db } from '../db/pool.js'
import { AppError } from './errors.js'
import { buildPage, type Page, type PageParams } from './pagination.js'

export type SortType = 'text' | 'timestamptz' | 'date' | 'integer'
/** One whitelisted sort key. `expr` is trusted SQL written in code (never request input) and must be NOT NULL. */
export interface SortDef { expr: string; type: SortType }
export interface ParsedSort { key: string; expr: string; type: SortType; dir: 'ASC' | 'DESC' }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TS_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}(:?\d{2})?|Z)?$/

/** Strict YYYY-MM-DD that is also a real calendar date (rejects 2026-02-30). */
export function isIsoDate(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const [y, m, d] = v.split('-').map(Number) as [number, number, number]
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

/**
 * Parse `?sort=key` / `?sort=-key` against a whitelist. Unknown keys are a 422, so request input never reaches SQL.
 * `def` is used when the parameter is absent, e.g. { key: 'created_at', dir: 'DESC' }.
 */
export function parseSort(raw: unknown, allowed: Record<string, SortDef>, def: { key: string; dir: 'ASC' | 'DESC' }): ParsedSort {
  let key = def.key
  let dir = def.dir
  if (raw !== undefined && raw !== '') {
    if (typeof raw !== 'string') throw AppError.validation([{ path: 'sort', message: 'sort must be a string' }])
    dir = raw.startsWith('-') ? 'DESC' : 'ASC'
    key = raw.replace(/^[-+]/, '')
  }
  const d = Object.prototype.hasOwnProperty.call(allowed, key) ? allowed[key] : undefined
  if (!d) throw AppError.validation([{ path: 'sort', message: `Unsupported sort key. Allowed: ${Object.keys(allowed).join(', ')}` }])
  return { key, expr: d.expr, type: d.type, dir }
}

function validateCursorValue(type: SortType, v: unknown): string {
  if (typeof v !== 'string') throw AppError.badRequest('Invalid pagination cursor')
  const ok = type === 'text' ? true : type === 'date' ? isIsoDate(v) : type === 'integer' ? /^-?\d{1,18}$/.test(v) : TS_RE.test(v)
  if (!ok) throw AppError.badRequest('Invalid pagination cursor')
  return v
}

/**
 * Keyset condition for `(sortExpr, idExpr)` against the cursor. Pushes its bind parameters onto `params` and returns
 * the SQL fragment (or null when there is no cursor). The sort value travels as text, so timestamps keep microseconds.
 */
export function keyset(sort: ParsedSort, idExpr: string, cursor: PageParams['cursor'], params: unknown[]): string | null {
  if (!cursor) return null
  const value = validateCursorValue(sort.type, cursor.sort)
  if (!UUID_RE.test(cursor.id)) throw AppError.badRequest('Invalid pagination cursor')
  params.push(value, cursor.id)
  const op = sort.dir === 'DESC' ? '<' : '>'
  return `(${sort.expr}, ${idExpr}) ${op} ($${params.length - 1}::${sort.type}, $${params.length}::uuid)`
}

export const orderBy = (sort: ParsedSort, idExpr: string): string => `${sort.expr} ${sort.dir}, ${idExpr} ${sort.dir}`

/** Escape LIKE wildcards so user text is matched literally, then wrap for a contains-search. */
export function likePattern(q: string): string { return `%${q.replace(/[\\%_]/g, '\\$&')}%` }

export function mapPage<A, B>(page: Page<A>, fn: (a: A) => B): Page<B> { return { data: page.data.map(fn), page: page.page } }

export interface KeysetListOptions<Dto> {
  select: string            // column list; `_sort` is appended automatically
  from: string              // FROM + JOINs
  where: string[]           // conditions already using $n placeholders matching `params`
  params: unknown[]
  sort: ParsedSort
  idExpr: string            // e.g. 'i.id'
  page: PageParams
  map: (row: Record<string, unknown>) => Dto
}

/** Run a keyset-paginated list; every row is returned exactly once across pages. */
export async function keysetList<Dto>(db: Db, o: KeysetListOptions<Dto>): Promise<Page<Dto>> {
  const params = [...o.params]
  const where = [...o.where]
  const ks = keyset(o.sort, o.idExpr, o.page.cursor, params)
  if (ks) where.push(ks)
  params.push(o.page.limit + 1)
  const r = await db.query(
    `SELECT ${o.select}, (${o.sort.expr})::text AS _sort FROM ${o.from} WHERE ${where.length ? where.join(' AND ') : 'TRUE'} ORDER BY ${orderBy(o.sort, o.idExpr)} LIMIT $${params.length}`,
    params,
  )
  const rows = r.rows as Array<Record<string, unknown>>
  const page = buildPage(rows, o.page.limit, (row) => ({ sort: row._sort as string, id: row.id as string }))
  return mapPage(page, o.map)
}

export interface UpdateSpec {
  table: string
  id: string
  expectedVersion: number
  /** column -> new value; `undefined` values are skipped, `null` sets NULL. */
  sets: Record<string, unknown>
  /** columns stored as jsonb (value is JSON-encoded and cast). */
  jsonColumns?: readonly string[]
  /** extra static SQL condition written in code, e.g. "status IN ('draft','rejected')". */
  extraWhere?: string
  returning?: string
  /** false for tables without a deleted_at column (class_sessions, attendance, assessment_results); default true. */
  softDeleted?: boolean
}

const IDENT_RE = /^[a-z][a-z0-9_]*$/

/**
 * Build a partial, optimistic-concurrency UPDATE: `WHERE id = $1 AND version = $2 AND deleted_at IS NULL`.
 * Column names come from code, but are still checked as plain identifiers. Bumping version/updated_at is done by the DB trigger.
 */
export function buildUpdate(u: UpdateSpec): { sql: string; params: unknown[] } {
  if (!IDENT_RE.test(u.table)) throw new Error(`unsafe table name: ${u.table}`)
  const params: unknown[] = [u.id, u.expectedVersion]
  const sets: string[] = ['updated_at = now()']
  for (const [col, val] of Object.entries(u.sets)) {
    if (val === undefined) continue
    if (!IDENT_RE.test(col)) throw new Error(`unsafe column name: ${col}`)
    const isJson = u.jsonColumns?.includes(col) ?? false
    params.push(isJson && val !== null ? JSON.stringify(val) : val)
    sets.push(`${col} = $${params.length}${isJson ? '::jsonb' : ''}`)
  }
  const extra = u.extraWhere ? ` AND (${u.extraWhere})` : ''
  return { sql: `UPDATE ${u.table} SET ${sets.join(', ')} WHERE id = $1 AND version = $2${u.softDeleted === false ? '' : ' AND deleted_at IS NULL'}${extra} RETURNING ${u.returning ?? '*'}`, params }
}
