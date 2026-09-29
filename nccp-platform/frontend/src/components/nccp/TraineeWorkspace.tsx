import React, { useEffect, useMemo, useState } from 'react'
import {
  ArrowRight,
  Award,
  Bell,
  BookOpen,
  Bot,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  Download,
  Fingerprint,
  GraduationCap,
  HelpCircle,
  Home,
  Languages,
  Layers3,
  LifeBuoy,
  LogOut,
  Menu,
  Pencil,
  PlayCircle,
  Plus,
  Printer,
  QrCode,
  Scan,
  Search,
  Send,
  Share2,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserRound,
  Wallet,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import brand from '@/assets/nccp/10_institution_logo_brand.png'
import banner from '@/assets/nccp/03_hero_cooperative_people.png'
import { workspaceApi } from '@/lib/nccp-api'
import { useI18n } from '@/lib/i18n-context'
import {
  ATTENDANCE_SYSTEM_NAME,
  ATTENDANCE_CHANNEL,
  recordAttendance,
  ActiveQrSession,
} from '@/lib/attendance-sync'
import { FaceCaptureModal } from './FaceCaptureModal'
import { QrCodeSvg } from './QrCodeGenerator'
import './TrainerWorkspace.css'
import './TraineeWorkspace.css'

type Section =
  | 'Dashboard'
  | 'Programmes'
  | 'My Learning'
  | 'Course Player'
  | 'Assessments'
  | 'Attendance'
  | 'Certificates'
  | 'Skill Wallet'
  | 'Jobs & Placements'
  | 'My Applications'
  | 'AI Career Assistant'
  | 'Timetable'
  | 'Hostel'
  | 'Notifications'
  | 'Profile'
  | 'Help & Support'

type Rec = { id: string; values: string[]; status: string }
type Store = Record<string, Rec[]>
type Schema = { fields: string[]; statuses: string[]; rows: [string[], string][]; note: string }
type Profile = {
  name: string
  phone: string
  email: string
  district: string
  education: string
  goal: string
  room: string
  bed: string
  block: string
  hostelStatus: string
}

const schemas: Partial<Record<Section, Schema>> = {
  'Programmes': {
    note: 'Discover programmes, apply and track nomination status',
    fields: ['Programme', 'Institution', 'Duration', 'Mode', 'Sector'],
    statuses: ['Open', 'Applied', 'Nominated', 'Enrolled', 'Rejected'],
    rows: [
      [['Dairy Cooperative Management', 'VAMNICOM Pune', '12 weeks', 'Hybrid', 'Dairy'], 'Enrolled'],
      [['Digital Skills for Cooperatives', 'NCUI New Delhi', '8 weeks', 'Online', 'Digital'], 'Enrolled'],
      [['Cooperative Finance & Accounting', 'ICM Lucknow', '10 weeks', 'Offline', 'Finance'], 'Open'],
      [['Agri Value Chain Development', 'RICM Bhopal', '6 weeks', 'Offline', 'Agriculture'], 'Nominated'],
    ],
  },
  'My Learning': {
    note: 'Enrolled courses, modules and your progress',
    fields: ['Course', 'Programme', 'Trainer', 'Total lessons', 'Current module'],
    statuses: ['In progress', 'Not started', 'Completed'],
    rows: [
      [['Cooperative Principles', 'Dairy Cooperative Management', 'Dr. Rajesh Kumar', '4', 'Module 1'], 'In progress'],
      [['Dairy Supply Chain', 'Dairy Cooperative Management', 'Dr. Rajesh Kumar', '3', 'Module 2'], 'In progress'],
      [['Digital Bookkeeping', 'Digital Skills for Cooperatives', 'Priya Singh', '3', 'Module 1'], 'Not started'],
    ],
  },
  'Assessments': {
    note: 'Upcoming quizzes, attempts, results and retakes',
    fields: ['Assessment', 'Course', 'Date', 'Duration', 'Score %', 'Retakes left'],
    statuses: ['Upcoming', 'Completed'],
    rows: [
      [['Cooperative Principles Quiz', 'Cooperative Principles', '2026-10-02', '15 min', '', '1'], 'Upcoming'],
      [['Dairy Operations Check', 'Dairy Supply Chain', '2026-10-06', '20 min', '', '1'], 'Upcoming'],
      [['Orientation Quiz', 'Cooperative Principles', '2026-09-20', '10 min', '82', '0'], 'Completed'],
    ],
  },
  'Attendance': {
    note: 'Attendance history, check-ins and correction requests',
    fields: ['Session', 'Course', 'Date', 'Method', 'Time / note'],
    statuses: ['Present', 'Late', 'Absent', 'Correction requested'],
    rows: [
      [['Cooperative Principles', 'Cooperative Principles', '2026-09-25', 'QR', '09:56'], 'Present'],
      [['Dairy Supply Chain', 'Dairy Supply Chain', '2026-09-24', 'Fingerprint', '10:05'], 'Late'],
      [['Value Chain Workshop', 'Dairy Supply Chain', '2026-09-23', 'Manual', ''], 'Absent'],
      [['Cooperative Principles', 'Cooperative Principles', '2026-09-22', 'QR', '09:58'], 'Present'],
    ],
  },
  'Certificates': {
    note: 'View, download, print, share and verify certificates',
    fields: ['Certificate', 'Course', 'Issue date', 'Certificate ID', 'Grade'],
    statuses: ['Issued', 'Pending'],
    rows: [
      [['Orientation to Cooperatives', 'Cooperative Principles', '2026-09-21', 'NCCP-2026-10482', 'A'], 'Issued'],
      [['Digital Literacy Basics', 'Digital Bookkeeping', '2026-08-14', 'NCCP-2026-09317', 'B+'], 'Issued'],
    ],
  },
  'Jobs & Placements': {
    note: 'Skill-matched jobs, saved roles and applications',
    fields: ['Role', 'Employer', 'Location', 'Salary / month', 'Required skills'],
    statuses: ['Open', 'Saved', 'Applied', 'Closed'],
    rows: [
      [['Dairy Collection Supervisor', 'Amul Cooperative', 'Anand, Gujarat', '₹18,000', 'Dairy operations, Record keeping'], 'Open'],
      [['Cooperative Accounts Assistant', 'IFFCO', 'Lucknow, UP', '₹16,500', 'Bookkeeping, Excel'], 'Open'],
      [['Field Mobiliser', 'NAFED', 'Bhopal, MP', '₹15,000', 'Communication, Cooperative principles'], 'Saved'],
      [['Digital Services Operator', 'PACS Digital Centre', 'Patna, Bihar', '₹14,000', 'Digital literacy, Excel'], 'Open'],
    ],
  },
  'My Applications': {
    note: 'Track every application from applied to joined',
    fields: ['Role', 'Employer', 'Applied on', 'Next step'],
    statuses: ['Applied', 'Under Review', 'Shortlisted', 'Interview', 'Offer', 'Joined', 'Rejected'],
    rows: [
      [['Milk Procurement Assistant', 'Sudha Dairy', '2026-09-18', 'Interview on 3 Oct'], 'Interview'],
      [['Warehouse Assistant', 'KRIBHCO', '2026-09-10', 'Awaiting review'], 'Under Review'],
    ],
  },
  'Timetable': {
    note: 'Upcoming classes, batch schedule and assessments',
    fields: ['Session', 'Type', 'Date', 'Time', 'Room / link', 'Batch'],
    statuses: ['Scheduled', 'Completed', 'Cancelled'],
    rows: [
      [['Cooperative Principles', 'Class', '2026-09-28', '10:00', 'Room 201', 'DCM-2026-04'], 'Scheduled'],
      [['Dairy Supply Chain', 'Class', '2026-09-29', '14:00', 'Online link', 'DCM-2026-04'], 'Scheduled'],
      [['Cooperative Principles Quiz', 'Assessment', '2026-10-02', '11:00', 'Lab 2', 'DCM-2026-04'], 'Scheduled'],
    ],
  },
  'Hostel': {
    note: 'Room details, check-in/out, room change and complaints',
    fields: ['Request', 'Type', 'Date', 'Details'],
    statuses: ['Open', 'In progress', 'Resolved'],
    rows: [
      [['Fan not working', 'Complaint', '2026-09-24', 'Ceiling fan in room B-204 stopped working.'], 'In progress'],
      [['Hostel check-in', 'Check-in', '2026-09-01', 'Checked in with ID verification.'], 'Resolved'],
    ],
  },
  'Notifications': {
    note: 'Alerts about classes, assessments, jobs and certificates',
    fields: ['Title', 'Message', 'Date', 'Category'],
    statuses: ['Unread', 'Read'],
    rows: [
      [['Quiz scheduled', 'Cooperative Principles Quiz on 2 October at 11:00.', '2026-09-27', 'Assessment'], 'Unread'],
      [['New job match', 'Dairy Collection Supervisor at Amul matches your skills.', '2026-09-26', 'Jobs'], 'Unread'],
      [['Certificate issued', 'Your Orientation certificate is ready to download.', '2026-09-21', 'Certificate'], 'Read'],
    ],
  },
  'Help & Support': {
    note: 'Raise a ticket and track responses',
    fields: ['Subject', 'Category', 'Date', 'Details'],
    statuses: ['Open', 'Resolved'],
    rows: [
      [['Unable to open PDF lesson', 'Learning', '2026-09-20', 'The PDF for Module 1 did not load on mobile.'], 'Resolved'],
    ],
  },
}

const lessonSeed: [string[], string][] = [
  [['What is a cooperative?', 'Cooperative Principles', 'Video', '12 min', 'English', 'Yes'], 'Completed'],
  [['Seven cooperative principles', 'Cooperative Principles', 'PDF', '15 min', 'Hindi', 'No'], 'Completed'],
  [['Member rights & duties', 'Cooperative Principles', 'Text', '10 min', 'English', 'No'], 'Not started'],
  [['Cooperative governance', 'Cooperative Principles', 'Audio', '14 min', 'Marathi', 'No'], 'Not started'],
  [['Milk collection process', 'Dairy Supply Chain', 'Video', '18 min', 'English', 'No'], 'Completed'],
  [['Quality testing basics', 'Dairy Supply Chain', 'PDF', '12 min', 'Hindi', 'No'], 'Not started'],
  [['Cold chain & logistics', 'Dairy Supply Chain', 'Audio', '11 min', 'English', 'No'], 'Not started'],
  [['Introduction to ledgers', 'Digital Bookkeeping', 'Video', '16 min', 'English', 'No'], 'Not started'],
  [['Spreadsheet basics', 'Digital Bookkeeping', 'Text', '9 min', 'English', 'No'], 'Not started'],
  [['Monthly accounts practice', 'Digital Bookkeeping', 'PDF', '20 min', 'Hindi', 'No'], 'Not started'],
]

const skillSeed: [string[], string][] = [
  [['Cooperative principles', '85', 'Orientation Quiz', 'VAMNICOM Pune'], 'Verified'],
  [['Dairy operations', '60', 'Dairy Supply Chain', 'Dr. Rajesh Kumar'], 'In progress'],
  [['Digital literacy', '78', 'Digital Literacy Basics', 'NCUI'], 'Verified'],
  [['Communication', '70', 'Group activities', 'Dr. Rajesh Kumar'], 'In progress'],
]

const quiz = [
  { q: 'Which principle means one member, one vote?', options: ['Democratic member control', 'Profit maximisation', 'Open pricing'], answer: 0 },
  { q: 'What is the main purpose of a cooperative?', options: ['Serve its members', 'Serve shareholders only', 'Collect taxes'], answer: 0 },
  { q: 'Who owns a cooperative?', options: ['The government', 'Its members', 'A single investor'], answer: 1 },
  { q: 'Education and training for members is…', options: ['Optional and discouraged', 'A core cooperative principle', 'Only for managers'], answer: 1 },
]

const nav: { label: Section; icon: typeof Home }[] = [
  { label: 'Dashboard', icon: Home },
  { label: 'Programmes', icon: Layers3 },
  { label: 'My Learning', icon: BookOpen },
  { label: 'Course Player', icon: PlayCircle },
  { label: 'Assessments', icon: ClipboardCheck },
  { label: 'Attendance', icon: CheckCircle2 },
  { label: 'Certificates', icon: Award },
  { label: 'Skill Wallet', icon: Wallet },
  { label: 'Jobs & Placements', icon: BriefcaseBusiness },
  { label: 'My Applications', icon: Send },
  { label: 'AI Career Assistant', icon: Bot },
  { label: 'Timetable', icon: CalendarDays },
  { label: 'Hostel', icon: Building2 },
  { label: 'Notifications', icon: Bell },
  { label: 'Profile', icon: UserRound },
  { label: 'Help & Support', icon: LifeBuoy },
]

const extraSchemas: Record<string, Schema> = {
  Lessons: { note: '', fields: ['Lesson', 'Course', 'Format', 'Duration', 'Language', 'Offline saved'], statuses: ['Not started', 'Completed'], rows: lessonSeed },
  Skills: { note: '', fields: ['Skill', 'Proficiency %', 'Evidence', 'Verified by'], statuses: ['Verified', 'In progress'], rows: skillSeed },
}

const allSchemas = (name: string): Schema | undefined => schemas[name as Section] ?? extraSchemas[name]
const storeKey = 'nccp-trainee-workspace-v1'
const profileKey = 'nccp-trainee-profile-v1'
const defaultProfile: Profile = {
  name: 'Ravi Kumar',
  phone: '+91 98765 43210',
  email: 'ravi.kumar@example.in',
  district: 'Sehore, Madhya Pradesh',
  education: 'Class 12 (Science)',
  goal: 'Dairy Collection Supervisor',
  room: 'B-204',
  bed: 'Bed 2',
  block: 'Block B · Boys hostel',
  hostelStatus: 'Checked in',
}

function initialStore(): Store {
  const names = [...Object.keys(schemas), ...Object.keys(extraSchemas)]
  return Object.fromEntries(
    names.map((name) => [name, (allSchemas(name)?.rows ?? []).map(([values, status], i) => ({ id: `${name}-${i}`, values, status }))])
  )
}

function saveFile(name: string, text: string, type = 'text/plain') {
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob(['\ufeff', text], { type: `${type};charset=utf-8` }))
  link.download = name
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1000)
}

