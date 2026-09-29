import type { Db } from '../db/pool.js'
import { AppError } from './errors.js'

export interface I18nConfig { defaultLanguage: string; enabledLanguages: string[] }

/** BCP-47-ish tag: primary subtag plus optional region/script, lower-cased primary (matches the DB CHECK). */
export const LANGUAGE_RE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/

export function isLanguageTag(v: string): boolean { return LANGUAGE_RE.test(v) }

/** Parse a comma separated list from configuration. Throws on a malformed tag so a typo fails at startup. */
export function parseLanguageList(raw: string): string[] {
  const out = raw.split(',').map((s) => s.trim()).filter(Boolean)
  for (const l of out) if (!isLanguageTag(l)) throw new Error(`invalid language tag "${l}"`)
  return [...new Set(out)]
}

export function assertEnabledLanguage(cfg: I18nConfig, lang: string, path = 'lang'): string {
  if (!isLanguageTag(lang) || !cfg.enabledLanguages.includes(lang)) {
    throw AppError.validation([{ path, message: `Language must be one of: ${cfg.enabledLanguages.join(', ')}` }])
  }
  return lang
}

/**
 * Which language to serve: explicit request > the user's saved preference (if still enabled) > default.
 * `requested` is validated (422 when not enabled); a stale saved preference silently falls back to the default.
 */
export function pickLanguage(cfg: I18nConfig, requested: string | undefined, preferred: string | null | undefined): string {
  if (requested) return assertEnabledLanguage(cfg, requested)
  if (preferred && cfg.enabledLanguages.includes(preferred)) return preferred
  return cfg.defaultLanguage
}

export async function resolveLanguage(db: Db, cfg: I18nConfig, userId: string, requested?: string): Promise<string> {
  if (requested) return pickLanguage(cfg, requested, null)
  const r = await db.query(`SELECT preferred_language FROM users WHERE id = $1`, [userId])
  return pickLanguage(cfg, undefined, (r.rows[0] as { preferred_language?: string } | undefined)?.preferred_language)
}

/**
 * Overlay localized text on base rows. `base` holds default-language text. When a translation exists it wins field by field
 * (a null translated description/content falls back to base for that field). Reports `translated` so the UI can show the notice.
 */
export function overlayText<T extends { title: string }>(base: T, tr: { title: string; [k: string]: unknown } | undefined, fields: readonly string[]): T & { translated: boolean } {
  if (!tr) return { ...base, translated: false }
  const out: Record<string, unknown> = { ...base, title: tr.title }
  for (const f of fields) if (f !== 'title' && tr[f] !== null && tr[f] !== undefined) out[f] = tr[f]
  return { ...(out as T), translated: true }
}
