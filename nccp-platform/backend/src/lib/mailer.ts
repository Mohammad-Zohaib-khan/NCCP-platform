import type { FastifyBaseLogger } from 'fastify'
import { AppError } from './errors.js'

export interface MailMessage { to: string; subject: string; text: string }
export interface Mailer { send(msg: MailMessage): Promise<void> }

/**
 * Part 2 ships a log-only mailer for development/test: the message (including the one-time link) is written to the
 * log so flows can be exercised without an SMTP server. In staging/production it refuses to send, so a link is
 * never written to production logs. The real SMTP/queue-backed mailer arrives in Part 7 behind this interface.
 */
export function createMailer(opts: { production: boolean; log: FastifyBaseLogger }): Mailer {
  return {
    async send(msg) {
      if (opts.production) throw AppError.unavailable('Email delivery is not configured')
      opts.log.info({ mail: msg }, 'DEV MAIL (not sent)')
    },
  }
}