const csv = (title: string, fields: string[], rows: Rec[]) => {
  const esc = (v: string) => `"${String(v).replaceAll('"', '""')}"`
  saveFile(
    `nccp-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.csv`,
    [fields.concat('Status'), ...rows.map((r) => r.values.concat(r.status))].map((r) => r.map(esc).join(',')).join('\r\n'),
    'text/csv'
  )
}
const good = ['Enrolled', 'Completed', 'Present', 'Issued', 'Verified', 'Joined', 'Offer', 'Resolved', 'Read', 'Scheduled', 'Nominated', 'Shortlisted']

export default function TraineeWorkspace({ onLogout }: { onLogout: () => void }) {
  const { t, language, setLanguage } = useI18n()
  const [section, setSection] = useState<Section>('Dashboard')
  const [data, setData] = useState<Store>(initialStore)
  const [profile, setProfile] = useState<Profile>(defaultProfile)
  const [profileDraft, setProfileDraft] = useState<Profile>(defaultProfile)
  const [hydrated, setHydrated] = useState(false)
  const [search, setSearch] = useState('')
  const [mobileOpen, setMobileOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [bellOpen, setBellOpen] = useState(false)
  const [modal, setModal] = useState<{ section: string; item?: Rec } | null>(null)
  const [draft, setDraft] = useState<string[]>([])
  const [draftStatus, setDraftStatus] = useState('')
  const [notice, setNotice] = useState('')
  const [lessonId, setLessonId] = useState('')
  const [quizFor, setQuizFor] = useState<Rec | null>(null)
  const [answers, setAnswers] = useState<number[]>([])
  const [verifyId, setVerifyId] = useState('')
  const [chat, setChat] = useState<{ me: boolean; text: string }[]>([
    { me: false, text: 'Namaste! I can help with career guidance, skill gaps, courses, jobs, resumes and interviews. Pick a topic below or type a question.' },
  ])
  const [chatInput, setChatInput] = useState('')
  const [faceModalOpen, setFaceModalOpen] = useState(false)

  // QR Scanner / Token Input state
  const [qrScanModalOpen, setQrScanModalOpen] = useState(false)
  const [inputQrToken, setInputQrToken] = useState('')
  const [scanningCamera, setScanningCamera] = useState(false)
  const [activeQrSession, setActiveQrSession] = useState<ActiveQrSession | null>(null)

  // Real-time synchronization for active QR sessions from the trainer
  useEffect(() => {
    const checkActiveSession = () => {
      try {
        const raw = localStorage.getItem('nccp-active-qr-session')
        if (raw) {
          const session = JSON.parse(raw)
          // Only show sessions from today
          if (session && session.date === new Date().toISOString().slice(0, 10)) {
            setActiveQrSession(session)
            if (!inputQrToken) setInputQrToken(session.token)
            return
          }
        }
        setActiveQrSession(null)
      } catch {
        /* ignore */
      }
    }
    checkActiveSession()

    let channel: BroadcastChannel | null = null
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        channel = new BroadcastChannel(ATTENDANCE_CHANNEL)
        channel.onmessage = (event) => {
          if (event.data?.type === 'SESSION_OPENED' && event.data?.session) {
            setActiveQrSession(event.data.session)
            setInputQrToken(event.data.session.token)
            flash(`🔴 Live Session Opened: ${event.data.session.course} (Token: ${event.data.session.token}). You can put present now!`)
          }
        }
      }
    } catch {
      /* ignore */
    }

    const onSessionOpened = (e: any) => {
      if (e.detail) {
        setActiveQrSession(e.detail)
        setInputQrToken(e.detail.token)
        flash(`🔴 Live Session Opened: ${e.detail.course} (Token: ${e.detail.token}). You can put present now!`)
      }
    }
    window.addEventListener('nccp-session-opened', onSessionOpened)

    const onStorage = (e: StorageEvent) => {
      if (e.key === 'nccp-active-qr-session') checkActiveSession()
    }
    window.addEventListener('storage', onStorage)

    const interval = setInterval(checkActiveSession, 2500)
    return () => {
      if (channel) channel.close()
      window.removeEventListener('nccp-session-opened', onSessionOpened)
      window.removeEventListener('storage', onStorage)
      clearInterval(interval)
    }
  }, [])

  // PostgreSQL workspace_records synchronization
  useEffect(() => {
    let mounted = true
    async function initDb() {
      try {
        const saved = window.localStorage.getItem(storeKey)
        if (saved) setData({ ...initialStore(), ...(JSON.parse(saved) as Store) })
        const p = window.localStorage.getItem(profileKey)
        if (p) {
          const parsed = { ...defaultProfile, ...(JSON.parse(p) as Partial<Profile>) }
          setProfile(parsed)
          setProfileDraft(parsed)
        }

        const res = await workspaceApi.list<Rec>('trainee')
        if (mounted && res?.data && res.data.length > 0) {
          const grouped: Store = initialStore()
          for (const item of res.data) {
            if (item.module === 'Profile') {
              if (item.data && typeof item.data === 'object') {
                const loadedProfile = { ...defaultProfile, ...(item.data as unknown as Partial<Profile>) }
                setProfile(loadedProfile)
                setProfileDraft(loadedProfile)
              }
              continue
            }
            if (!grouped[item.module]) grouped[item.module] = []
            const exists = grouped[item.module].some((r) => r.id === item.data.id)
            if (!exists) {
              grouped[item.module].push(item.data as Rec)
            } else {
              grouped[item.module] = grouped[item.module].map((r) => (r.id === item.data.id ? (item.data as Rec) : r))
            }
          }
          setData(grouped)
        } else if (mounted) {
          const seedItems = Object.entries(initialStore()).flatMap(([mod, rows]) =>
            rows.map((row) => ({
              id: `trainee-${mod}-${row.id}`,
              module: mod,
              data: row as unknown as Record<string, unknown>,
              status: row.status,
            }))
          )
          void workspaceApi.batchSync('trainee', seedItems).catch(() => { })
        }
      } catch (err) {
        console.warn('[TraineeWorkspace] Offline fallback used', err)
      } finally {
        if (mounted) setHydrated(true)
      }
    }
    initDb()
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    if (hydrated) {
      try {
        window.localStorage.setItem(storeKey, JSON.stringify(data))
        window.localStorage.setItem(profileKey, JSON.stringify(profile))
      } catch {
        /* memory only */
      }
    }
  }, [data, profile, hydrated])

  const rows = (name: string) => data[name] ?? []
  const update = (name: string, next: Rec[]) => setData((cur) => ({ ...cur, [name]: next }))
  const patch = (name: string, id: string, change: Partial<Rec>) => {
    update(
      name,
      rows(name).map((r) => {
        if (r.id !== id) return r
        const updated = { ...r, ...change }
        void workspaceApi.save('trainee', name, { id, data: updated, status: updated.status }).catch(() => { })
        return updated
      })
    )
  }
  const flash = (text: string) => {
    setNotice(text)
    window.setTimeout(() => setNotice(''), 3200)
  }
  const go = (name: Section) => {
    setSection(name)
    setSearch('')
    setMobileOpen(false)
    setBellOpen(false)
    setProfileOpen(false)
    window.scrollTo({ top: 0 })
  }
  const open = (name: string, item?: Rec) => {
    const s = allSchemas(name)
    if (!s) return
    setDraft(item ? [...item.values] : s.fields.map(() => ''))
    setDraftStatus(item?.status ?? s.statuses[0] ?? '')
    setModal(item ? { section: name, item } : { section: name })
  }
  const save = () => {
    if (!modal) return
    if (!draft[0]?.trim()) {
      flash('Please fill the first field.')
      return
    }
    const rec: Rec = { id: modal.item?.id ?? crypto.randomUUID(), values: draft.map((v) => v.trim()), status: draftStatus }
    update(modal.section, modal.item ? rows(modal.section).map((r) => (r.id === rec.id ? rec : r)) : [rec, ...rows(modal.section)])
    void workspaceApi.save('trainee', modal.section, { id: rec.id, data: rec, status: rec.status }).catch(() => { })
    setModal(null)
    flash('Saved to PostgreSQL. Your dashboard is updated.')
  }
  const remove = (name: string, item: Rec) => {
    if (!window.confirm(`Delete "${item.values[0]}"?`)) return
    update(name, rows(name).filter((r) => r.id !== item.id))
    void workspaceApi.delete('trainee', item.id, name).catch(() => { })
    flash('Deleted from PostgreSQL. Your dashboard is updated.')
  }
  const filtered = (name: string) =>
    rows(name).filter((r) => [...r.values, r.status].join(' ').toLowerCase().includes(search.toLowerCase()))
  const today = new Date().toISOString().slice(0, 10)
  const now = () => new Date().toTimeString().slice(0, 5)

  // Live derived values
  const courseStats = (course: string, declared: string) => {
    const ls = rows('Lessons').filter((l) => l.values[1] === course)
    const done = ls.filter((l) => l.status === 'Completed').length
    const total = Math.max(Number(declared) || 0, ls.length)
    return { done, total, pct: total ? Math.round((done / total) * 100) : 0 }
  }
  const courses = rows('My Learning').map((c) => ({ c, ...courseStats(c.values[0] ?? '', c.values[3] ?? '') }))
  const lessonsDone = rows('Lessons').filter((l) => l.status === 'Completed').length
  const overall = rows('Lessons').length ? Math.round((lessonsDone / rows('Lessons').length) * 100) : 0
  const att = rows('Attendance')
  const attPct = att.length ? Math.round((att.filter((r) => r.status === 'Present' || r.status === 'Late').length / att.length) * 100) : 0
  const certs = rows('Certificates').filter((r) => r.status === 'Issued')
  const skills = rows('Skills')
  const skillNames = skills.map((s) => (s.values[0] ?? '').toLowerCase())
  const match = (job: Rec) => {
    const req = (job.values[4] ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
    if (!req.length) return 0
    return Math.round((req.filter((r) => skillNames.some((s) => s.includes(r) || r.includes(s))).length / req.length) * 100)
  }
  const recommended = rows('Jobs & Placements')
    .filter((j) => j.status !== 'Closed' && match(j) >= 50)
    .sort((a, b) => match(b) - match(a))
  const upcomingSessions = rows('Timetable')
    .filter((r) => r.status === 'Scheduled' && (r.values[2] ?? '') >= today)
    .sort((a, b) => (a.values[2] ?? '').localeCompare(b.values[2] ?? ''))
  const upcomingTests = rows('Assessments').filter((r) => r.status === 'Upcoming')
  const unread = rows('Notifications').filter((r) => r.status === 'Unread')
  const scores = rows('Assessments')
    .map((r) => Number(r.values[4]))
    .filter((n) => Number.isFinite(n) && n > 0)
  const avgScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0
  const notify = (title: string, message: string, category: string) =>
    setData((cur) => ({
      ...cur,
      Notifications: [{ id: crypto.randomUUID(), values: [title, message, today, category], status: 'Unread' }, ...(cur['Notifications'] ?? [])],
    }))

  // Actions
  const applyProgramme = (p: Rec) => {
    patch('Programmes', p.id, { status: 'Applied' })
    notify('Application submitted', `Your application for ${p.values[0]} is under nomination review.`, 'Programme')
    flash(`Applied to ${p.values[0]}.`)
  }
  const currentLesson = rows('Lessons').find((l) => l.id === lessonId) ?? rows('Lessons').find((l) => l.status !== 'Completed') ?? rows('Lessons')[0]
  const continueCourse = (course: string) => {
    const next = rows('Lessons').find((l) => l.values[1] === course && l.status !== 'Completed') ?? rows('Lessons').find((l) => l.values[1] === course)
    if (next) setLessonId(next.id)
    go('Course Player')
  }
  const markComplete = (l: Rec) => {
    const nextStatus = l.status === 'Completed' ? 'Not started' : 'Completed'
    setData((cur) => {
      const lessons = (cur['Lessons'] ?? []).map((r) => (r.id === l.id ? { ...r, status: nextStatus } : r))
      const learning = (cur['My Learning'] ?? []).map((c) => {
        if (c.values[0] !== l.values[1]) return c
        const ls = lessons.filter((x) => x.values[1] === c.values[0])
        const done = ls.filter((x) => x.status === 'Completed').length
        return { ...c, status: done === 0 ? 'Not started' : done >= Math.max(ls.length, Number(c.values[3]) || 0) ? 'Completed' : 'In progress' }
      })
      return { ...cur, Lessons: lessons, 'My Learning': learning }
    })
    flash(nextStatus === 'Completed' ? 'Lesson completed. Progress updated.' : 'Lesson marked as not completed.')
  }
  const toggleOffline = (l: Rec) => {
    const v = [...l.values]
    v[5] = v[5] === 'Yes' ? 'No' : 'Yes'
    patch('Lessons', l.id, { values: v })
    flash(v[5] === 'Yes' ? 'Saved for offline use on this device.' : 'Removed from offline content.')
  }
  const startQuiz = (a: Rec) => {
    setAnswers(quiz.map(() => -1))
    setQuizFor(a)
  }
  const submitQuiz = () => {
    if (!quizFor) return
    if (answers.some((a) => a < 0)) {
      flash('Answer all questions before submitting.')
      return
    }
    const score = Math.round((answers.filter((a, i) => a === quiz[i]?.answer).length / quiz.length) * 100)
    const v = [...quizFor.values]
    const retake = quizFor.status === 'Completed'
    v[4] = String(score)
    if (retake) v[5] = String(Math.max(0, (Number(v[5]) || 0) - 1))
    patch('Assessments', quizFor.id, { values: v, status: 'Completed' })
    notify('Result published', `You scored ${score}% in ${v[0]}.`, 'Assessment')
    setQuizFor(null)
    flash(`Submitted! You scored ${score}%.`)
  }

  // Attendance Submission: Syncs with both Trainee and Trainer workspaces via ATTENDANCE_SYSTEM_NAME
  const submitAttendanceRecord = async (method: string, tokenInfo = '') => {
    const session = rows('Timetable').find((r) => r.values[2] === today && r.values[1] === 'Class')
    const sessionName = activeQrSession?.course || session?.values[0] || 'Dairy Cooperative Management'
    const batchCode = activeQrSession?.batch || session?.values[5] || 'DCM-2026-04'
    const token = activeQrSession?.token || inputQrToken || 'NCCP-DCM-8921'
    const currentTime = now()

    await recordAttendance({
      traineeName: profile.name,
      traineeEmail: profile.email,
      batchCode,
      courseName: sessionName,
      date: today,
      time: currentTime,
      method,
      token,
      systemName: ATTENDANCE_SYSTEM_NAME,
      status: 'Present',
      source: 'trainee_portal',
    })

    // Record for trainee local state
    const recId = crypto.randomUUID()
    const traineeRecord: Rec = {
      id: recId,
      values: [sessionName, batchCode, today, `${method} · ${ATTENDANCE_SYSTEM_NAME}`, `${currentTime} ${tokenInfo}`.trim()],
      status: 'Present',
    }
    update('Attendance', [traineeRecord, ...att])

    flash(`Attendance marked Present (${method})! Your name (${profile.name}) is now reflected in Trainer Dashboard under ${ATTENDANCE_SYSTEM_NAME}.`)
  }

  const qrCheckIn = () => {
    setQrScanModalOpen(true)
  }

  const completeQrScan = () => {
    if (!inputQrToken.trim()) {
      flash('Enter or scan a valid session token.')
      return
    }
    // Validate token against active session from trainer
    if (activeQrSession && inputQrToken.trim().toUpperCase() !== activeQrSession.token.toUpperCase()) {
      flash('Invalid token! Please enter the correct session token from your trainer.')
      return
    }
    setScanningCamera(true)
    setTimeout(() => {
      setScanningCamera(false)
      const sessionInfo = activeQrSession
        ? `${activeQrSession.course} | ${activeQrSession.batch}`
        : 'Session'
      submitAttendanceRecord('QR Code', `Token: ${inputQrToken.trim()} | ${sessionInfo}`)
      setQrScanModalOpen(false)
      // Notify the trainee
      notify('Attendance Marked', `You are marked Present for ${sessionInfo} via QR Code scan.`, 'Attendance')
    }, 1200)
  }

  const handleFaceSuccess = () => {
    submitAttendanceRecord('Face Recognition')
    setFaceModalOpen(false)
  }

  const requestCorrection = (r: Rec) => {
    const v = [...r.values]
    v[4] = 'Correction requested by trainee'
    patch('Attendance', r.id, { values: v, status: 'Correction requested' })
    flash('Correction request sent to your trainer.')
  }

  const certText = (c: Rec) =>
    `NATIONAL COOPERATIVE CAPACITY BUILDING PLATFORM\n\nCertificate of Completion\n\nThis certifies that ${profile.name}\nhas successfully completed ${c.values[0]}\n(${c.values[1]}) with grade ${c.values[4]}.\n\nIssued on: ${c.values[2]}\nCertificate ID: ${c.values[3]}\nVerify at NCCP using the certificate ID.`
  const printCert = (c: Rec) => {
    const w = window.open('', '_blank', 'width=800,height=600')
    if (!w) {
      flash('Allow pop-ups to print.')
      return
    }
    w.document.write(`<pre style="font:18px Georgia;padding:40px;border:6px double #b8892b;white-space:pre-wrap">${certText(c).replace(/</g, '&lt;')}</pre>`)
    w.document.close()
    w.focus()
    w.print()
  }
  const shareCert = async (c: Rec) => {
    const text = `${profile.name} earned "${c.values[0]}" on NCCP. Certificate ID: ${c.values[3]}`
    try {
      if (navigator.share) {
        await navigator.share({ title: 'NCCP Certificate', text })
        return
      }
      await navigator.clipboard.writeText(text)
      flash('Share text copied to clipboard.')
    } catch {
      flash('Sharing was cancelled.')
    }
  }
  const verify = () => {
    const id = verifyId.trim().toUpperCase()
    if (!id) {
      flash('Enter a certificate ID.')
      return
    }
    const c = certs.find((x) => (x.values[3] ?? '').toUpperCase() === id)
    flash(c ? `Valid certificate: ${c.values[0]} issued ${c.values[2]}.` : 'No issued certificate found with that ID.')
  }
  const applyJob = (j: Rec) => {
    if (rows('My Applications').some((a) => a.values[0] === j.values[0] && a.values[1] === j.values[1])) {
      flash('You already applied for this job.')
      return
    }
    patch('Jobs & Placements', j.id, { status: 'Applied' })
    const appId = crypto.randomUUID()
    const newApp: Rec = { id: appId, values: [j.values[0] ?? '', j.values[1] ?? '', today, 'Awaiting review'], status: 'Applied' }
    update('My Applications', [newApp, ...rows('My Applications')])
    void workspaceApi.save('trainee', 'My Applications', { id: appId, data: newApp, status: 'Applied' }).catch(() => { })
    flash(`Applied for ${j.values[0]}. Track it in My Applications (saved to PostgreSQL).`)
  }
  const saveJob = (j: Rec) => {
    patch('Jobs & Placements', j.id, { status: j.status === 'Saved' ? 'Open' : 'Saved' })
    flash(j.status === 'Saved' ? 'Removed from saved jobs.' : 'Job saved.')
  }
  const hostelRequest = (type: string) => {
    setDraft([type === 'Room change' ? 'Room change request' : type === 'Check-out' ? 'Hostel check-out' : 'New complaint', type, today, ''])
    setDraftStatus('Open')
    setModal({ section: 'Hostel' })
  }

  const answer = (q: string) => {
    const tLower = q.toLowerCase()
    const gaps = recommended.length ? [] : ['Dairy operations']
    const jobSkills = rows('Jobs & Placements')
      .flatMap((j) => (j.values[4] ?? '').split(',').map((s) => s.trim()))
      .filter(Boolean)
    const missing = [...new Set(jobSkills.filter((s) => !skillNames.some((n) => n.includes(s.toLowerCase()) || s.toLowerCase().includes(n))))]
      .concat(gaps)
      .slice(0, 4)
    const weak = skills.filter((s) => Number(s.values[1]) < 75).map((s) => s.values[0])
    if (tLower.includes('gap') || tLower.includes('skill'))
      return `Skill-gap analysis for ${profile.goal}:\n• Skills to strengthen: ${weak.join(', ') || 'none — great work!'}\n• Skills requested by jobs you don't have yet: ${missing.join(', ') || 'none'}\nTip: finish your in-progress courses (overall ${overall}%) to raise proficiency.`
    if (tLower.includes('course')) {
      const next = courses.filter((c) => c.pct < 100).map((c) => `${c.c.values[0]} (${c.pct}%)`)
      const open = rows('Programmes')
        .filter((p) => p.status === 'Open')
        .map((p) => p.values[0])
      return `Course recommendations:\n• Continue: ${next.join(', ') || 'all courses complete'}\n• Explore: ${open.join(', ') || 'no open programmes right now'}`
    }
    if (tLower.includes('job'))
      return recommended.length
        ? `Jobs matching your skills:\n${recommended.slice(0, 3).map((j) => `• ${j.values[0]} – ${j.values[1]} (${match(j)}% match)`).join('\n')}\nOpen Jobs & Placements to apply.`
        : 'No strong matches yet. Add verified skills in your Skill Wallet to improve matching.'
    if (tLower.includes('resume') || tLower.includes('cv'))
      return `Resume guidance:\n1. Header: ${profile.name}, ${profile.phone}, ${profile.district}\n2. Objective: Aspiring ${profile.goal} in the cooperative sector.\n3. Certificates: ${certs.map((c) => c.values[0]).join(', ') || 'add once issued'}\n4. Skills: ${skills.map((s) => `${s.values[0]} (${s.values[1]}%)`).join(', ')}\n5. Training: ${courses.map((c) => c.c.values[0]).join(', ')}`
    if (tLower.includes('interview'))
      return 'Interview preparation:\n• Explain cooperative principles with a local example.\n• Describe a time you solved a problem in a team.\n• Know the employer: its members, products and region.\n• Practice: "Why do you want to work in a cooperative?"\n• Carry certificates and ID; arrive 15 minutes early.'
    if (tLower.includes('roadmap') || tLower.includes('career'))
      return `Career roadmap to ${profile.goal}:\n1. Now: complete current courses (${overall}% done).\n2. Next 1 month: pass upcoming assessments (${upcomingTests.length} pending).\n3. Next 2 months: earn certificates and verify skills.\n4. Then: apply to matched jobs (${recommended.length} available).`
    if (tLower.includes('project'))
      return 'Project ideas:\n• Map the milk collection route of a nearby dairy society.\n• Build a simple member ledger in a spreadsheet.\n• Survey 10 farmers about cooperative benefits and present findings.'
    if (tLower.includes('certif'))
      return `Certification guidance:\nYou have ${certs.length} certificate(s). Keep attendance above 75% (now ${attPct}%) and assessment scores above 70% (now ${avgScore || '—'}%) to be eligible for the next one.`
    return `I can help with: skill gaps, courses, jobs, resume, interview, career roadmap, projects and certification. Try one of the topic buttons. (Replies are prepared from your NCCP records; language preference: ${language === 'hi' ? 'हिंदी' : 'English'}.)`
  }
  const ask = (q: string) => {
    if (!q.trim()) return
    setChat((c) => [...c, { me: true, text: q }, { me: false, text: answer(q) }])
    setChatInput('')
  }

  const schema = schemas[section]
  const summary = [
    { label: t('Programmes'), value: rows('Programmes').filter((p) => p.status === 'Enrolled').length, icon: Layers3, target: 'Programmes' as Section },
    { label: t('Courses'), value: rows('My Learning').filter((c) => c.status === 'In progress').length, icon: BookOpen, target: 'My Learning' as Section },
    { label: t('Course progress'), value: `${lessonsDone}/${rows('Lessons').length}`, icon: PlayCircle, target: 'Course Player' as Section },
    { label: t('Completion rate'), value: `${overall}%`, icon: GraduationCap, target: 'My Learning' as Section },
    { label: t('Attendance %'), value: `${attPct}%`, icon: CheckCircle2, target: 'Attendance' as Section },
    { label: t('Certificates Issued'), value: certs.length, icon: Award, target: 'Certificates' as Section },
    { label: t('Skill Wallet'), value: skills.filter((s) => s.status === 'Verified').length, icon: Wallet, target: 'Skill Wallet' as Section },
    { label: t('Jobs & Placements'), value: recommended.length, icon: BriefcaseBusiness, target: 'Jobs & Placements' as Section },
  ]
  const initials = profile.name
    .split(' ')
    .map((p) => p[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase()
  const pipelineStatuses = schemas['My Applications']?.statuses ?? []
  const stat = useMemo(() => pipelineStatuses.map((s) => [s, rows('My Applications').filter((a) => a.status === s).length] as const), [data])

  const table = (name: string, extra?: (item: Rec) => React.ReactNode, statusEditable = false) => {
    const s = allSchemas(name)
    if (!s) return null
    return (
      <div className="tw-table-wrap">
        <table className="tw-table">
          <thead>
            <tr>
              {s.fields.map((f) => (
                <th key={f}>{t(f)}</th>
              ))}
              {name === 'Jobs & Placements' && <th>{t('Match', 'मिलान')}</th>}
              <th>{t('Status')}</th>
              <th>{t('Actions')}</th>
            </tr>
          </thead>
          <tbody>
            {filtered(name).map((item) => (
              <tr key={item.id}>
                {item.values.map((v, i) => (
                  <td key={i}>{v || '—'}</td>
                ))}
                {name === 'Jobs & Placements' && (
                  <td>
                    <span className="te-match">{match(item)}%</span>
                  </td>
                )}
                <td>
                  {statusEditable ? (
                    <select
                      aria-label={`Status for ${item.values[0]}`}
                      value={item.status}
                      onChange={(e) => {
                        patch(name, item.id, { status: e.target.value })
                        flash('Status updated.')
                      }}
                    >
                      {s.statuses.map((o) => (
                        <option key={o} value={o}>
                          {t(o)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span
                      className={`tw-chip ${good.includes(item.status)
                        ? 'tw-success'
                        : ['Absent', 'Rejected', 'Unread', 'Open'].includes(item.status)
                          ? 'tw-warning'
                          : ''
                        }`}
                    >
                      {t(item.status)}
                    </span>
                  )}
                </td>
                <td>
                  <div className="tw-row-actions">
                    {extra?.(item)}
                    <Button variant="ghost" size="icon" aria-label={`Edit ${item.values[0]}`} title="Edit" onClick={() => open(name, item)}>
                      <Pencil size={16} />
                    </Button>
                    <Button variant="ghost" size="icon" aria-label={`Delete ${item.values[0]}`} title="Delete" onClick={() => remove(name, item)}>
                      <Trash2 size={16} />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered(name).length === 0 && <div className="tw-empty tw-table-empty">No records found. Use “Add new” to create one.</div>}
      </div>
    )
  }
  const statCard = ({ label, value, icon: Icon, target }: (typeof summary)[number]) => (
    <Button variant="ghost" className="tw-stat" key={label} onClick={() => go(target)}>
      <span className="tw-stat-icon">
        <Icon size={20} />
      </span>
      <span className="tw-stat-copy">
        <small>{label}</small>
        <strong>{value}</strong>
      </span>
      <ArrowRight className="tw-stat-arrow" size={16} />
    </Button>
  )

  return (
    <div className="tw-shell">
      {mobileOpen && <div className="tw-scrim" onClick={() => setMobileOpen(false)} />}
      <aside className={`tw-sidebar ${mobileOpen ? 'tw-open' : ''}`}>
        <div className="tw-brand">
          <img src={brand} alt="NCCP logo" />
          <span>
            <strong>NCCP</strong>
            <small>{t('TRAINEE PORTAL')}</small>
          </span>
          <Button variant="ghost" size="icon" className="tw-close" aria-label="Close navigation" onClick={() => setMobileOpen(false)}>
            <X />
          </Button>
        </div>
        <div className="tw-side-caption">{t('MY JOURNEY', 'मेरी यात्रा')}</div>
        <nav aria-label="Trainee navigation">
          {nav.map(({ label, icon: Icon }) => (
            <Button
              variant="ghost"
              key={label}
              className={`tw-nav-item ${section === label ? 'is-active' : ''}`}
              onClick={() => go(label)}
            >
              <Icon size={18} />
              <span>{t(label)}</span>
              {label === 'Notifications' && unread.length > 0 ? (
                <span className="tw-chip tw-warning" style={{ marginLeft: 'auto', padding: '1px 8px' }}>
                  {unread.length}
                </span>
              ) : (
                section === label && <span className="tw-nav-dot" />
              )}
            </Button>
          ))}
        </nav>
        <div className="tw-sidebar-foot">
          <ShieldCheck size={18} />
          <span>
            सहकार से समृद्ध भारत<small>{t('Cooperation for a Prosperous Bharat')}</small>
          </span>
        </div>
      </aside>
      <div className="tw-main">
        <header className="tw-topbar">
          <Button variant="ghost" size="icon" className="tw-menu" aria-label="Open navigation" onClick={() => setMobileOpen(true)}>
            <Menu />
          </Button>
          <div className="tw-breadcrumb">
            {t('TRAINEE PORTAL')} <span>/</span> <strong>{t(section)}</strong>
          </div>
          <div className="tw-top-actions">
            {/* Language Switcher */}
            <Button
              variant="outline"
              size="sm"
              className="tw-lang-btn flex items-center gap-1.5 font-medium border-amber-900/20 text-emerald-950 hover:bg-emerald-50 text-xs px-2.5 py-1 h-8 rounded-lg"
              onClick={() => setLanguage(language === 'en' ? 'hi' : 'en')}
              title={language === 'en' ? 'हिंदी में बदलें' : 'Switch to English'}
            >
              <Languages size={14} className="text-amber-600" />
              <span>{language === 'en' ? 'हिंदी' : 'English'}</span>
            </Button>

            <div className="tw-pop-anchor">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Notifications"
                onClick={() => {
                  setBellOpen(!bellOpen)
                  setProfileOpen(false)
                }}
              >
                <Bell />
              </Button>
              {unread.length > 0 && <i className="tw-bell-dot" />}
              {bellOpen && (
                <div className="tw-popover">
                  <b>
                    {t('Notifications')} ({unread.length} new)
                  </b>
                  {unread.length ? (
                    unread.slice(0, 3).map((n) => (
                      <p key={n.id}>
                        <strong>{n.values[0]}</strong>
                        <br />
                        {n.values[1]}
                      </p>
                    ))
                  ) : (
                    <p>You're all caught up.</p>
                  )}
                  <Button
                    variant="ghost"
                    onClick={() => {
                      update('Notifications', rows('Notifications').map((n) => ({ ...n, status: 'Read' })))
                      setBellOpen(false)
                      flash('All notifications marked as read.')
                    }}
                  >
                    <Check size={15} /> {t('Mark all as read')}
                  </Button>
                  <Button variant="ghost" onClick={() => go('Notifications')}>
                    {t('View all')} <ArrowRight size={15} />
                  </Button>
                </div>
              )}
            </div>
            <div className="tw-pop-anchor">
              <Button
                variant="ghost"
                className="tw-profile-trigger"
                aria-label="Open profile menu"
                onClick={() => {
                  setProfileOpen(!profileOpen)
                  setBellOpen(false)
                }}
              >
                <span className="tw-avatar">{initials}</span>
                <span className="tw-profile-name">
                  <strong>{profile.name}</strong>
                  <small>{t('Trainee / Rural Youth')}</small>
                </span>
                <ChevronDown size={15} />
              </Button>
              {profileOpen && (
                <div className="tw-popover tw-profile-pop">
                  <b>{profile.name}</b>
                  <p>Trainee · {profile.district}</p>
                  <Button variant="ghost" onClick={() => go('Profile')}>
                    <UserRound size={16} /> {t('Profile')}
                  </Button>
                  <Button variant="ghost" onClick={() => go('Help & Support')}>
                    <HelpCircle size={16} /> {t('Help & Support')}
                  </Button>
                  <Button variant="ghost" onClick={onLogout}>
                    <LogOut size={16} /> {t('Log out')}
                  </Button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="tw-content">
          {activeQrSession && (
            <div className="bg-gradient-to-r from-emerald-900 via-emerald-800 to-amber-950 text-white rounded-2xl p-4 mb-4 shadow-xl border border-emerald-400/40 flex flex-wrap items-center justify-between gap-3 animate-in fade-in slide-in-from-top-2">
              <div className="flex items-center gap-3">
                <div className="relative flex h-3.5 w-3.5 shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-emerald-500"></span>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-amber-300 bg-black/30 px-2 py-0.5 rounded border border-amber-400/30">
                      {ATTENDANCE_SYSTEM_NAME}
                    </span>
                    <span className="text-xs font-semibold text-emerald-200">🔴 Live Session Attendance Open</span>
                  </div>
                  <p className="text-sm font-bold text-white mt-1">
                    {activeQrSession.course} ({activeQrSession.batch}) · Trainer: {activeQrSession.trainer}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono font-bold text-amber-300 bg-white/10 px-2.5 py-1 rounded border border-white/20">
                  {activeQrSession.token}
                </span>
                <Button
                  size="sm"
                  className="bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold px-4 shadow-md"
                  onClick={() => {
                    setInputQrToken(activeQrSession.token)
                    qrCheckIn()
                  }}
                >
                  <CheckCircle2 size={15} className="mr-1.5 text-emerald-950" /> Put Present
                </Button>
              </div>
            </div>
          )}
          <div className="tw-banner">
            <img src={banner} alt="Cooperative trainees learning together" />
            <div className="tw-banner-shade" />
            <div className="tw-banner-text">
              <span className="tw-kicker">NCCP · {t('TRAINEE PORTAL')}</span>
              <h1>
                {section === 'Dashboard'
                  ? `${language === 'hi' ? 'नमस्ते' : 'Welcome back'}, ${profile.name.split(' ')[0]}`
                  : t(section)}
              </h1>
              <p>
                {section === 'Dashboard'
                  ? `From training to employment — you are ${overall}% through your learning.`
                  : schema?.note ??
                  ({
                    'Course Player': 'Watch, read and listen to lessons in your language.',
                    'Skill Wallet': 'Your verified skills, scores and training history in one place.',
                    'AI Career Assistant': 'Guidance on skills, courses, jobs and interviews.',
                    Profile: 'Your personal and employment profile.',
                  } as Record<string, string>)[section]}
              </p>
            </div>
          </div>

          {section === 'Dashboard' && (
            <>
              <div className="tw-section-head">
                <div>
                  <span className="tw-overline">{t('LIVE OVERVIEW')}</span>
                  <h2>{t('At a glance')}</h2>
                </div>
                <div className="flex items-center gap-3">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex items-center gap-2 bg-emerald-50 text-emerald-800 border-emerald-300 font-semibold"
                    onClick={qrCheckIn}
                  >
                    <QrCode size={16} /> {t('Scan Session QR Code')}
                  </Button>
                  <span className="tw-live">
                    <i /> {t('Active')}
                  </span>
                </div>
              </div>
              <div className="tw-stat-grid">{summary.map(statCard)}</div>
              <div className="tw-dashboard-grid">
                <section className="tw-panel tw-wide">
                  <div className="tw-panel-head">
                    <div>
                      <span className="tw-overline">{t('Courses')}</span>
                      <h2>{t('My Learning')}</h2>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => go('My Learning')}>
                      {t('View all')} <ArrowRight size={15} />
                    </Button>
                  </div>
                  {courses.map(({ c, pct, done, total }) => (
                    <div className="tw-progress-row" key={c.id}>
                      <div>
                        <strong>{c.values[0]}</strong>
                        <span>
                          {done}/{total} lessons · {pct}%
                        </span>
                      </div>
                      <progress max="100" value={pct} />
                      <Button variant="ghost" size="sm" onClick={() => continueCourse(c.values[0] ?? '')}>
                        <PlayCircle size={15} /> {pct >= 100 ? 'Review' : 'Continue'}
                      </Button>
                    </div>
                  ))}
                </section>
                <section className="tw-panel">
                  <div className="tw-panel-head">
                    <div>
                      <span className="tw-overline">{t('LATEST')}</span>
                      <h2>{t('Notifications')}</h2>
                    </div>
                    <Button variant="ghost" size="icon" aria-label="All notifications" onClick={() => go('Notifications')}>
                      <ArrowRight />
                    </Button>
                  </div>
                  {rows('Notifications')
                    .slice(0, 3)
                    .map((n) => (
                      <div className="tw-feed" key={n.id}>
                        <span className="tw-feed-icon">
                          <Bell size={17} />
                        </span>
                        <div>
                          <strong>{n.values[0]}</strong>
                          <small>{n.values[1]}</small>
                        </div>
                      </div>
                    ))}
                  {!rows('Notifications').length && <p className="tw-empty">No notifications.</p>}
                </section>
                <section className="tw-panel tw-wide">
                  <div className="tw-panel-head">
                    <div>
                      <span className="tw-overline">{t('UP NEXT')}</span>
                      <h2>{t('Upcoming Sessions')}</h2>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => go('Timetable')}>
                      {t('Timetable')} <ArrowRight size={15} />
                    </Button>
                  </div>
                  {upcomingSessions.slice(0, 4).map((s) => (
                    <div className="tw-session" key={s.id}>
                      <span className="tw-time">{s.values[3]}</span>
                      <div>
                        <strong>{s.values[0]}</strong>
                        <small>
                          {s.values[2]} · {s.values[4]} · {s.values[1]}
                        </small>
                      </div>
                      <span className="tw-chip">{t(s.values[1])}</span>
                    </div>
                  ))}
                  {upcomingTests.slice(0, 2).map((a) => (
                    <div className="tw-session" key={a.id}>
                      <span className="tw-time">{(a.values[2] ?? '').slice(5)}</span>
                      <div>
                        <strong>{a.values[0]}</strong>
                        <small>
                          {a.values[1]} · {a.values[3]}
                        </small>
                      </div>
                      <Button size="sm" className="tw-primary" onClick={() => startQuiz(a)}>
                        {t('Submit')}
                      </Button>
                    </div>
                  ))}
                  {!upcomingSessions.length && !upcomingTests.length && <p className="tw-empty">Nothing scheduled.</p>}
                </section>
                <section className="tw-panel">
                  <div className="tw-panel-head">
                    <div>
                      <span className="tw-overline">FOR YOU</span>
                      <h2>{t('Opportunities')}</h2>
                    </div>
                  </div>
                  {recommended.slice(0, 3).map((j) => (
                    <div className="tw-feed" key={j.id}>
                      <span className="tw-feed-icon">
                        <BriefcaseBusiness size={17} />
                      </span>
                      <div>
                        <strong>{j.values[0]}</strong>
                        <small>
                          {j.values[1]} · <span className="te-match">{match(j)}% match</span>
                        </small>
                      </div>
                    </div>
                  ))}
                  {!recommended.length && <p className="tw-empty">Add skills to get job matches.</p>}
                  <Button variant="outline" size="sm" onClick={() => go('Jobs & Placements')}>
                    {t('View all')} <ArrowRight size={15} />
                  </Button>
                </section>
                <section className="tw-panel tw-wide">
                  <div className="tw-panel-head">
                    <div>
                      <span className="tw-overline">SKILLS</span>
                      <h2>{t('Skill Wallet')}</h2>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => go('Skill Wallet')}>
                      {t('View all')} <ArrowRight size={15} />
                    </Button>
                  </div>
                  {skills.map((s) => (
                    <div className="te-skill" key={s.id}>
                      <strong>{s.values[0]}</strong>
                      <span>
                        {s.values[1]}% · {t(s.status)}
                      </span>
                      <progress max="100" value={Number(s.values[1]) || 0} />
                    </div>
                  ))}
                </section>
                <section className="tw-panel">
                  <div className="tw-panel-head">
                    <div>
                      <span className="tw-overline">{t('QUICK ACTIONS')}</span>
                      <h2>{t('Keep things moving')}</h2>
                    </div>
                  </div>
                  <div className="tw-shortcuts">
                    <Button variant="outline" onClick={qrCheckIn} className="border-emerald-500 text-emerald-800 bg-emerald-50/50">
                      <QrCode className="text-emerald-700" /> {t('Scan Session QR Code')}
                    </Button>
                    <Button variant="outline" id="btn-face-quick" onClick={() => setFaceModalOpen(true)}>
                      <Camera /> {t('Face Recognition')}
                    </Button>
                    <Button variant="outline" onClick={() => go('Programmes')}>
                      <Layers3 /> {t('Programmes')}
                    </Button>
                    <Button variant="outline" onClick={() => go('Certificates')}>
                      <Award /> {t('Certificates')}
                    </Button>
                    <Button variant="outline" onClick={() => go('AI Career Assistant')}>
                      <Bot /> {t('AI Career Assistant')}
                    </Button>
                  </div>
                </section>
              </div>
            </>
          )}

          {schema && (
            <>
              <div className="tw-section-head">
                <div>
                  <span className="tw-overline">{filtered(section).length} {t('Total records')}</span>
                  <h2>{t(section)}</h2>
                </div>
                <div className="tw-toolbar">
                  {section === 'Attendance' && (
                    <Button
                      variant="default"
                      className="bg-emerald-700 hover:bg-emerald-800 text-white font-medium flex items-center gap-2"
                      onClick={qrCheckIn}
                    >
                      <QrCode size={17} />
                      <span>{t('Scan Session QR Code')}</span>
                    </Button>
                  )}
                  <label className="tw-search">
                    <Search size={17} />
                    <input
                      aria-label={`Search ${section}`}
                      placeholder={t('Search') + '...'}
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </label>
                  <Button variant="outline" aria-label={`Download ${section} CSV`} onClick={() => csv(section, schema.fields, filtered(section))}>
                    <Download size={17} />
                    <span>{t('Export')}</span>
                  </Button>
                  <Button className="tw-primary" onClick={() => (section === 'Hostel' ? hostelRequest('Complaint') : open(section))}>
                    <Plus size={17} /> {t('Add new')}
                  </Button>
                </div>
              </div>
              {section === 'Programmes' && (
                <>
                  <div className="tw-mini-stats">
                    {schema.statuses.map((s) => (
                      <span key={s}>
                        <strong>{rows('Programmes').filter((p) => p.status === s).length}</strong> {t(s)}
                      </span>
                    ))}
                  </div>
                  {table('Programmes', (p) =>
                    p.status === 'Open' ? (
                      <Button size="sm" className="tw-primary" onClick={() => applyProgramme(p)}>
                        {t('Apply')}
                      </Button>
                    ) : null
                  )}
                </>
              )}
              {section === 'My Learning' && (
                <>
                  <div className="tw-mini-stats">
                    <span>
                      <strong>{overall}%</strong> {t('Completion rate')}
                    </span>
                    <span>
                      <strong>{lessonsDone}</strong> lessons completed
                    </span>
                    <span>
                      <strong>{rows('Lessons').filter((l) => l.values[5] === 'Yes').length}</strong> saved offline
                    </span>
                  </div>
                  <div className="tw-batch-grid" style={{ marginBottom: 18 }}>
                    {courses.map(({ c, pct, done, total }) => (
                      <Button variant="ghost" className="tw-batch" key={c.id} onClick={() => continueCourse(c.values[0] ?? '')}>
                        <span className="tw-batch-initial">{pct}%</span>
                        <span>
                          <strong>{c.values[0]}</strong>
                          <small>
                            {done}/{total} lessons · {c.values[4]}
                          </small>
                        </span>
                        <PlayCircle size={16} />
                      </Button>
                    ))}
                  </div>
                  {table('My Learning')}
                </>
              )}
              {section === 'Assessments' && (
                <>
                  <div className="tw-mini-stats">
                    <span>
                      <strong>{upcomingTests.length}</strong> upcoming
                    </span>
                    <span>
                      <strong>{scores.length}</strong> results
                    </span>
                    <span>
                      <strong>{avgScore}%</strong> average score
                    </span>
                  </div>
                  {table('Assessments', (a) =>
                    a.status === 'Upcoming' ? (
                      <Button size="sm" className="tw-primary" onClick={() => startQuiz(a)}>
                        {t('Submit')}
                      </Button>
                    ) : Number(a.values[5]) > 0 ? (
                      <Button size="sm" variant="outline" onClick={() => startQuiz(a)}>
                        {t('Retake')}
                      </Button>
                    ) : null
                  )}
                </>
              )}
              {section === 'Attendance' && (
                <>
                  <div className="tw-inline-tools bg-gradient-to-r from-emerald-50/80 to-amber-50/50 border border-emerald-200 p-4 rounded-xl flex flex-wrap items-center gap-4">
                    <div>
                      <strong className="text-emerald-950 font-semibold block">{t('Check in for today', 'आज की उपस्थिति दर्ज करें')}</strong>
                      <small className="text-slate-600">
                        {t('Attendance %')}: {attPct}%. Keep it above 75% for certification.
                      </small>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button className="tw-primary bg-emerald-700 hover:bg-emerald-800" onClick={qrCheckIn}>
                        <QrCode size={16} /> {t('Scan Session QR Code')}
                      </Button>
                      <Button variant="outline" id="btn-face-attendance" className="border-emerald-600 text-emerald-800 font-medium" onClick={() => setFaceModalOpen(true)}>
                        <Camera size={16} /> {t('Face Recognition')}
                      </Button>
                      <Button variant="outline" onClick={() => flash('Fingerprint device (R307) is ready in trainer classroom.')}>
                        <Fingerprint size={16} /> {t('Biometric Attendance')}
                      </Button>
                    </div>
                    {activeQrSession && (
                      <div className="w-full mt-3 bg-white/80 border border-emerald-300 rounded-lg px-4 py-3 flex items-center gap-3">
                        <div className="w-3 h-3 bg-emerald-500 rounded-full animate-pulse" />
                        <div className="flex-1">
                          <strong className="text-emerald-900 text-sm block">Active Session Available</strong>
                          <small className="text-slate-600">
                            {activeQrSession.course} · {activeQrSession.batch} · Trainer: {activeQrSession.trainer} · Token: <span className="font-mono font-bold text-emerald-800">{activeQrSession.token}</span>
                          </small>
                        </div>
                        <Button size="sm" className="bg-emerald-700 hover:bg-emerald-800 text-white" onClick={() => { setInputQrToken(activeQrSession.token); qrCheckIn() }}>
                          <Check size={14} /> Mark Present
                        </Button>
                      </div>
                    )}
                  </div>
                  {table('Attendance', (r) =>
                    r.status === 'Absent' || r.status === 'Late' ? (
                      <Button size="sm" variant="outline" onClick={() => requestCorrection(r)}>
                        {t('Correction requested', 'सुधार अनुरोध')}
                      </Button>
                    ) : null
                  )}
                </>
              )}
              {section === 'Certificates' && (
                <>
                  <div className="tw-inline-tools">
                    <div>
                      <strong>QR / ID verification</strong>
                      <small>Enter a certificate ID to check it is genuine.</small>
                    </div>
                    <input
                      aria-label="Certificate ID"
                      placeholder="e.g. NCCP-2026-10482"
                      value={verifyId}
                      onChange={(e) => setVerifyId(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') verify()
                      }}
                    />
                    <Button className="tw-primary" onClick={verify}>
                      <ShieldCheck size={16} /> {t('Verified')}
                    </Button>
                  </div>
                  <div className="te-cert-grid">
                    {certs.map((c) => (
                      <div className="te-cert" key={c.id}>
                        <Award size={26} />
                        <h3>{c.values[0]}</h3>
                        <small>
                          {c.values[1]} · Grade {c.values[4]}
                        </small>
                        <small>
                          Issued {c.values[2]} · {c.values[3]}
                        </small>
                        <div className="tw-row-actions">
                          <Button size="sm" variant="outline" onClick={() => saveFile(`${c.values[3] || 'certificate'}.txt`, certText(c))}>
                            <Download size={14} /> {t('Download')}
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => printCert(c)}>
                            <Printer size={14} /> {t('Print')}
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => void shareCert(c)}>
                            <Share2 size={14} /> {t('Share')}
                          </Button>
                        </div>
                      </div>
                    ))}
                    {!certs.length && <p className="tw-empty">No certificates issued yet.</p>}
                  </div>
                  {table('Certificates')}
                </>
              )}
              {section === 'Jobs & Placements' && (
                <>
                  <div className="tw-mini-stats">
                    <span>
                      <strong>{recommended.length}</strong> {t('Candidate Matches')}
                    </span>
                    <span>
                      <strong>{rows('Jobs & Placements').filter((j) => j.status === 'Saved').length}</strong> saved
                    </span>
                    <span>
                      <strong>{rows('My Applications').length}</strong> {t('Applications')}
                    </span>
                  </div>
                  {table('Jobs & Placements', (j) => (
                    <>
                      {j.status !== 'Applied' && j.status !== 'Closed' && (
                        <Button size="sm" className="tw-primary" onClick={() => applyJob(j)}>
                          {t('Apply')}
                        </Button>
                      )}
                      {j.status !== 'Applied' && (
                        <Button size="sm" variant="outline" onClick={() => saveJob(j)}>
                          {j.status === 'Saved' ? 'Unsave' : 'Save'}
                        </Button>
                      )}
                    </>
                  ))}
                </>
              )}
              {section === 'My Applications' && (
                <>
                  <div className="te-pipeline">
                    {stat.map(([s, n]) => (
                      <span key={s}>
                        <strong>{n}</strong>
                        {t(s)}
                      </span>
                    ))}
                  </div>
                  {table('My Applications', undefined, true)}
                </>
              )}
              {section === 'Timetable' && table('Timetable')}
              {section === 'Hostel' && (
                <>
                  <section className="tw-panel" style={{ marginBottom: 18 }}>
                    <div className="tw-panel-head">
                      <div>
                        <span className="tw-overline">MY ROOM</span>
                        <h2>Room information</h2>
                      </div>
                      <span className={`tw-chip ${profile.hostelStatus === 'Checked in' ? 'tw-success' : 'tw-warning'}`}>
                        {profile.hostelStatus}
                      </span>
                    </div>
                    <div className="te-room">
                      <div>
                        <small>Room</small>
                        <strong>{profile.room}</strong>
                      </div>
                      <div>
                        <small>Bed allocation</small>
                        <strong>{profile.bed}</strong>
                      </div>
                      <div>
                        <small>Block</small>
                        <strong>{profile.block}</strong>
                      </div>
                      <div>
                        <small>Open requests</small>
                        <strong>{rows('Hostel').filter((h) => h.status !== 'Resolved').length}</strong>
                      </div>
                    </div>
                    <div className="tw-shortcuts" style={{ marginTop: 14 }}>
                      <Button
                        variant="outline"
                        onClick={() => {
                          const next = profile.hostelStatus === 'Checked in' ? 'Checked out' : 'Checked in'
                          setProfile((p) => ({ ...p, hostelStatus: next }))
                          update('Hostel', [
                            {
                              id: crypto.randomUUID(),
                              values: [`Hostel ${next.toLowerCase()}`, next === 'Checked in' ? 'Check-in' : 'Check-out', today, `Recorded at ${now()}`],
                              status: 'Resolved',
                            },
                            ...rows('Hostel'),
                          ])
                          flash(`${next} recorded.`)
                        }}
                      >
                        <Building2 /> {profile.hostelStatus === 'Checked in' ? 'Check out' : 'Check in'}
                      </Button>
                      <Button variant="outline" onClick={() => hostelRequest('Room change')}>
                        <Layers3 /> Room change
                      </Button>
                      <Button variant="outline" onClick={() => hostelRequest('Complaint')}>
                        <HelpCircle /> Complaint / help
                      </Button>
                    </div>
                  </section>
                  {table('Hostel')}
                </>
              )}
              {section === 'Notifications' && (
                <>
                  {table('Notifications', (n) =>
                    n.status === 'Unread' ? (
                      <Button size="sm" variant="outline" onClick={() => patch('Notifications', n.id, { status: 'Read' })}>
                        {t('Mark as read')}
                      </Button>
                    ) : null
                  )}
                </>
              )}
              {section === 'Help & Support' && (
                <>
                  <p className="tw-info">
                    <LifeBuoy size={17} /> Helpline 1800-000-NCCP (Mon–Sat, 9am–6pm). Raise a ticket below and track its status.
                  </p>
                  {table('Help & Support')}
                </>
              )}
            </>
          )}

          {section === 'Course Player' && currentLesson && (
            <div className="te-player">
              <section className="tw-panel">
                <div className="te-stage">
                  {currentLesson.values[2] === 'Video' ? (
                    <PlayCircle size={56} />
                  ) : currentLesson.values[2] === 'Audio' ? (
                    <Sparkles size={48} />
                  ) : (
                    <BookOpen size={52} />
                  )}
                  <span className="te-tag">
                    {currentLesson.values[2]} · {currentLesson.values[3]} · {currentLesson.values[4]}
                  </span>
                  <h3>{currentLesson.values[0]}</h3>
                  <p>
                    {currentLesson.values[2] === 'Text'
                      ? `Reading: ${currentLesson.values[0]} explains key ideas of ${currentLesson.values[1]} through simple examples from village cooperatives.`
                      : `Lesson from ${currentLesson.values[1]}. ${currentLesson.values[2] === 'PDF'
                        ? 'Open the notes and read through each section.'
                        : currentLesson.values[2] === 'Audio'
                          ? 'Listen to the recorded explanation.'
                          : 'Watch the recorded class.'
                      }`}
                  </p>
                  {currentLesson.values[5] === 'Yes' && (
                    <span className="te-tag">
                      <Download size={13} /> Available offline
                    </span>
                  )}
                </div>
                <div className="tw-row-actions" style={{ marginTop: 14, flexWrap: 'wrap' }}>
                  <Button className="tw-primary" onClick={() => markComplete(currentLesson)}>
                    <Check size={16} /> {currentLesson.status === 'Completed' ? 'Completed — undo' : 'Mark complete'}
                  </Button>
                  <Button variant="outline" onClick={() => toggleOffline(currentLesson)}>
                    <Download size={16} /> {currentLesson.values[5] === 'Yes' ? 'Remove offline' : 'Save offline'}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      const list = rows('Lessons')
                      const i = list.findIndex((l) => l.id === currentLesson.id)
                      const next = list[i + 1]
                      if (next) setLessonId(next.id)
                      else flash('This is the last lesson.')
                    }}
                  >
                    Next lesson <ArrowRight size={15} />
                  </Button>
                </div>
              </section>
              <section className="tw-panel">
                <div className="tw-panel-head">
                  <div>
                    <span className="tw-overline">
                      {lessonsDone}/{rows('Lessons').length} DONE
                    </span>
                    <h2>Lessons</h2>
                  </div>
                  <Button variant="ghost" size="icon" aria-label="Add lesson" onClick={() => open('Lessons')}>
                    <Plus />
                  </Button>
                </div>
                <div className="te-lessons">
                  {rows('Lessons').map((l) => (
                    <Button
                      variant="ghost"
                      key={l.id}
                      className={`te-lesson ${l.id === currentLesson.id ? 'is-active' : ''}`}
                      onClick={() => setLessonId(l.id)}
                    >
                      {l.status === 'Completed' ? <CheckCircle2 size={18} color="var(--tw-green)" /> : <PlayCircle size={18} />}
                      <span>
                        <strong>{l.values[0]}</strong>
                        <small>
                          {l.values[1]} · {l.values[2]} · {l.values[3]}
                        </small>
                      </span>
                    </Button>
                  ))}
                </div>
              </section>
            </div>
          )}

          {section === 'Skill Wallet' && (
            <>
              <div className="tw-stat-grid">
                {[summary[6], summary[5], summary[3], { label: 'Average score', value: `${avgScore}%`, icon: ClipboardCheck, target: 'Assessments' as Section }].map(
                  (s) => s && statCard(s)
                )}
              </div>
              <div className="tw-dashboard-grid">
                <section className="tw-panel tw-wide">
                  <div className="tw-panel-head">
                    <div>
                      <span className="tw-overline">VERIFIED SKILLS</span>
                      <h2>Skill proficiency</h2>
                    </div>
                    <Button size="sm" className="tw-primary" onClick={() => open('Skills')}>
                      <Plus size={15} /> Add skill
                    </Button>
                  </div>
                  {skills.map((s) => (
                    <div className="te-skill" key={s.id}>
                      <strong>
                        {s.values[0]} {s.status === 'Verified' && <ShieldCheck size={14} color="var(--tw-green)" />}
                      </strong>
                      <span className="tw-row-actions">
                        {s.values[1]}%
                        <Button variant="ghost" size="icon" aria-label={`Edit ${s.values[0]}`} onClick={() => open('Skills', s)}>
                          <Pencil size={14} />
                        </Button>
                        <Button variant="ghost" size="icon" aria-label={`Delete ${s.values[0]}`} onClick={() => remove('Skills', s)}>
                          <Trash2 size={14} />
                        </Button>
                      </span>
                      <progress max="100" value={Number(s.values[1]) || 0} />
                      <small style={{ gridColumn: '1/-1', color: 'var(--tw-muted)' }}>
                        {s.values[2]} · verified by {s.values[3]}
                      </small>
                    </div>
                  ))}
                </section>
                <section className="tw-panel">
                  <div className="tw-panel-head">
                    <div>
                      <span className="tw-overline">EMPLOYMENT PROFILE</span>
                      <h2>{profile.name}</h2>
                    </div>
                  </div>
                  <div className="tw-analytics-line">
                    <span>Career goal</span>
                    <strong>{profile.goal}</strong>
                  </div>
                  <div className="tw-analytics-line">
                    <span>Education</span>
                    <strong>{profile.education}</strong>
                  </div>
                  <div className="tw-analytics-line">
                    <span>Attendance</span>
                    <strong>{attPct}%</strong>
                  </div>
                  <div className="tw-analytics-line">
                    <span>Applications</span>
                    <strong>{rows('My Applications').length}</strong>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      saveFile(
                        'nccp-skill-wallet.txt',
                        `NCCP SKILL WALLET — ${profile.name}\n\nSkills:\n${skills
                          .map((s) => `- ${s.values[0]}: ${s.values[1]}% (${s.status})`)
                          .join('\n')}\n\nCertificates:\n${certs
                            .map((c) => `- ${c.values[0]} (${c.values[3]})`)
                            .join('\n')}\n\nAssessments:\n${rows('Assessments')
                              .filter((a) => a.values[4])
                              .map((a) => `- ${a.values[0]}: ${a.values[4]}%`)
                              .join('\n')}\n\nCourses:\n${courses.map((c) => `- ${c.c.values[0]}: ${c.pct}%`).join('\n')}`
                      )
                    }
                  >
                    <Download size={15} /> Download wallet
                  </Button>
                </section>
              </div>
            </>
          )}

          {section === 'AI Career Assistant' && (
            <div className="tw-ai-grid">
              <section className="tw-panel">
                <div className="tw-panel-head">
                  <div>
                    <span className="tw-overline">CAREER CHAT</span>
                    <h2>Ask for guidance</h2>
                  </div>
                  <Bot size={22} />
                </div>
                <div className="te-chips">
                  {[
                    'Career roadmap',
                    'Skill-gap analysis',
                    'Course recommendations',
                    'Job recommendations',
                    'Resume guidance',
                    'Interview preparation',
                    'Project suggestions',
                    'Certification guidance',
                  ].map((tStr) => (
                    <Button key={tStr} size="sm" variant="outline" onClick={() => ask(tStr)}>
                      {tStr}
                    </Button>
                  ))}
                </div>
                <div className="te-chat" aria-live="polite">
                  {chat.map((m, i) => (
                    <div key={i} className={`te-msg ${m.me ? 'me' : 'bot'}`}>
                      {m.text}
                    </div>
                  ))}
                </div>
                <div className="te-chat-input">
                  <input
                    aria-label="Ask the career assistant"
                    placeholder="Type your question..."
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') ask(chatInput)
                    }}
                  />
                  <Button className="tw-primary" aria-label="Send" onClick={() => ask(chatInput)}>
                    <Send size={16} />
                  </Button>
                </div>
              </section>
              <section className="tw-panel">
                <div className="tw-panel-head">
                  <div>
                    <span className="tw-overline">SNAPSHOT</span>
                    <h2>Where you stand</h2>
                  </div>
                </div>
                <div className="tw-analytics-line">
                  <span>Goal</span>
                  <strong>{profile.goal}</strong>
                </div>
                <div className="tw-analytics-line">
                  <span>Learning progress</span>
                  <strong>{overall}%</strong>
                </div>
                <div className="tw-analytics-line">
                  <span>Verified skills</span>
                  <strong>{skills.filter((s) => s.status === 'Verified').length}</strong>
                </div>
                <div className="tw-analytics-line">
                  <span>Job matches</span>
                  <strong>{recommended.length}</strong>
                </div>
                <div className="tw-analytics-line">
                  <span>Language</span>
                  <strong>{language === 'hi' ? 'हिंदी' : 'English'}</strong>
                </div>
                <p className="tw-info">
                  <Sparkles size={16} /> Suggestions are prepared from your own NCCP records.
                </p>
                <Button variant="outline" size="sm" onClick={() => setChat((c) => c.slice(0, 1))}>
                  Clear chat
                </Button>
              </section>
            </div>
          )}

          {section === 'Profile' && (
            <div className="tw-ai-grid">
              <section className="tw-panel">
                <div className="tw-panel-head">
                  <div>
                    <span className="tw-overline">PERSONAL DETAILS</span>
                    <h2>{t('Profile')}</h2>
                  </div>
                  <span className="tw-avatar">{initials}</span>
                </div>
                <div className="tw-form">
                  {(
                    [
                      ['name', 'Full name'],
                      ['phone', 'Phone'],
                      ['email', 'Email'],
                      ['district', 'District / State'],
                      ['education', 'Education'],
                      ['goal', 'Career goal'],
                    ] as [keyof Profile, string][]
                  ).map(([k, label]) => (
                    <label key={k}>
                      {t(label)}
                      <input
                        value={profileDraft[k]}
                        onChange={(e) => setProfileDraft((p) => ({ ...p, [k]: e.target.value }))}
                      />
                    </label>
                  ))}
                  <Button
                    className="tw-primary"
                    onClick={() => {
                      if (!profileDraft.name.trim()) {
                        flash('Name is required.')
                        return
                      }
                      setProfile(profileDraft)
                      void workspaceApi
                        .save('trainee', 'Profile', {
                          id: 'trainee-profile',
                          data: profileDraft as unknown as Record<string, unknown>,
                          status: 'Active',
                        })
                        .catch(() => { })
                      flash('Profile saved to PostgreSQL. Name updated everywhere.')
                    }}
                  >
                    <Check size={16} /> {t('Save changes')}
                  </Button>
                </div>
              </section>
              <section className="tw-panel">
                <div className="tw-panel-head">
                  <div>
                    <span className="tw-overline">ACCOUNT</span>
                    <h2>{t('Settings')}</h2>
                  </div>
                </div>
                <div className="tw-analytics-line">
                  <span>Hostel room</span>
                  <strong>
                    {profile.room} · {profile.bed}
                  </strong>
                </div>
                <div className="tw-analytics-line">
                  <span>Enrolled programmes</span>
                  <strong>{summary[0]?.value}</strong>
                </div>
                <div className="tw-shortcuts" style={{ marginTop: 14 }}>
                  <Button variant="outline" onClick={onLogout}>
                    <LogOut /> {t('Log out')}
                  </Button>
                </div>
              </section>
            </div>
          )}
        </main>
      </div>

      {notice && (
        <div className="tw-toast" role="status">
          {notice}
        </div>
      )}

      {/* Face Capture Attendance Modal */}
      {faceModalOpen && (
        <FaceCaptureModal
          sessionId="trainee-session-id"
          onSuccess={handleFaceSuccess}
          onClose={() => setFaceModalOpen(false)}
        />
      )}

      {/* QR Code Scan / Entry Modal for Trainee */}
      {qrScanModalOpen && (
        <div
          className="tw-modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setQrScanModalOpen(false)
          }}
        >
          <div className="tw-modal max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden border border-emerald-800/10" role="dialog" aria-modal="true">
            <div className="tw-modal-head bg-emerald-900 text-white p-5">
              <div>
                <span className="text-amber-300 text-xs tracking-wider font-semibold uppercase block">
                  {ATTENDANCE_SYSTEM_NAME}
                </span>
                <h2 className="text-xl font-bold text-white mt-1">{t('Mark Attendance for Live Session')}</h2>
              </div>
              <Button variant="ghost" size="icon" className="text-white hover:bg-emerald-800" onClick={() => setQrScanModalOpen(false)}>
                <X size={20} />
              </Button>
            </div>

            <div className="p-6 text-center">
              {/* Active Session Banner */}
              {activeQrSession && (
                <div className="bg-emerald-50 border border-emerald-300 rounded-xl p-4 mb-5 text-left">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-2.5 h-2.5 bg-emerald-500 rounded-full animate-pulse" />
                    <strong className="text-emerald-900 text-sm">Live Session Active</strong>
                  </div>
                  <div className="text-xs text-slate-700 space-y-1">
                    <p><strong>Course:</strong> {activeQrSession.course}</p>
                    <p><strong>Batch:</strong> {activeQrSession.batch}</p>
                    <p><strong>Trainer:</strong> {activeQrSession.trainer}</p>
                    <p><strong>Token:</strong> <span className="font-mono font-bold text-emerald-800 text-sm">{activeQrSession.token}</span></p>
                  </div>
                </div>
              )}

              <div className="border-2 border-dashed border-emerald-400 bg-emerald-50/50 rounded-2xl p-6 mb-5 relative flex flex-col items-center justify-center">
                <div className="w-48 h-48 bg-white rounded-xl flex items-center justify-center shadow-inner border border-emerald-200 overflow-hidden relative">
                  {scanningCamera ? (
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-10 h-10 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin" />
                      <span className="text-xs font-semibold text-emerald-800">{t('Verifying...')}</span>
                      <span className="text-[10px] text-slate-500">Marking {profile.name} as Present</span>
                    </div>
                  ) : (
                    <div className="text-center p-4">
                      <Scan size={44} className="text-emerald-700 mx-auto mb-2 animate-pulse" />
                      <span className="text-xs text-slate-700 block font-medium">Point Camera at Trainer's QR Code</span>
                      <span className="text-[10px] text-slate-400 mt-1 block">or enter token manually below</span>
                    </div>
                  )}
                  <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-emerald-500 via-amber-400 to-emerald-500 animate-pulse" />
                </div>
              </div>

              <div className="text-left mb-4">
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">{t('Active Session Token')}</label>
                <div className="flex gap-2">
                  <input
                    value={inputQrToken}
                    onChange={(e) => setInputQrToken(e.target.value)}
                    placeholder="e.g. NCCP-DCM-8921"
                    className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono uppercase"
                    onKeyDown={(e) => { if (e.key === 'Enter') completeQrScan() }}
                  />
                  <Button className="bg-emerald-700 hover:bg-emerald-800 text-white font-medium px-4" onClick={completeQrScan} disabled={scanningCamera}>
                    <Check size={16} /> {t('Mark Present')}
                  </Button>
                </div>
              </div>

              <div className="text-left bg-slate-50 rounded-lg p-3 border border-slate-200">
                <p className="text-xs text-slate-600 flex items-center gap-1.5">
                  <Sparkles size={13} className="text-emerald-600" />
                  <span>Your name <strong>({profile.name})</strong> will appear on your trainer's dashboard immediately after scanning.</span>
                </p>
              </div>
            </div>

            <div className="p-4 bg-slate-100 flex justify-end border-t border-slate-200">
              <Button variant="outline" onClick={() => setQrScanModalOpen(false)}>
                {t('Cancel')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {quizFor && (
        <div
          className="tw-modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setQuizFor(null)
          }}
        >
          <div className="tw-modal" role="dialog" aria-modal="true" aria-label={quizFor.values[0]}>
            <div className="tw-modal-head">
              <div>
                <span className="tw-overline">
                  {quizFor.values[3]} · {quiz.length} QUESTIONS
                </span>
                <h2>{quizFor.values[0]}</h2>
              </div>
              <Button variant="ghost" size="icon" aria-label="Close quiz" onClick={() => setQuizFor(null)}>
                <X />
              </Button>
            </div>
            {quiz.map((q, qi) => (
              <div className="te-quiz-q" key={qi}>
                <p>
                  {qi + 1}. {q.q}
                </p>
                {q.options.map((o, oi) => (
                  <label key={o}>
                    <input
                      type="radio"
                      name={`q${qi}`}
                      checked={answers[qi] === oi}
                      onChange={() => setAnswers((a) => a.map((v, i) => (i === qi ? oi : v)))}
                    />{' '}
                    {o}
                  </label>
                ))}
              </div>
            ))}
            <div className="tw-modal-actions">
              <Button variant="outline" onClick={() => setQuizFor(null)}>
                {t('Cancel')}
              </Button>
              <Button className="tw-primary" onClick={submitQuiz}>
                <Check size={17} /> {t('Submit')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {modal && allSchemas(modal.section) && (
        <div
          className="tw-modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setModal(null)
          }}
        >
          <div className="tw-modal" role="dialog" aria-modal="true" aria-label={`${modal.item ? 'Edit' : 'Add'} ${modal.section}`}>
            <div className="tw-modal-head">
              <div>
                <span className="tw-overline">{modal.section.toUpperCase()}</span>
                <h2>{modal.item ? t('Edit') : t('Add new')}</h2>
              </div>
              <Button variant="ghost" size="icon" aria-label="Close editor" onClick={() => setModal(null)}>
                <X />
              </Button>
            </div>
            <div className="tw-form">
              {allSchemas(modal.section)?.fields.map((field, index) => (
                <label key={field}>
                  {t(field)}
                  {['Details', 'Message'].includes(field) ? (
                    <textarea
                      value={draft[index] ?? ''}
                      onChange={(e) => setDraft((v) => v.map((x, i) => (i === index ? e.target.value : x)))}
                    />
                  ) : (
                    <input
                      type={/date|Applied on/i.test(field) ? 'date' : 'text'}
                      value={draft[index] ?? ''}
                      onChange={(e) => setDraft((v) => v.map((x, i) => (i === index ? e.target.value : x)))}
                    />
                  )}
                </label>
              ))}
              <label>
                {t('Status')}
                <select value={draftStatus} onChange={(e) => setDraftStatus(e.target.value)}>
                  {allSchemas(modal.section)?.statuses.map((o) => (
                    <option key={o} value={o}>
                      {t(o)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="tw-modal-actions">
              <Button variant="outline" onClick={() => setModal(null)}>
                {t('Cancel')}
              </Button>
              <Button className="tw-primary" onClick={save}>
                <Check size={17} /> {t('Save changes')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
