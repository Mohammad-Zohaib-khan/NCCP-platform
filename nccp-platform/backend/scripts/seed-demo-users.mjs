#!/usr/bin/env node
/**
 * Seed script: creates demo accounts for all 5 stakeholder roles.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node scripts/seed-demo-users.mjs
 */

import pg from 'pg'
import crypto from 'node:crypto'
import { scrypt as scryptCb, randomBytes } from 'node:crypto'

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

const DEMO_USERS = [
  {
    email: 'admin@nccp.gov.in',
    password: process.env.ADMIN_PASSWORD ?? 'Admin@12345',
    fullName: 'Dr. R.K. Sharma',
    role: 'super_admin',
  },
  {
    email: 'institute@nccp.gov.in',
    password: process.env.INSTITUTE_PASSWORD ?? 'Institute@12345',
    fullName: 'Dr. Anil Verma',
    role: 'institution_admin',
  },
  {
    email: 'trainer@nccp.gov.in',
    password: process.env.TRAINER_PASSWORD ?? 'Trainer@12345',
    fullName: 'Dr. Rajesh Kumar',
    role: 'trainer',
  },
  {
    email: 'trainee@nccp.gov.in',
    password: process.env.TRAINEE_PASSWORD ?? 'Trainee@12345',
    fullName: 'Ravi Kumar',
    role: 'trainee',
  },
  {
    email: 'employer@nccp.gov.in',
    password: process.env.EMPLOYER_PASSWORD ?? 'Employer@12345',
    fullName: 'Amul Dairy Cooperative',
    role: 'employer',
  },
]

async function main() {
  const pool = new pg.Pool({ connectionString: DATABASE_URL })
  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    for (const u of DEMO_USERS) {
      // Remove existing demo user by email if re-seeding
      await client.query(`DELETE FROM users WHERE email = $1`, [u.email])

      const userId = crypto.randomUUID()
      const passwordHash = await hashPassword(u.password)

      await client.query(
        `INSERT INTO users (id, email, full_name, role_code, password_hash, status, email_verified_at, password_changed_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'active', now(), now(), now(), now())`,
        [userId, u.email, u.fullName, u.role, passwordHash]
      )

      await client.query(
        `INSERT INTO audit_logs (actor_user_id, actor_role, action, entity_type, entity_id)
         VALUES ($1, $2, 'seed.create_demo_user', 'user', $3)`,
        [userId, u.role, userId]
      )

      console.log(`✅ Seeded ${u.role}: ${u.email} (${u.fullName})`)
    }

    await client.query('COMMIT')
    console.log('\nAll 5 demo role users seeded successfully!')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch((err) => {
  console.error('Seed demo users failed:', err.message)
  process.exit(1)
})
