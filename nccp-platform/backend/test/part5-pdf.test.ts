import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { AppError } from '../src/lib/errors.js'
import type { AuthContext } from '../src/auth/context.js'
import type { Db } from '../src/db/pool.js'
import { createCertificatesService } from '../src/modules/certificates/certificates.service.js'
import { FONT_WIDTH_TABLE_LENGTH, formatIssuedOn, pdfHex, renderCertificatePdf, textWidth, wrapText, type CertificatePdfInput } from '../src/modules/certificates/certificate.pdf.js'
import { LOGO_JPEG_BASE64 } from '../src/modules/certificates/certificate.logo.js'

const base: CertificatePdfInput = { certificateNo: 'NCCP-2026-7K3M9QXD', holderName: 'Asha Kumari Devi', programmeTitle: 'Solar Technician', issuedOn: '2026-09-29',
  verificationCode: 'ABCD-EFGH-JKMN-PQRS-TVWX', verifyUrl: 'https://nccp.example.org/verify/ABCD-EFGH-JKMN-PQRS-TVWX' }
const NOW = new Date('2026-09-29T10:00:00Z')
const text = (b: Buffer) => b.toString('latin1')

describe('font metrics and text helpers', () => {
  test('width tables cover exactly the 95 printable ASCII characters', () => { assert.equal(FONT_WIDTH_TABLE_LENGTH, 95) })
  test('known AFM widths (space, W, i, digits, bold A)', () => {
    assert.equal(textWidth(' ', 'regular', 1000), 278); assert.equal(textWidth('W', 'regular', 1000), 944); assert.equal(textWidth('i', 'regular', 1000), 222)
    assert.equal(textWidth('0123456789', 'regular', 1000), 5560); assert.equal(textWidth('A', 'bold', 1000), 722)
  })
  test('date formatting', () => {
    assert.equal(formatIssuedOn('2026-09-29'), '29 September 2026'); assert.equal(formatIssuedOn('2026-01-05'), '5 January 2026'); assert.equal(formatIssuedOn('not a date'), 'not a date')
  })
  test('wrapText keeps every line within the width and never loses words', () => {
    const words = 'Advanced Cooperative Management Accounting and Digital Marketplace Operations'
    const lines = wrapText(words, 'bold', 22, 300)
    assert.ok(lines.length > 1); for (const l of lines) assert.ok(textWidth(l, 'bold', 22) <= 300, l)
    assert.equal(lines.join(' '), words)
  })
  test('a single over-long word is hard-broken instead of overflowing', () => {
    const lines = wrapText('W'.repeat(60), 'bold', 20, 200)
    assert.ok(lines.length > 1); for (const l of lines) assert.ok(textWidth(l, 'bold', 20) <= 200)
    assert.equal(lines.join(''), 'W'.repeat(60))
  })
  test('pdfHex encodes WinAnsi bytes and refuses Devanagari and control characters', () => {
    assert.equal(pdfHex('Aé'), '<41e9>'); assert.equal(pdfHex('\u2019'), '<92>'); assert.equal(pdfHex('€'), '<80>')
    assert.throws(() => pdfHex('आशा')); assert.throws(() => pdfHex('a\u0000b')); assert.throws(() => pdfHex('a\nb'))
  })
})

describe('renderCertificatePdf', () => {
  test('is a structurally sound single-page PDF with correct xref offsets', () => {
    const buf = renderCertificatePdf(base, { now: NOW }); const s = text(buf)
    assert.ok(s.startsWith('%PDF-1.4')); assert.ok(s.trimEnd().endsWith('%%EOF'))
    const start = Number(/startxref\n(\d+)\n%%EOF/.exec(s)![1]); assert.equal(s.slice(start, start + 4), 'xref')
    const entries = [...s.slice(start).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]))
    assert.equal(entries.length, 9)
    entries.forEach((off, i) => assert.equal(s.slice(off, off + `${i + 1} 0 obj`.length), `${i + 1} 0 obj`))
    assert.equal((s.match(/\/Type \/Page /g) ?? []).length, 1)
  })
  test('stream /Length values match the real stream sizes', () => {
    const s = text(renderCertificatePdf(base, { now: NOW }))
    for (const m of s.matchAll(/\/Length (\d+)[^>]*>>\nstream\n/g)) {
      const from = m.index! + m[0].length; assert.equal(s.slice(from + Number(m[1]), from + Number(m[1]) + 10), '\nendstream')
    }
  })
  test('embeds the logo bytes untouched and prints the fields as WinAnsi hex', () => {
    const buf = renderCertificatePdf(base, { now: NOW })
    assert.ok(buf.includes(Buffer.from(LOGO_JPEG_BASE64, 'base64')))
    const s = text(buf)
    for (const v of [base.holderName, `Certificate No. ${base.certificateNo}`, `Code: ${base.verificationCode}`, 'Solar Technician', 'Issued on 29 September 2026']) assert.ok(s.includes(pdfHex(v)), v)
    assert.ok(s.includes(`/URI (${base.verifyUrl})`))
  })
  test('deterministic for the same input and clock, and the creation date comes from the clock', () => {
    assert.ok(renderCertificatePdf(base, { now: NOW }).equals(renderCertificatePdf(base, { now: NOW })))
    assert.ok(text(renderCertificatePdf(base, { now: NOW })).includes('D:20260929100000Z'))
  })
  test('accented Latin names render; Devanagari throws instead of printing wrong glyphs', () => {
    assert.ok(renderCertificatePdf({ ...base, holderName: 'José Ñandú O\u2019Brien' }, { now: NOW }).length > 1000)
    assert.throws(() => renderCertificatePdf({ ...base, holderName: 'आशा कुमारी' }, { now: NOW }))
  })
  test('the verification link must be an absolute http(s) URL without spaces or PDF-breaking characters', () => {
    assert.throws(() => renderCertificatePdf({ ...base, verifyUrl: 'javascript:alert(1)' }))
    assert.throws(() => renderCertificatePdf({ ...base, verifyUrl: 'https://x.example/a b' }))
    assert.ok(text(renderCertificatePdf({ ...base, verifyUrl: 'https://x.example/a(b)' }, { now: NOW })).includes('/URI (https://x.example/a\\(b\\))'))
  })
  test('very long name and title are shrunk and wrapped, never rejected', () => {
    const buf = renderCertificatePdf({ ...base, holderName: 'Krishnamurthy '.repeat(12).trim(), programmeTitle: 'Rural Producer Organisation Governance '.repeat(6).trim() }, { now: NOW })
    assert.ok(buf.length > 1000)
  })
})

