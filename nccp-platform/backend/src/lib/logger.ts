import pino, { type LoggerOptions } from 'pino'
import type { AppConfig } from '../config/env.js'

/** Fields that must never reach logs. */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password', '*.passwordHash', '*.password_hash', '*.token', '*.refreshToken', '*.secret', '*.otp',
]

export function loggerOptions(config: Pick<AppConfig, 'logLevel' | 'env'>): LoggerOptions {
  return {
    level: config.env === 'test' ? 'silent' : config.logLevel,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    base: { service: 'nccp-backend', env: config.env },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
  }
}
