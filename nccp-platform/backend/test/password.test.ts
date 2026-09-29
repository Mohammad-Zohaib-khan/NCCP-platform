import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkPasswordPolicy, hashPassword, needsRehash, verifyPassword } from '../src/auth/password.js'

test('hash then verify; wrong password and malformed hashes fail', async () => {
  const h = await hashPassword('Correct-Horse-9')
  assert.match(h, /^scrypt\$32768\$8\$1\$/)
  assert.equal(await verifyPassword('Correct-Horse-9', h), true)
  assert.equal(await verifyPassword('correct-horse-9', h), false)
  assert.equal(await verifyPassword('x', null), false)
  assert.equal(await verifyPassword('x', 'garbage'), false)
  assert.equal(await verifyPassword('x'.repeat(500), h), false)
})

test('same password hashes differently (random salt); needsRehash flags old parameters', async () => {
  const a = await hashPassword('Correct-Horse-9'); const b = await hashPassword('Correct-Horse-9')
  assert.notEqual(a, b)
  assert.equal(needsRehash(a), false)
  assert.equal(needsRehash(a.replace('$32768$', '$16384$')), true)
})

test('password policy', () => {
  assert.ok(checkPasswordPolicy('short1A!').length > 0)
  assert.ok(checkPasswordPolicy('alllowercaseletters').some((i) => /three of/.test(i.message)))
  assert.ok(checkPasswordPolicy('Password123').some((i) => /common/.test(i.message)) || checkPasswordPolicy('password123').some((i) => /common/.test(i.message)))
  assert.ok(checkPasswordPolicy('Rajesh-Kumar-1!', { email: 'rajesh@example.org' }).some((i) => /email/.test(i.message)))
  assert.deepEqual(checkPasswordPolicy('Tr4ining-Portal!', { email: 'a@b.c' }), [])
})
