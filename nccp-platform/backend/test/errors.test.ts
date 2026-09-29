import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AppError, normaliseError } from '../src/lib/errors.js'

test('AppError maps to its status and code', () => {
  const out = normaliseError(AppError.forbidden(), 'req-12345678')
  assert.equal(out.statusCode, 403)
  assert.equal(out.body.error.code, 'FORBIDDEN')
  assert.equal(out.body.error.requestId, 'req-12345678')
  assert.equal(out.log, 'warn')
})

test('validation errors carry field issues', () => {
  const out = normaliseError(AppError.validation([{ path: 'email', message: 'invalid' }]), 'r')
  assert.equal(out.statusCode, 422)
  assert.deepEqual((out.body.error.details as { issues: unknown[] }).issues, [{ path: 'email', message: 'invalid' }])
})

test('ZodError-shaped errors become 422 with dotted paths', () => {
  const zodish = Object.assign(new Error('x'), { name: 'ZodError', issues: [{ path: ['job', 'title'], message: 'Required', code: 'invalid_type' }] })
  const out = normaliseError(zodish, 'r')
  assert.equal(out.statusCode, 422)
  assert.equal((out.body.error.details as { issues: { path: string }[] }).issues[0]?.path, 'job.title')
})

test('Fastify-style 4xx errors keep their status', () => {
  const out = normaliseError({ statusCode: 413, message: 'Payload too large' }, 'r')
  assert.equal(out.statusCode, 413)
  assert.equal(out.body.error.code, 'PAYLOAD_TOO_LARGE')
})

test('Fastify schema validation arrays become 422', () => {
  const out = normaliseError({ statusCode: 400, message: 'bad', validation: [{ instancePath: '/a/b', message: 'must be string', keyword: 'type' }] }, 'r')
  assert.equal(out.statusCode, 422)
  assert.equal((out.body.error.details as { issues: { path: string }[] }).issues[0]?.path, 'a.b')
})

test('unknown errors never leak internals', () => {
  const out = normaliseError(new Error('password=hunter2 connection refused at 10.0.0.5'), 'r')
  assert.equal(out.statusCode, 500)
  assert.equal(out.body.error.code, 'INTERNAL')
  assert.ok(!JSON.stringify(out.body).includes('hunter2'))
  assert.equal(out.log, 'error')
})

test('a 5xx status object is treated as internal, not echoed', () => {
  const out = normaliseError({ statusCode: 502, message: 'upstream secret detail' }, 'r')
  assert.equal(out.statusCode, 500)
  assert.ok(!JSON.stringify(out.body).includes('secret'))
})
