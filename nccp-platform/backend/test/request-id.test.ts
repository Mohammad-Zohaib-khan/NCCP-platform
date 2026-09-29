import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveRequestId } from '../src/lib/request-id.js'

test('accepts a well-formed inbound id', () => {
  assert.equal(resolveRequestId('trace-abc_123.XYZ'), 'trace-abc_123.XYZ')
})

test('rejects malformed / hostile ids and mints a UUID', () => {
  for (const bad of [undefined, '', 'short', 'has space in it', 'x'.repeat(200), 'line\nbreak-id-123', '<script>alert(1)</script>']) {
    const id = resolveRequestId(bad)
    assert.match(id, /^[0-9a-f-]{36}$/)
  }
})
