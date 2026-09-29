import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  ArrowRight,
  Award,
  BarChart3,
  Bell,
  BookOpen,
  Bot,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  Copy,
  Download,
  FileText,
  Fingerprint,
  GraduationCap,
  Home,
  Languages,
  LogOut,
  Megaphone,
  Menu,
  Pencil,
  Plus,
  QrCode,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  UsersRound,
  X,
  ExternalLink,
  Smartphone,
  Share2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import brand from '@/assets/nccp/10_institution_logo_brand.png'
import banner from '@/assets/nccp/07_institution_dashboard_banner.png'
import { workspaceApi } from '@/lib/nccp-api'
import { useI18n } from '@/lib/i18n-context'
import {
  ATTENDANCE_SYSTEM_NAME,
  ATTENDANCE_CHANNEL,
  broadcastSessionCreated,
  ActiveQrSession,
} from '@/lib/attendance-sync'
import { QrCodeSvg } from './QrCodeGenerator'
import './TrainerWorkspace.css'

type Section =
  | 'My Dashboard'
  | 'My Batches'
  | 'My Timetable'
  | 'Attendance'
  | 'Courses'
  | 'Assessments'
  | 'Trainee Performance'
  | 'Certification'
  | 'Announcements'
  | 'AI Teaching Assistant'
  | 'Trainer Analytics'

type RecordItem = { id: string; values: string[]; status: string }
type Store = Record<Section, RecordItem[]>
type Schema = {
  fields: string[]
  statuses: string[]
  rows: [string[], string][]
  icon: typeof Home
  note: string
}

const schemas: Partial<Record<Section, Schema>> = {
  'My Batches': {
    icon: UsersRound,
    fields: ['Batch code', 'Programme', 'Room', 'Schedule', 'Capacity'],
    statuses: ['Active', 'Upcoming', 'Completed'],
    note: 'Assigned cohorts and batch delivery',
    rows: [
      [['DCM-2026-04', 'Dairy Cooperative Management', 'Room 201', 'Mon, Wed, Fri · 10:00', '45'], 'Active'],
      [['AVC-2026-02', 'Agri Value Chain Development', 'Room 104', 'Tue, Thu · 14:00', '32'], 'Active'],
      [['CFA-2026-06', 'Cooperative Finance', 'Room 103', 'Fri · 11:00', '28'], 'Upcoming'],
    ],
  },
  'My Timetable': {
    icon: CalendarDays,
    fields: ['Session', 'Batch code', 'Date', 'Time', 'Room / link', 'Session type'],
    statuses: ['Scheduled', 'Live', 'Completed', 'Cancelled'],
    note: 'Classes, rooms and delivery modes',
    rows: [
      [['Cooperative Principles', 'DCM-2026-04', '2026-09-28', '10:00', 'Room 201', 'Offline'], 'Scheduled'],
      [['Dairy Supply Chain', 'DCM-2026-04', '2026-09-28', '14:00', 'Meet link in notes', 'Hybrid'], 'Scheduled'],
      [['Value Chain Workshop', 'AVC-2026-02', '2026-09-29', '11:00', 'Room 104', 'Offline'], 'Scheduled'],
    ],
  },
  'Attendance': {
    icon: ClipboardCheck,
    fields: ['Trainee', 'Batch code', 'Date', 'Method', 'Check-in / note'],
    statuses: ['Present', 'Absent', 'Late', 'Leave', 'Correction requested'],
    note: 'Daily attendance, corrections and check-ins',
    rows: [
      [['Ravi Kumar', 'DCM-2026-04', '2026-09-28', 'QR', '09:55'], 'Present'],
      [['Amaan Siddiqui', 'DCM-2026-04', '2026-09-28', 'Manual', ''], 'Absent'],
      [['Neha Singh', 'AVC-2026-02', '2026-09-28', 'R307', '10:02'], 'Present'],
      [['Pooja Kumari', 'AVC-2026-02', '2026-09-28', 'Manual', ''], 'Absent'],
    ],
  },
  'Courses': {
    icon: BookOpen,
    fields: ['Lesson / resource', 'Course', 'Module', 'Format', 'Resource link'],
    statuses: ['Draft', 'Published', 'Archived'],
    note: 'Modules, lessons and learning materials',
    rows: [
      [['Cooperative Principles', 'Dairy Cooperative Management', 'Module 1', 'PDF', ''], 'Published'],
      [['Dairy Supply Chain', 'Dairy Cooperative Management', 'Module 2', 'Video', ''], 'Draft'],
      [['Value Chain Mapping', 'Agri Value Chain Development', 'Module 1', 'Worksheet', ''], 'Published'],
    ],
  },
  'Assessments': {
    icon: ClipboardCheck,
    fields: ['Assessment', 'Batch code', 'Date', 'Max marks', 'Average score %', 'Question / instructions'],
    statuses: ['Draft', 'Scheduled', 'In progress', 'Completed'],
    note: 'Quizzes, questions, schedules and grading',
    rows: [
      [['Dairy Operations Quiz', 'DCM-2026-04', '2026-10-02', '100', '0', 'Explain three cooperative principles.'], 'Scheduled'],
      [['Value Chain Review', 'AVC-2026-02', '2026-09-26', '100', '78', 'Map a local supply chain.'], 'Completed'],
    ],
  },
  'Trainee Performance': {
    icon: BarChart3,
    fields: ['Trainee', 'Batch code', 'Attendance %', 'Course progress %', 'Assessment score %', 'Skill / note'],
    statuses: ['On track', 'At risk', 'Completed'],
    note: 'Individual progress and trainees needing support',
    rows: [
      [['Ravi Kumar', 'DCM-2026-04', '94', '86', '88', 'Dairy operations'], 'On track'],
      [['Amaan Siddiqui', 'DCM-2026-04', '65', '54', '61', 'Needs practical support'], 'At risk'],
      [['Neha Singh', 'AVC-2026-02', '88', '80', '82', 'Supply chains'], 'On track'],
      [['Pooja Kumari', 'AVC-2026-02', '72', '68', '70', 'Financial literacy'], 'At risk'],
    ],
  },
  'Certification': {
    icon: Award,
    fields: ['Trainee', 'Batch code', 'Attendance %', 'Course progress %', 'Assessment score %', 'Certificate ID'],
    statuses: ['Pending', 'Recommended', 'Issued'],
    note: 'Eligibility and certificate recommendations',
    rows: [
      [['Ravi Kumar', 'DCM-2026-04', '94', '86', '88', ''], 'Pending'],
      [['Neha Singh', 'AVC-2026-02', '88', '80', '82', ''], 'Pending'],
      [['Amaan Siddiqui', 'DCM-2026-04', '65', '54', '61', ''], 'Pending'],
    ],
  },
  'Announcements': {
    icon: Megaphone,
    fields: ['Title', 'Batch / audience', 'Message', 'Publish date', 'Type'],
    statuses: ['Draft', 'Published', 'Archived'],
    note: 'Batch notices and important updates',
    rows: [
      [['Assessment reminder', 'DCM-2026-04', 'The Dairy Operations Quiz is scheduled for 2 October.', '2026-09-28', 'Assessment'], 'Published'],
      [['Room update', 'AVC-2026-02', 'Tuesday workshop will be held in Room 104.', '2026-09-28', 'Schedule'], 'Published'],
    ],
  },
}

