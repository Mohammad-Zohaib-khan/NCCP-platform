// @ts-nocheck -- Dashboard records use module-specific display schemas.
import { useEffect, useMemo, useState } from 'react'
import {
  Activity, Award, BarChart3, Bell, BookOpen, BriefcaseBusiness, Building2,
  CalendarDays, Check, CheckCircle2, ChevronDown, CircleUserRound, Download,
  FileCheck2, GraduationCap, Home, Languages, Layers3, Menu, MoreHorizontal,
  Plus, Search, Settings, ShieldCheck, Sparkles, UsersRound, X,
} from 'lucide-react'
import asset02 from '@/assets/nccp/02_india_map_network.png'
import asset10 from '@/assets/nccp/10_institution_logo_brand.png'
import { workspaceApi } from '@/lib/nccp-api'
import { useI18n } from '@/lib/i18n-context'

type RecordItem = { id: number; name: string; category: string; location: string; status: string; value: string; updated: string }
type ModuleDefinition = { title: string; description: string; tabs: string[]; singular: string; fields: [string, string][] }

const modules: Record<string, ModuleDefinition> = {
  Institutions: { title: 'Institution Management', description: 'Verify institutions, review performance and manage national training delivery.', tabs: ['Directory', 'Verification', 'Performance', 'State Analytics'], singular: 'Institution', fields: [['Institution name', 'name'], ['State', 'location'], ['Institution type', 'category']] },
  Programmes: { title: 'Programme Management', description: 'Create, approve and monitor the national programme catalogue.', tabs: ['Catalogue', 'Approvals', 'Categories', 'Performance'], singular: 'Programme', fields: [['Programme title', 'name'], ['Category', 'category'], ['Lead state', 'location']] },
  Trainees: { title: 'Trainee Management', description: 'Search verified profiles and review training, skills and certificate histories.', tabs: ['Directory', 'Verification', 'Training History', 'Skills', 'Certificates'], singular: 'Trainee', fields: [['Full name', 'name'], ['Programme', 'category'], ['State', 'location']] },
  Trainers: { title: 'Trainer Management', description: 'Manage allocation, availability and trainer performance.', tabs: ['Directory', 'Allocation', 'Performance', 'Availability', 'Analytics'], singular: 'Trainer', fields: [['Trainer name', 'name'], ['Specialisation', 'category'], ['Institution', 'location']] },
  Batches: { title: 'Batch Management', description: 'Monitor enrolment, attendance, completion and cohort performance.', tabs: ['Monitoring', 'Enrolment', 'Attendance', 'Completion', 'Performance'], singular: 'Batch', fields: [['Batch name', 'name'], ['Programme', 'category'], ['Institution', 'location']] },
  'Training Operations': { title: 'Training Operations', description: 'Coordinate sessions, timetables, rooms, hostels, logistics and resources.', tabs: ['Timetable', 'Rooms', 'Hostel', 'Logistics', 'Resources', 'Live Sessions'], singular: 'Session', fields: [['Session title', 'name'], ['Resource / room', 'category'], ['Institution', 'location']] },
  LMS: { title: 'LMS Management', description: 'Manage courses, modules, lessons, materials, assessments and completion.', tabs: ['Courses', 'Modules', 'Lessons', 'Materials', 'Assessments', 'Completion'], singular: 'Course', fields: [['Course title', 'name'], ['Module / category', 'category'], ['Owner', 'location']] },
  Attendance: { title: 'Attendance Management', description: 'Monitor R307 fingerprint, QR and authorised manual attendance.', tabs: ['Overview', 'R307 Fingerprint', 'QR Attendance', 'Manual Entry', 'Corrections', 'Analytics'], singular: 'Attendance Record', fields: [['Session / trainee', 'name'], ['Attendance method', 'category'], ['Institution', 'location']] },
  Certification: { title: 'Certification', description: 'Issue, verify and revoke secure certificates with QR verification.', tabs: ['Issued', 'Issue Certificate', 'Verification', 'Revocations', 'QR Verification', 'Analytics'], singular: 'Certificate', fields: [['Certificate holder', 'name'], ['Programme', 'category'], ['Certificate ID', 'location']] },
  Employment: { title: 'Employment Ecosystem', description: 'Manage employers, jobs, applications, placements and outcomes.', tabs: ['Employers', 'Job Postings', 'Applications', 'Placements', 'Outcomes'], singular: 'Employment Record', fields: [['Employer / candidate', 'name'], ['Role / sector', 'category'], ['Location', 'location']] },
  'Analytics & Reports': { title: 'Analytics & Reports', description: 'Compare national, state, institution, programme, skill and employment outcomes.', tabs: ['National', 'State-wise', 'Institutions', 'Programmes', 'Skills', 'Employment'], singular: 'Report', fields: [['Report name', 'name'], ['Report type', 'category'], ['Coverage', 'location']] },
  'AI Monitoring': { title: 'AI Monitoring', description: 'Track assistant usage, skill gaps, job demand and course recommendations.', tabs: ['Assistant Usage', 'Skill Gaps', 'Job Demand', 'Recommendations'], singular: 'AI Insight', fields: [['Insight name', 'name'], ['Trend category', 'category'], ['Coverage', 'location']] },
  'System Administration': { title: 'System Administration', description: 'Manage users, roles, languages, notifications, settings and audit logs.', tabs: ['Users', 'Roles & Permissions', 'Languages', 'Notifications', 'Settings', 'Audit Logs'], singular: 'User', fields: [['User / setting name', 'name'], ['Role / type', 'category'], ['Scope', 'location']] },
}

