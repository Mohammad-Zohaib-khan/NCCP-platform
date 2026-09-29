import { AppError } from './errors.js'

export const DEFAULT_PAGE_SIZE = 25
export const MAX_PAGE_SIZE = 100

export interface CursorPayload { sort: string | number | null; id: string }
export interface PageParams { limit: number; cursor?: CursorPayload }

export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}

export function decodeCursor(raw: string): CursorPayload {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<CursorPayload>
    if (typeof parsed?.id !== 'string' || !('sort' in parsed)) throw new Error('shape')
    return { sort: parsed.sort ?? null, id: parsed.id }
  } catch {
    throw AppError.badRequest('Invalid pagination cursor')
  }
}

/** Parse ?limit= and ?cursor= from a query object. */
export function parsePageParams(query: Record<string, unknown>): PageParams {
  let limit = DEFAULT_PAGE_SIZE
  if (query.limit !== undefined && query.limit !== '') {
    const n = Number(query.limit)
    if (!Number.isInteger(n) || n < 1) throw AppError.validation([{ path: 'limit', message: 'limit must be a positive integer' }])
    limit = Math.min(n, MAX_PAGE_SIZE)
  }
  const cursor = typeof query.cursor === 'string' && query.cursor ? decodeCursor(query.cursor) : undefined
  return { limit, cursor }
}

export interface Page<T> { data: T[]; page: { limit: number; nextCursor: string | null; hasMore: boolean } }

/** Build a page from `limit + 1` fetched rows (the extra row tells us whether more exist, no COUNT(*) needed). */
export function buildPage<T>(rows: T[], limit: number, cursorOf: (row: T) => CursorPayload): Page<T> {
  const hasMore = rows.length > limit
  const data = hasMore ? rows.slice(0, limit) : rows
  const last = data[data.length - 1]
  return { data, page: { limit, hasMore, nextCursor: hasMore && last ? encodeCursor(cursorOf(last)) : null } }
}