const sections: { label: Section; icon: typeof Home }[] = [
  { label: 'My Dashboard', icon: Home },
  { label: 'My Batches', icon: UsersRound },
  { label: 'My Timetable', icon: CalendarDays },
  { label: 'Attendance', icon: ClipboardCheck },
  { label: 'Courses', icon: BookOpen },
  { label: 'Assessments', icon: FileText },
  { label: 'Trainee Performance', icon: Activity },
  { label: 'Certification', icon: Award },
  { label: 'Announcements', icon: Megaphone },
  { label: 'AI Teaching Assistant', icon: Bot },
  { label: 'Trainer Analytics', icon: BarChart3 },
]

const key = 'nccp-trainer-workspace-v1'

function initialStore(): Store {
  return Object.fromEntries(
    Object.entries(schemas).map(([name, schema]) => [
      name,
      schema.rows.map(([values, status], i) => ({ id: `${name}-${i}`, values, status })),
    ])
  ) as Store
}

function readStore(): Store {
  try {
    const saved = window.localStorage.getItem(key)
    if (saved) {
      const parsed = JSON.parse(saved) as Store
      if (parsed && typeof parsed === 'object') return { ...initialStore(), ...parsed }
    }
  } catch {
    /* fallback */
  }
  return initialStore()
}

function downloadCsv(title: string, headers: string[], rows: RecordItem[]) {
  const escape = (value: string) => `"${String(value).replaceAll('"', '""')}"`
  const text = [headers.concat('Status'), ...rows.map((row) => row.values.concat(row.status))]
    .map((row) => row.map(escape).join(','))
    .join('\r\n')
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob(['\ufeff', text], { type: 'text/csv;charset=utf-8' }))
  link.download = `nccp-${title.toLowerCase().replaceAll(' ', '-')}.csv`
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1000)
}

