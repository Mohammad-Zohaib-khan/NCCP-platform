import { randomInt } from 'node:crypto'
import { attendancePercent, type AttendanceCounts } from '../learning/attendance.rules.js'

/**
 * Pure certificate rules (no database, no framework) so they can be unit-tested without installs.
 * The service loads the numbers; every decision lives here.
 */

// ---------------------------------------------------------------- settings
export const SETTING_KEYS = {
  minAttendancePercent: 'certificates.min_attendance_percent',
  requireAssessmentsPassed: 'certificates.require_assessments_passed',
  publicHolderName: 'certificates.public_holder_name',
} as const

export const HOLDER_NAME_MODES = ['full', 'initials', 'none'] as const
export type HolderNameMode = (typeof HOLDER_NAME_MODES)[number]

export interface CertificateSettings { minAttendancePercent: number; requireAssessmentsPassed: boolean; publicHolderName: HolderNameMode }
/** Defaults used when a key is missing or holds a value of the wrong shape (the settings API arrives in Part 7). */
export const DEFAULT_CERTIFICATE_SETTINGS: CertificateSettings = { minAttendancePercent: 75, requireAssessmentsPassed: true, publicHolderName: 'full' }

/** Build settings from raw system_settings values. A malformed value falls back to its default; it never loosens a rule silently. */
export function parseCertificateSettings(raw: Record<string, unknown>): CertificateSettings {
  const d = DEFAULT_CERTIFICATE_SETTINGS
  const pct = raw[SETTING_KEYS.minAttendancePercent]
  const req = raw[SETTING_KEYS.requireAssessmentsPassed]
  const mode = raw[SETTING_KEYS.publicHolderName]
  return {
    minAttendancePercent: typeof pct === 'number' && Number.isFinite(pct) && pct >= 0 && pct <= 100 ? pct : d.minAttendancePercent,
    requireAssessmentsPassed: typeof req === 'boolean' ? req : d.requireAssessmentsPassed,
    publicHolderName: typeof mode === 'string' && (HOLDER_NAME_MODES as readonly string[]).includes(mode) ? (mode as HolderNameMode) : d.publicHolderName,
  }
}

// ---------------------------------------------------------------- eligibility
/** Enrolment statuses that hold a seat and can therefore be certified. applied / dropped / rejected never can. */
export const CERTIFIABLE_ENROLMENT_STATUSES = ['enrolled', 'in_progress', 'completed'] as const

export type IneligibleCode = 'ENROLMENT_STATUS' | 'ATTENDANCE_NOT_COUNTABLE' | 'ATTENDANCE_BELOW_THRESHOLD' | 'NO_ASSESSMENTS' | 'ASSESSMENTS_NOT_PASSED'
export interface EligibilityInput { enrolmentStatus: string; attendance: AttendanceCounts; assessments: { total: number; passed: number } }
export interface EligibilityResult {
  eligible: boolean
  attendancePercent: number | null
  assessments: { total: number; passed: number; allPassed: boolean }
  thresholds: { minAttendancePercent: number; requireAssessmentsPassed: boolean }
  reasons: Array<{ code: IneligibleCode; message: string }>
}

/**
 * All reasons are reported, not just the first, so the UI can tell an admin everything that is missing.
 * Attendance uses the Part 4 formula (late counts, excused leaves the denominator); a null percentage (nothing countable yet) is never eligible.
 * Assessments use the Part 4 `allPassed` rule: at least one published/closed assessment and all of them passed.
 */
