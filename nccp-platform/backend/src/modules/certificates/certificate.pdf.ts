import { LOGO_HEIGHT, LOGO_JPEG_BASE64, LOGO_WIDTH } from './certificate.logo.js'
import { isWinAnsiPrintable } from './certificates.rules.js'

/**
 * Certificate PDF, written by hand (no dependency) so it can be produced and checked without an npm install.
 * One A4 landscape page, the two standard fonts Helvetica and Helvetica-Bold (WinAnsiEncoding), one embedded JPEG logo and a
 * clickable verification link. Standard fonts cannot draw Devanagari: callers must check `isWinAnsiPrintable` first
 * (the service answers 409); this renderer throws if it is handed text it cannot encode, rather than printing wrong glyphs.
 */

export interface CertificatePdfInput {
  certificateNo: string
  holderName: string
  programmeTitle: string
  issuedOn: string          // YYYY-MM-DD (UTC date the certificate was issued)
  verificationCode: string
  verifyUrl: string         // absolute URL printed on the page and used as the link target
}

// ---------------------------------------------------------------- font metrics (Adobe standard 14 AFM, units per 1000 em, chars 0x20..0x7E)
const HELVETICA = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584]
const HELVETICA_BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584]
export const FONT_WIDTH_TABLE_LENGTH = HELVETICA.length   // 95; asserted by a unit test

export type FontKey = 'regular' | 'bold'
const TABLES: Record<FontKey, number[]> = { regular: HELVETICA, bold: HELVETICA_BOLD }

/** Width of `text` in PDF points. Characters outside ASCII use an average width (only used for centring, never for correctness). */
export function textWidth(text: string, font: FontKey, size: number): number {
  const t = TABLES[font]; let w = 0
  for (const ch of text) { const c = ch.codePointAt(0)!; w += c >= 0x20 && c <= 0x7e ? (t[c - 0x20] as number) : 556 }
  return (w * size) / 1000
}

/** Greedy word wrap. A single word wider than the line is broken by characters so nothing can run off the page. */
export function wrapText(text: string, font: FontKey, size: number, maxWidth: number): string[] {
  const lines: string[] = []; let cur = ''
  const push = () => { if (cur) lines.push(cur); cur = '' }
  for (const word of text.trim().split(/\s+/).filter(Boolean)) {
    if (textWidth(word, font, size) > maxWidth) {
      push()
      for (const ch of word) { if (textWidth(cur + ch, font, size) > maxWidth) push(); cur += ch }
      continue
    }
    const next = cur ? `${cur} ${word}` : word
    if (textWidth(next, font, size) <= maxWidth) cur = next; else { push(); cur = word }
  }
  push()
  return lines
}

