import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  Award,
  BarChart3,
  BedDouble,
  Bell,
  BookOpen,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  Clock3,
  FileBarChart2,
  FileText,
  GraduationCap,
  Home,
  Landmark,
  Languages,
  LogOut,
  Megaphone,
  Menu,
  Package,
  Pencil,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Trash2,
  UsersRound,
  X,
  UserPlus,
  KeyRound,
  Eye,
  EyeOff,
  Copy,
  Printer,
  Sparkles,
  RefreshCw,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import brand from '@/assets/nccp/10_institution_logo_brand.png'
import banner from '@/assets/nccp/07_institution_dashboard_banner.png'
import { workspaceApi } from '@/lib/nccp-api'
import { useI18n } from '@/lib/i18n-context'
import { saveRegisteredTrainee, RegisteredTrainee } from '@/lib/attendance-sync'

type Row = { id: string; values: string[]; status: string; updated: string }
type Data = Record<string, Row[]>
type Definition = { icon: typeof Home; fields: string[]; statuses: string[]; initial: [string[], string][]; description: string }
const modules: Record<string, Definition> = {
  'Batch Management': { icon: ClipboardCheck, fields: ['Batch code', 'Programme', 'Trainer', 'Room', 'Capacity', 'Schedule'], statuses: ['Planning', 'Active', 'Completed'], description: 'Cohorts, capacity, trainer assignments and classroom allocation.', initial: [[['DCM-2026-04','Dairy Cooperative Management','Dr. Rajesh Kumar','Room 201','45','Mon, Wed · 10:00'],'Active'],[['DSC-2026-08','Digital Skills for Cooperatives','Priya Singh','Lab 2','38','Tue, Thu · 14:00'],'Active'],[['CFA-2026-06','Cooperative Finance','Aman Verma','Room 103','32','Fri · 11:00'],'Planning']] },
  'Trainee Management': { icon: UsersRound, fields: ['Trainee name', 'Programme', 'Batch', 'Email', 'Attendance %', 'Score %'], statuses: ['Nominated', 'Approved', 'Rejected', 'Active', 'Completed'], description: 'Nominations, profiles, training history and progress.', initial: [[['Amaan Siddiqui','Dairy Cooperative Management','DCM-2026-04','amaan@example.in','0','0'],'Nominated'],[['Pooja Kumari','Digital Skills for Cooperatives','DSC-2026-08','pooja@example.in','0','0'],'Nominated'],[['Ravi Kumar','Dairy Cooperative Management','DCM-2026-04','ravi@example.in','94','88'],'Active'],[['Neha Singh','Digital Skills for Cooperatives','DSC-2026-08','neha@example.in','88','82'],'Active']] },
  'Trainer Management': { icon: GraduationCap, fields: ['Trainer name', 'Specialisation', 'Assigned batch', 'Email', 'Workload hours', 'Rating %'], statuses: ['Available', 'Assigned', 'Inactive'], description: 'Assignments, timetables, workloads and performance.', initial: [[['Dr. Rajesh Kumar','Dairy Management','DCM-2026-04','rajesh@example.in','24','92'],'Assigned'],[['Priya Singh','Digital Skills','DSC-2026-08','priya@example.in','18','89'],'Assigned'],[['Aman Verma','Cooperative Finance','CFA-2026-06','aman@example.in','12','91'],'Available']] },
  'Courses & Programmes': { icon: BookOpen, fields: ['Programme title', 'Category', 'Duration', 'Coordinator', 'Start date', 'End date'], statuses: ['Draft', 'Active', 'Completed'], description: 'Programme catalogue, course assignments and delivery dates.', initial: [[['Dairy Cooperative Management','Agriculture','12 weeks','Dr. Rajesh Kumar','2026-09-01','2026-11-30'],'Active'],[['Digital Skills for Cooperatives','Digital','10 weeks','Priya Singh','2026-09-15','2026-11-24'],'Active'],[['Cooperative Finance','Finance','8 weeks','Aman Verma','2026-10-01','2026-11-26'],'Draft']] },
  'Course Content': { icon: FileText, fields: ['Lesson / resource', 'Programme', 'Module', 'Format', 'Owner', 'Link / location'], statuses: ['Draft', 'Published', 'Archived'], description: 'Lessons, learning materials and course resources.', initial: [[['Cooperative Principles','Dairy Cooperative Management','Module 1','PDF','Dr. Rajesh Kumar','Resource library'],'Published'],[['Spreadsheets for Cooperatives','Digital Skills for Cooperatives','Module 2','Video','Priya Singh','Resource library'],'Draft']] },
  Attendance: { icon: CheckCircle2, fields: ['Trainee', 'Batch', 'Session date', 'Method', 'Check-in time', 'Remarks'], statuses: ['Present', 'Absent', 'Late', 'Leave', 'Correction requested'], description: 'QR, R307 and manual attendance with correction review.', initial: [[['Ravi Kumar','DCM-2026-04','2026-09-28','QR','09:05','On time'],'Present'],[['Neha Singh','DSC-2026-08','2026-09-28','R307','14:08',''],'Present'],[['Pooja Kumari','DSC-2026-08','2026-09-28','Manual','','Pending verification'],'Correction requested']] },
  Assessments: { icon: ClipboardCheck, fields: ['Assessment', 'Programme', 'Batch', 'Date', 'Max marks', 'Average score %'], statuses: ['Scheduled', 'In progress', 'Completed', 'Cancelled'], description: 'Schedules, results, scores and batch performance.', initial: [[['Dairy Operations Quiz','Dairy Cooperative Management','DCM-2026-04','2026-10-02','100',''],'Scheduled'],[['Digital Literacy Test','Digital Skills for Cooperatives','DSC-2026-08','2026-09-25','100','78'],'Completed']] },
  Certificates: { icon: Award, fields: ['Trainee', 'Programme', 'Certificate ID', 'Issue date', 'Batch', 'Verification note'], statuses: ['Eligible', 'Issued', 'Revoked'], description: 'Eligibility, issuance, records and verification.', initial: [[['Ravi Kumar','Dairy Cooperative Management','NCCP-2026-8421','2026-09-20','DCM-2026-04','Verified'],'Issued'],[['Neha Singh','Digital Skills for Cooperatives','','','DSC-2026-08','Awaiting issue'],'Eligible']] },
  Timetable: { icon: CalendarDays, fields: ['Session', 'Batch', 'Date', 'Time', 'Trainer', 'Room'], statuses: ['Scheduled', 'Live', 'Completed', 'Cancelled'], description: 'Daily sessions, rooms, trainers and conflict-aware scheduling.', initial: [[['Cooperative Finance Workshop','CFA-2026-06','2026-09-29','10:00','Aman Verma','Room 103'],'Scheduled'],[['Digital Skills Lab','DSC-2026-08','2026-09-29','14:00','Priya Singh','Lab 2'],'Scheduled']] },
  Hostel: { icon: BedDouble, fields: ['Trainee / room', 'Block', 'Room', 'Bed', 'Check-in', 'Check-out'], statuses: ['Occupied', 'Reserved', 'Vacant', 'Maintenance'], description: 'Blocks, beds, allocation, check-in and maintenance.', initial: [[['Ravi Kumar','A','A-102','1','2026-09-01','2026-11-30'],'Occupied'],[['Neha Singh','B','B-204','2','2026-09-15','2026-11-24'],'Occupied'],[['A-105 bed 1','A','A-105','1','',''],'Vacant']] },
  Logistics: { icon: Package, fields: ['Request / item', 'Resource type', 'Quantity', 'Room / location', 'Requested by', 'Details'], statuses: ['Requested', 'Approved', 'Allocated', 'Maintenance', 'Closed'], description: 'Training kits, equipment, inventory and procurement requests.', initial: [[['Projectors','Equipment','2','Room 201','Dr. Rajesh Kumar','Training session'],'Allocated'],[['Training kits','Materials','45','Store A','Dr. Rajesh Kumar','DCM-2026-04'],'Requested']] },
  Announcements: { icon: Megaphone, fields: ['Title', 'Audience', 'Message', 'Publish date', 'Owner', 'Expiry date'], statuses: ['Draft', 'Published', 'Archived'], description: 'Institution notices and trainee communications.', initial: [[['October batch orientation','All trainees','Orientation begins next week.','2026-09-28','Institution Admin','2026-10-10'],'Published']] },
}
const formatNumber = (n: number) => new Intl.NumberFormat('en-IN').format(n)
const now = () => new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
const seed = (): Data => Object.fromEntries(Object.entries(modules).map(([key, def]) => [key, def.initial.map(([values,status], index) => ({ id: `${key}-${index}`, values, status, updated: '28 Sep 2026' }))]))
const storageKey = 'nccp-institute-dashboard-v1'
const names = Object.keys(modules)
const nav = ['Dashboard', ...names, 'Analytics', 'Reports', 'Institution Settings']
const extraIcons: Record<string, typeof Home> = { Dashboard: Home, Analytics: BarChart3, Reports: FileBarChart2, 'Institution Settings': Settings }
const metricDestination: Record<string,string> = { 'Total Trainees':'Trainee Management', 'Active Batches':'Batch Management', 'Active Programmes':'Courses & Programmes', Trainers:'Trainer Management', 'Attendance %':'Attendance', 'Completion Rate':'Trainee Management', 'Certificates Issued':'Certificates', 'Hostel Occupancy':'Hostel', 'Pending Nominations':'Trainee Management', 'Upcoming Sessions':'Timetable', 'Logistics Requests':'Logistics' }

