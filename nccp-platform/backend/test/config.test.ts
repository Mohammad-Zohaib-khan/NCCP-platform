import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadConfig } from '../src/config/env.js'

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  AUTH_JWT_SECRET: 'a'.repeat(40),
  AUTH_COOKIE_SECRET: 'b'.repeat(40),
}

test('loads defaults', () => {
  const c = loadConfig({ ...base, NODE_ENV: 'development' })
  assert.equal(c.port, 8080)
  assert.deepEqual(c.frontendOrigins, ['http://localhost:3000'])
})

test('honours platform PORT', () => {
  assert.equal(loadConfig({ ...base, PORT: '3111' }).port, 3111)
})

test('reports every problem at once', () => {
  assert.throws(() => loadConfig({ NODE_ENV: 'production' }), /DATABASE_URL[\s\S]*AUTH_JWT_SECRET[\s\S]*AUTH_COOKIE_SECRET/)
})

test('production rejects placeholder secrets and wildcard origins', () => {
  assert.throws(() => loadConfig({ ...base, NODE_ENV: 'production', AUTH_JWT_SECRET: 'change-me-' + 'x'.repeat(30) }), /placeholder secret/)
  assert.throws(() => loadConfig({ ...base, NODE_ENV: 'production', FRONTEND_ORIGINS: '*' }), /wildcard/)
})

test('rejects short secrets', () => {
  assert.throws(() => loadConfig({ ...base, AUTH_JWT_SECRET: 'short' }), /AUTH_JWT_SECRET/)
})

test('auth defaults, secure cookies outside development, SameSite=None forces Secure', () => {
  const dev = loadConfig({ ...base, NODE_ENV: 'development' })
  assert.equal(dev.auth.accessTtlSeconds, 900); assert.equal(dev.auth.refreshTtlDays, 14)
  assert.equal(dev.auth.cookieSecure, false); assert.equal(dev.auth.mfaKey, base.AUTH_JWT_SECRET)
  assert.equal(loadConfig({ ...base, NODE_ENV: 'production' }).auth.cookieSecure, true)
  assert.equal(loadConfig({ ...base, AUTH_COOKIE_SAMESITE: 'none' }).auth.cookieSecure, true)
})
test('production rejects identical JWT/cookie secrets and insecure cookies', () => {
  assert.throws(() => loadConfig({ ...base, NODE_ENV: 'production', AUTH_COOKIE_SECRET: base.AUTH_JWT_SECRET }), /must differ/)
  assert.throws(() => loadConfig({ ...base, NODE_ENV: 'production', AUTH_COOKIE_SECURE: 'false' }), /AUTH_COOKIE_SECURE/)
})

test('production rejects the fingerprint demo flag; development allows it', () => {
  assert.throws(() => loadConfig({ ...base, NODE_ENV: 'production', FEATURE_FINGERPRINT_DEMO: 'true' }), /FEATURE_FINGERPRINT_DEMO/)
  assert.equal(loadConfig({ ...base, NODE_ENV: 'development', FEATURE_FINGERPRINT_DEMO: 'true' }).features.fingerprintDemo, true)
  assert.equal(loadConfig({ ...base, NODE_ENV: 'production' }).features.fingerprintDemo, false)
})
test('language configuration: default must be enabled, tags must be valid', () => {
  assert.deepEqual(loadConfig({ ...base }).i18n, { defaultLanguage: 'en', enabledLanguages: ['en', 'hi'] })
  assert.throws(() => loadConfig({ ...base, I18N_DEFAULT_LANGUAGE: 'fr' }), /I18N_DEFAULT_LANGUAGE/)
  assert.throws(() => loadConfig({ ...base, I18N_ENABLED_LANGUAGES: 'en,not a tag' }), /I18N_ENABLED_LANGUAGES/)
})