export function evaluateEligibility(input: EligibilityInput, settings: CertificateSettings): EligibilityResult {
  const reasons: EligibilityResult['reasons'] = []
  const pct = attendancePercent(input.attendance)
  const allPassed = input.assessments.total > 0 && input.assessments.passed === input.assessments.total

  if (!(CERTIFIABLE_ENROLMENT_STATUSES as readonly string[]).includes(input.enrolmentStatus)) {
    reasons.push({ code: 'ENROLMENT_STATUS', message: `Enrolment status "${input.enrolmentStatus}" cannot be certified` })
  }
  if (pct === null) reasons.push({ code: 'ATTENDANCE_NOT_COUNTABLE', message: 'No attendance can be counted yet' })
  else if (pct < settings.minAttendancePercent) reasons.push({ code: 'ATTENDANCE_BELOW_THRESHOLD', message: `Attendance ${pct}% is below the required ${settings.minAttendancePercent}%` })
  if (settings.requireAssessmentsPassed) {
    if (input.assessments.total === 0) reasons.push({ code: 'NO_ASSESSMENTS', message: 'The batch has no published assessments to pass' })
    else if (!allPassed) reasons.push({ code: 'ASSESSMENTS_NOT_PASSED', message: `${input.assessments.passed} of ${input.assessments.total} assessments passed` })
  }
  return {
    eligible: reasons.length === 0,
    attendancePercent: pct,
    assessments: { total: input.assessments.total, passed: input.assessments.passed, allPassed },
    thresholds: { minAttendancePercent: settings.minAttendancePercent, requireAssessmentsPassed: settings.requireAssessmentsPassed },
    reasons,
  }
}

// ---------------------------------------------------------------- identifiers
/** Crockford base32 without I, L, O, U: unambiguous when read aloud or typed from paper. */
export const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const randomChars = (n: number): string => { let s = ''; for (let i = 0; i < n; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]; return s }

/** NCCP-2026-7K3M9QXD: readable and unique (the DB unique index is the authority; the service retries on the rare collision). */
export function generateCertificateNo(now: Date = new Date()): string { return `NCCP-${now.getUTCFullYear()}-${randomChars(8)}` }
export const CERTIFICATE_NO_RE = /^NCCP-\d{4}-[0-9A-HJKMNP-TV-Z]{8}$/

export const VERIFICATION_CODE_LENGTH = 20   // 20 chars x 5 bits = 100 bits: not guessable
/** Public verification code, grouped for readability: XXXX-XXXX-XXXX-XXXX-XXXX. Generated with a CSPRNG. */
export function generateVerificationCode(): string { return randomChars(VERIFICATION_CODE_LENGTH).match(/.{4}/g)!.join('-') }

/**
 * Canonical form of a code typed or pasted by a person: case-insensitive, separators ignored, and the usual look-alikes
 * mapped (O->0, I/L->1). Returns null when the input cannot be a code, so the caller answers 404 without touching the DB.
 */
export function normaliseVerificationCode(input: string): string | null {
  if (typeof input !== 'string' || input.length > 64) return null
  const s = input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1')
  if (s.length !== VERIFICATION_CODE_LENGTH) return null
  for (const ch of s) if (!CODE_ALPHABET.includes(ch)) return null
  return s.match(/.{4}/g)!.join('-')
}

// ---------------------------------------------------------------- public holder name
/** "Asha Kumari Devi" -> "A. K. D." (Unicode letters only, first letter of each word). */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const out: string[] = []
  for (const p of parts) { const first = [...p].find((c) => /\p{L}/u.test(c)); if (first) out.push(`${first.toLocaleUpperCase()}.`) }
  return out.join(' ')
}
/** What the unauthenticated verification page may show. 'none' returns null so the response never carries the name. */
export function publicHolderName(fullName: string, mode: HolderNameMode): string | null {
  if (mode === 'none') return null
  if (mode === 'initials') return initialsOf(fullName) || null
  return fullName.trim() || null
}

// ---------------------------------------------------------------- printable text (standard PDF fonts)
/** Windows-1252 characters above 0x7F that the standard PDF fonts (WinAnsiEncoding) can draw. */
const WIN_ANSI_EXTRA = new Set([...'€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'])
/**
 * True when every character can be drawn with the standard PDF fonts. Devanagari and other scripts return false; the PDF
 * endpoint then answers 409 instead of printing wrong glyphs (a Unicode font is needed - see docs/part-5-notes.md).
 */
export function isWinAnsiPrintable(text: string): boolean {
  for (const ch of text) {
    const c = ch.codePointAt(0)!
    const ok = (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || WIN_ANSI_EXTRA.has(ch)
    if (!ok) return false
  }
  return true
}

// ---------------------------------------------------------------- misc
export const REVOKE_REASON_MAX = 500
export const CERT_UNIQUE_NO_CONSTRAINT = 'certificates_certificate_no_key'
export const CERT_UNIQUE_CODE_CONSTRAINT = 'certificates_verification_code_key'
export const CERT_ONE_LIVE_INDEX = 'certificates_one_live_per_enrolment'
