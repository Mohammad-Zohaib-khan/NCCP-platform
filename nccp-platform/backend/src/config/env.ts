import { z } from 'zod'
import { attendanceFeatureIssues } from '../modules/learning/biometric.js'
import { isLanguageTag, parseLanguageList } from '../lib/i18n.js'

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1')

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(8080),
    HOST: z.string().default('0.0.0.0'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

    DATABASE_URL: z.string().url(),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
    DATABASE_SSL: bool.default('false'),

    FRONTEND_ORIGINS: z.string().default('http://localhost:3000'),
    TRUST_PROXY: bool.default('false'),
    RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(300),
    RATE_LIMIT_WINDOW: z.string().default('1 minute'),

    AUTH_JWT_SECRET: z.string().min(32),
    AUTH_COOKIE_SECRET: z.string().min(32),
    AUTH_MFA_ENCRYPTION_KEY: z.string().min(32).optional(),
    AUTH_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    AUTH_REFRESH_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(14),
    AUTH_MAX_FAILED_LOGINS: z.coerce.number().int().min(3).max(20).default(5),
    AUTH_LOCK_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
    AUTH_COOKIE_SECURE: bool.optional(),
    AUTH_COOKIE_SAMESITE: z.enum(['strict', 'lax', 'none']).default('lax'),
    APP_BASE_URL: z.string().url().default('http://localhost:3000'),

    // Part 4 (v3): attendance feature flags and UI/content languages. Part 7 moves these into system settings; env stays the hard ceiling.
    FEATURE_QR_ATTENDANCE: bool.default('true'),
    FEATURE_FACE_ATTENDANCE: bool.default('true'),
    FEATURE_FINGERPRINT_DEMO: bool.default('false'),
    I18N_DEFAULT_LANGUAGE: z.string().default('en'),
    I18N_ENABLED_LANGUAGES: z.string().default('en,hi'),

    REDIS_URL: z.string().optional(),
    S3_ENDPOINT: z.string().optional(),
    S3_BUCKET: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    SMTP_URL: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    for (const message of attendanceFeatureIssues(env.NODE_ENV, { qrAttendance: env.FEATURE_QR_ATTENDANCE, faceAttendance: env.FEATURE_FACE_ATTENDANCE, fingerprintDemo: env.FEATURE_FINGERPRINT_DEMO })) {
      ctx.addIssue({ code: 'custom', path: ['FEATURE_FINGERPRINT_DEMO'], message })
    }
    try {
      const langs = parseLanguageList(env.I18N_ENABLED_LANGUAGES)
      if (!isLanguageTag(env.I18N_DEFAULT_LANGUAGE)) ctx.addIssue({ code: 'custom', path: ['I18N_DEFAULT_LANGUAGE'], message: 'invalid language tag' })
      else if (!langs.includes(env.I18N_DEFAULT_LANGUAGE)) ctx.addIssue({ code: 'custom', path: ['I18N_DEFAULT_LANGUAGE'], message: 'must be one of I18N_ENABLED_LANGUAGES' })
    } catch (e) { ctx.addIssue({ code: 'custom', path: ['I18N_ENABLED_LANGUAGES'], message: (e as Error).message }) }
    if (env.NODE_ENV === 'production' || env.NODE_ENV === 'staging') {
      for (const key of ['AUTH_JWT_SECRET', 'AUTH_COOKIE_SECRET'] as const) {
        if (/change-me/i.test(env[key])) {
          ctx.addIssue({ code: 'custom', path: [key], message: 'placeholder secret is not allowed outside development/test' })
        }
      }
      if (env.AUTH_JWT_SECRET === env.AUTH_COOKIE_SECRET) {
        ctx.addIssue({ code: 'custom', path: ['AUTH_COOKIE_SECRET'], message: 'must differ from AUTH_JWT_SECRET' })
      }
      if (env.AUTH_COOKIE_SECURE === false) {
        ctx.addIssue({ code: 'custom', path: ['AUTH_COOKIE_SECURE'], message: 'must not be false outside development/test' })
      }
      const origins = env.FRONTEND_ORIGINS.split(',').map((s) => s.trim())
      if (origins.some((o) => o === '*' || o === '')) {
        ctx.addIssue({ code: 'custom', path: ['FRONTEND_ORIGINS'], message: 'wildcard/empty origin is not allowed in production' })
      }
    }
  })

export type Env = z.infer<typeof schema>

export interface AppConfig {
  env: Env['NODE_ENV']
  isProduction: boolean
  port: number
  host: string
  logLevel: Env['LOG_LEVEL']
  trustProxy: boolean
  frontendOrigins: string[]
  rateLimit: { max: number; timeWindow: string }
  db: { url: string; poolMax: number; ssl: boolean }
  auth: {
    jwtSecret: string; cookieSecret: string; mfaKey: string
    accessTtlSeconds: number; refreshTtlDays: number
    maxFailedLogins: number; lockMinutes: number; cookieSecure: boolean; cookieSameSite: 'strict' | 'lax' | 'none'
  }
  appBaseUrl: string
  features: { qrAttendance: boolean; faceAttendance: boolean; fingerprintDemo: boolean }
  i18n: { defaultLanguage: string; enabledLanguages: string[] }
  optional: { redisUrl?: string; s3Endpoint?: string; s3Bucket?: string; smtpUrl?: string }
}

/** Parse and validate configuration. Throws one readable error listing every problem. */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.safeParse(source)
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`)
  }
  const e = parsed.data
  return {
    env: e.NODE_ENV,
    isProduction: e.NODE_ENV === 'production',
    port: e.PORT,
    host: e.HOST,
    logLevel: e.LOG_LEVEL,
    trustProxy: e.TRUST_PROXY,
    frontendOrigins: e.FRONTEND_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
    rateLimit: { max: e.RATE_LIMIT_MAX, timeWindow: e.RATE_LIMIT_WINDOW },
    db: { url: e.DATABASE_URL, poolMax: e.DATABASE_POOL_MAX, ssl: e.DATABASE_SSL },
    auth: {
      jwtSecret: e.AUTH_JWT_SECRET, cookieSecret: e.AUTH_COOKIE_SECRET, mfaKey: e.AUTH_MFA_ENCRYPTION_KEY ?? e.AUTH_JWT_SECRET,
      accessTtlSeconds: e.AUTH_ACCESS_TTL_SECONDS, refreshTtlDays: e.AUTH_REFRESH_TTL_DAYS,
      maxFailedLogins: e.AUTH_MAX_FAILED_LOGINS, lockMinutes: e.AUTH_LOCK_MINUTES,
      cookieSecure: (e.AUTH_COOKIE_SECURE ?? (e.NODE_ENV === 'production' || e.NODE_ENV === 'staging')) || e.AUTH_COOKIE_SAMESITE === 'none',
      cookieSameSite: e.AUTH_COOKIE_SAMESITE,
    },
    appBaseUrl: e.APP_BASE_URL.replace(/\/$/, ''),
    features: { qrAttendance: e.FEATURE_QR_ATTENDANCE, faceAttendance: e.FEATURE_FACE_ATTENDANCE, fingerprintDemo: e.FEATURE_FINGERPRINT_DEMO },
    i18n: { defaultLanguage: e.I18N_DEFAULT_LANGUAGE, enabledLanguages: parseLanguageList(e.I18N_ENABLED_LANGUAGES) },
    optional: {
      redisUrl: e.REDIS_URL || undefined,
      s3Endpoint: e.S3_ENDPOINT || undefined,
      s3Bucket: e.S3_BUCKET || undefined,
      smtpUrl: e.SMTP_URL || undefined,
    },
  }
}
