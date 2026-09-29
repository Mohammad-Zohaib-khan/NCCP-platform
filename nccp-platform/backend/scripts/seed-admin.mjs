#!/usr/bin/env node
/**
 * Seed script: creates the first super-admin user.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node scripts/seed-admin.mjs
 *
 * Environment:
 *   DATABASE_URL   — required
 *   ADMIN_EMAIL    — default: admin@nccp.gov.in
 *   ADMIN_PASSWORD — default: Admin@12345 (change immediately after first login)
 *   ADMIN_NAME     — default: System Administrator
 */

import pg from 'pg'
import crypto from 'node:crypto'
import { scrypt as scryptCb, randomBytes } from 'node:crypto'

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@nccp.gov.in'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'Admin@12345'
const ADMIN_NAME = process.env.ADMIN_NAME ?? 'System Administrator'

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL is required')
  process.exit(1)
}

const PARAMS = { N: 2 ** 15, r: 8, p: 1, keyLen: 64 }

function derive(password, salt) {
  const opts = { N: PARAMS.N, r: PARAMS.r, p: PARAMS.p, maxmem: 128 * PARAMS.N * PARAMS.r * 2 }
  return new Promise((resolve, reject) => {
    scryptCb(password.normalize('NFKC'), salt, PARAMS.keyLen, opts, (err, key) => (err ? reject(err) : resolve(key)))
  })
}

async function hashPassword(password) {
  const salt = randomBytes(16)
  const key = await derive(password, salt)
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), key.toString('base64')].join('$')
}

async function main() {
  const pool = new pg.Pool({ connectionString: DATABASE_URL })
  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    // Delete existing admin user if re-seeding
    await client.query(`DELETE FROM users WHERE email = $1`, [ADMIN_EMAIL])

    const userId = crypto.randomUUID()
    const passwordHash = await hashPassword(ADMIN_PASSWORD)

    // Insert user with super_admin role
    await client.query(
      `INSERT INTO users (id, email, full_name, role_code, password_hash, status, email_verified_at, password_changed_at, created_at, updated_at)
       VALUES ($1, $2, $3, 'super_admin', $4, 'active', now(), now(), now(), now())`,
      [userId, ADMIN_EMAIL, ADMIN_NAME, passwordHash]
    )

    // Audit log entry
    await client.query(
      `INSERT INTO audit_logs (actor_user_id, actor_role, action, entity_type, entity_id)
       VALUES ($1, 'super_admin', 'seed.create_admin', 'user', $2)`,
      [userId, userId]
    )

    await client.query('COMMIT')
    console.log(`✅ Super admin created:`)
    console.log(`   Email:    ${ADMIN_EMAIL}`)
    console.log(`   Password: ${ADMIN_PASSWORD}`)
    console.log(`   ID:       ${userId}`)
    console.log(`\n   ⚠️  Change the password immediately after first login!`)
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch((err) => {
  console.error('Seed failed:', err.message)
  process.exit(1)
})
