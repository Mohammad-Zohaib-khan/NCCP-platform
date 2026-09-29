import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { can, INVITABLE_BY, PERMISSIONS, ROLE_CODES, ROLE_PERMISSIONS } from '../src/auth/permissions.js'

test('every role permission exists in the catalogue', () => {
  for (const role of ROLE_CODES) for (const p of ROLE_PERMISSIONS[role]) assert.ok(p in PERMISSIONS, `${role}: unknown permission ${p}`)
})
test('super admin has everything; nobody else can approve/verify/audit/settings', () => {
  assert.equal(ROLE_PERMISSIONS.super_admin.length, Object.keys(PERMISSIONS).length)
  for (const role of ROLE_CODES.filter((r) => r !== 'super_admin'))
    for (const p of ['institutions:approve', 'employers:verify', 'audit:read', 'settings:write', 'sessions:revoke_any', 'programmes:approve'] as const)
      assert.equal(can(role, p), false, `${role} must not have ${p}`)
})
test('role boundaries across the five workspaces', () => {
  assert.equal(can('trainee', 'users:read'), false)
  assert.equal(can('trainee', 'attendance:mark'), false)
  assert.equal(can('trainee', 'attendance:checkin_own'), true)
  assert.equal(can('trainer', 'attendance:mark'), true)
  assert.equal(can('trainer', 'users:invite'), false)
  assert.equal(can('employer', 'candidates:search'), true)
  assert.equal(can('employer', 'trainees:read'), false)
  assert.equal(can('institution_admin', 'jobs:write'), false)
  assert.equal(can('institution_admin', 'certificates:issue'), true)
  assert.equal(can('trainee', 'certificates:issue'), false)
  assert.equal(can('nonsense', 'users:read'), false)
})
test('invitation matrix: institution admins cannot mint admins or employers', () => {
  assert.deepEqual([...INVITABLE_BY.institution_admin].sort(), ['trainee', 'trainer'])
  assert.equal(INVITABLE_BY.trainee.length + INVITABLE_BY.trainer.length + INVITABLE_BY.employer.length, 0)
})
test('migration seeds (0006 + 0007 + 0010) match the in-code catalogue exactly', () => {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'db', 'migrations')
  const seededPerms = new Set<string>(); const seededRolePerms = new Set<string>()
  for (const file of ['0006_permissions_mfa.sql', '0007_part4_permissions.sql', '0010_part6_employment.sql']) {
    const sql = readFileSync(path.join(dir, file), 'utf8')
    const [permsPart, rolePart] = sql.split('INSERT INTO role_permissions') as [string, string]
    for (const m of permsPart.matchAll(/^\s+\('([a-z_]+:[a-z_]+)',/gm)) seededPerms.add(m[1]!)
    for (const m of rolePart.matchAll(/\('([a-z_]+)', '([a-z_]+:[a-z_]+)'\)/g)) seededRolePerms.add(`${m[1]}|${m[2]}`)
  }
  assert.deepEqual([...seededPerms].sort(), Object.keys(PERMISSIONS).sort())
  const expected = new Set(ROLE_CODES.flatMap((r) => ROLE_PERMISSIONS[r].map((p) => `${r}|${p}`)))
  assert.deepEqual([...seededRolePerms].sort(), [...expected].sort())
})