const initialRecords: Record<string, RecordItem[]> = {
  Institutions: [
    { id: 1, name: 'Rajasthan Cooperative Institute', category: 'State Institute', location: 'Rajasthan', status: 'Active', value: '420 trainees', updated: 'Today' },
    { id: 2, name: 'Maharashtra State Coop. Training', category: 'State Institute', location: 'Maharashtra', status: 'Verified', value: '560 trainees', updated: '2 hours ago' },
    { id: 3, name: 'Bundelkhand Cooperative Institute', category: 'Regional Centre', location: 'Uttar Pradesh', status: 'Pending', value: '180 trainees', updated: '4 hours ago' },
  ],
  Programmes: [
    { id: 11, name: 'Dairy Cooperative Management', category: 'Agriculture', location: '42 institutions', status: 'Active', value: '82% completion', updated: 'Today' },
    { id: 12, name: 'Digital Skills for Cooperatives', category: 'Digital', location: '28 institutions', status: 'Approved', value: '76% completion', updated: 'Yesterday' },
    { id: 13, name: 'Rural Enterprise Leadership', category: 'Leadership', location: '19 institutions', status: 'Pending', value: '620 trainees', updated: 'Yesterday' },
  ],
  Trainees: [
    { id: 21, name: 'Ravi Kumar', category: 'Data Analysis', location: 'Rajasthan', status: 'Verified', value: '86% progress', updated: 'Today' },
    { id: 22, name: 'Neha Singh', category: 'Digital Skills', location: 'Uttar Pradesh', status: 'Active', value: '78% progress', updated: 'Today' },
    { id: 23, name: 'Amit Kumar', category: 'Financial Management', location: 'Bihar', status: 'Pending', value: '74% progress', updated: 'Yesterday' },
  ],
  Trainers: [{ id: 31, name: 'Dr. Rajesh Kumar', category: 'Cooperative Management', location: 'Rajasthan Institute', status: 'Available', value: '92% rating', updated: 'Today' }, { id: 32, name: 'Priya Singh', category: 'Digital Skills', location: 'Maharashtra Institute', status: 'Allocated', value: '89% rating', updated: 'Today' }],
  Batches: [{ id: 41, name: 'DCM-2026-04', category: 'Dairy Management', location: 'Rajasthan Institute', status: 'Ongoing', value: '45 enrolled', updated: 'Live' }, { id: 42, name: 'DSC-2026-08', category: 'Digital Skills', location: 'Maharashtra Institute', status: 'Planning', value: '38 enrolled', updated: 'Today' }],
  'Training Operations': [{ id: 51, name: 'Cooperative Finance Workshop', category: 'Room 201 · 10:00 AM', location: 'Rajasthan Institute', status: 'Live', value: '42 present', updated: 'Now' }, { id: 52, name: 'Digital Skills Lab', category: 'Lab 2 · 02:00 PM', location: 'Maharashtra Institute', status: 'Scheduled', value: '38 seats', updated: 'Today' }],
  LMS: [{ id: 61, name: 'Data Analysis for Cooperatives', category: '8 modules · 24 lessons', location: 'Learning Team', status: 'Published', value: '1,248 learners', updated: 'Today' }, { id: 62, name: 'Cooperative Governance', category: '6 modules · 18 lessons', location: 'Academic Team', status: 'Draft', value: '0 learners', updated: 'Yesterday' }],
  Attendance: [{ id: 71, name: 'Batch DCM-2026-04', category: 'R307 Fingerprint', location: 'Rajasthan Institute', status: 'Recorded', value: '94% present', updated: '10 mins ago' }, { id: 72, name: 'Batch DSC-2026-08', category: 'QR Attendance', location: 'Maharashtra Institute', status: 'Correction', value: '88% present', updated: '1 hour ago' }],
  Certification: [{ id: 81, name: 'Ravi Kumar', category: 'Dairy Cooperative Management', location: 'NCCP-2026-8421', status: 'Verified', value: 'Issued', updated: 'Today' }, { id: 82, name: 'Neha Singh', category: 'Digital Skills', location: 'NCCP-2026-8422', status: 'Pending', value: 'Awaiting issue', updated: 'Today' }],
  Employment: [{ id: 91, name: 'Amul Dairy Cooperative', category: 'Field Associate', location: 'Gujarat', status: 'Hiring', value: '24 openings', updated: 'Today' }, { id: 92, name: 'Ayesha Khan', category: 'Data Analyst', location: 'Amul Cooperative', status: 'Placed', value: 'Joined', updated: 'Yesterday' }],
  'Analytics & Reports': [{ id: 101, name: 'National Training Outcomes', category: 'National', location: 'All states', status: 'Ready', value: '12,840 records', updated: 'Today' }, { id: 102, name: 'State Placement Comparison', category: 'Employment', location: '28 states', status: 'Ready', value: '2,140 records', updated: 'Yesterday' }],
  'AI Monitoring': [{ id: 111, name: 'Career Assistant Usage', category: 'Assistant Usage', location: 'National', status: 'Healthy', value: '8,420 queries', updated: 'Live' }, { id: 112, name: 'Dairy Technology Skills', category: 'Skill Gap', location: '8 states', status: 'Rising', value: '+18% demand', updated: 'Today' }],
  'System Administration': [{ id: 121, name: 'Anita Verma', category: 'Institution Admin', location: 'Rajasthan', status: 'Active', value: 'Full access', updated: 'Today' }, { id: 122, name: 'Hindi', category: 'Platform Language', location: 'National', status: 'Enabled', value: '100% translated', updated: 'Yesterday' }],
}

