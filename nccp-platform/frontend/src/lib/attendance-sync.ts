/**
 * Real-time Attendance Synchronization Engine
 * Bridges Trainer Workspace, Trainee Portal, and Mobile QR Scan Check-In
 * Works across browser tabs, windows, and devices using BroadcastChannel,
 * StorageEvents, and PostgreSQL backend workspace API.
 */

import { workspaceApi } from './nccp-api'

export const ATTENDANCE_SYSTEM_NAME = 'NCCP Smart QR Attendance System'
export const ATTENDANCE_CHANNEL = 'nccp-attendance-sync'
export const STORAGE_ACTIVE_SESSION = 'nccp-active-qr-session'
export const STORAGE_REGISTERED_TRAINEES = 'nccp-registered-trainees'

export interface ActiveQrSession {
  token: string
  batch: string
  course: string
  date: string
  trainer: string
  createdAt: string
  systemName: string
}

export interface AttendanceMarkedPayload {
  traineeName: string
  traineeEmail?: string
  traineeId?: string
  batchCode: string
  courseName?: string
  date: string
  time: string
  method: string
  token: string
  systemName: string
  status: 'Present' | 'Late' | string
  source?: 'mobile_qr' | 'trainee_portal' | 'manual'
}

export interface RegisteredTrainee {
  id: string
  name: string
  email: string
  phone?: string
  batch: string
  programme: string
  generatedPassword?: string
  district?: string
  status: string
  createdAt: string
}

const DEFAULT_TRAINEES: RegisteredTrainee[] = [
  {
    id: 'TRN-2026-1048',
    name: 'Ravi Kumar',
    email: 'ravi@example.in',
    phone: '+91 98765 43210',
    batch: 'DCM-2026-04',
    programme: 'Dairy Cooperative Management',
    status: 'Active',
    createdAt: '2026-09-01',
  },
  {
    id: 'TRN-2026-2091',
    name: 'Amaan Siddiqui',
    email: 'amaan@example.in',
    phone: '+91 98111 22334',
    batch: 'DCM-2026-04',
    programme: 'Dairy Cooperative Management',
    status: 'Active',
    createdAt: '2026-09-01',
  },
  {
    id: 'TRN-2026-3482',
    name: 'Neha Singh',
    email: 'neha@example.in',
    phone: '+91 98222 33445',
    batch: 'DSC-2026-08',
    programme: 'Digital Skills for Cooperatives',
    status: 'Active',
    createdAt: '2026-09-05',
  },
  {
    id: 'TRN-2026-4590',
    name: 'Pooja Kumari',
    email: 'pooja@example.in',
    phone: '+91 98333 44556',
    batch: 'DSC-2026-08',
    programme: 'Digital Skills for Cooperatives',
    status: 'Active',
    createdAt: '2026-09-05',
  },
]

// -------------------------------------------------------------
// Trainee Registry
// -------------------------------------------------------------
export function getRegisteredTrainees(): RegisteredTrainee[] {
  try {
    const raw = localStorage.getItem(STORAGE_REGISTERED_TRAINEES)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed
      }
    }
  } catch {
    /* fallback to defaults */
  }
  return DEFAULT_TRAINEES
}

export function saveRegisteredTrainee(trainee: RegisteredTrainee): void {
  const current = getRegisteredTrainees()
  const exists = current.some((t) => t.id === trainee.id || t.email === trainee.email)
  const updated = exists ? current.map((t) => (t.id === trainee.id ? trainee : t)) : [trainee, ...current]
  try {
    localStorage.setItem(STORAGE_REGISTERED_TRAINEES, JSON.stringify(updated))
  } catch {
    /* ignore */
  }
}

// -------------------------------------------------------------
// Active Session Broadcast
// -------------------------------------------------------------
export function broadcastSessionCreated(session: ActiveQrSession): void {
  try {
    localStorage.setItem(STORAGE_ACTIVE_SESSION, JSON.stringify(session))
  } catch {
    /* ignore */
  }

  // Broadcast to other windows / tabs
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel(ATTENDANCE_CHANNEL)
      channel.postMessage({ type: 'SESSION_OPENED', session })
      channel.close()
    }
  } catch {
    /* BroadcastChannel unsupported */
  }

  // Dispatch custom window event for same-tab listeners
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('nccp-session-opened', { detail: session }))
  }
}

