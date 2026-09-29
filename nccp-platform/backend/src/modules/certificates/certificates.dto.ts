import type { RoleCode } from '../../auth/permissions.js'

/** A certificate as stored (camelCase). What each role may see is decided in `shapeCertificate`, not in SQL. */
export interface CertificateRecord {
  id: string; certificateNo: string; verificationCode: string; traineeId: string; enrolmentId: string; programmeId: string
  institutionId: string | null; title: string; holderName: string; grade: string | null; score: number | null
  status: 'issued' | 'revoked'; issuedAt: Date; revokedAt: Date | null; revocationReason: string | null; version: number
}

const ADMIN_ROLES: readonly RoleCode[] = ['super_admin', 'institution_admin']

/**
 * Role-shaped view of a certificate.
 * - The revocation reason is an internal note: administrators only.
 * - Employers (who reach a certificate only through a job application) do not see scores or grades.
 * - Everyone who can read a certificate gets its verification code, because that is what makes it checkable by a third party.
 */
export function shapeCertificate(c: CertificateRecord, role: RoleCode) {
  const admin = ADMIN_ROLES.includes(role)
  return {
    id: c.id, certificateNo: c.certificateNo, verificationCode: c.verificationCode, traineeId: c.traineeId, enrolmentId: c.enrolmentId,
    programmeId: c.programmeId, institutionId: c.institutionId, title: c.title, holderName: c.holderName,
    grade: role === 'employer' ? null : c.grade, score: role === 'employer' ? null : c.score,
    status: c.status, issuedAt: c.issuedAt, revokedAt: c.revokedAt, revocationReason: admin ? c.revocationReason : null, version: c.version,
  }
}
export type CertificateDto = ReturnType<typeof shapeCertificate>

/** The whole unauthenticated response. Deliberately tiny: no email, phone, scores, ids, institution or reason. */
export interface PublicVerification { valid: boolean; status: 'issued' | 'revoked'; certificateNo: string; programmeTitle: string; issuedOn: string; holderName: string | null }
export function toPublicVerification(r: { status: 'issued' | 'revoked'; certificateNo: string; title: string; issuedAt: Date; holderName: string | null }): PublicVerification {
  return { valid: r.status === 'issued', status: r.status, certificateNo: r.certificateNo, programmeTitle: r.title, issuedOn: r.issuedAt.toISOString().slice(0, 10), holderName: r.holderName }
}