export default function InstituteDashboard({ onLogout }: { onLogout: () => void }) {
  const { language, setLanguage, t } = useI18n()
  const [data, setData] = useState<Data>(seed)
  const [section, setSection] = useState('Dashboard')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('All')
  const [modal, setModal] = useState<'create'|'edit'|'view'|null>(null)
  const [selected, setSelected] = useState<Row|null>(null)
  const [values, setValues] = useState<string[]>([])
  const [status, setStatus] = useState('')
  const [profile, setProfile] = useState(false)
  const [notifications, setNotifications] = useState(false)
  const [read, setRead] = useState(false)
  const [mobile, setMobile] = useState(false)
  const [toast, setToast] = useState('')
  const [institutionName, setInstitutionName] = useState('Rajasthan Cooperative Institute')
  const [adminName, setAdminName] = useState('Dr. Anil Verma')
  const [settings, setSettings] = useState({ name: 'Rajasthan Cooperative Institute', admin: 'Dr. Anil Verma' })
  const [activity, setActivity] = useState<string[]>([])
  const [ready, setReady] = useState(false)

  // Add Trainee & Credentials generation state
  const [addTraineeModal, setAddTraineeModal] = useState(false)
  const [credentialSlip, setCredentialSlip] = useState<{
    id: string
    name: string
    email: string
    phone: string
    password: string
    batch: string
    programme: string
    status: string
  } | null>(null)
  const [copiedCreds, setCopiedCreds] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  // Form fields for new trainee
  const [newTraineeName, setNewTraineeName] = useState('')
  const [newTraineeEmail, setNewTraineeEmail] = useState('')
  const [newTraineePhone, setNewTraineePhone] = useState('')
  const [newTraineeProgramme, setNewTraineeProgramme] = useState('Dairy Cooperative Management')
  const [newTraineeBatch, setNewTraineeBatch] = useState('DCM-2026-04')
  const [newTraineeDistrict, setNewTraineeDistrict] = useState('Pune, Maharashtra')
  const [newTraineeStatus, setNewTraineeStatus] = useState('Active')
  const [generatedId, setGeneratedId] = useState('')
  const [generatedPassword, setGeneratedPassword] = useState('')

  const regenerateCredentials = () => {
    const id = `TRN-2026-${Math.floor(1000 + Math.random() * 9000)}`
    const pwList = ['Sahakar@2026!', 'Nccp#9821!', 'Bharat@2026#', 'Kisan#4829!', 'Coop@2026$']
    const pw = pwList[Math.floor(Math.random() * pwList.length)]
    setGeneratedId(id)
    setGeneratedPassword(pw)
  }

  const openAddTraineeModal = () => {
    regenerateCredentials()
    setNewTraineeName('')
    setNewTraineeEmail('')
    setNewTraineePhone('')
    setNewTraineeProgramme('Dairy Cooperative Management')
    setNewTraineeBatch('DCM-2026-04')
    setNewTraineeDistrict('Pune, Maharashtra')
    setNewTraineeStatus('Active')
    setShowPassword(false)
    setAddTraineeModal(true)
  }

  const handleCreateTrainee = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newTraineeName.trim()) {
      notify('Please enter the Trainee Name')
      return
    }
    const finalEmail = newTraineeEmail.trim() || `${newTraineeName.trim().toLowerCase().replace(/\s+/g, '.')}@nccp.in`
    const id = generatedId || `TRN-2026-${Math.floor(1000 + Math.random() * 9000)}`
    const password = generatedPassword || 'Sahakar@2026!'

    // 1. Add row to Trainee Management in Institute Dashboard
    const newRow: Row = {
      id,
      values: [newTraineeName.trim(), newTraineeProgramme, newTraineeBatch, finalEmail, '0', '0'],
      status: newTraineeStatus,
      updated: now(),
    }

    setData((prev) => ({
      ...prev,
      'Trainee Management': [newRow, ...(prev['Trainee Management'] || [])],
    }))

    // Save to PostgreSQL workspace_records
    void workspaceApi
      .save('institute', 'Trainee Management', {
        id: newRow.id,
        data: newRow,
        status: newRow.status,
      })
      .catch(() => {})

    // 2. Save to shared registered trainees so Mobile Scan and Trainer Dashboard see it
    const registered: RegisteredTrainee = {
      id,
      name: newTraineeName.trim(),
      email: finalEmail,
      phone: newTraineePhone.trim(),
      batch: newTraineeBatch,
      programme: newTraineeProgramme,
      generatedPassword: password,
      district: newTraineeDistrict,
      status: newTraineeStatus,
      createdAt: new Date().toISOString().slice(0, 10),
    }
    saveRegisteredTrainee(registered)

    setAddTraineeModal(false)
    setCredentialSlip({
      id,
      name: newTraineeName.trim(),
      email: finalEmail,
      phone: newTraineePhone.trim(),
      password,
      batch: newTraineeBatch,
      programme: newTraineeProgramme,
      status: newTraineeStatus,
    })
    notify(`Trainee ${newTraineeName.trim()} added! ID: ${id}, Password generated.`)
  }

  const copyCredentials = () => {
    if (!credentialSlip) return
    const text = `NCCP Portal Trainee Credentials:
Trainee ID: ${credentialSlip.id}
Full Name: ${credentialSlip.name}
Login Email: ${credentialSlip.email}
Temporary Password: ${credentialSlip.password}
Programme: ${credentialSlip.programme} (${credentialSlip.batch})
Portal URL: ${window.location.origin}`
    navigator.clipboard.writeText(text)
    setCopiedCreds(true)
    setTimeout(() => setCopiedCreds(false), 2000)
    notify('Credentials copied to clipboard!')
  }

  const printCredentialSlip = () => {
    if (!credentialSlip) return
    const w = window.open('', '_blank', 'width=750,height=600')
    if (!w) {
      notify('Allow popups to print credential slip')
      return
    }
    w.document.write(`<!DOCTYPE html>
<html>
<head>
  <title>NCCP Trainee Admission & Credential Slip - ${credentialSlip.id}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 30px; color: #1e293b; background: #fff; }
    .slip { border: 2px solid #065f46; border-radius: 12px; padding: 25px; max-width: 650px; margin: 0 auto; }
    .head { border-bottom: 2px solid #065f46; padding-bottom: 12px; margin-bottom: 18px; }
    .kicker { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #047857; font-weight: bold; }
    h1 { margin: 4px 0; font-size: 20px; color: #064e3b; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 15px; }
    .item { background: #f8fafc; padding: 10px 14px; border-radius: 8px; border: 1px solid #e2e8f0; }
    .label { font-size: 11px; color: #64748b; display: block; margin-bottom: 2px; }
    .val { font-size: 14px; font-weight: bold; color: #0f172a; }
    .cred { background: #ecfdf5; border: 1px solid #a7f3d0; padding: 15px; border-radius: 8px; margin-top: 18px; }
    .foot { margin-top: 25px; font-size: 11px; color: #64748b; text-align: center; border-top: 1px solid #e2e8f0; padding-top: 12px; }
  </style>
</head>
<body>
  <div class="slip">
    <div class="head">
      <span class="kicker">Government of India · Ministry of Cooperation</span>
      <h1>National Cooperative Capacity Building Platform (NCCP)</h1>
      <small>${institutionName} — Trainee Admission &amp; Portal Access Slip</small>
    </div>
    <div class="grid">
      <div class="item"><span class="label">Trainee Full Name</span><span class="val">${credentialSlip.name}</span></div>
      <div class="item"><span class="label">Trainee System ID</span><span class="val" style="color:#047857; font-family:monospace;">${credentialSlip.id}</span></div>
      <div class="item"><span class="label">Programme</span><span class="val">${credentialSlip.programme}</span></div>
      <div class="item"><span class="label">Enrolled Batch</span><span class="val">${credentialSlip.batch}</span></div>
    </div>
    <div class="cred">
      <h3 style="margin:0 0 10px 0; color:#065f46; font-size:14px;">Portal Login Credentials</h3>
      <p style="margin:4px 0; font-size:13px;"><strong>Login Email:</strong> <span style="font-family:monospace;">${credentialSlip.email}</span></p>
      <p style="margin:4px 0; font-size:13px;"><strong>Temporary Password:</strong> <span style="font-family:monospace; font-weight:bold; color:#065f46;">${credentialSlip.password}</span></p>
      <small style="color:#047857; display:block; margin-top:6px;">Please log in to the NCCP portal at ${window.location.origin} and change your password upon first sign-in.</small>
    </div>
    <div class="foot">
      <p>Authorized Admission Record · Issued by ${adminName} on ${new Date().toLocaleDateString('en-IN', { dateStyle: 'full' })}</p>
      <p>Sahakar Se Samriddhi · Strengthening India's Cooperative Ecosystem</p>
    </div>
  </div>
</body>
</html>`)
    w.document.close()
    w.focus()
    setTimeout(() => w.print(), 500)
  }

  // PostgreSQL workspace_records synchronization
  useEffect(() => {
    let mounted = true
    async function initDb() {
      try {
        const raw = localStorage.getItem(storageKey)
        if (raw) {
          const saved = JSON.parse(raw)
          if (saved?.institutionName) { setInstitutionName(saved.institutionName); setSettings(s => ({ ...s, name: saved.institutionName })) }
          if (saved?.adminName) { setAdminName(saved.adminName); setSettings(s => ({ ...s, admin: saved.adminName })) }
        }
        const res = await workspaceApi.list<Row>('institute')
        if (mounted && res?.data && res.data.length > 0) {
          const grouped: Data = seed()
          for (const item of res.data) {
            if (!grouped[item.module]) grouped[item.module] = []
            const exists = grouped[item.module].some(r => r.id === item.data.id)
            if (!exists) {
              grouped[item.module].push(item.data as Row)
            } else {
              grouped[item.module] = grouped[item.module].map(r => r.id === item.data.id ? (item.data as Row) : r)
            }
          }
          setData(grouped)
        } else if (mounted) {
          const seedItems = Object.entries(seed()).flatMap(([mod, rows]) =>
            rows.map(row => ({
              id: `institute-${mod}-${row.id}`,
              module: mod,
              data: row as unknown as Record<string, unknown>,
              status: row.status,
            }))
          )
          void workspaceApi.batchSync('institute', seedItems).catch(() => {})
        }
      } catch (err) {
        console.warn('[InstituteDashboard] Offline fallback used', err)
      } finally {
        if (mounted) setReady(true)
      }
    }
    initDb()
    return () => { mounted = false }
  }, [])

  useEffect(() => { if (!ready) return; try { localStorage.setItem(storageKey, JSON.stringify({ data, institutionName, adminName })) } catch { /* Dashboard remains usable without browser storage. */ } }, [data, institutionName, adminName, ready])
  const notify = (text: string) => { setToast(text); setActivity(prev => [text, ...prev].slice(0, 8)); window.setTimeout(() => setToast(''), 3200) }
  const go = (next: string) => { setSection(next); setQuery(''); setFilter('All'); setMobile(false); setModal(null); setProfile(false) }
  const def = modules[section]
  const rows = data[section] || []
  const filtered = rows.filter(r => (filter === 'All' || r.status === filter) && `${r.values.join(' ')} ${r.status}`.toLowerCase().includes(query.toLowerCase()))
  const pending = (data['Trainee Management'] || []).filter(r => r.status === 'Nominated')
  const upcoming = (data['Timetable'] || []).filter(r => r.status === 'Scheduled' || r.status === 'Live')
  const metrics = useMemo(() => {
    const trainees = data['Trainee Management'] || [], batches = data['Batch Management'] || [], programmes = data['Courses & Programmes'] || [], attendance = data['Attendance'] || [], hostel = data['Hostel'] || []
    const present = attendance.filter(r => ['Present','Late'].includes(r.status)).length
    const attendanceTotal = attendance.filter(r => ['Present','Late','Absent'].includes(r.status)).length
    const approved = trainees.filter(r => !['Nominated','Rejected'].includes(r.status))
    return [
      [formatNumber(trainees.length), 'Total Trainees', UsersRound, 'mint'],
      [String(batches.filter(r => r.status === 'Active').length), 'Active Batches', ClipboardCheck, 'gold'],
      [String(programmes.filter(r => r.status === 'Active').length), 'Active Programmes', BookOpen, 'blue'],
      [String((data['Trainer Management'] || []).filter(r => r.status !== 'Inactive').length), 'Trainers', GraduationCap, 'mint'],
      [`${attendanceTotal ? Math.round(present / attendanceTotal * 100) : 0}%`, 'Attendance %', CheckCircle2, 'blue'],
      [`${approved.length ? Math.round(trainees.filter(r => r.status === 'Completed').length / approved.length * 100) : 0}%`, 'Completion Rate', BarChart3, 'gold'],
      [String((data['Certificates'] || []).filter(r => r.status === 'Issued').length), 'Certificates Issued', Award, 'mint'],
      [`${hostel.length ? Math.round(hostel.filter(r => r.status === 'Occupied').length / hostel.length * 100) : 0}%`, 'Hostel Occupancy', BedDouble, 'blue'],
      [String(pending.length), 'Pending Nominations', Clock3, 'gold'],
      [String((data['Timetable'] || []).filter(r => r.status === 'Scheduled').length), 'Upcoming Sessions', CalendarDays, 'mint'],
      [String((data['Logistics'] || []).filter(r => r.status === 'Requested').length), 'Logistics Requests', Package, 'gold'],
    ] as const
  }, [data, pending.length])
  const open = (kind: 'create'|'edit'|'view', row?: Row, target?: string) => { if (target && target !== section) setSection(target); const config = modules[target || section]; if (!config) return; setSelected(row || null); setValues(row ? [...row.values] : config.fields.map(() => '')); setStatus(row?.status || config.statuses[0] || ''); setModal(kind) }
  const save = () => {
    if (!def || !values[0]?.trim()) { notify(`Enter ${def?.fields[0]?.toLowerCase() || 'a name'}`); return }
    const cleaned = values.map(v => v.trim())
    if (section === 'Batch Management' && cleaned[4] && (!Number.isInteger(Number(cleaned[4])) || Number(cleaned[4]) < 1)) { notify('Capacity must be a positive whole number'); return }
    if (section === 'Timetable' && status !== 'Cancelled') {
      const conflict = rows.find(r => r.id !== selected?.id && r.status !== 'Cancelled' && r.values[2] === cleaned[2] && r.values[3] === cleaned[3] && ((cleaned[4] && r.values[4] === cleaned[4]) || (cleaned[5] && r.values[5] === cleaned[5])))
      if (conflict) { notify(`Schedule conflict with ${conflict.values[0]}`); return }
    }
    if (section === 'Hostel' && ['Occupied','Reserved'].includes(status)) {
      const taken = rows.find(r => r.id !== selected?.id && ['Occupied','Reserved'].includes(r.status) && r.values[2] === cleaned[2] && r.values[3] === cleaned[3] && cleaned[2] && cleaned[3])
      if (taken) { notify('That bed is already allocated'); return }
    }
    const item: Row = { id: selected?.id || crypto.randomUUID(), values: cleaned, status, updated: now() }
    setData(prev => ({ ...prev, [section]: modal === 'edit' ? (prev[section] || []).map(r => r.id === item.id ? item : r) : [item, ...(prev[section] || [])] }))
    void workspaceApi.save('institute', section, { id: item.id, data: item, status: item.status }).catch(() => {})
    setModal(null); notify(`${def.fields[0]} ${modal === 'edit' ? 'updated' : 'created'}: ${cleaned[0]} (saved to PostgreSQL)`)
  }
  const updateStatus = (target: string, row: Row, next: string) => {
    const updated = { ...row, status: next, updated: now() }
    setData(prev => ({ ...prev, [target]: (prev[target] || []).map(r => r.id === row.id ? updated : r) }))
    void workspaceApi.save('institute', target, { id: row.id, data: updated, status: next }).catch(() => {})
    notify(`${row.values[0]} · ${next} (updated in PostgreSQL)`)
  }
  const remove = (row: Row) => {
    if (!def || !window.confirm(`Delete ${row.values[0]}? This cannot be undone.`)) return
    setData(prev => ({ ...prev, [section]: (prev[section] || []).filter(r => r.id !== row.id) }))
    void workspaceApi.delete('institute', row.id, section).catch(() => {})
    setModal(null); notify(`${def.fields[0]} deleted (removed from PostgreSQL)`)
  }
  const exportRows = (target: string) => { const config = modules[target]; const csvRows = config ? [config.fields.concat(['Status','Updated']), ...(data[target] || []).map(r => [...r.values,r.status,r.updated])] : [['Module','Name','Status','Updated'], ...names.flatMap(name => (data[name] || []).map(r => [name,r.values[0],r.status,r.updated]))]; const csv = '\uFEFF' + csvRows.map(r => r.map(cell => `"${String(cell || '').replaceAll('"','""')}"`).join(',')).join('\r\n'); const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = `nccp-${target.toLowerCase().replaceAll(' ','-')}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); notify('CSV downloaded') }
  const summary = (label: string) => metrics.find(m => m[1] === label)?.[0] || '0'
  return <div className="institute-shell">
    {mobile && <Button className="institute-scrim" aria-label="Close navigation" onClick={() => setMobile(false)} />}
    <aside className={`institute-sidebar ${mobile ? 'open' : ''}`}>
      <div className="institute-brand"><img src={brand} alt="NCCP institutional brand" /><span>{t('INSTITUTION WORKSPACE')}</span></div>
      <div className="institute-identity"><Landmark size={25}/><div><b>{institutionName}</b><small>{t('Institution account')}</small></div></div>
      <nav aria-label="Institute navigation">{nav.map(label => { const Icon = modules[label]?.icon || extraIcons[label] || Landmark; return <Button variant="ghost" key={label} className={section === label ? 'active' : ''} onClick={() => go(label)}><Icon size={18}/><span>{t(label)}</span></Button> })}</nav>
      <div className="institute-sidebar-foot"><span>{t('Sahakar Se Samriddhi')}</span><small>{t('Cooperation for a Prosperous Bharat')}</small></div>
    </aside>
    <div className="institute-main">
      <header className="institute-top">
        <Button variant="ghost" size="icon" className="institute-menu" aria-label="Open navigation" onClick={() => setMobile(true)}><Menu/></Button>
        <div className="institute-top-search"><Search size={18}/><input aria-label="Search current section" value={query} onChange={e => setQuery(e.target.value)} placeholder={`${t('Search')} ${section === 'Dashboard' ? t('institution records') : t(section).toLowerCase()}...`} onKeyDown={e => { if (e.key === 'Enter' && section === 'Dashboard' && query) { const match = names.find(name => (data[name] || []).some(row => `${row.values.join(' ')} ${row.status}`.toLowerCase().includes(query.toLowerCase()))); if (match) { setSection(match); setFilter('All'); setMobile(false) } else notify('No matching records found') } }} /></div>
        <div className="institute-top-right">
          <Button variant="ghost" size="sm" onClick={() => setLanguage(language === 'en' ? 'hi' : 'en')} className="gap-1.5 text-xs text-slate-700 hover:text-black">
            <Languages size={15}/> {language === 'en' ? 'English' : 'हिंदी'}
          </Button>
          <div className="institute-pop-wrap"><Button variant="ghost" size="icon" aria-label="Notifications" onClick={() => { setNotifications(!notifications); setProfile(false) }}><Bell size={19}/>{!read && pending.length > 0 && <i className="institute-dot" />}</Button>{notifications && <div className="institute-pop"><strong>{t('Notifications')}</strong>{pending.length ? pending.slice(0,4).map(r => <Button variant="ghost" key={r.id} onClick={() => { go('Trainee Management'); open('view',r,'Trainee Management'); setNotifications(false) }}>{r.values[0]} · Nomination pending</Button>) : <p>No pending nominations</p>}<Button variant="ghost" onClick={() => { setRead(true); setNotifications(false) }}>{t('Mark as read')}</Button></div>}</div>
          <div className="institute-pop-wrap"><Button variant="ghost" className="institute-user" aria-label="Open profile" onClick={() => { setProfile(!profile); setNotifications(false) }}><span className="institute-avatar"><Landmark size={18}/></span><span><b>{adminName}</b><small>{t('Institution Administrator')}</small></span><ChevronDown size={15}/></Button>{profile && <div className="institute-pop"><strong>{adminName}</strong><p>{institutionName}</p><Button variant="ghost" onClick={() => go('Institution Settings')}><Settings size={15}/> {t('Profile settings')}</Button><Button variant="ghost" onClick={onLogout}><LogOut size={15}/> {t('Logout')}</Button></div>}</div>
        </div>
      </header>
      <main className="institute-content">
        {section === 'Dashboard' && <>
          <section className="institute-hero"><img src={banner} alt="Cooperative training institution"/><div className="institute-hero-copy"><p>{t('INSTITUTION WORKSPACE')}</p><h1>{institutionName}</h1><span>{t('One place for your people, programmes and training operations.')}</span><div className="institute-hero-actions"><Button onClick={() => go('Batch Management')}><Plus size={16}/> {t('Manage batches')}</Button><Button className="bg-emerald-800 hover:bg-emerald-900 text-white font-semibold gap-1.5" onClick={openAddTraineeModal}><UserPlus size={16}/> Add Trainee &amp; Credentials</Button><Button variant="outline" onClick={() => exportRows('Dashboard')}><ArrowDownToLine size={16}/> {t('Export data')}</Button></div></div></section>
          <div className="institute-section-heading"><div><span>OVERVIEW</span><h2>At a glance</h2></div><small>Updates reflect your latest changes</small></div>
          <section className="institute-metrics">{metrics.map(([value,label,Icon,tone]) => <Button variant="outline" className={`institute-metric ${tone}`} key={label} onClick={() => go(metricDestination[label] ?? 'Dashboard')}><span className="institute-metric-icon"><Icon size={22}/></span><span className="institute-metric-text"><strong>{value}</strong><small>{label}</small></span><ArrowRight size={15} className="institute-metric-arrow"/></Button>)}</section>
          <div className="institute-overview-grid"><section className="institute-panel"><div className="institute-panel-head"><div><span>ACTION REQUIRED</span><h2>Pending nominations</h2></div><Button variant="ghost" onClick={() => go('Trainee Management')}>View all <ArrowRight size={15}/></Button></div><div className="institute-list">{pending.length ? pending.slice(0,4).map(r => <div className="institute-list-row" key={r.id}><span className="institute-initial">{(r.values[0] ?? '').split(' ').map(x => x[0]).slice(0,2).join('')}</span><span className="institute-list-copy"><b>{r.values[0]}</b><small>{r.values[1]}</small></span><Button variant="outline" onClick={() => updateStatus('Trainee Management',r,'Approved')} title="Approve nomination"><Check size={16}/></Button><Button variant="outline" onClick={() => updateStatus('Trainee Management',r,'Rejected')} title="Reject nomination"><X size={16}/></Button></div>) : <p className="institute-empty">All nominations reviewed.</p>}</div></section><section className="institute-panel"><div className="institute-panel-head"><div><span>COMING UP</span><h2>Training sessions</h2></div><Button variant="ghost" onClick={() => go('Timetable')}>Timetable <ArrowRight size={15}/></Button></div><div className="institute-list">{upcoming.length ? upcoming.slice(0,4).map(r => <Button variant="ghost" className="institute-session" key={r.id} onClick={() => { go('Timetable'); open('view',r,'Timetable') }}><span className="institute-session-icon"><CalendarDays size={19}/></span><span><b>{r.values[0]}</b><small>{r.values[2]} · {r.values[3]} · {r.values[5]}</small></span><ArrowRight size={15}/></Button>) : <p className="institute-empty">No upcoming sessions.</p>}</div></section></div>
          <div className="institute-overview-grid"><section className="institute-panel"><div className="institute-panel-head"><div><span>DELIVERY</span><h2>Programme progress</h2></div><Button variant="ghost" onClick={() => go('Courses & Programmes')}>Programmes <ArrowRight size={15}/></Button></div><div className="institute-progress-list">{(data['Courses & Programmes'] || []).slice(0,4).map((r,i) => { const matching = (data['Trainee Management'] || []).filter(t => t.values[1] === r.values[0]); const done = matching.filter(t => t.status === 'Completed').length; const percent = matching.length ? Math.round(done / matching.length * 100) : 0; return <div key={r.id}><span><b>{r.values[0]}</b><small>{matching.length} trainees · {r.status}</small></span><strong>{percent}%</strong><div className="institute-track"><i className={i % 2 ? 'gold' : ''} style={{ width: `${percent}%` }}/></div></div> })}</div></section><section className="institute-panel"><div className="institute-panel-head"><div><span>LIVE ACTIVITY</span><h2>Recent changes</h2></div><Activity size={19}/></div><div className="institute-activity">{activity.length ? activity.map((item,i) => <p key={`${i}-${item}`}><CheckCircle2 size={16}/><span>{item}</span><small>{i === 0 ? 'Just now' : 'Earlier'}</small></p>) : <p><ShieldCheck size={16}/><span>Institution workspace ready</span><small>Today</small></p>}</div></section></div>
        </>}
        {def && <><div className="institute-module-heading"><div><span>INSTITUTION / {section.toUpperCase()}</span><h1>{section}</h1><p>{def.description}</p></div><div className="flex flex-wrap items-center gap-2"><Button variant="outline" onClick={() => exportRows(section)}><ArrowDownToLine size={16}/> Export CSV</Button>{section === 'Trainee Management' && (<Button className="bg-emerald-800 hover:bg-emerald-900 text-white font-semibold gap-1.5 shadow-sm" onClick={openAddTraineeModal}><UserPlus size={16}/> Add Trainee &amp; Generate ID/Password</Button>)}<Button onClick={() => open('create')}><Plus size={17}/> Add {def.fields[0]}</Button></div></div><div className="institute-module-stats"><div><span>Total records</span><b>{rows.length}</b></div><div><span>Active / confirmed</span><b>{rows.filter(r => ['Active','Present','Approved','Assigned','Published','Issued','Completed','Occupied','Allocated','Scheduled'].includes(r.status)).length}</b></div><div><span>Needs attention</span><b>{rows.filter(r => ['Nominated','Requested','Correction requested','Draft','Planning','Eligible'].includes(r.status)).length}</b></div></div><section className="institute-panel institute-table-panel"><div className="institute-table-tools"><div><span>RECORDS</span><h2>{section}</h2></div><select aria-label="Filter by status" value={filter} onChange={e => setFilter(e.target.value)}><option>All</option>{def.statuses.map(s => <option key={s}>{s}</option>)}</select><small>{filtered.length} of {rows.length}</small></div><div className="institute-table-scroll"><table><thead><tr>{def.fields.map(field => <th key={field}>{field}</th>)}<th>Status</th><th>Updated</th><th>Actions</th></tr></thead><tbody>{filtered.map(r => <tr key={r.id}>{def.fields.map((f,i) => <td key={f}>{r.values[i] || '—'}</td>)}<td><select className="institute-status-select" aria-label={`Status for ${r.values[0]}`} value={r.status} onChange={e => updateStatus(section,r,e.target.value)}>{def.statuses.map(s => <option key={s}>{s}</option>)}</select></td><td>{r.updated}</td><td><div className="institute-row-actions"><Button variant="ghost" size="icon" title="View details" aria-label={`View ${r.values[0]}`} onClick={() => open('view',r)}><Search size={16}/></Button><Button variant="ghost" size="icon" title="Edit" aria-label={`Edit ${r.values[0]}`} onClick={() => open('edit',r)}><Pencil size={16}/></Button><Button variant="ghost" size="icon" title="Delete" aria-label={`Delete ${r.values[0]}`} onClick={() => remove(r)}><Trash2 size={16}/></Button></div></td></tr>)}</tbody></table>{!filtered.length && <p className="institute-empty">No matching records. Try a different search or filter.</p>}</div></section></>}
        {section === 'Analytics' && <><div className="institute-module-heading"><div><span>INSTITUTION / ANALYTICS</span><h1>Performance analytics</h1><p>Current indicators based on institution records.</p></div><Button variant="outline" onClick={() => exportRows('Dashboard')}><ArrowDownToLine size={16}/> Export data</Button></div><div className="institute-analytics-grid">{['Attendance %','Completion Rate','Hostel Occupancy','Certificates Issued','Active Batches','Pending Nominations'].map((label,i) => <Button variant="outline" className="institute-analysis" key={label} onClick={() => go(metricDestination[label] ?? 'Dashboard')}><span>{label}</span><strong>{summary(label)}</strong><div className="institute-track"><i className={i % 2 ? 'gold' : ''} style={{width: `${Math.min(100, Number.parseInt(summary(label)) || 0)}%`}}/></div><small>View records <ArrowRight size={13}/></small></Button>)}</div></>}
        {section === 'Reports' && <><div className="institute-module-heading"><div><span>INSTITUTION / REPORTS</span><h1>Reports & exports</h1><p>Download current records for your institution.</p></div></div><div className="institute-report-grid">{['Dashboard','Trainee Management','Attendance','Courses & Programmes','Batch Management','Certificates','Assessments','Hostel'].map(label => <div className="institute-report" key={label}><FileBarChart2 size={25}/><div><b>{label === 'Dashboard' ? 'Complete institution export' : `${label} report`}</b><small>{label === 'Dashboard' ? 'All institution records' : `${(data[label] || []).length} records · CSV`}</small></div><Button variant="outline" onClick={() => exportRows(label)}><ArrowDownToLine size={16}/> Download</Button></div>)}</div></>}
        {section === 'Institution Settings' && <><div className="institute-module-heading"><div><span>INSTITUTION / SETTINGS</span><h1>Institution settings</h1><p>Update the name shown throughout this dashboard.</p></div></div><form className="institute-settings" onSubmit={e => { e.preventDefault(); if (!settings.name.trim() || !settings.admin.trim()) { notify('Complete both fields'); return } setInstitutionName(settings.name.trim()); setAdminName(settings.admin.trim()); notify('Institution settings saved') }}><h2>Profile information</h2><label>Institution name<input required value={settings.name} onChange={e => setSettings({...settings,name:e.target.value})}/></label><label>Administrator name<input required value={settings.admin} onChange={e => setSettings({...settings,admin:e.target.value})}/></label><Button type="submit">Save changes</Button></form></>}
      </main>
    </div>
    {modal && def && <div className="institute-modal-backdrop" onMouseDown={() => setModal(null)}><section className="institute-modal" role="dialog" aria-modal="true" aria-label={`${modal} ${def.fields[0]}`} onMouseDown={e => e.stopPropagation()}><header><div><span>{section.toUpperCase()}</span><h2>{modal === 'create' ? `Add ${def.fields[0]}` : modal === 'edit' ? `Edit ${def.fields[0]}` : 'Record details'}</h2></div><Button variant="ghost" size="icon" aria-label="Close dialog" onClick={() => setModal(null)}><X size={19}/></Button></header>{modal === 'view' && selected ? <><div className="institute-detail-grid">{def.fields.map((field,i) => <div key={field}><small>{field}</small><b>{selected.values[i] || '—'}</b></div>)}<div><small>Status</small><b>{selected.status}</b></div><div><small>Last updated</small><b>{selected.updated}</b></div></div><footer><Button variant="outline" onClick={() => setModal(null)}>Close</Button><Button onClick={() => open('edit',selected)}>Edit record</Button></footer></> : <form onSubmit={e => { e.preventDefault(); save() }}><div className="institute-form-grid">{def.fields.map((field,i) => <label key={field}>{field}{i === 0 && <span> *</span>}<input autoFocus={i === 0} required={i === 0} type={field.toLowerCase().includes('date') || field === 'Check-in' || field === 'Check-out' ? 'date' : field === 'Email' ? 'email' : ['Capacity','Quantity','Attendance %','Score %','Rating %','Workload hours','Max marks','Average score %'].includes(field) ? 'number' : 'text'} min={field === 'Capacity' ? 1 : undefined} max={field.includes('%') ? 100 : undefined} value={values[i] || ''} onChange={e => setValues(prev => prev.map((v,index) => index === i ? e.target.value : v))} placeholder={field}/></label>)}<label>Status<select value={status} onChange={e => setStatus(e.target.value)}>{def.statuses.map(s => <option key={s}>{s}</option>)}</select></label></div><footer><Button variant="outline" type="button" onClick={() => setModal(null)}>Cancel</Button><Button type="submit"><Check size={16}/> Save record</Button></footer></form>}</section></div>}

    {/* Add Trainee & Generate ID/Password Modal */}
    {addTraineeModal && (
      <div className="institute-modal-backdrop" onMouseDown={() => setAddTraineeModal(false)}>
        <section
          className="institute-modal max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden border border-emerald-900/15"
          role="dialog"
          aria-modal="true"
          aria-label="Add Trainee & Generate ID and Password"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <header className="bg-emerald-900 text-white p-5 flex items-center justify-between">
            <div>
              <span className="text-amber-300 text-xs tracking-wider font-semibold uppercase block">
                Institution Workspace · Admission &amp; Enrolment
              </span>
              <h2 className="text-lg font-bold text-white mt-0.5">Add Trainee &amp; Generate ID/Password</h2>
            </div>
            <Button variant="ghost" size="icon" className="text-white hover:bg-emerald-800" onClick={() => setAddTraineeModal(false)}>
              <X size={19} />
            </Button>
          </header>

          <form onSubmit={handleCreateTrainee} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Trainee Full Name <span className="text-rose-500">*</span>
                </label>
                <input
                  required
                  autoFocus
                  type="text"
                  value={newTraineeName}
                  onChange={(e) => {
                    setNewTraineeName(e.target.value)
                    if (!newTraineeEmail && e.target.value) {
                      setNewTraineeEmail(e.target.value.toLowerCase().trim().replace(/\s+/g, '.') + '@nccp.in')
                    }
                  }}
                  placeholder="e.g. Suresh Patel"
                  className="w-full text-xs p-2.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-700 font-medium"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Login Email</label>
                  <input
                    type="email"
                    value={newTraineeEmail}
                    onChange={(e) => setNewTraineeEmail(e.target.value)}
                    placeholder="suresh.patel@nccp.in"
                    className="w-full text-xs p-2.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-700"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Phone Number</label>
                  <input
                    type="tel"
                    value={newTraineePhone}
                    onChange={(e) => setNewTraineePhone(e.target.value)}
                    placeholder="+91 98765 43210"
                    className="w-full text-xs p-2.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-700"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Programme</label>
                  <select
                    value={newTraineeProgramme}
                    onChange={(e) => setNewTraineeProgramme(e.target.value)}
                    className="w-full text-xs p-2.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-700 bg-white"
                  >
                    <option value="Dairy Cooperative Management">Dairy Cooperative Management</option>
                    <option value="Digital Skills for Cooperatives">Digital Skills for Cooperatives</option>
                    <option value="Cooperative Finance">Cooperative Finance</option>
                    <option value="Agri Value Chain Development">Agri Value Chain Development</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Enrolled Batch</label>
                  <select
                    value={newTraineeBatch}
                    onChange={(e) => setNewTraineeBatch(e.target.value)}
                    className="w-full text-xs p-2.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-700 bg-white"
                  >
                    <option value="DCM-2026-04">DCM-2026-04</option>
                    <option value="DSC-2026-08">DSC-2026-08</option>
                    <option value="CFA-2026-06">CFA-2026-06</option>
                    <option value="AVC-2026-02">AVC-2026-02</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">District / State</label>
                  <input
                    type="text"
                    value={newTraineeDistrict}
                    onChange={(e) => setNewTraineeDistrict(e.target.value)}
                    placeholder="Pune, Maharashtra"
                    className="w-full text-xs p-2.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-700"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Status</label>
                  <select
                    value={newTraineeStatus}
                    onChange={(e) => setNewTraineeStatus(e.target.value)}
                    className="w-full text-xs p-2.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-700 bg-white"
                  >
                    <option value="Active">Active</option>
                    <option value="Approved">Approved</option>
                    <option value="Nominated">Nominated</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Auto-Generated Credentials Card */}
            <div className="bg-gradient-to-br from-emerald-50 to-teal-50 border-2 border-emerald-300 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-900 flex items-center gap-1.5">
                  <KeyRound size={15} className="text-emerald-700" />
                  Generated Portal Credentials
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-emerald-800 hover:bg-emerald-100 gap-1"
                  onClick={regenerateCredentials}
                >
                  <RefreshCw size={12} /> Regenerate
                </Button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div className="bg-white p-2.5 rounded-lg border border-emerald-200">
                  <span className="text-[10px] text-slate-500 font-semibold uppercase block">System Trainee ID</span>
                  <strong className="text-sm font-mono text-emerald-950 tracking-wider">{generatedId}</strong>
                </div>

                <div className="bg-white p-2.5 rounded-lg border border-emerald-200">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-slate-500 font-semibold uppercase block">Temporary Password</span>
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="text-slate-400 hover:text-slate-700"
                    >
                      {showPassword ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                  </div>
                  <strong className="text-sm font-mono text-emerald-950 tracking-wider">
                    {showPassword ? generatedPassword : '••••••••••••'}
                  </strong>
                </div>
              </div>

              <p className="text-[11px] text-emerald-800/90 leading-tight">
                These credentials allow the trainee to sign into NCCP platform, access courses, and put attendance for live sessions.
              </p>
            </div>

            <footer className="flex justify-end gap-2 pt-2 border-t border-slate-200">
              <Button variant="outline" type="button" onClick={() => setAddTraineeModal(false)}>
                Cancel
              </Button>
              <Button type="submit" className="bg-emerald-800 hover:bg-emerald-900 text-white font-bold gap-1.5">
                <Check size={16} /> Create Trainee &amp; Issue Credentials
              </Button>
            </footer>
          </form>
        </section>
      </div>
    )}

    {/* Credential Slip Modal */}
    {credentialSlip && (
      <div className="institute-modal-backdrop" onMouseDown={() => setCredentialSlip(null)}>
        <section
          className="institute-modal max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden border border-emerald-900/15"
          role="dialog"
          aria-modal="true"
          aria-label="Trainee Credentials Issued"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <header className="bg-emerald-900 text-white p-5 flex items-center justify-between">
            <div>
              <span className="text-amber-300 text-xs tracking-wider font-semibold uppercase block">
                NCCP · Official Admission Credential Slip
              </span>
              <h2 className="text-lg font-bold text-white mt-0.5">Trainee Registered Successfully!</h2>
            </div>
            <Button variant="ghost" size="icon" className="text-white hover:bg-emerald-800" onClick={() => setCredentialSlip(null)}>
              <X size={19} />
            </Button>
          </header>

          <div className="p-6 space-y-4">
            <div className="bg-emerald-50 rounded-2xl p-4 border border-emerald-200 space-y-2.5 text-xs">
              <div className="flex justify-between items-center pb-2 border-b border-emerald-200/60">
                <span className="text-slate-500 font-medium">Trainee Name:</span>
                <strong className="text-sm font-bold text-emerald-950">{credentialSlip.name}</strong>
              </div>
              <div className="flex justify-between items-center pb-2 border-b border-emerald-200/60">
                <span className="text-slate-500 font-medium">Trainee System ID:</span>
                <span className="font-mono font-bold text-emerald-900 bg-white px-2 py-0.5 rounded border border-emerald-300">
                  {credentialSlip.id}
                </span>
              </div>
              <div className="flex justify-between items-center pb-2 border-b border-emerald-200/60">
                <span className="text-slate-500 font-medium">Login Email:</span>
                <span className="font-mono text-slate-800 font-semibold">{credentialSlip.email}</span>
              </div>
              <div className="flex justify-between items-center pb-2 border-b border-emerald-200/60">
                <span className="text-slate-500 font-medium">Temporary Password:</span>
                <span className="font-mono font-bold text-emerald-900 bg-white px-2 py-0.5 rounded border border-emerald-300">
                  {credentialSlip.password}
                </span>
              </div>
              <div className="flex justify-between items-center pb-2 border-b border-emerald-200/60">
                <span className="text-slate-500 font-medium">Programme:</span>
                <span className="text-slate-800 font-medium">{credentialSlip.programme}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500 font-medium">Enrolled Batch:</span>
                <span className="font-mono text-slate-800 font-bold">{credentialSlip.batch}</span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-2">
              <Button
                className="flex-1 bg-emerald-800 hover:bg-emerald-900 text-white font-semibold gap-1.5"
                onClick={copyCredentials}
              >
                {copiedCreds ? <Check size={15} /> : <Copy size={15} />}
                {copiedCreds ? 'Credentials Copied!' : 'Copy Credentials'}
              </Button>

              <Button variant="outline" className="gap-1.5 border-slate-300" onClick={printCredentialSlip}>
                <Printer size={15} /> Print Slip
              </Button>

              <Button variant="outline" onClick={() => setCredentialSlip(null)}>
                Done
              </Button>
            </div>
          </div>
        </section>
      </div>
    )}
    {toast && <div className="institute-toast" role="status"><CheckCircle2 size={17}/>{toast}</div>}
  </div>
}