export function getActiveSession(): ActiveQrSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_ACTIVE_SESSION)
    if (raw) {
      const session = JSON.parse(raw) as ActiveQrSession
      const today = new Date().toISOString().slice(0, 10)
      if (session && session.date === today) {
        return session
      }
    }
  } catch {
    /* ignore */
  }
  return null
}

// -------------------------------------------------------------
// Mark Attendance Record & Reflect in Both Workspaces
// -------------------------------------------------------------
export async function recordAttendance(payload: AttendanceMarkedPayload): Promise<{ id: string }> {
  const id = crypto.randomUUID()
  const nowTime = payload.time || new Date().toTimeString().slice(0, 5)
  const nowDate = payload.date || new Date().toISOString().slice(0, 10)

  // 1. Update Trainer Workspace records in localStorage
  try {
    const trainerKey = 'nccp-trainer-workspace-v1'
    const rawTrainer = localStorage.getItem(trainerKey)
    const trainerStore = rawTrainer ? JSON.parse(rawTrainer) : {}
    const currentAtt = Array.isArray(trainerStore.Attendance) ? [...trainerStore.Attendance] : []

    // Check if trainee already marked present today
    const existingIndex = currentAtt.findIndex(
      (r: any) =>
        (r.values?.[0] ?? '').toLowerCase() === payload.traineeName.toLowerCase() &&
        r.values?.[2] === nowDate
    )

    const trainerRecord = {
      id: existingIndex >= 0 ? currentAtt[existingIndex].id : id,
      values: [
        payload.traineeName,
        payload.batchCode,
        nowDate,
        payload.method,
        `${nowTime} · ${payload.systemName}`,
      ],
      status: payload.status,
    }

    if (existingIndex >= 0) {
      currentAtt[existingIndex] = trainerRecord
    } else {
      currentAtt.unshift(trainerRecord)
    }

    trainerStore.Attendance = currentAtt
    localStorage.setItem(trainerKey, JSON.stringify(trainerStore))

    // Save directly to PostgreSQL workspace_records for trainer
    void workspaceApi
      .save('trainer', 'Attendance', {
        id: trainerRecord.id,
        data: trainerRecord,
        status: payload.status,
      })
      .catch(() => {})
  } catch (err) {
    console.warn('[attendance-sync] trainer update error:', err)
  }

  // 2. Update Trainee Workspace records in localStorage
  try {
    const traineeKey = 'nccp-trainee-workspace-v1'
    const rawTrainee = localStorage.getItem(traineeKey)
    const traineeStore = rawTrainee ? JSON.parse(rawTrainee) : {}
    const traineeAtt = Array.isArray(traineeStore.Attendance) ? [...traineeStore.Attendance] : []

    const sessionTitle = payload.courseName || payload.batchCode || 'Dairy Cooperative Management'
    const traineeRecord = {
      id,
      values: [
        sessionTitle,
        payload.batchCode,
        nowDate,
        payload.method,
        `${nowTime} (Token: ${payload.token}) · ${payload.systemName}`,
      ],
      status: payload.status,
    }

    traineeAtt.unshift(traineeRecord)
    traineeStore.Attendance = traineeAtt
    localStorage.setItem(traineeKey, JSON.stringify(traineeStore))

    // Save directly to PostgreSQL workspace_records for trainee
    void workspaceApi
      .save('trainee', 'Attendance', {
        id,
        data: traineeRecord,
        status: payload.status,
      })
      .catch(() => {})
  } catch (err) {
    console.warn('[attendance-sync] trainee update error:', err)
  }

  // 3. Broadcast real-time event to all open tabs and windows
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel(ATTENDANCE_CHANNEL)
      channel.postMessage({
        type: 'ATTENDANCE_MARKED',
        payload: { ...payload, id, time: nowTime, date: nowDate },
      })
      channel.close()
    }
  } catch {
    /* BroadcastChannel unsupported */
  }

  // 4. Dispatch DOM custom event and storage notification
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('nccp-attendance-marked', {
        detail: { ...payload, id, time: nowTime, date: nowDate },
      })
    )
    try {
      localStorage.setItem('nccp-latest-attendance-timestamp', String(Date.now()))
    } catch {
      /* ignore */
    }
  }

  return { id }
}
