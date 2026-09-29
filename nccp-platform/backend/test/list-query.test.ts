import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AppError } from '../src/lib/errors.js'
import { buildUpdate, isIsoDate, keyset, likePattern, mapPage, orderBy, parseSort } from '../src/lib/list-query.js'
import { parseIfMatch, limit } from '../src/lib/http.js'

const SORTS = { created_at: { expr: 'i.created_at', type: 'timestamptz' as const }, name: { expr: 'lower(i.name)', type: 'text' as const }, start: { expr: 'b.start_date', type: 'date' as const } }
const status = (code: number) => (e: unknown) => e instanceof AppError && e.statusCode === code
const UUID = '11111111-1111-4111-8111-111111111111'

test('parseSort: default, ascending, descending', () => {
  assert.deepEqual(parseSort(undefined, SORTS, { key: 'created_at', dir: 'DESC' }), { key: 'created_at', expr: 'i.created_at', type: 'timestamptz', dir: 'DESC' })
  assert.equal(parseSort('name', SORTS, { key: 'created_at', dir: 'DESC' }).dir, 'ASC')
  assert.equal(parseSort('-name', SORTS, { key: 'created_at', dir: 'ASC' }).dir, 'DESC')
})
test('parseSort rejects unknown and hostile keys with 422 (nothing reaches SQL)', () => {
  for (const bad of ['password', 'name; DROP TABLE users', '__proto__', 'constructor', 'toString', '-', '1=1', ['name']])
    assert.throws(() => parseSort(bad, SORTS, { key: 'created_at', dir: 'DESC' }), status(422), String(bad))
})
test('keyset: no cursor gives no condition', () => {
  const params: unknown[] = []
  assert.equal(keyset(parseSort(undefined, SORTS, { key: 'created_at', dir: 'DESC' }), 'i.id', undefined, params), null)
  assert.deepEqual(params, [])
})
test('keyset: builds a row comparison with typed placeholders, direction decides the operator', () => {
  const params: unknown[] = ['x']
  const sql = keyset(parseSort('-created_at', SORTS, { key: 'created_at', dir: 'DESC' }), 'i.id', { sort: '2026-09-29 10:00:00.123456+00', id: UUID }, params)
  assert.equal(sql, '(i.created_at, i.id) < ($2::timestamptz, $3::uuid)')
  assert.deepEqual(params, ['x', '2026-09-29 10:00:00.123456+00', UUID])
  const p2: unknown[] = []
  assert.equal(keyset(parseSort('name', SORTS, { key: 'created_at', dir: 'DESC' }), 'i.id', { sort: 'abc', id: UUID }, p2), '(lower(i.name), i.id) > ($1::text, $2::uuid)')
})
test('keyset keeps microseconds because the value stays a string', () => {
  const params: unknown[] = []
  keyset(parseSort(undefined, SORTS, { key: 'created_at', dir: 'DESC' }), 'i.id', { sort: '2026-09-29 10:00:00.123456+05:30', id: UUID }, params)
  assert.equal(params[0], '2026-09-29 10:00:00.123456+05:30')
})
test('keyset rejects cursors whose value does not fit the sort type, or whose id is not a uuid (400)', () => {
  const ts = parseSort(undefined, SORTS, { key: 'created_at', dir: 'DESC' })
  const date = parseSort('start', SORTS, { key: 'created_at', dir: 'DESC' })
  assert.throws(() => keyset(ts, 'i.id', { sort: 'yesterday', id: UUID }, []), status(400))
  assert.throws(() => keyset(ts, 'i.id', { sort: 12345, id: UUID }, []), status(400))
  assert.throws(() => keyset(ts, 'i.id', { sort: null, id: UUID }, []), status(400))
  assert.throws(() => keyset(date, 'b.id', { sort: '2026-02-30', id: UUID }, []), status(400))
  assert.throws(() => keyset(ts, 'i.id', { sort: '2026-09-29 10:00:00+00', id: "1' OR '1'='1" }, []), status(400))
})
test('orderBy uses the same direction for the sort and the id tiebreaker', () => {
  assert.equal(orderBy(parseSort('-name', SORTS, { key: 'created_at', dir: 'DESC' }), 'i.id'), 'lower(i.name) DESC, i.id DESC')
})
test('likePattern escapes LIKE wildcards and backslashes', () => {
  assert.equal(likePattern('50%_off'), '%50\\%\\_off%')
  assert.equal(likePattern('a\\b'), '%a\\\\b%')
  assert.equal(likePattern('plain'), '%plain%')
})
test('isIsoDate accepts real dates only', () => {
  for (const ok of ['2026-09-29', '2024-02-29', '1999-12-31']) assert.equal(isIsoDate(ok), true, ok)
  for (const bad of ['2026-02-30', '2025-02-29', '2026-13-01', '2026-9-9', '29-09-2026', '2026-09-29T00:00:00Z', '', null, 20260929]) assert.equal(isIsoDate(bad), false, String(bad))
})
test('buildUpdate: partial sets, version guard, jsonb cast, undefined skipped, null kept', () => {
  const q = buildUpdate({ table: 'trainees', id: UUID, expectedVersion: 4, jsonColumns: ['career_profile'], sets: { state: 'Kerala', district: undefined, education: null, career_profile: { a: 1 }, skills: ['x', 'y'] } })
  assert.equal(q.sql, 'UPDATE trainees SET updated_at = now(), state = $3, education = $4, career_profile = $5::jsonb, skills = $6 WHERE id = $1 AND version = $2 AND deleted_at IS NULL RETURNING *')
  assert.deepEqual(q.params, [UUID, 4, 'Kerala', null, '{"a":1}', ['x', 'y']])
})
test('buildUpdate: extraWhere, returning, and an all-undefined patch still only touches updated_at', () => {
  const q = buildUpdate({ table: 'programmes', id: UUID, expectedVersion: 1, sets: { title: undefined }, extraWhere: "status IN ('draft','rejected')", returning: 'id' })
  assert.equal(q.sql, "UPDATE programmes SET updated_at = now() WHERE id = $1 AND version = $2 AND deleted_at IS NULL AND (status IN ('draft','rejected')) RETURNING id")
})
test('buildUpdate refuses unsafe identifiers', () => {
  assert.throws(() => buildUpdate({ table: 'users; DROP', id: UUID, expectedVersion: 1, sets: {} }))
  assert.throws(() => buildUpdate({ table: 'users', id: UUID, expectedVersion: 1, sets: { 'a = 1, admin': 'x' } }))
})
test('mapPage maps data and keeps paging info', () => {
  const out = mapPage({ data: [1, 2], page: { limit: 2, nextCursor: 'c', hasMore: true } }, (n) => n * 2)
  assert.deepEqual(out, { data: [2, 4], page: { limit: 2, nextCursor: 'c', hasMore: true } })
})
test('parseIfMatch accepts quoted, weak and bare versions; rejects missing or bad values with 400', () => {
  assert.equal(parseIfMatch('"3"'), 3); assert.equal(parseIfMatch('W/"7"'), 7); assert.equal(parseIfMatch('12'), 12)
  for (const bad of [undefined, '', '0', '-1', 'abc', '1.5', '"*"']) assert.throws(() => parseIfMatch(bad), status(400), String(bad))
})
test('limit() is relaxed only when NODE_ENV=test', () => {
  assert.equal(limit({ env: 'test' }, 5, '1 hour').rateLimit.max, 100_000)
  assert.equal(limit({ env: 'production' }, 5, '1 hour').rateLimit.max, 5)
  assert.equal(limit({ env: 'development' }, 5).rateLimit.timeWindow, '1 minute')
})