export default function TrainerWorkspace({ onLogout }: { onLogout: () => void }) {
  const { t, language, setLanguage } = useI18n()
  const [section, setSection] = useState<Section>('My Dashboard')
  const [data, setData] = useState<Store>(initialStore)
  const [hydrated, setHydrated] = useState(false)
  const [search, setSearch] = useState('')
  const [mobileOpen, setMobileOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [modal, setModal] = useState<{ section: Section; item?: RecordItem } | null>(null)
  const [draft, setDraft] = useState<string[]>([])
  const [draftStatus, setDraftStatus] = useState('')
  const [notice, setNotice] = useState('')
  const [qrValue, setQrValue] = useState('')
  const [scanning, setScanning] = useState(false)

  // QR Session Generator state
  const [qrModalOpen, setQrModalOpen] = useState(false)
  const [qrBatch, setQrBatch] = useState('DCM-2026-04')
  const [qrCourse, setQrCourse] = useState('Dairy Cooperative Management')
  const [qrToken, setQrToken] = useState('NCCP-DCM-8921')
  const [tokenCopied, setTokenCopied] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)

  const [aiTask, setAiTask] = useState('Quiz questions')
  const [aiTopic, setAiTopic] = useState('Cooperative principles')
  const [aiLanguage, setAiLanguage] = useState('English')
  const [aiOutput, setAiOutput] = useState('')
  const today = new Date().toISOString().slice(0, 10)

  // Listen for real-time attendance markings from Mobile QR scan or Trainee Portal
  useEffect(() => {
    const handleAttendanceEvent = (payload: any) => {
      if (!payload?.traineeName) return
      const recId = payload.id || crypto.randomUUID()
      const recData: RecordItem = {
        id: recId,
        values: [
          payload.traineeName,
          payload.batchCode || qrBatch,
          payload.date || today,
          payload.method || 'Mobile QR Scan',
          `${payload.time || new Date().toTimeString().slice(0, 5)} · ${payload.systemName || ATTENDANCE_SYSTEM_NAME}`,
        ],
        status: 'Present',
      }

      setData((current) => {
        const attList = current.Attendance ? [...current.Attendance] : []
        const existingIdx = attList.findIndex(
          (r) =>
            (r.values[0] ?? '').toLowerCase() === payload.traineeName.toLowerCase() &&
            r.values[2] === (payload.date || today)
        )
        if (existingIdx >= 0) {
          attList[existingIdx] = recData
        } else {
          attList.unshift(recData)
        }
        return { ...current, Attendance: attList }
      })

      flash(`🟢 ${payload.traineeName} marked Present via ${payload.method || 'Mobile QR Scan'}!`)
    }

    let channel: BroadcastChannel | null = null
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        channel = new BroadcastChannel(ATTENDANCE_CHANNEL)
        channel.onmessage = (event) => {
          if (event.data?.type === 'ATTENDANCE_MARKED' && event.data?.payload) {
            handleAttendanceEvent(event.data.payload)
          }
        }
      }
    } catch {
      /* ignore */
    }

    const onCustomEvent = (e: any) => {
      if (e.detail) handleAttendanceEvent(e.detail)
    }
    window.addEventListener('nccp-attendance-marked', onCustomEvent)

    const onStorage = (e: StorageEvent) => {
      if (e.key === 'nccp-trainer-workspace-v1' && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue)
          if (parsed?.Attendance) {
            setData((prev) => ({ ...prev, Attendance: parsed.Attendance }))
          }
        } catch {
          /* ignore */
        }
      }
    }
    window.addEventListener('storage', onStorage)

    return () => {
      if (channel) channel.close()
      window.removeEventListener('nccp-attendance-marked', onCustomEvent)
      window.removeEventListener('storage', onStorage)
    }
  }, [qrBatch, today])

  const fetchDb = async () => {
    try {
      const res = await workspaceApi.list<RecordItem>('trainer')
      if (res?.data && res.data.length > 0) {
        const grouped: Store = initialStore()
        for (const item of res.data) {
          const sec = item.module as Section
          if (!grouped[sec]) grouped[sec] = []
          const exists = grouped[sec].some((r) => r.id === item.data.id)
          if (!exists) {
            grouped[sec].push(item.data as RecordItem)
          } else {
            grouped[sec] = grouped[sec].map((r) => (r.id === item.data.id ? (item.data as RecordItem) : r))
          }
        }
        setData(grouped)
      }
    } catch (err) {
      console.warn('[TrainerWorkspace] Offline sync fallback', err)
    }
  }

  useEffect(() => {
    let mounted = true
    async function initDb() {
      try {
        const local = readStore()
        setData(local)
        const res = await workspaceApi.list<RecordItem>('trainer')
        if (mounted && res?.data && res.data.length > 0) {
          const grouped: Store = initialStore()
          for (const item of res.data) {
            const sec = item.module as Section
            if (!grouped[sec]) grouped[sec] = []
            const exists = grouped[sec].some((r) => r.id === item.data.id)
            if (!exists) {
              grouped[sec].push(item.data as RecordItem)
            } else {
              grouped[sec] = grouped[sec].map((r) => (r.id === item.data.id ? (item.data as RecordItem) : r))
            }
          }
          setData(grouped)
        } else if (mounted) {
          const seedItems = Object.entries(initialStore()).flatMap(([sec, rows]) =>
            rows.map((row) => ({
              id: `trainer-${sec}-${row.id}`,
              module: sec,
              data: row as unknown as Record<string, unknown>,
              status: row.status,
            }))
          )
          void workspaceApi.batchSync('trainer', seedItems).catch(() => {})
        }
      } catch (err) {
        console.warn('[TrainerWorkspace] Offline fallback used', err)
      } finally {
        if (mounted) setHydrated(true)
      }
    }
    initDb()

    // Periodic live sync for real-time attendance updates
    const interval = setInterval(fetchDb, 4000)
    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [])

  useEffect(() => {
    if (hydrated) {
      try {
        window.localStorage.setItem(key, JSON.stringify(data))
      } catch {
        /* fallback */
      }
    }
  }, [data, hydrated])

  const rows = (name: Section) => data[name] ?? []
  const update = (name: Section, next: RecordItem[]) => setData((current) => ({ ...current, [name]: next }))
  const flash = (text: string) => {
    setNotice(text)
    window.setTimeout(() => setNotice(''), 3500)
  }
  const go = (name: Section) => {
    setSection(name)
    setSearch('')
    setMobileOpen(false)
    setNotificationsOpen(false)
  }
  const open = (name: Section, item?: RecordItem) => {
    const schema = schemas[name]
    if (!schema) return
    setDraft(item ? [...item.values] : schema.fields.map(() => ''))
    setDraftStatus(item?.status ?? schema.statuses[0] ?? 'Draft')
    setModal(item ? { section: name, item } : { section: name })
  }
  const save = () => {
    if (!modal) return
    const schema = schemas[modal.section]
    if (!schema || !draft[0]?.trim()) {
      flash('Enter the first field before saving.')
      return
    }
    const values = draft.map((value) => value.trim())
    const record = { id: modal.item?.id ?? crypto.randomUUID(), values, status: draftStatus }
    update(
      modal.section,
      modal.item ? rows(modal.section).map((item) => (item.id === record.id ? record : item)) : [record, ...rows(modal.section)]
    )
    void workspaceApi.save('trainer', modal.section, { id: record.id, data: record, status: record.status }).catch(() => {})
    setModal(null)
    flash(modal.item ? 'Changes saved to PostgreSQL. Dashboard totals updated.' : 'Record added to PostgreSQL. Dashboard totals updated.')
  }
  const remove = (name: Section, item: RecordItem) => {
    if (!window.confirm(`Delete ${item.values[0]}?`)) return
    update(name, rows(name).filter((row) => row.id !== item.id))
    void workspaceApi.delete('trainer', item.id, name).catch(() => {})
    flash('Record deleted from PostgreSQL. Dashboard totals updated.')
  }
  const status = (name: Section, item: RecordItem, value: string) => {
    const updated = { ...item, status: value }
    update(name, rows(name).map((row) => (row.id === item.id ? updated : row)))
    void workspaceApi.save('trainer', name, { id: item.id, data: updated, status: value }).catch(() => {})
    flash('Status updated in PostgreSQL.')
  }
  const filtered = (name: Section) =>
    rows(name).filter((row) => [...row.values, row.status].join(' ').toLowerCase().includes(search.toLowerCase()))
  const traineeCount = rows('Trainee Performance').length
  const present = rows('Attendance').filter((row) => row.status === 'Present' || row.status === 'Late').length
  const attendanceRate = rows('Attendance').length ? Math.round((present / rows('Attendance').length) * 100) : 0
  const average = (name: Section, index: number) => {
    const values = rows(name).map((row) => Number(row.values[index])).filter(Number.isFinite)
    return values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0
  }
  const due = rows('Assessments').filter((row) => ['Draft', 'Scheduled', 'In progress'].includes(row.status)).length
  const todaySessions = rows('My Timetable').filter((row) => row.values[2] === today && row.status !== 'Cancelled')
  const completion = traineeCount
    ? Math.round((rows('Trainee Performance').filter((row) => row.status === 'Completed' || Number(row.values[3]) >= 100).length / traineeCount) * 100)
    : 0
  const mark = (item: RecordItem, value: string) => status('Attendance', item, value)

  const checkIn = (method: string) => {
    const match = rows('Trainee Performance').find((row) => (row.values[0] ?? '').toLowerCase() === qrValue.trim().toLowerCase())
    if (!match) {
      flash('No matching trainee. Enter an exact trainee name.')
      return false
    }
    const current = rows('Attendance').find((row) => row.values[0] === match.values[0] && row.values[2] === today)
    const recId = current?.id ?? crypto.randomUUID()
    const recData: RecordItem = {
      id: recId,
      values: [match.values[0] ?? '', match.values[1] ?? '', today, method, new Date().toTimeString().slice(0, 5)],
      status: 'Present',
    }
    if (current) {
      update('Attendance', rows('Attendance').map((row) => (row.id === current.id ? recData : row)))
    } else {
      update('Attendance', [recData, ...rows('Attendance')])
    }
    void workspaceApi.save('trainer', 'Attendance', { id: recId, data: recData, status: 'Present' }).catch(() => {})
    setQrValue('')
    flash(`${match.values[0]} marked present by ${method} entry (recorded in PostgreSQL).`)
    return true
  }

  const qrCheck = () => {
    checkIn('QR')
  }
  const fingerprintCheck = () => {
    if (scanning) return
    if (!qrValue.trim()) {
      flash('Enter a trainee name, then press Space to scan their fingerprint.')
      return
    }
    setScanning(true)
    window.setTimeout(() => {
      setScanning(false)
      checkIn('Fingerprint')
    }, 1200)
  }

  useEffect(() => {
    if (section !== 'Attendance') return
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const tag = target?.tagName
      const isNameInput = target?.getAttribute('aria-label') === 'Trainee name for QR check-in'
      if (event.code === 'Space' && (isNameInput || (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT'))) {
        event.preventDefault()
        fingerprintCheck()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const eligible = (item: RecordItem) =>
    Number(item.values[2]) >= 75 && Number(item.values[3]) >= 75 && Number(item.values[4]) >= 70

  const generate = () => {
    if (!aiTopic.trim()) {
      flash('Enter a topic first.')
      return
    }
    const topic = aiTopic.trim()
    const content: Record<string, string> = {
      'Quiz questions': `1. Define ${topic} in your own words.\n2. Give two practical examples of ${topic} in a cooperative.\n3. What is one challenge when applying ${topic}, and how would you solve it?`,
      'Lesson plan': `Topic: ${topic}\nObjective: Explain and apply the key ideas.\nOpening (10 min): Ask learners to share an example.\nActivity (25 min): Work through a real cooperative scenario in groups.\nReview (15 min): Discuss findings and check understanding.`,
      'Worksheet': `Worksheet: ${topic}\nA. Write a definition.\nB. List three examples from your community.\nC. Describe one way you would use this concept at work.`,
      'Concept explanation': `${topic} can be understood by linking the concept to everyday cooperative work. Start with a familiar example, identify the people involved, then discuss the benefits and trade-offs together.`,
      'Training material': `Training material: ${topic}\nLearning goal: Understand the basics and apply them in practice.\nKey points: Definition, context, practical example, group activity and reflection.`,
    }
    setAiOutput(
      `${content[aiTask]}\n\nLanguage requested: ${aiLanguage}. This is an editable draft template, not an AI-generated or translated answer.`
    )
  }

  const generateNewQrSession = () => {
    const newToken = `NCCP-${qrBatch.slice(0, 3)}-${Math.floor(1000 + Math.random() * 9000)}`
    setQrToken(newToken)
    setQrModalOpen(true)

    const session: ActiveQrSession = {
      token: newToken,
      batch: qrBatch,
      course: qrCourse,
      date: today,
      trainer: 'Dr. Rajesh Kumar',
      createdAt: new Date().toISOString(),
      systemName: ATTENDANCE_SYSTEM_NAME,
    }
    broadcastSessionCreated(session)
    flash(`Session QR Code generated! Token: ${newToken}. Trainees can scan via mobile camera to put attendance.`)
  }

  const copyToken = () => {
    navigator.clipboard.writeText(qrToken)
    setTokenCopied(true)
    setTimeout(() => setTokenCopied(false), 2000)
  }

  const qrSessionUrl = useMemo(() => {
    if (typeof window === 'undefined') return ''
    const origin = window.location.origin
    return `${origin}/?action=attendance&token=${encodeURIComponent(qrToken)}&batch=${encodeURIComponent(qrBatch)}&course=${encodeURIComponent(qrCourse)}&trainer=${encodeURIComponent('Dr. Rajesh Kumar')}&date=${encodeURIComponent(today)}`
  }, [qrToken, qrBatch, qrCourse, today])

  const copySessionLink = () => {
    if (navigator.clipboard && qrSessionUrl) {
      navigator.clipboard.writeText(qrSessionUrl)
      setLinkCopied(true)
      setTimeout(() => setLinkCopied(false), 2000)
      flash('Mobile Attendance link copied to clipboard!')
    }
  }

  const qrSessionPayload = qrSessionUrl || qrToken

  const schema = schemas[section]
  const summary = [
    { label: t('Today’s sessions'), value: todaySessions.length, icon: CalendarDays, target: 'My Timetable' as Section },
    { label: t('Assigned batches'), value: rows('My Batches').filter((row) => row.status === 'Active').length, icon: UsersRound, target: 'My Batches' as Section },
    { label: t('Total trainees'), value: traineeCount, icon: GraduationCap, target: 'Trainee Performance' as Section },
    { label: t('Today’s attendance'), value: `${attendanceRate}%`, icon: CheckCircle2, target: 'Attendance' as Section },
    { label: t('Pending assessments'), value: due, icon: ClipboardCheck, target: 'Assessments' as Section },
    { label: t('Course progress'), value: `${average('Trainee Performance', 3)}%`, icon: BookOpen, target: 'Courses' as Section },
    { label: t('Average batch score'), value: `${average('Trainee Performance', 4)}%`, icon: BarChart3, target: 'Trainee Performance' as Section },
    { label: t('Completion rate'), value: `${completion}%`, icon: Award, target: 'Certification' as Section },
  ]
  const activity = useMemo(() => rows('Announcements').filter((row) => row.status === 'Published').slice(0, 3), [data])

  return (
    <div className="tw-shell">
      {mobileOpen && <div className="tw-scrim" onClick={() => setMobileOpen(false)} />}
      <aside className={`tw-sidebar ${mobileOpen ? 'tw-open' : ''}`}>
        <div className="tw-brand">
          <img src={brand} alt="NCCP logo" />
          <span>
            <strong>NCCP</strong>
            <small>{t('TRAINER WORKSPACE')}</small>
          </span>
          <Button variant="ghost" size="icon" className="tw-close" aria-label="Close navigation" onClick={() => setMobileOpen(false)}>
            <X />
          </Button>
        </div>
        <div className="tw-side-caption">{t('WORKSPACE', 'कार्यक्षेत्र')}</div>
        <nav aria-label="Trainer navigation">
          {sections.map(({ label, icon: Icon }) => (
            <Button
              variant="ghost"
              key={label}
              className={`tw-nav-item ${section === label ? 'is-active' : ''}`}
              onClick={() => go(label)}
            >
              <Icon size={18} />
              <span>{t(label)}</span>
              {section === label && <span className="tw-nav-dot" />}
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
            {t('TRAINER WORKSPACE')} <span>/</span> <strong>{t(section)}</strong>
          </div>
          <div className="tw-top-actions">
            {/* Bilingual Switcher */}
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
                title="Notifications"
                onClick={() => {
                  setNotificationsOpen(!notificationsOpen)
                  setProfileOpen(false)
                }}
              >
                <Bell />
              </Button>
              {activity.length > 0 && <i className="tw-bell-dot" />}
              {notificationsOpen && (
                <div className="tw-popover">
                  <b>{t('Announcements')}</b>
                  {activity.length ? (
                    activity.map((item) => (
                      <p key={item.id}>
                        <strong>{item.values[0]}</strong>
                        <br />
                        {item.values[2]}
                      </p>
                    ))
                  ) : (
                    <p>No new announcements.</p>
                  )}
                  <Button variant="ghost" onClick={() => go('Announcements')}>
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
                  setNotificationsOpen(false)
                }}
              >
                <span className="tw-avatar">RK</span>
                <span className="tw-profile-name">
                  <strong>Dr. Rajesh Kumar</strong>
                  <small>{t('Trainer')}</small>
                </span>
                <ChevronDown size={15} />
              </Button>
              {profileOpen && (
                <div className="tw-popover tw-profile-pop">
                  <b>Dr. Rajesh Kumar</b>
                  <p>{t('Trainer')} · NCCP</p>
                  <Button variant="ghost" onClick={onLogout}>
                    <LogOut size={16} /> {t('Log out')}
                  </Button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="tw-content">
          <div className="tw-banner">
            <img src={banner} alt="Cooperative training campus" />
            <div className="tw-banner-shade" />
            <div className="tw-banner-text">
              <span className="tw-kicker">NCCP · {t('TRAINER WORKSPACE')}</span>
              <h1>{section === 'My Dashboard' ? t('Good day, Dr. Rajesh Kumar') : t(section)}</h1>
              <p>
                {section === 'My Dashboard'
                  ? t('Your classes, learners and progress in one place.')
                  : schema?.note ??
                    (section === 'AI Teaching Assistant'
                      ? 'Prepare teaching drafts for your next session.'
                      : 'Follow learning outcomes across your batches.')}
              </p>
            </div>
          </div>

          {section === 'My Dashboard' && (
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
                    onClick={generateNewQrSession}
                  >
                    <QrCode size={16} /> {t('Generate Session QR Code')}
                  </Button>
                  <span className="tw-live">
                    <i /> {t('Active')}
                  </span>
                </div>
              </div>
              <div className="tw-stat-grid">
                {summary.map(({ label, value, icon: Icon, target }) => (
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
                ))}
              </div>
              <div className="tw-dashboard-grid">
                <section className="tw-panel tw-wide">
                  <div className="tw-panel-head">
                    <div>
                      <span className="tw-overline">{t('UP NEXT')}</span>
                      <h2>{t('Today’s sessions')}</h2>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => go('My Timetable')}>
                      {t('View all')} <ArrowRight size={15} />
                    </Button>
                  </div>
                  {todaySessions.length ? (
                    todaySessions.map((item) => (
                      <div className="tw-session" key={item.id}>
                        <span className="tw-time">{item.values[3]}</span>
                        <div>
                          <strong>{item.values[0]}</strong>
                          <small>
                            {item.values[1]} · {item.values[4]} · {item.values[5]}
                          </small>
                        </div>
                        <span className="tw-chip">{t(item.status)}</span>
                      </div>
                    ))
                  ) : (
                    <p className="tw-empty">No sessions scheduled today. Add one in My Timetable.</p>
                  )}
                </section>
                <section className="tw-panel">
                  <div className="tw-panel-head">
                    <div>
                      <span className="tw-overline">{t('LATEST')}</span>
                      <h2>{t('Announcements')}</h2>
                    </div>
                    <Button variant="ghost" size="icon" title="All announcements" onClick={() => go('Announcements')}>
                      <ArrowRight />
                    </Button>
                  </div>
                  {activity.length ? (
                    activity.map((item) => (
                      <div className="tw-feed" key={item.id}>
                        <span className="tw-feed-icon">
                          <Megaphone size={17} />
                        </span>
                        <div>
                          <strong>{item.values[0]}</strong>
                          <small>
                            {item.values[1]} · {item.values[3]}
                          </small>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="tw-empty">No published announcements.</p>
                  )}
                </section>
                <section className="tw-panel tw-wide">
                  <div className="tw-panel-head">
                    <div>
                      <span className="tw-overline">{t('COHORTS')}</span>
                      <h2>{t('My Batches')}</h2>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => go('My Batches')}>
                      {t('Manage batches')} <ArrowRight size={15} />
                    </Button>
                  </div>
                  <div className="tw-batch-grid">
                    {rows('My Batches')
                      .slice(0, 4)
                      .map((item) => (
                        <Button
                          variant="ghost"
                          className="tw-batch"
                          key={item.id}
                          onClick={() => {
                            go('My Batches')
                            open('My Batches', item)
                          }}
                        >
                          <span className="tw-batch-initial">{(item.values[0] ?? '').slice(0, 2)}</span>
                          <span>
                            <strong>{item.values[1]}</strong>
                            <small>
                              {item.values[0]} · {item.values[3]}
                            </small>
                          </span>
                          <ArrowRight size={15} />
                        </Button>
                      ))}
                  </div>
                </section>
                <section className="tw-panel">
                  <div className="tw-panel-head">
                    <div>
                      <span className="tw-overline">{t('QUICK ACTIONS')}</span>
                      <h2>{t('Keep things moving')}</h2>
                    </div>
                  </div>
                  <div className="tw-shortcuts">
                    <Button variant="outline" onClick={generateNewQrSession} className="border-emerald-500 text-emerald-800 bg-emerald-50/50">
                      <QrCode className="text-emerald-700" /> {t('Generate Session QR Code')}
                    </Button>
                    <Button variant="outline" onClick={() => open('Attendance')}>
                      <CheckCircle2 /> {t('Mark attendance')}
                    </Button>
                    <Button variant="outline" onClick={() => open('Assessments')}>
                      <ClipboardCheck /> {t('Create assessment')}
                    </Button>
                    <Button variant="outline" onClick={() => open('Courses')}>
                      <Upload /> {t('Add learning material')}
                    </Button>
                    <Button variant="outline" onClick={() => go('AI Teaching Assistant')}>
                      <Bot /> {t('Teaching assistant')}
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
                      onClick={generateNewQrSession}
                    >
                      <QrCode size={17} />
                      <span>{t('Generate Session QR Code')}</span>
                    </Button>
                  )}
                  <label className="tw-search">
                    <Search size={17} />
                    <input
                      aria-label={`Search ${section}`}
                      placeholder={t('Search') + '...'}
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                    />
                  </label>
                  <Button
                    variant="outline"
                    title="Download CSV"
                    aria-label={`Download ${section} CSV`}
                    onClick={() => downloadCsv(section, schema.fields, filtered(section))}
                  >
                    <Download size={17} />
                    <span>{t('Export')}</span>
                  </Button>
                  <Button className="tw-primary" onClick={() => open(section)}>
                    <Plus size={17} /> {t('Add new')}
                  </Button>
                </div>
              </div>

              {section === 'Attendance' && (
                <div className="tw-inline-tools bg-gradient-to-r from-emerald-50/80 to-amber-50/50 border border-emerald-200 p-4 rounded-xl flex flex-wrap items-center gap-4">
                  <div>
                    <strong className="text-emerald-900 block font-semibold">{t('QR Attendance Entry')}</strong>
                    <small className="text-slate-600">Enter trainee name to record check-in, or show Live Session QR Code for instant student check-in.</small>
                  </div>
                  <div className="flex items-center gap-2 flex-1 min-w-[280px]">
                    <input
                      aria-label="Trainee name for QR check-in"
                      placeholder={t('Trainee name for QR check-in', 'Trainee name')}
                      value={qrValue}
                      className="flex-1 bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm"
                      onChange={(event) => setQrValue(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') qrCheck()
                      }}
                    />
                    <Button className="tw-primary bg-emerald-700 hover:bg-emerald-800" onClick={qrCheck}>
                      <Check size={16} /> {t('Check In')}
                    </Button>
                    <Button
                      variant="outline"
                      className="border-emerald-600 text-emerald-800 font-medium"
                      onClick={generateNewQrSession}
                    >
                      <QrCode size={16} /> {t('Live Session QR Code')}
                    </Button>
                  </div>
                  <Button
                    variant="outline"
                    className={`tw-hardware ${scanning ? 'tw-scanning' : ''}`}
                    onClick={fingerprintCheck}
                    title="Fingerprint check-in (or press Space)"
                  >
                    <Fingerprint size={16} /> {scanning ? 'Scanning fingerprint…' : 'R307 Biometric Check-in'}
                  </Button>
                </div>
              )}

              {section === 'Certification' && (
                <p className="tw-info">
                  <ShieldCheck size={17} /> Eligibility guide: attendance ≥75%, progress ≥75%, assessment ≥70%. Recommendations do not issue certificates.
                </p>
              )}

              {section === 'Trainee Performance' && (
                <div className="tw-mini-stats">
                  <span>
                    <strong>{traineeCount}</strong> {t('Total trainees')}
                  </span>
                  <span>
                    <strong>{rows('Trainee Performance').filter((row) => row.status === 'At risk').length}</strong> {t('At risk')}
                  </span>
                  <span>
                    <strong>{average('Trainee Performance', 4)}%</strong> {t('Average batch score')}
                  </span>
                </div>
              )}

              <div className="tw-table-wrap">
                <table className="tw-table">
                  <thead>
                    <tr>
                      {schema.fields.map((field) => (
                        <th key={field}>{t(field)}</th>
                      ))}
                      {section === 'Certification' && <th>{t('Eligible')}</th>}
                      <th>{t('Status')}</th>
                      <th>{t('Actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered(section).map((item) => (
                      <tr key={item.id}>
                        {item.values.map((value, index) => (
                          <td key={index}>{value || '—'}</td>
                        ))}
                        {section === 'Certification' && (
                          <td>
                            <span className={`tw-chip ${eligible(item) ? 'tw-success' : 'tw-warning'}`}>
                              {eligible(item) ? t('Eligible') : 'Not yet eligible'}
                            </span>
                          </td>
                        )}
                        <td>
                          {section === 'Attendance' ? (
                            <select
                              aria-label={`Attendance status for ${item.values[0]}`}
                              value={item.status}
                              onChange={(event) => mark(item, event.target.value)}
                            >
                              {schema.statuses.map((option) => (
                                <option key={option} value={option}>
                                  {t(option)}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span
                              className={`tw-chip ${
                                ['Active', 'Present', 'Published', 'Completed', 'Issued', 'On track'].includes(item.status)
                                  ? 'tw-success'
                                  : ''
                              }`}
                            >
                              {t(item.status)}
                            </span>
                          )}
                        </td>
                        <td>
                          <div className="tw-row-actions">
                            {section === 'Certification' && eligible(item) && item.status === 'Pending' && (
                              <Button variant="outline" size="sm" onClick={() => status(section, item, 'Recommended')}>
                                {t('Recommend')}
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              title={`Edit ${item.values[0]}`}
                              aria-label={`Edit ${item.values[0]}`}
                              onClick={() => open(section, item)}
                            >
                              <Pencil size={16} />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              title={`Delete ${item.values[0]}`}
                              aria-label={`Delete ${item.values[0]}`}
                              onClick={() => remove(section, item)}
                            >
                              <Trash2 size={16} />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filtered(section).length === 0 && (
                  <div className="tw-empty tw-table-empty">No records match your search. Add a record to get started.</div>
                )}
              </div>
            </>
          )}

          {section === 'AI Teaching Assistant' && (
            <div className="tw-ai-grid">
              <section className="tw-panel">
                <div className="tw-panel-head">
                  <div>
                    <span className="tw-overline">PREPARE</span>
                    <h2>Teaching draft</h2>
                  </div>
                  <Bot size={22} />
                </div>
                <div className="tw-form">
                  <label>
                    Material type
                    <select value={aiTask} onChange={(event) => setAiTask(event.target.value)}>
                      {['Quiz questions', 'Lesson plan', 'Worksheet', 'Concept explanation', 'Training material'].map((value) => (
                        <option key={value}>{value}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Topic
                    <input value={aiTopic} onChange={(event) => setAiTopic(event.target.value)} />
                  </label>
                  <label>
                    Requested language
                    <select value={aiLanguage} onChange={(event) => setAiLanguage(event.target.value)}>
                      {['English', 'Hindi', 'Marathi', 'Tamil', 'Bengali'].map((value) => (
                        <option key={value}>{value}</option>
                      ))}
                    </select>
                  </label>
                  <Button className="tw-primary" onClick={generate}>
                    <Bot size={17} /> Prepare draft
                  </Button>
                </div>
              </section>
              <section className="tw-panel">
                <div className="tw-panel-head">
                  <div>
                    <span className="tw-overline">WORKING COPY</span>
                    <h2>Your material</h2>
                  </div>
                </div>
                <textarea
                  aria-label="Editable teaching material"
                  className="tw-output"
                  value={aiOutput}
                  onChange={(event) => setAiOutput(event.target.value)}
                  placeholder="Your draft will appear here. You can edit and download it."
                />
                <Button
                  variant="outline"
                  disabled={!aiOutput}
                  onClick={() =>
                    downloadCsv('teaching-draft', ['Material'], [{ id: 'draft', values: [aiOutput], status: 'Draft' }])
                  }
                >
                  <Download size={16} /> Download draft
                </Button>
              </section>
            </div>
          )}

          {section === 'Trainer Analytics' && (
            <>
              <div className="tw-stat-grid">
                {summary.slice(1, 8).map(({ label, value, icon: Icon, target }) => (
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
                ))}
              </div>
              <div className="tw-dashboard-grid">
                <section className="tw-panel tw-wide">
                  <div className="tw-panel-head">
                    <div>
                      <span className="tw-overline">LEARNING PROGRESS</span>
                      <h2>Batch performance</h2>
                    </div>
                  </div>
                  {rows('My Batches').map((batch) => {
                    const people = rows('Trainee Performance').filter((row) => row.values[1] === batch.values[0])
                    const score = people.length
                      ? Math.round(people.reduce((sum, row) => sum + Number(row.values[4] || 0), 0) / people.length)
                      : 0
                    return (
                      <div className="tw-progress-row" key={batch.id}>
                        <div>
                          <strong>{batch.values[1]}</strong>
                          <span>{score}% average score</span>
                        </div>
                        <progress max="100" value={score} />
                      </div>
                    )
                  })}
                </section>
                <section className="tw-panel">
                  <div className="tw-panel-head">
                    <div>
                      <span className="tw-overline">ASSESSMENTS</span>
                      <h2>Assessment mix</h2>
                    </div>
                  </div>
                  {['Draft', 'Scheduled', 'In progress', 'Completed'].map((value) => (
                    <div className="tw-analytics-line" key={value}>
                      <span>{t(value)}</span>
                      <strong>{rows('Assessments').filter((row) => row.status === value).length}</strong>
                    </div>
                  ))}
                </section>
              </div>
            </>
          )}
        </main>
      </div>

      {notice && (
        <div className="tw-toast" role="status">
          {notice}
        </div>
      )}

      {/* QR Code Live Session Modal */}
      {qrModalOpen && (
        <div
          className="tw-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setQrModalOpen(false)
          }}
        >
          <div className="tw-modal max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden border border-emerald-800/10" role="dialog" aria-modal="true">
            <div className="tw-modal-head bg-emerald-900 text-white p-5">
              <div>
                <span className="text-amber-300 text-xs tracking-wider font-semibold uppercase block">
                  {ATTENDANCE_SYSTEM_NAME}
                </span>
                <h2 className="text-xl font-bold text-white mt-1">{t('Scan Session QR Code')}</h2>
              </div>
              <Button variant="ghost" size="icon" className="text-white hover:bg-emerald-800" onClick={() => setQrModalOpen(false)}>
                <X size={20} />
              </Button>
            </div>

            <div className="p-6 text-center">
              <div className="mb-4">
                <QrCodeSvg value={qrSessionPayload} size={230} className="mx-auto" />
              </div>

              {/* Session Token & Direct Mobile Scan Link */}
              <div className="flex flex-wrap items-center justify-center gap-2 mb-4">
                <div className="bg-emerald-50 rounded-xl p-2.5 px-3 border border-emerald-200/80 inline-flex items-center gap-2">
                  <div className="text-left">
                    <span className="text-[10px] text-emerald-800 font-semibold uppercase block">{t('Session Token')}</span>
                    <strong className="text-base font-mono text-emerald-950 tracking-wider">{qrToken}</strong>
                  </div>
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs gap-1 text-emerald-800 hover:bg-emerald-100" onClick={copyToken}>
                    {tokenCopied ? <Check size={13} className="text-emerald-700" /> : <Copy size={13} />}
                    <span>{tokenCopied ? t('Copied!') : t('Copy')}</span>
                  </Button>
                </div>

                <Button
                  size="sm"
                  variant="outline"
                  className="h-11 px-3 border-emerald-300 bg-white hover:bg-emerald-50 text-emerald-900 font-semibold gap-1.5 shadow-sm"
                  onClick={() => {
                    if (qrSessionUrl) window.open(qrSessionUrl, '_blank')
                  }}
                >
                  <Smartphone size={15} className="text-emerald-700" />
                  <span className="text-xs">Open Mobile Scan Page</span>
                  <ExternalLink size={12} className="text-slate-400" />
                </Button>

                <Button
                  size="sm"
                  variant="outline"
                  className="h-11 px-3 border-emerald-200 text-xs text-slate-700 hover:bg-slate-50 gap-1.5"
                  onClick={copySessionLink}
                >
                  {linkCopied ? <Check size={14} className="text-emerald-700" /> : <Share2 size={14} />}
                  <span>{linkCopied ? 'Link Copied!' : 'Copy Scan Link'}</span>
                </Button>
              </div>

              <div className="text-left text-xs text-slate-600 space-y-1.5 bg-slate-50 p-3.5 rounded-lg border border-slate-200 mb-4">
                <p>
                  <strong>{t('Batches')}:</strong> {qrBatch} — {qrCourse}
                </p>
                <p>
                  <strong>{t('Trainer')}:</strong> Dr. Rajesh Kumar | <strong>{t('Schedule')}:</strong> {today}
                </p>
                <p className="text-emerald-700 font-medium flex items-center gap-1.5">
                  <Sparkles size={13} />
                  <span>Scan with any phone camera or trainee portal to put Present instantly.</span>
                </p>
              </div>

              {/* Live Attendees Feed in QR Modal */}
              <div className="text-left pt-3 border-t border-slate-200">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                    <UsersRound size={14} className="text-emerald-700" />
                    Live Attendees Marked Present ({rows('Attendance').filter((r) => r.status === 'Present' && r.values[2] === today).length})
                  </span>
                  <span className="text-[10px] text-emerald-700 font-semibold flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping inline-block" /> Live sync
                  </span>
                </div>

                <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1">
                  {rows('Attendance').filter((r) => r.status === 'Present' && r.values[2] === today).length === 0 ? (
                    <div className="text-xs text-slate-400 italic py-3 text-center bg-slate-50 rounded-lg border border-dashed border-slate-200">
                      Waiting for trainees to scan QR code or put attendance...
                    </div>
                  ) : (
                    rows('Attendance')
                      .filter((r) => r.status === 'Present' && r.values[2] === today)
                      .map((att) => (
                        <div
                          key={att.id}
                          className="text-xs p-2 rounded-lg bg-emerald-50/90 border border-emerald-200 flex items-center justify-between animate-in fade-in slide-in-from-top-1 duration-200"
                        >
                          <div className="flex items-center gap-2">
                            <CheckCircle2 size={15} className="text-emerald-700 shrink-0" />
                            <strong className="text-emerald-950 font-bold">{att.values[0]}</strong>
                            <span className="text-[10px] text-emerald-800 bg-white px-1.5 py-0.5 rounded border border-emerald-200 font-medium">
                              {att.values[3] || 'QR'}
                            </span>
                          </div>
                          <span className="text-[10px] text-slate-600 font-mono">
                            {att.values[4]?.split('·')?.[0]?.trim() || 'Checked In'}
                          </span>
                        </div>
                      ))
                  )}
                </div>
              </div>
            </div>

            <div className="p-4 bg-slate-100 flex justify-between items-center border-t border-slate-200">
              <span className="text-xs text-slate-600 font-medium">
                {t('Attendance %')}: <strong>{attendanceRate}%</strong> ({present} {t('Present')})
              </span>
              <Button className="tw-primary bg-emerald-800 hover:bg-emerald-900" onClick={() => setQrModalOpen(false)}>
                {t('Close')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {modal && schemas[modal.section] && (
        <div
          className="tw-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setModal(null)
          }}
        >
          <div className="tw-modal" role="dialog" aria-modal="true" aria-label={`${modal.item ? 'Edit' : 'Add'} ${modal.section}`}>
            <div className="tw-modal-head">
              <div>
                <span className="tw-overline">{t(modal.section).toUpperCase()}</span>
                <h2>{modal.item ? t('Edit') : t('Add new')}</h2>
              </div>
              <Button variant="ghost" size="icon" aria-label="Close editor" onClick={() => setModal(null)}>
                <X />
              </Button>
            </div>
            <div className="tw-form">
              {schemas[modal.section]?.fields.map((field, index) => (
                <label key={field}>
                  {t(field)}
                  {field === 'Message' || field === 'Question / instructions' ? (
                    <textarea
                      value={draft[index] ?? ''}
                      onChange={(event) =>
                        setDraft((values) => values.map((value, i) => (i === index ? event.target.value : value)))
                      }
                    />
                  ) : (
                    <input
                      required={index === 0}
                      type={field === 'Date' || field === 'Publish date' ? 'date' : 'text'}
                      value={draft[index] ?? ''}
                      onChange={(event) =>
                        setDraft((values) => values.map((value, i) => (i === index ? event.target.value : value)))
                      }
                    />
                  )}
                </label>
              ))}
              <label>
                {t('Status')}
                <select value={draftStatus} onChange={(event) => setDraftStatus(event.target.value)}>
                  {schemas[modal.section]?.statuses.map((option) => (
                    <option key={option} value={option}>
                      {t(option)}
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