// ---------------------------------------------------------------- encoding
const CP1252_EXTRA: Record<string, number> = { '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e,
  '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f }
/** PDF hex string in WinAnsi (Windows-1252) byte values. Throws for anything the standard fonts cannot draw. */
export function pdfHex(text: string): string {
  if (!isWinAnsiPrintable(text)) throw new Error('text contains characters the standard PDF fonts cannot draw')
  let out = '<'
  for (const ch of text) { const c = ch.codePointAt(0)!; const b = c <= 0xff ? c : (CP1252_EXTRA[ch] as number); out += b.toString(16).padStart(2, '0') }
  return out + '>'
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
/** "2026-09-29" -> "29 September 2026". Anything that is not a valid ISO date is returned unchanged (and must still be printable). */
export function formatIssuedOn(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return iso
  const month = MONTHS[Number(m[2]) - 1]
  return month ? `${Number(m[3])} ${month} ${m[1]}` : iso
}
const pdfDate = (d: Date): string => `D:${d.toISOString().replace(/[-:T]/g, '').slice(0, 14)}Z`
const n = (v: number): string => (Math.round(v * 100) / 100).toString()

// ---------------------------------------------------------------- page
const W = 841.89, H = 595.28   // A4 landscape
const INK = '0.09 0.13 0.21', MUTED = '0.38 0.42 0.50', ACCENT = '0.05 0.45 0.32'

class Page {
  private ops: string[] = []
  raw(op: string): void { this.ops.push(op) }
  rect(x: number, y: number, w: number, h: number, lineWidth: number, rgb: string): void { this.ops.push(`${rgb} RG ${n(lineWidth)} w ${n(x)} ${n(y)} ${n(w)} ${n(h)} re S`) }
  line(x1: number, y1: number, x2: number, y2: number, lineWidth: number, rgb: string): void { this.ops.push(`${rgb} RG ${n(lineWidth)} w ${n(x1)} ${n(y1)} m ${n(x2)} ${n(y2)} l S`) }
  text(s: string, x: number, y: number, font: FontKey, size: number, rgb: string): void {
    this.ops.push(`BT ${rgb} rg /${font === 'bold' ? 'F2' : 'F1'} ${n(size)} Tf ${n(x)} ${n(y)} Td ${pdfHex(s)} Tj ET`)
  }
  centred(s: string, y: number, font: FontKey, size: number, rgb: string): void { this.text(s, (W - textWidth(s, font, size)) / 2, y, font, size, rgb) }
  content(): string { return this.ops.join('\n') }
}

/** Build the one-page certificate. Deterministic for a given input and `now`. */
export function renderCertificatePdf(input: CertificatePdfInput, opts: { now?: Date } = {}): Buffer {
  const now = opts.now ?? new Date()
  const p = new Page()

  // frame: outer green rule, inner thin rule
  p.rect(24, 24, W - 48, H - 48, 3, ACCENT)
  p.rect(32, 32, W - 64, H - 64, 0.75, MUTED)

  // logo, centred at the top (bytes are embedded below as /Im1)
  const logoW = 190, logoH = (LOGO_HEIGHT / LOGO_WIDTH) * logoW
  p.raw(`q ${n(logoW)} 0 0 ${n(logoH)} ${n((W - logoW) / 2)} ${n(H - 62 - logoH)} cm /Im1 Do Q`)

  p.centred('CERTIFICATE OF COMPLETION', H - 150, 'bold', 30, INK)
  p.line(W / 2 - 90, H - 162, W / 2 + 90, H - 162, 1.5, ACCENT)
  p.centred('This is to certify that', H - 195, 'regular', 14, MUTED)

  // holder name: one line, shrunk down to 18 pt if needed, then wrapped (max 2 lines)
  const maxNameW = W - 200
  let nameSize = 34
  while (nameSize > 18 && textWidth(input.holderName, 'bold', nameSize) > maxNameW) nameSize -= 2
  const nameLines = wrapText(input.holderName, 'bold', nameSize, maxNameW).slice(0, 2)
  nameLines.forEach((l, i) => p.centred(l, H - 240 - i * (nameSize + 6), 'bold', nameSize, INK))
  const afterName = H - 240 - (nameLines.length - 1) * (nameSize + 6)
  p.line(W / 2 - 200, afterName - 10, W / 2 + 200, afterName - 10, 0.75, MUTED)

  p.centred('has successfully completed the programme', afterName - 42, 'regular', 14, MUTED)
  const titleLines = wrapText(input.programmeTitle, 'bold', 22, W - 200).slice(0, 2)
  titleLines.forEach((l, i) => p.centred(l, afterName - 76 - i * 28, 'bold', 22, ACCENT))

  // issue details
  const detailY = 150
  p.centred(`Issued on ${formatIssuedOn(input.issuedOn)}`, detailY + 20, 'regular', 12, INK)
  p.centred(`Certificate No. ${input.certificateNo}`, detailY, 'bold', 12, INK)

  // signatory line (left) and verification block (right)
  p.line(90, 96, 270, 96, 0.75, MUTED)
  p.text('Authorised signatory', 90, 82, 'regular', 10, MUTED)
  const vx = W - 90
  const heading = 'Verify this certificate', code = `Code: ${input.verificationCode}`
  p.text(heading, vx - textWidth(heading, 'bold', 10), 108, 'bold', 10, INK)
  p.text(input.verifyUrl, vx - textWidth(input.verifyUrl, 'regular', 9), 94, 'regular', 9, ACCENT)
  p.text(code, vx - textWidth(code, 'regular', 9), 80, 'regular', 9, MUTED)
  const urlW = textWidth(input.verifyUrl, 'regular', 9)
  const linkRect = `[${n(vx - urlW)} 91 ${n(vx)} 104]`

  // ---- objects
  const jpeg = Buffer.from(LOGO_JPEG_BASE64, 'base64')
  const content = Buffer.from(p.content(), 'latin1')
  const uri = input.verifyUrl.replace(/[\\()]/g, (c) => `\\${c}`)
  if (!/^https?:\/\/[\x21-\x7e]+$/.test(input.verifyUrl)) throw new Error('verifyUrl must be an absolute http(s) URL without spaces')

  const objs: Array<Buffer | string> = []
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objs[2] = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>'
  objs[3] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(W)} ${n(H)}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> /XObject << /Im1 6 0 R >> >> /Contents 7 0 R /Annots [8 0 R] >>`
  objs[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
  objs[5] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'
  objs[6] = Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${LOGO_WIDTH} /Height ${LOGO_HEIGHT} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`, 'latin1'), jpeg, Buffer.from('\nendstream', 'latin1')])
  objs[7] = Buffer.concat([Buffer.from(`<< /Length ${content.length} >>\nstream\n`, 'latin1'), content, Buffer.from('\nendstream', 'latin1')])
  objs[8] = `<< /Type /Annot /Subtype /Link /Rect ${linkRect} /Border [0 0 0] /A << /S /URI /URI (${uri}) >> >>`
  objs[9] = `<< /Title ${pdfHex(`Certificate ${input.certificateNo}`)} /Producer (NCCP backend) /CreationDate (${pdfDate(now)}) >>`

  const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')]
  const offsets: number[] = []; let pos = chunks[0]!.length
  for (let i = 1; i < objs.length; i++) {
    offsets[i] = pos
    const body = objs[i] as Buffer | string
    const b = Buffer.concat([Buffer.from(`${i} 0 obj\n`, 'latin1'), typeof body === 'string' ? Buffer.from(body, 'latin1') : body, Buffer.from('\nendobj\n', 'latin1')])
    chunks.push(b); pos += b.length
  }
  let xref = `xref\n0 ${objs.length}\n0000000000 65535 f \n`
  for (let i = 1; i < objs.length; i++) xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  xref += `trailer\n<< /Size ${objs.length} /Root 1 0 R /Info 9 0 R >>\nstartxref\n${pos}\n%%EOF\n`
  chunks.push(Buffer.from(xref, 'latin1'))
  return Buffer.concat(chunks)
}

/** Everything the renderer will print, in one list, so the service can check it against the standard fonts before rendering. */
export const printedFields = (i: CertificatePdfInput): string[] => [i.holderName, i.programmeTitle, i.certificateNo, i.verificationCode, formatIssuedOn(i.issuedOn)]
