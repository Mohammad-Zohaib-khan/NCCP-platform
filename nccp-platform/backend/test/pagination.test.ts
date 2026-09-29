import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildPage, decodeCursor, encodeCursor, parsePageParams, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE } from '../src/lib/pagination.js'
import { AppError } from '../src/lib/errors.js'

test('cursor round-trips', () => {
  const c = { sort: '2026-09-29T00:00:00Z', id: 'abc' }
  assert.deepEqual(decodeCursor(encodeCursor(c)), c)
})

test('garbage cursor is a 400', () => {
  assert.throws(() => decodeCursor('not-a-cursor!!'), (e) => e instanceof AppError && e.statusCode === 400)
  assert.throws(() => decodeCursor(Buffer.from('{"x":1}').toString('base64url')), (e) => e instanceof AppError && e.statusCode === 400)
})

test('limit defaults, clamps, and validates', () => {
  assert.equal(parsePageParams({}).limit, DEFAULT_PAGE_SIZE)
  assert.equal(parsePageParams({ limit: '5' }).limit, 5)
  assert.equal(parsePageParams({ limit: '99999' }).limit, MAX_PAGE_SIZE)
  for (const bad of ['0', '-3', 'abc', '1.5']) {
    assert.throws(() => parsePageParams({ limit: bad }), (e) => e instanceof AppError && e.statusCode === 422)
  }
})

test('buildPage detects more rows using the extra fetched row', () => {
  const rows = [1, 2, 3, 4].map((n) => ({ id: String(n), n }))
  const p = buildPage(rows, 3, (r) => ({ sort: r.n, id: r.id }))
  assert.equal(p.data.length, 3)
  assert.equal(p.page.hasMore, true)
  assert.deepEqual(decodeCursor(p.page.nextCursor!), { sort: 3, id: '3' })
})

test('buildPage on the last page has no cursor', () => {
  const p = buildPage([{ id: '1' }], 3, (r) => ({ sort: null, id: r.id }))
  assert.equal(p.page.hasMore, false)
  assert.equal(p.page.nextCursor, null)
})
