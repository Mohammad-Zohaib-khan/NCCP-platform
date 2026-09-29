import type { Db } from '../../db/pool.js'
import { AppError } from '../../lib/errors.js'
import type { PageParams } from '../../lib/pagination.js'
import { keysetList, likePattern, type ParsedSort } from '../../lib/list-query.js'
import { isSuperAdmin, type AuthContext } from '../../auth/context.js'
import { parseSkillList } from './employment.rules.js'

type Row = Record<string, unknown>

export interface CandidateFilter {
  skills?: string; location?: string; state?: string; district?: string; hasCertificate?: boolean; q?: string
}

export interface CandidateDto {
  traineeId: string; fullName: string; skills: string[]; location: string | null
  district: string | null; state: string | null; highestQualification: string | null
  hasCertificate: boolean; certificateCount: number
}

const COLS = `t.id AS trainee_id, u.full_name, t.skills, t.location, t.district, t.state,
  t.highest_qualification,
  (SELECT count(*)::int FROM certificates c WHERE c.trainee_id = t.id AND c.status = 'issued') AS cert_count,
  EXISTS(SELECT 1 FROM certificates c WHERE c.trainee_id = t.id AND c.status = 'issued') AS has_cert`

export function createCandidatesService(db: Db) {

  async function search(actor: AuthContext, f: CandidateFilter, sort: ParsedSort, page: PageParams) {
    if (actor.role !== 'employer' && !isSuperAdmin(actor)) {
      throw AppError.forbidden('Only employers and NCCP administrators can search candidates')
    }

    const params: unknown[] = []
    const where = ['t.deleted_at IS NULL', 'u.deleted_at IS NULL', 'u.is_active = TRUE']

    if (f.location) { params.push(likePattern(f.location)); where.push(`t.location ILIKE $${params.length}`) }
    if (f.state) { params.push(f.state); where.push(`t.state = $${params.length}`) }
    if (f.district) { params.push(f.district); where.push(`t.district = $${params.length}`) }
    if (f.hasCertificate) {
      where.push(`EXISTS(SELECT 1 FROM certificates c WHERE c.trainee_id = t.id AND c.status = 'issued')`)
    }
    if (f.skills) {
      const skills = parseSkillList(f.skills)
      if (skills.length) {
        params.push(skills)
        where.push(`t.skills && $${params.length}::text[]`)
      }
    }
    if (f.q) {
      params.push(likePattern(f.q))
      where.push(`(u.full_name ILIKE $${params.length} OR t.location ILIKE $${params.length})`)
    }

    return keysetList(db, {
      select: COLS,
      from: 'trainees t JOIN users u ON u.id = t.user_id',
      where,
      params,
      sort,
      idExpr: 't.id',
      page,
      map: (r: Row): CandidateDto => ({
        traineeId: r.trainee_id as string,
        fullName: r.full_name as string,
        skills: (r.skills as string[]) ?? [],
        location: (r.location as string | null) ?? null,
        district: (r.district as string | null) ?? null,
        state: (r.state as string | null) ?? null,
        highestQualification: (r.highest_qualification as string | null) ?? null,
        hasCertificate: Boolean(r.has_cert),
        certificateCount: r.cert_count as number,
      }),
    })
  }

  return { search }
}

export type CandidatesService = ReturnType<typeof createCandidatesService>
