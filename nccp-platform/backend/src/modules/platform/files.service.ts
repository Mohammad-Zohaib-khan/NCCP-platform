import { randomBytes, createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { Db } from '../../db/pool.js'
import { withTransaction } from '../../db/pool.js'
import { AppError } from '../../lib/errors.js'
import { writeAudit } from '../../audit/audit.js'
import { isSuperAdmin, type AuthContext } from '../../auth/context.js'
import type { ReqInfo } from '../auth/service.js'

type Row = Record<string, unknown>

export type FilePurpose = 'avatar' | 'resume' | 'course_resource' | 'certificate' | 'employer_document' | 'institution_document' | 'other'
export type FileVisibility = 'private' | 'org' | 'authenticated'

export interface FileMetadata {
  id: string; storageKey: string; originalName: string; contentType: string; sizeBytes: number
  sha256: string | null; purpose: FilePurpose; visibility: FileVisibility; scanStatus: string
  ownerUserId: string | null; institutionId: string | null; employerId: string | null
  createdAt: Date
}

export interface FileUploadInput {
  originalName: string; contentType: string; data: Buffer; purpose: FilePurpose; visibility?: FileVisibility
  institutionId?: string | null; employerId?: string | null
}

const COLS = `f.id, f.storage_key, f.original_name, f.content_type, f.size_bytes::bigint AS size_bytes,
  f.sha256, f.purpose, f.visibility, f.scan_status, f.owner_user_id, f.institution_id, f.employer_id, f.created_at`

const toFileMetadata = (r: Row): FileMetadata => ({
  id: r.id as string,
  storageKey: r.storage_key as string,
  originalName: r.original_name as string,
  contentType: r.content_type as string,
  sizeBytes: Number(r.size_bytes),
  sha256: (r.sha256 as string | null) ?? null,
  purpose: r.purpose as FilePurpose,
  visibility: r.visibility as FileVisibility,
  scanStatus: r.scan_status as string,
  ownerUserId: (r.owner_user_id as string | null) ?? null,
  institutionId: (r.institution_id as string | null) ?? null,
  employerId: (r.employer_id as string | null) ?? null,
  createdAt: r.created_at as Date,
})

const MAX_FILE_SIZE = 25 * 1024 * 1024 // 25 MB

export function createFilesService(db: Db, storageDir = './uploads') {

  async function ensureStorageDir(): Promise<void> {
    try {
      await fs.mkdir(storageDir, { recursive: true })
    } catch {
      // directory already exists
    }
  }

  async function upload(actor: AuthContext, input: FileUploadInput, info: ReqInfo): Promise<FileMetadata> {
    if (input.data.length > MAX_FILE_SIZE) {
      throw new AppError(413, 'PAYLOAD_TOO_LARGE', `File size exceeds the 25 MB limit`)
    }
    if (!input.originalName?.trim()) {
      throw AppError.validation([{ path: 'originalName', message: 'Original file name is required' }])
    }

    const sha256 = createHash('sha256').update(input.data).digest('hex')
    const ext = path.extname(input.originalName).slice(0, 10)
    const storageKey = `${Date.now()}-${randomBytes(16).toString('hex')}${ext}`

    await ensureStorageDir()
    const filePath = path.join(storageDir, storageKey)
    await fs.writeFile(filePath, input.data)

    const visibility: FileVisibility = input.visibility ?? 'private'

    const id = await withTransaction(db, async (tx) => {
      const res = await tx.query(
        `INSERT INTO files (
          storage_key, original_name, content_type, size_bytes, sha256, purpose,
          visibility, scan_status, owner_user_id, institution_id, employer_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'clean', $8, $9, $10)
        RETURNING id`,
        [
          storageKey, input.originalName.trim(), input.contentType, input.data.length, sha256,
          input.purpose, visibility, actor.userId,
          input.institutionId ?? (actor.institutionIds[0] ?? null),
          input.employerId ?? (actor.employerIds[0] ?? null),
        ],
      )
      const fileId = (res.rows[0] as Row).id as string
      await writeAudit(tx, {
        action: 'file.upload',
        actorUserId: actor.userId,
        actorRole: actor.role,
        entityType: 'file',
        entityId: fileId,
        institutionId: input.institutionId ?? null,
        employerId: input.employerId ?? null,
        requestId: info.requestId,
        ip: info.ip,
        userAgent: info.userAgent,
        changes: { originalName: input.originalName, sizeBytes: input.data.length, purpose: input.purpose },
      })
      return fileId
    })

    return get(actor, id)
  }

  async function get(actor: AuthContext, id: string): Promise<FileMetadata> {
    const r = await db.query(`SELECT ${COLS} FROM files f WHERE f.id = $1 AND f.deleted_at IS NULL`, [id])
    const row = r.rows[0] as Row | undefined
    if (!row) throw AppError.notFound('File')

    const file = toFileMetadata(row)

    // Authorization checks
    if (!isSuperAdmin(actor)) {
      if (file.visibility === 'authenticated') {
        // all logged in users can see
      } else if (file.visibility === 'org') {
        const matchesInstitution = file.institutionId && actor.institutionIds.includes(file.institutionId)
        const matchesEmployer = file.employerId && actor.employerIds.includes(file.employerId)
        const isOwner = file.ownerUserId === actor.userId
        if (!matchesInstitution && !matchesEmployer && !isOwner) {
          throw AppError.notFound('File')
        }
      } else {
        // private: owner only
        if (file.ownerUserId !== actor.userId) {
          throw AppError.notFound('File')
        }
      }
    }

    return file
  }

  async function download(actor: AuthContext, id: string): Promise<{ meta: FileMetadata; data: Buffer }> {
    const meta = await get(actor, id)
    const filePath = path.join(storageDir, meta.storageKey)
    try {
      const data = await fs.readFile(filePath)
      return { meta, data }
    } catch {
      throw AppError.notFound('File contents')
    }
  }

  async function softDelete(actor: AuthContext, id: string, info: ReqInfo): Promise<void> {
    const meta = await get(actor, id)
    if (!isSuperAdmin(actor) && meta.ownerUserId !== actor.userId) {
      throw AppError.forbidden('You can only delete files you uploaded')
    }

    await withTransaction(db, async (tx) => {
      await tx.query(`UPDATE files SET deleted_at = now() WHERE id = $1`, [id])
      await writeAudit(tx, {
        action: 'file.delete',
        actorUserId: actor.userId,
        actorRole: actor.role,
        entityType: 'file',
        entityId: id,
        requestId: info.requestId,
        ip: info.ip,
        userAgent: info.userAgent,
      })
    })
  }

  return { upload, get, download, softDelete }
}

export type FilesService = ReturnType<typeof createFilesService>