// ---------------------------------------------------------------- service.pdf with a scripted database
const ids = { inst: '33333333-3333-4333-8333-333333333333', trainee: '66666666-6666-4666-8666-666666666666', traineeUser: '77777777-7777-4777-8777-777777777777', cert: '99999999-9999-4999-8999-999999999999', admin: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }
const actor = (role: AuthContext['role'], o: Partial<AuthContext> = {}): AuthContext => ({ userId: ids.admin, role, sessionId: 's', fullName: 'X', email: 'x@example.org', institutionIds: [ids.inst], employerIds: [], mfaEnabled: true, mfaSetupRequired: false, ...o })
const certRow = (o: Record<string, unknown> = {}) => ({ id: ids.cert, certificate_no: 'NCCP-2026-ABCD2345', verification_code: 'ABCD-EFGH-JKMN-PQRS-TVWX', trainee_id: ids.trainee, enrolment_id: 'e', programme_id: 'p',
  institution_id: ids.inst, title: 'Solar Technician', holder_name: 'Asha Kumari', grade: null, score: 82.5, status: 'issued', issued_at: new Date('2026-09-29T10:00:00Z'), revoked_at: null, revocation_reason: null, version: 1, ...o })
const dbWith = (row: Record<string, unknown> | null) => {
  const calls: Array<{ sql: string; params: unknown[] }> = []
  const db = { query: async (sql: string, params: unknown[] = []) => { calls.push({ sql, params }); return { rows: row ? [row] : [] } } } as unknown as Db
  return { db, calls }
}
const rejects = async (p: Promise<unknown>, status: number, code?: string) => assert.rejects(p, (e: unknown) => {
  assert.ok(e instanceof AppError, String(e)); assert.equal((e as AppError).statusCode, status)
  if (code) assert.equal(((e as AppError).details as { code?: string })?.code, code); return true
})

describe('service.pdf', () => {
  test('returns a PDF named after the certificate number, dated at issue time, with the configured verification URL', async () => {
    const { db } = dbWith(certRow())
    const out = await createCertificatesService(db, { appBaseUrl: 'https://nccp.example.org/' }).pdf(actor('super_admin'), ids.cert)
    assert.equal(out.filename, 'NCCP-2026-ABCD2345.pdf')
    const s = text(out.bytes)
    assert.ok(s.startsWith('%PDF-')); assert.ok(s.includes('/URI (https://nccp.example.org/verify/ABCD-EFGH-JKMN-PQRS-TVWX)')); assert.ok(s.includes('D:20260929100000Z'))
  })
  test('uses the same role scope as GET /certificates/:id: not visible -> 404, never a PDF', async () => {
    await rejects(createCertificatesService(dbWith(null).db).pdf(actor('trainee'), ids.cert), 404)
    const { db, calls } = dbWith(certRow())
    await createCertificatesService(db).pdf(actor('trainee', { userId: ids.traineeUser }), ids.cert)
    assert.match(calls[0]!.sql, /t\.user_id = \$2/); assert.equal(calls[0]!.params[1], ids.traineeUser)
  })
  test('a revoked certificate is 409 CERTIFICATE_REVOKED and nothing is rendered', async () => {
    await rejects(createCertificatesService(dbWith(certRow({ status: 'revoked', revoked_at: new Date(), revocation_reason: 'Issued in error' })).db).pdf(actor('super_admin'), ids.cert), 409, 'CERTIFICATE_REVOKED')
  })
  test('a Devanagari holder name or programme title is a clear 409 UNSUPPORTED_CHARACTERS', async () => {
    await rejects(createCertificatesService(dbWith(certRow({ holder_name: 'आशा कुमारी' })).db).pdf(actor('super_admin'), ids.cert), 409, 'UNSUPPORTED_CHARACTERS')
    await rejects(createCertificatesService(dbWith(certRow({ title: 'सौर तकनीशियन' })).db).pdf(actor('super_admin'), ids.cert), 409, 'UNSUPPORTED_CHARACTERS')
  })
  test('the PDF never prints the score, the grade or the revocation note', async () => {
    const { db } = dbWith(certRow({ score: 82.5, grade: 'A', revocation_reason: null }))
    const s = text((await createCertificatesService(db).pdf(actor('employer', { employerIds: ['e1'] }), ids.cert)).bytes)
    assert.ok(!s.includes(pdfHex('82.5')) && !s.includes(pdfHex('Grade')))
  })
})