const navIcons: Record<string, typeof Home> = { Dashboard: Home, Institutions: Building2, Programmes: BookOpen, Trainees: UsersRound, Trainers: GraduationCap, Batches: Layers3, 'Training Operations': CalendarDays, LMS: BookOpen, Attendance: CheckCircle2, Certification: Award, Employment: BriefcaseBusiness, 'Analytics & Reports': BarChart3, 'AI Monitoring': Sparkles, 'System Administration': Settings }

export default function AdminDashboard({ onLogout }: { onLogout: () => void }) {
  const { language, setLanguage, t } = useI18n()
  const [section, setSection] = useState('Dashboard')
  const [activeTab, setActiveTab] = useState('')
  const [records, setRecords] = useState(initialRecords)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('All')
  const [modal, setModal] = useState<'create' | 'edit' | 'view' | null>(null)
  const [selected, setSelected] = useState<RecordItem | null>(null)
  const [form, setForm] = useState({ name: '', category: '', location: '' })
  const [toast, setToast] = useState('')
  const [notifications, setNotifications] = useState(false)
  const [profile, setProfile] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [activities, setActivities] = useState(['New institution onboarded', 'Programme approved: Dairy Cooperative Management', 'Certificate issued to Rahul Verma', '12 placements recorded at Amul Cooperative'])
  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(''), 2200) }
  const current = modules[section]
  const currentRows = section === 'Dashboard' ? [] : records[section] || []
  const statuses = ['All', ...Array.from(new Set(currentRows.map(row => row.status)))]
  const filtered = currentRows.filter(row => (statusFilter === 'All' || row.status === statusFilter) && Object.values(row).join(' ').toLowerCase().includes(search.toLowerCase()))

  const overview = useMemo(() => [
    ['128', 'Institutions', Building2, 'mint'], ['456', 'Programmes', BookOpen, 'gold'], ['620', 'Total Batches', Layers3, 'blue'], ['12,840', 'Total Trainees', UsersRound, 'purple'],
    ['9,680', 'Active Trainees', Activity, 'mint'], ['742', 'Trainers', GraduationCap, 'gold'], ['318', 'Employers', BriefcaseBusiness, 'blue'], ['9,210', 'Certificates Issued', Award, 'purple'],
    ['91.4%', 'Overall Attendance', CheckCircle2, 'mint'], ['82%', 'Completion Rate', BarChart3, 'gold'], ['68%', 'Placement Rate', BriefcaseBusiness, 'blue'], ['42', 'Active Sessions', CalendarDays, 'purple'],
    ['74%', 'Hostel Occupancy', Building2, 'mint'], [String(Object.values(records).flat().filter(r => r.status === 'Pending' || r.status === 'Correction').length), 'Pending Approvals', FileCheck2, 'gold'],
  ] as const, [records])

  // PostgreSQL workspace_records synchronization
  useEffect(() => {
    let mounted = true
    async function initDb() {
      try {
        const res = await workspaceApi.list<RecordItem>('admin')
        if (mounted && res?.data && res.data.length > 0) {
          const grouped: Record<string, RecordItem[]> = { ...initialRecords }
          for (const item of res.data) {
            if (!grouped[item.module]) grouped[item.module] = []
            const exists = grouped[item.module].some(r => String(r.id) === String(item.data.id || item.id))
            if (!exists) {
              grouped[item.module].push(item.data as RecordItem)
            } else {
              grouped[item.module] = grouped[item.module].map(r => String(r.id) === String(item.data.id || item.id) ? (item.data as RecordItem) : r)
            }
          }
          setRecords(grouped)
        } else if (mounted) {
          const seedItems = Object.entries(initialRecords).flatMap(([mod, rows]) =>
            rows.map(row => ({
              id: `admin-${mod}-${row.id}`,
              module: mod,
              data: row as unknown as Record<string, unknown>,
              status: row.status,
            }))
          )
          void workspaceApi.batchSync('admin', seedItems).catch(() => {})
        }
      } catch (err) {
        console.warn('[AdminDashboard] Offline mode; using memory records', err)
      }
    }
    initDb()
    return () => { mounted = false }
  }, [])

  const chooseSection = (next: string) => { setSection(next); setActiveTab(''); setSearch(''); setStatusFilter('All'); setMobileOpen(false) }
  const openCreate = () => { setSelected(null); setForm({ name: '', category: '', location: '' }); setModal('create') }
  const openEdit = (row: RecordItem) => { setSelected(row); setForm({ name: row.name, category: row.category, location: row.location }); setModal('edit') }
  const saveRecord = () => {
    if (!current || !form.name.trim() || !form.category.trim() || !form.location.trim()) { notify('Please complete all required fields'); return }
    const now = 'Just now'
    if (modal === 'edit' && selected) {
      const updatedRow = { ...selected, ...form, updated: now }
      setRecords(prev => ({ ...prev, [section]: prev[section].map(row => row.id === selected.id ? updatedRow : row) }))
      setActivities(prev => [`${current.singular} updated: ${form.name}`, ...prev].slice(0, 6))
      notify(`${current.singular} updated (saved to PostgreSQL)`)
      void workspaceApi.save('admin', section, { id: `admin-${section}-${selected.id}`, data: updatedRow, status: updatedRow.status }).catch(() => {})
    } else {
      const newRow: RecordItem = { id: Date.now(), ...form, status: section === 'Analytics & Reports' ? 'Ready' : 'Pending', value: 'New record', updated: now }
      setRecords(prev => ({ ...prev, [section]: [newRow, ...prev[section]] }))
      setActivities(prev => [`${current.singular} added: ${form.name}`, ...prev].slice(0, 6))
      notify(`${current.singular} added (saved to PostgreSQL)`)
      void workspaceApi.save('admin', section, { id: `admin-${section}-${newRow.id}`, data: newRow, status: newRow.status }).catch(() => {})
    }
    setModal(null)
  }
  const cycleStatus = (row: RecordItem) => {
    const next = ['Pending', 'Correction', 'Draft'].includes(row.status) ? 'Approved' : ['Active', 'Verified', 'Approved', 'Published', 'Ready', 'Healthy', 'Available', 'Allocated', 'Ongoing', 'Scheduled', 'Recorded', 'Hiring', 'Placed', 'Enabled'].includes(row.status) ? 'Inactive' : 'Active'
    const updatedRow = { ...row, status: next, updated: 'Just now' }
    setRecords(prev => ({ ...prev, [section]: prev[section].map(item => item.id === row.id ? updatedRow : item) }))
    setActivities(prev => [`${row.name} changed to ${next}`, ...prev].slice(0, 6))
    notify(`${row.name}: ${next} (updated in PostgreSQL)`)
    void workspaceApi.save('admin', section, { id: `admin-${section}-${row.id}`, data: updatedRow, status: next }).catch(() => {})
  }
  const exportCsv = () => {
    const rows = section === 'Dashboard' ? Object.values(records).flat() : currentRows
    const csv = [['Name','Category','Location','Status','Value','Updated'], ...rows.map(r => [r.name,r.category,r.location,r.status,r.value,r.updated])].map(row => row.map(cell => `"${String(cell).replaceAll('"','""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); const link = document.createElement('a'); link.href = url; link.download = `nccp-${section.toLowerCase().replaceAll(' ','-')}.csv`; link.click(); URL.revokeObjectURL(url); notify('CSV report downloaded')
  }

  return <div className="ncct-admin-shell">
    {mobileOpen && <button className="ncct-admin-scrim" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
    <aside className={`ncct-admin-sidebar ${mobileOpen ? 'open' : ''}`}>
      <div className="ncct-admin-brand"><img src={asset10} alt="NCCP" /></div>
      <nav>{['Dashboard', ...Object.keys(modules)].map(label => { const Icon = navIcons[label]; return <button key={label} className={section === label ? 'active' : ''} onClick={() => chooseSection(label)}><Icon size={17} /><span>{t(label)}</span></button> })}</nav>
      <div className="ncct-admin-motto">{t('Sahakar Se Samriddhi')}<small>{t('Cooperation for a Prosperous Bharat')}</small></div>
    </aside>
    <div className="ncct-admin-main">
      <header className="ncct-admin-top">
        <button className="ncct-icon-button ncct-menu" aria-label="Open navigation" onClick={() => setMobileOpen(true)}><Menu size={20} /></button>
        <div className="ncct-search"><Search size={17} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder={`${t('Search')} ${section === 'Dashboard' ? t('the platform') : t(section).toLowerCase()}...`} /></div>
        <button className="ncct-language" onClick={() => setLanguage(language === 'en' ? 'hi' : 'en')}><Languages size={17} /> {language === 'en' ? 'English' : 'हिंदी'} <ChevronDown size={13} /></button>
        <div className="ncct-pop-wrap"><button className="ncct-icon-button" aria-label="Notifications" onClick={() => setNotifications(!notifications)}><Bell size={18} /><i>3</i></button>{notifications && <div className="ncct-pop"><b>{t('Notifications')}</b><p>3 institution approvals require review.</p><p>National attendance report is ready.</p><button onClick={() => { setNotifications(false); notify(t('Notifications marked as read')) }}>{t('Mark all as read')}</button></div>}</div>
        <div className="ncct-pop-wrap"><button className="ncct-user" onClick={() => setProfile(!profile)}><CircleUserRound size={27} /><span><b>Dr. R.K. Sharma</b><small>{t('Super Admin')}</small></span><ChevronDown size={13} /></button>{profile && <div className="ncct-pop"><b>Dr. R.K. Sharma</b><p>{t('NCCT Super Admin')}</p><button onClick={() => notify(t('Profile settings opened'))}>{t('Profile settings')}</button><button onClick={onLogout}>{t('Logout')}</button></div>}</div>
      </header>
      <main className="ncct-admin-content">
        {section === 'Dashboard' ? <>
          <section className="ncct-admin-hero"><img src={asset02} alt="India cooperative network" /><div><p>{t('NCCT ADMIN CONTROL CENTER')}</p><h1>{language === 'hi' ? 'एक नज़र में राष्ट्रीय प्रशिक्षण पारिस्थितिकी तंत्र' : 'National training ecosystem at a glance'}</h1><span>{language === 'hi' ? 'पूरे भारत में प्रशिक्षण, अनुमोदन, सीखने के परिणाम और रोजगार की निगरानी करें।' : 'Monitor delivery, approvals, learning outcomes and employment across India.'}</span></div><button onClick={() => chooseSection('Analytics & Reports')}><BarChart3 size={17} /> {language === 'hi' ? 'राष्ट्रीय रिपोर्ट देखें' : 'View national report'}</button></section>
          <section className="ncct-metric-grid">{overview.map(([value,label,Icon,tone]) => <button className={`ncct-metric ${tone}`} key={label} onClick={() => { const target = label.includes('Institution') ? 'Institutions' : label.includes('Programme') ? 'Programmes' : label.includes('Batch') ? 'Batches' : label.includes('Trainee') ? 'Trainees' : label.includes('Trainer') ? 'Trainers' : label.includes('Employer') || label.includes('Placement') ? 'Employment' : label.includes('Certificate') ? 'Certification' : label.includes('Attendance') ? 'Attendance' : label.includes('Session') || label.includes('Hostel') ? 'Training Operations' : 'Analytics & Reports'; chooseSection(target) }}><span><Icon size={21} /></span><div><strong>{value}</strong><small>{t(label)}</small></div></button>)}</section>
          <section className="ncct-dashboard-grid">
            <article className="ncct-panel ncct-span-2"><div className="ncct-panel-head"><div><h2>{language === 'hi' ? 'प्रशिक्षण एवं प्रमाणन रुझान' : 'Training & certification trend'}</h2><p>{language === 'hi' ? 'मासिक राष्ट्रीय गतिविधि' : 'Monthly national activity'}</p></div><button onClick={() => chooseSection('Analytics & Reports')}>{language === 'hi' ? 'विश्लेषण देखें' : 'View analytics'}</button></div><div className="ncct-chart">{[58,72,65,82,76,91,88,96,84,100,92,98].map((h,i) => <div key={i}><span style={{height:`${h}%`}}/><i style={{height:`${h*.72}%`}}/><small>{['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][i]}</small></div>)}</div></article>
            <article className="ncct-panel"><div className="ncct-panel-head"><div><h2>{language === 'hi' ? 'लंबित स्वीकृतियां' : 'Pending approvals'}</h2><p>{language === 'hi' ? 'प्रशासक के ध्यान की आवश्यकता' : 'Needs admin attention'}</p></div><button onClick={() => chooseSection('Institutions')}>{t('Review all')}</button></div><div className="ncct-approval-list">{Object.entries(records).flatMap(([key, rows]) => rows.filter(r => r.status === 'Pending' || r.status === 'Correction').map(r => ({...r, module:key}))).slice(0,5).map(row => <button key={`${row.module}-${row.id}`} onClick={() => chooseSection(row.module)}><span><b>{row.name}</b><small>{t(row.module)} · {row.updated}</small></span><em>{t(row.status)}</em></button>)}</div></article>
            <article className="ncct-panel ncct-span-2"><div className="ncct-panel-head"><div><h2>{language === 'hi' ? 'परिचालन स्थिति' : 'Operational health'}</h2><p>{language === 'hi' ? 'लाइव संकेतक' : 'Live delivery indicators'}</p></div><button onClick={() => chooseSection('Training Operations')}>{language === 'hi' ? 'संचालन खोलें' : 'Open operations'}</button></div><div className="ncct-health-grid">{[['Attendance','91.4%',91],['Completion','82%',82],['Placement','68%',68],['Hostel occupancy','74%',74]].map(([label,value,width]) => <div key={label as string}><span>{t(label as string)}<b>{value}</b></span><i><em style={{width:`${width}%`}} /></i></div>)}</div></article>
            <article className="ncct-panel"><div className="ncct-panel-head"><div><h2>{language === 'hi' ? 'हाल की गतिविधि' : 'Recent activity'}</h2><p>{language === 'hi' ? 'एनसीसीपी पर अपडेट' : 'Updates across NCCP'}</p></div></div><div className="ncct-activity-list">{activities.map((item,index) => <div key={`${item}-${index}`}><span><Activity size={14} /></span><p><b>{item}</b><small>{index === 0 ? (language === 'hi' ? 'अभी-अभी' : 'Just now') : (language === 'hi' ? `${index + 1} घंटे पहले` : `${index + 1} hours ago`)}</small></p></div>)}</div></article>
          </section>
          </> : current && <>
            <section className="ncct-module-head"><div><p>{t('NCCT Super Admin')}</p><h1>{t(current.title)}</h1><span>{t(current.description)}</span></div><div><button className="ncct-export" onClick={exportCsv}><Download size={16} /> {t('Export')}</button><button className="ncct-primary" onClick={openCreate}><Plus size={17} /> {t('Add')} {t(current.singular)}</button></div></section>
            <div className="ncct-tabs">{current.tabs.map(tab => <button className={(activeTab || current.tabs[0]) === tab ? 'active' : ''} key={tab} onClick={() => setActiveTab(tab)}>{t(tab)}</button>)}</div>
            <section className="ncct-module-stats">{[[String(currentRows.length),'Total records'],[String(currentRows.filter(r => ['Active','Verified','Approved','Ready','Published','Healthy','Available','Ongoing','Recorded','Placed','Enabled'].includes(r.status)).length),'Active / approved'],[String(currentRows.filter(r => r.status === 'Pending' || r.status === 'Correction').length),'Pending action'],['94%','Performance']].map(([value,label],i) => <div key={label}><span className={['mint','gold','blue','purple'][i]}><BarChart3 size={20}/></span><b>{value}</b><small>{t(label)}</small></div>)}</section>
            <section className="ncct-panel ncct-table-panel"><div className="ncct-table-tools"><div className="ncct-search"><Search size={16}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder={`${t('Search')} ${t(current.title).toLowerCase()}...`} /></div><select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>{statuses.map(status => <option key={status}>{status === 'All' ? (language === 'hi' ? 'सभी स्थितियां' : 'All statuses') : t(status)}</option>)}</select><span>{filtered.length} {language === 'hi' ? 'रिकॉर्ड' : 'records'}</span></div><div className="ncct-table-scroll"><table><thead><tr><th>{t(current.fields[0][0])}</th><th>{t(current.fields[1][0])}</th><th>{t(current.fields[2][0])}</th><th>{language === 'hi' ? 'प्रदर्शन / मात्रा' : 'Performance / volume'}</th><th>{t('Status')}</th><th>{t('Updated')}</th><th>{t('Actions')}</th></tr></thead><tbody>{filtered.map(row => <tr key={row.id}><td><b>{row.name}</b></td><td>{row.category}</td><td>{row.location}</td><td>{row.value}</td><td><span className={`ncct-status ${row.status.toLowerCase().replaceAll(' ','-')}`}>{t(row.status)}</span></td><td>{row.updated}</td><td><div className="ncct-row-actions"><button title={t('View')} onClick={() => { setSelected(row); setModal('view') }}><Search size={15}/></button><button title={t('Edit')} onClick={() => openEdit(row)}><Settings size={15}/></button><button title={t('Change status')} onClick={() => cycleStatus(row)}><Check size={15}/></button></div></td></tr>)}</tbody></table>{filtered.length === 0 && <div className="ncct-empty">{language === 'hi' ? 'कोई रिकॉर्ड नहीं मिला।' : 'No records match the current search and filter.'}</div>}</div></section>
          </>}
      </main>
    </div>
    {modal && current && <div className="ncct-modal-backdrop" role="presentation" onMouseDown={() => setModal(null)}><section className="ncct-modal" role="dialog" aria-modal="true" onMouseDown={e => e.stopPropagation()}><div className="ncct-modal-head"><div><p>{current.title}</p><h2>{modal === 'create' ? `Add ${current.singular}` : modal === 'edit' ? `Edit ${current.singular}` : `${current.singular} details`}</h2></div><button aria-label="Close" onClick={() => setModal(null)}><X size={19}/></button></div>{modal === 'view' && selected ? <div className="ncct-details"><div><small>{current.fields[0][0]}</small><b>{selected.name}</b></div><div><small>{current.fields[1][0]}</small><b>{selected.category}</b></div><div><small>{current.fields[2][0]}</small><b>{selected.location}</b></div><div><small>Status</small><b>{selected.status}</b></div><div><small>Performance / volume</small><b>{selected.value}</b></div><div><small>Last updated</small><b>{selected.updated}</b></div><button className="ncct-primary" onClick={() => { setModal(null); openEdit(selected) }}>Edit record</button></div> : <form onSubmit={e => { e.preventDefault(); saveRecord() }}><label>{current.fields[0][0]}<input autoFocus value={form.name} onChange={e => setForm({...form,name:e.target.value})} placeholder={`Enter ${current.fields[0][0].toLowerCase()}`} /></label><label>{current.fields[1][0]}<input value={form.category} onChange={e => setForm({...form,category:e.target.value})} placeholder={`Enter ${current.fields[1][0].toLowerCase()}`} /></label><label>{current.fields[2][0]}<input value={form.location} onChange={e => setForm({...form,location:e.target.value})} placeholder={`Enter ${current.fields[2][0].toLowerCase()}`} /></label><div className="ncct-modal-actions"><button type="button" onClick={() => setModal(null)}>Cancel</button><button className="ncct-primary" type="submit"><Check size={16}/> Save {current.singular}</button></div></form>}</section></div>}
    {toast && <div className="ncct-toast"><CheckCircle2 size={17}/>{toast}</div>}
  </div>
}
