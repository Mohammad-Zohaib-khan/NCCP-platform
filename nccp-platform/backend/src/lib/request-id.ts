import { randomUUID } from 'node:crypto'

const SAFE = /^[A-Za-z0-9._-]{8,128}$/

/** Accept a well-formed inbound X-Request-Id (for tracing through a proxy); otherwise mint one. */
export function resolveRequestId(inbound: unknown): string {
  if (typeof inbound === 'string' && SAFE.test(inbound)) return inbound
  return randomUUID()
}
