import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import {
  Award,
  BarChart3,
  Bell,
  Bot,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  CircleUserRound,
  Download,
  FileCheck2,
  FileText,
  Handshake,
  Home,
  Landmark,
  Languages,
  LogOut,
  Mail,
  Menu,
  MessageSquare,
  Pause,
  Pencil,
  Plus,
  Search,
  Send,
  Settings,
  Sparkles,
  Target,
  UserCheck,
  UsersRound,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import brand from '@/assets/nccp/10_institution_logo_brand.png'
import bannerImg from '@/assets/nccp/01_landing_hero_visual.png'
import { workspaceApi } from '@/lib/nccp-api'
import { useI18n } from '@/lib/i18n-context'
import './EmployerWorkspace.css'

type JobStatus = 'Active' | 'Draft' | 'Paused' | 'Closed'
type ApplicantStatus = 'Review' | 'Shortlisted' | 'Interview' | 'Offer' | 'Placed' | 'Rejected'
type Job = {
  id: number
  title: string
  company: string
  type: string
  openings: number
  location: string
  mode: string
  experience: string
  salary: string
  description: string
  required: string
  preferred: string
  qualification: string
  deadline: string
  benefits: string
  status: JobStatus
}
type Applicant = {
  id: number
  name: string
  role: string
  match: number
  location: string
  skills: string[]
  education: string
  certification: string
  training: string
  institution: string
  score: number
  status: ApplicantStatus
  applied: string
}
type Interview = {
  id: number
  candidate: string
  role: string
  date: string
  time: string
  mode: string
  notes: string
  status: string
}
type EmployerData = {
  jobs: Job[]
  applicants: Applicant[]
  interviews: Interview[]
  company: { name: string; sector: string; location: string; website: string; about: string }
  activities: string[]
}

const seedData = (): EmployerData => ({
  jobs: [
    {
      id: 1,
      title: 'Dairy Technician',
      company: 'Amul Dairy Cooperative',
      type: 'Full time',
      openings: 12,
      location: 'Anand, Gujarat',
      mode: 'On-site',
      experience: '1–3 years',
      salary: '₹3.2–4.2 LPA',
      description: 'Support dairy processing, quality checks and plant operations.',
      required: 'Dairy Operations, Quality Control',
      preferred: 'MIS, Cooperative Management',
      qualification: 'Diploma / B.Sc.',
      deadline: '2026-10-08',
      benefits: 'Insurance, transport, training',
      status: 'Active',
    },
    {
      id: 2,
      title: 'Field Associate',
      company: 'Amul Dairy Cooperative',
      type: 'Full time',
      openings: 8,
      location: 'Jaipur, Rajasthan',
      mode: 'Field',
      experience: '0–2 years',
      salary: '₹2.8–3.6 LPA',
      description: 'Work with rural dairy societies and member producers.',
      required: 'Community Mobilisation, Livestock Care',
      preferred: 'Hindi, Reporting',
      qualification: 'Graduate',
      deadline: '2026-10-12',
      benefits: 'Travel allowance, insurance',
      status: 'Active',
    },
    {
      id: 3,
      title: 'MIS Executive',
      company: 'Amul Dairy Cooperative',
      type: 'Contract',
      openings: 3,
      location: 'Remote',
      mode: 'Hybrid',
      experience: '1+ year',
      salary: '₹25,000/month',
      description: 'Maintain recruitment and operations dashboards.',
      required: 'Excel, Data Entry, MIS',
      preferred: 'Power BI',
      qualification: 'Graduate',
      deadline: '2026-10-20',
      benefits: 'Flexible work',
      status: 'Draft',
    },
  ],
  applicants: [
    {
      id: 1,
      name: 'Ravi Kumar',
      role: 'Dairy Technician',
      match: 92,
      location: 'Rajasthan',
      skills: ['Dairy Operations', 'Quality Control', 'Equipment Safety'],
      education: 'B.Sc. Dairy Technology',
      certification: 'NCCP Dairy Operations',
      training: '6-week NDDB programme',
      institution: 'Rajasthan Cooperative Institute',
      score: 88,
      status: 'Shortlisted',
      applied: '28 Sep 2026',
    },
    {
      id: 2,
      name: 'Pooja Sharma',
      role: 'Field Associate',
      match: 88,
      location: 'Gujarat',
      skills: ['Cooperative Management', 'Community Mobilisation', 'Reporting'],
      education: 'B.A. Rural Development',
      certification: 'Cooperative Leadership',
      training: '8-week NCCP programme',
      institution: 'Gujarat Cooperative Academy',
      score: 84,
      status: 'Interview',
      applied: '27 Sep 2026',
    },
    {
      id: 3,
      name: 'Imran Khan',
      role: 'Dairy Technician',
      match: 85,
      location: 'Uttar Pradesh',
      skills: ['Livestock Care', 'Dairy Operations', 'Hygiene'],
      education: 'Diploma in Animal Husbandry',
      certification: 'Livestock Care',
      training: '4-week field programme',
      institution: 'UP Cooperative Institute',
      score: 81,
      status: 'Review',
      applied: '26 Sep 2026',
    },
    {
      id: 4,
      name: 'Neha Verma',
      role: 'MIS Executive',
      match: 78,
      location: 'Bihar',
      skills: ['Data Entry', 'Excel', 'MIS'],
      education: 'B.Com.',
      certification: 'Digital Skills',
      training: '6-week digital programme',
      institution: 'Bihar Training Centre',
      score: 86,
      status: 'Offer',
      applied: '25 Sep 2026',
    },
    {
      id: 5,
      name: 'Suresh Patel',
      role: 'Field Associate',
      match: 76,
      location: 'Madhya Pradesh',
      skills: ['Field Survey', 'Hindi', 'Farmer Outreach'],
      education: 'B.A.',
      certification: 'Rural Outreach',
      training: '4-week programme',
      institution: 'MP Cooperative Academy',
      score: 75,
      status: 'Placed',
      applied: '24 Sep 2026',
    },
  ],
  interviews: [
    {
      id: 1,
      candidate: 'Pooja Sharma',
      role: 'Field Associate',
      date: '2026-09-29',
      time: '11:00',
      mode: 'Video',
      notes: 'Focus on field coordination experience.',
      status: 'Confirmed',
    },
  ],
  company: {
    name: 'Amul Dairy Cooperative',
    sector: 'Dairy & Food Processing',
    location: 'Anand, Gujarat',
    website: 'www.amul.com',
    about: 'Building stronger dairy livelihoods through cooperative enterprise.',
  },
  activities: ['Pooja Sharma moved to Interview', 'Neha Verma received an offer', 'Dairy Technician job published'],
})

const nav = [
  ['Dashboard', Home],
  ['Post a Job', Plus],
  ['Manage Jobs', BriefcaseBusiness],
  ['Applications', FileCheck2],
  ['Candidate Matches', Target],
  ['Interviews', CalendarDays],
  ['Selection & Placements', Award],
  ['Analytics', BarChart3],
  ['AI Recruitment Assistant', Bot],
  ['Messages', MessageSquare],
  ['Company Profile', Landmark],
  ['Notifications', Bell],
  ['Settings', Settings],
  ['Help & Support', CircleHelp],
] as const

const statuses: ApplicantStatus[] = ['Review', 'Shortlisted', 'Interview', 'Offer', 'Placed', 'Rejected']
const today = '2026-09-28'

function useEmployerData() {
  const [data, setData] = useState<EmployerData>(() => seedData())
  const [hydrated, setHydrated] = useState(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    async function init() {
      try {
        const saved = window.localStorage.getItem('nccp-employer-dashboard-v1')
        if (saved) setData(JSON.parse(saved) as EmployerData)
      } catch {
        /* keep seed */
      }

      try {
        const res = await workspaceApi.list<EmployerData>('employer')
        if (!mountedRef.current) return

        if (res?.data && res.data.length > 0) {
          const rebuilt: EmployerData = seedData()
          for (const row of res.data) {
            const mod = row.module as keyof EmployerData
            if (mod === 'jobs' && row.data)
              rebuilt.jobs = Array.isArray(row.data)
                ? row.data
                : [...rebuilt.jobs.filter((j) => j.id !== (row.data as unknown as Job).id), row.data as unknown as Job]
            else if (mod === 'applicants' && row.data)
              rebuilt.applicants = Array.isArray(row.data)
                ? row.data
                : [...rebuilt.applicants.filter((a) => a.id !== (row.data as unknown as Applicant).id), row.data as unknown as Applicant]
            else if (mod === 'interviews' && row.data)
              rebuilt.interviews = Array.isArray(row.data)
                ? row.data
                : [...rebuilt.interviews.filter((i) => i.id !== (row.data as unknown as Interview).id), row.data as unknown as Interview]
            else if (mod === 'company' && row.data) rebuilt.company = row.data as unknown as EmployerData['company']
            else if (mod === 'activities' && row.data)
              rebuilt.activities = (row.data as unknown as { items: string[] }).items ?? rebuilt.activities
          }
          setData(rebuilt)
        } else {
          const seed = seedData()
          const items = [
            ...seed.jobs.map((j) => ({
              id: `employer-job-${j.id}`,
              module: 'jobs',
              data: j as unknown as Record<string, unknown>,
              status: j.status,
            })),
            ...seed.applicants.map((a) => ({
              id: `employer-applicant-${a.id}`,
              module: 'applicants',
              data: a as unknown as Record<string, unknown>,
              status: a.status,
            })),
            ...seed.interviews.map((i) => ({
              id: `employer-interview-${i.id}`,
              module: 'interviews',
              data: i as unknown as Record<string, unknown>,
              status: i.status,
            })),
            { id: 'employer-company', module: 'company', data: seed.company as unknown as Record<string, unknown>, status: 'active' },
            { id: 'employer-activities', module: 'activities', data: { items: seed.activities } as unknown as Record<string, unknown>, status: 'active' },
          ]
          void workspaceApi.batchSync('employer', items).catch(() => {})
        }
      } catch (err) {
        console.warn('[EmployerWorkspace] PostgreSQL offline — using local fallback', err)
      } finally {
        if (mountedRef.current) setHydrated(true)
      }
    }
    init()
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (hydrated) {
      try {
        window.localStorage.setItem('nccp-employer-dashboard-v1', JSON.stringify(data))
      } catch {
        /* quota */
      }
    }
  }, [data, hydrated])

  return [data, setData] as const
}

function Brand() {
  return (
    <div className="emp-brand">
      <img src={brand} alt="NCCP logo" />
      <div>
        <b>NCCP</b>
        <small>National Cooperative<br />Capacity Building Platform</small>
      </div>
    </div>
  )
}
function initials(name: string) {
  return name
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
}
function pct(n: number, d: number) {
  return d ? `${Math.round((n / d) * 100)}%` : '0%'
}

export default function EmployerWorkspace({ onLogout }: { onLogout: () => void }) {
  const { t, language, setLanguage } = useI18n()
  const [data, setData] = useEmployerData()
  const [section, setSection] = useState('Dashboard')
  const [search, setSearch] = useState('')
  const [menu, setMenu] = useState(false)
  const [profileMenu, setProfileMenu] = useState(false)
  const [noticeMenu, setNoticeMenu] = useState(false)
  const [toast, setToast] = useState('')
  const [selected, setSelected] = useState<Applicant | null>(null)
  const notify = (text: string) => {
    setToast(text)
    window.setTimeout(() => setToast(''), 2400)
  }

  const update = useCallback(
    (recipe: (old: EmployerData) => EmployerData, message: string) => {
      setData((prev) => {
        const next = recipe(prev)
        try {
          for (const job of next.jobs) {
            if (!prev.jobs.find((j) => j.id === job.id && JSON.stringify(j) === JSON.stringify(job))) {
              void workspaceApi
                .save('employer', 'jobs', {
                  id: `employer-job-${job.id}`,
                  data: job as unknown as Record<string, unknown>,
                  status: job.status,
                })
                .catch(() => {})
            }
          }
          for (const app of next.applicants) {
            if (!prev.applicants.find((a) => a.id === app.id && JSON.stringify(a) === JSON.stringify(app))) {
              void workspaceApi
                .save('employer', 'applicants', {
                  id: `employer-applicant-${app.id}`,
                  data: app as unknown as Record<string, unknown>,
                  status: app.status,
                })
                .catch(() => {})
            }
          }
          for (const iv of next.interviews) {
            if (!prev.interviews.find((i) => i.id === iv.id && JSON.stringify(i) === JSON.stringify(iv))) {
              void workspaceApi
                .save('employer', 'interviews', {
                  id: `employer-interview-${iv.id}`,
                  data: iv as unknown as Record<string, unknown>,
                  status: iv.status,
                })
                .catch(() => {})
            }
          }
          if (JSON.stringify(next.company) !== JSON.stringify(prev.company)) {
            void workspaceApi
              .save('employer', 'company', {
                id: 'employer-company',
                data: next.company as unknown as Record<string, unknown>,
                status: 'active',
              })
              .catch(() => {})
          }
          if (next.activities.length !== prev.activities.length || next.activities[0] !== prev.activities[0]) {
            void workspaceApi
              .save('employer', 'activities', {
                id: 'employer-activities',
                data: { items: next.activities.slice(0, 50) } as unknown as Record<string, unknown>,
                status: 'active',
              })
              .catch(() => {})
          }
        } catch {
          /* fallback */
        }
        return next
      })
      notify(message)
    },
    [notify, setData]
  )

  const go = (next: string) => {
    setSection(next)
    setMenu(false)
    setSearch('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const counts = useMemo(
    () => ({
      active: data.jobs.filter((j) => j.status === 'Active').length,
      applicants: data.applicants.length,
      shortlisted: data.applicants.filter((a) => a.status === 'Shortlisted').length,
      interviews: data.applicants.filter((a) => a.status === 'Interview').length,
      offers: data.applicants.filter((a) => a.status === 'Offer').length,
      placements: data.applicants.filter((a) => a.status === 'Placed').length,
    }),
    [data]
  )
  const context = { data, setData, search, notify, update, go, selected, setSelected, counts, t }

  return (
    <div className="emp-shell">
      <Sidebar active={section} open={menu} onClose={() => setMenu(false)} onSelect={go} t={t} />
      {menu && <button className="emp-scrim" aria-label="Close navigation" onClick={() => setMenu(false)} />}
      <div className="emp-main">
        <header className="emp-top">
          <Button variant="ghost" size="icon" className="emp-menu" onClick={() => setMenu(true)} aria-label="Open navigation">
            <Menu />
          </Button>
          <div className="emp-search">
            <Search size={17} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('Search') + '...'} />
          </div>
          <div className="emp-top-actions">
            {/* Language Switcher */}
            <Button
              variant="outline"
              size="sm"
              className="flex items-center gap-1.5 font-medium border-amber-900/20 text-emerald-950 hover:bg-emerald-50 text-xs px-2.5 py-1 h-8 rounded-lg"
              onClick={() => setLanguage(language === 'en' ? 'hi' : 'en')}
              title={language === 'en' ? 'हिंदी में बदलें' : 'Switch to English'}
            >
              <Languages size={14} className="text-amber-600" />
              <span>{language === 'en' ? 'हिंदी' : 'English'}</span>
            </Button>

            <div className="emp-pop-wrap">
              <Button variant="ghost" size="icon" onClick={() => setNoticeMenu((v) => !v)} aria-label="Notifications">
                <Bell />
                <i>{data.activities.length}</i>
              </Button>
              {noticeMenu && (
                <Popover title={t('Notifications')} close={() => setNoticeMenu(false)}>
                  {data.activities.slice(0, 4).map((x) => (
                    <button key={x} onClick={() => notify(x)}>
                      {x}
                      <small>Recently</small>
                    </button>
                  ))}
                  <Button variant="ghost" onClick={() => go('Notifications')}>
                    {t('View all')}
                  </Button>
                </Popover>
              )}
            </div>
            <div className="emp-pop-wrap">
              <Button variant="outline" className="emp-account" onClick={() => setProfileMenu((v) => !v)}>
                <span className="emp-avatar">
                  <Building2 />
                </span>
                <span>
                  <b>{data.company.name}</b>
                  <small>{t('Employer / Recruiter')}</small>
                </span>
                <ChevronDown />
              </Button>
              {profileMenu && (
                <Popover title={t('Employer / Recruiter')} close={() => setProfileMenu(false)}>
                  <button
                    onClick={() => {
                      go('Company Profile')
                      setProfileMenu(false)
                    }}
                  >
                    <CircleUserRound /> {t('Company Profile')}
                  </button>
                  <button
                    onClick={() => {
                      go('Settings')
                      setProfileMenu(false)
                    }}
                  >
                    <Settings /> {t('Settings')}
                  </button>
                  <button className="emp-logout" onClick={onLogout}>
                    <LogOut /> {t('Log out')}
                  </button>
                </Popover>
              )}
            </div>
          </div>
        </header>
        <main className="emp-content">
          {section === 'Dashboard' ? (
            <Dashboard {...context} />
          ) : section === 'Post a Job' ? (
            <JobForm {...context} />
          ) : section === 'Manage Jobs' ? (
            <Jobs {...context} />
          ) : section === 'Applications' ? (
            <Applications {...context} />
          ) : section === 'Candidate Matches' ? (
            <Matches {...context} />
          ) : section === 'Interviews' ? (
            <Interviews {...context} />
          ) : section === 'Selection & Placements' ? (
            <Placements {...context} />
          ) : section === 'Analytics' ? (
            <Analytics data={data} counts={counts} t={t} />
          ) : section === 'AI Recruitment Assistant' ? (
            <Assistant {...context} />
          ) : section === 'Messages' ? (
            <Messages notify={notify} t={t} />
          ) : section === 'Company Profile' ? (
            <Company {...context} />
          ) : section === 'Notifications' ? (
            <Notifications data={data} notify={notify} t={t} />
          ) : section === 'Settings' ? (
            <SettingsView notify={notify} t={t} />
          ) : (
            <Help notify={notify} t={t} />
          )}
        </main>
      </div>
      {selected && (
        <CandidateModal
          candidate={selected}
          onClose={() => setSelected(null)}
          onStatus={(status) =>
            update(
              (old) => ({
                ...old,
                applicants: old.applicants.map((a) => (a.id === selected.id ? { ...a, status } : a)),
                activities: [`${selected.name} moved to ${status}`, ...old.activities],
              }),
              `${selected.name} moved to ${status}`
            )
          }
          t={t}
        />
      )}
      {toast && (
        <div className="emp-toast">
          <CheckCircle2 /> {toast}
        </div>
      )}
    </div>
  )
}

function Sidebar({
  active,
  open,
  onClose,
  onSelect,
  t,
}: {
  active: string
  open: boolean
  onClose: () => void
  onSelect: (s: string) => void
  t: (k: string) => string
}) {
  return (
    <aside className={`emp-sidebar ${open ? 'open' : ''}`}>
      <div className="emp-sidebar-head">
        <Brand />
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close navigation">
          <X />
        </Button>
      </div>
      <div className="emp-company">
        <span>
          <Building2 />
        </span>
        <div>
          <b>Amul Dairy Cooperative</b>
          <small>{t('Verified')} {t('Employer / Recruiter')}</small>
        </div>
        <CheckCircle2 />
      </div>
      <nav>
        {nav.map(([label, Icon]) => (
          <Button
            variant="ghost"
            key={label}
            className={active === label ? 'active' : ''}
            onClick={() => onSelect(label)}
          >
            <Icon />
            {t(label)}
          </Button>
        ))}
      </nav>
      <div className="emp-motto">
        <b>सहकार से समृद्ध भारत</b>
        <small>{t('Cooperation for a Prosperous Bharat')}</small>
      </div>
    </aside>
  )
}

function Popover({ title, children, close }: { title: string; children: ReactNode; close: () => void }) {
  return (
    <div className="emp-pop">
      <header>
        <b>{title}</b>
        <Button variant="ghost" size="icon" onClick={close}>
          <X />
        </Button>
      </header>
      {children}
    </div>
  )
}

function Heading({ eyebrow, title, copy, action }: { eyebrow: string; title: string; copy: string; action?: ReactNode }) {
  return (
    <div className="emp-heading">
      <div>
        <span>{eyebrow}</span>
        <h1>{title}</h1>
        <p>{copy}</p>
      </div>
      {action}
    </div>
  )
}

function Panel({ title, sub, children, action }: { title: string; sub?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="emp-panel">
      <header>
        <div>
          <h2>{title}</h2>
          {sub && <p>{sub}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  )
}

function Dashboard({ data, counts, search, setSelected, go, t }: any) {
  const filtered = data.applicants
    .filter((a: Applicant) => `${a.name} ${a.role} ${a.skills.join(' ')}`.toLowerCase().includes(search.toLowerCase()))
    .slice(0, 5)
  const metrics = [
    [counts.active, 'Active Jobs', BriefcaseBusiness],
    [counts.applicants, 'Total Applicants', UsersRound],
    [counts.shortlisted, 'Shortlisted', UserCheck],
    [counts.interviews, 'Interviews', CalendarDays],
    [counts.offers, 'Offers', FileCheck2],
    [counts.placements, 'Placements', Award],
  ] as const
  return (
    <>
      <section className="emp-banner">
        <img src={bannerImg} alt="Employer talent network" className="emp-banner-bg" />
        <div>
          <span>EMPLOYER RECRUITMENT CENTRE</span>
          <p>Welcome back,</p>
          <h1>{data.company.name}</h1>
          <p>Connect trained cooperative talent with meaningful work.</p>
          <Button onClick={() => go('Post a Job')}>
            <Plus /> {t('Post a Job')}
          </Button>
        </div>
        <div className="emp-banner-mark">
          <BriefcaseBusiness />
          <b>Hire with purpose.</b>
          <small>Build stronger cooperatives.</small>
        </div>
      </section>
      <div className="emp-metrics">
        {metrics.map(([v, l, I]) => (
          <button
            key={l}
            onClick={() =>
              go(
                l === 'Active Jobs'
                  ? 'Manage Jobs'
                  : l === 'Total Applicants' || l === 'Shortlisted'
                  ? 'Applications'
                  : l === 'Placements' || l === 'Offers'
                  ? 'Selection & Placements'
                  : l
              )
            }
          >
            <span>
              <I />
            </span>
            <div>
              <strong>{v}</strong>
              <small>{t(l)}</small>
            </div>
            <ChevronRight />
          </button>
        ))}
      </div>
      <div className="emp-grid-two">
        <Panel title="Hiring funnel" sub="Live pipeline from current records">
          <div className="emp-funnel">
            {[
              ['Applicants', counts.applicants],
              ['Shortlisted', counts.shortlisted],
              ['Interviews', counts.interviews],
              ['Offers', counts.offers],
              ['Placements', counts.placements],
            ].map(([l, v], i) => (
              <button key={l} onClick={() => go(i < 2 ? 'Applications' : i === 2 ? 'Interviews' : 'Selection & Placements')}>
                <span>{t(String(l))}</span>
                <b>{v}</b>
                <i style={{ width: `${Math.max(12, (Number(v) / Math.max(1, counts.applicants)) * 100)}%` }} />
              </button>
            ))}
          </div>
        </Panel>
        <Panel title="Top skills in candidate pool" sub="Based on verified candidate profiles">
          <div className="emp-skills">
            {topSkills(data.applicants).map(([skill, n]: [string, number]) => (
              <button key={skill} onClick={() => go('Candidate Matches')}>
                <span>
                  {skill}
                  <b>{n} candidates</b>
                </span>
                <i>
                  <em style={{ width: `${Math.min(100, n * 22)}%` }} />
                </i>
              </button>
            ))}
          </div>
        </Panel>
      </div>
      <Panel
        title="Latest applications"
        sub={`${filtered.length} candidates shown`}
        action={
          <Button variant="ghost" onClick={() => go('Applications')}>
            {t('View all')} <ChevronRight />
          </Button>
        }
      >
        <CandidateTable applicants={filtered} onOpen={setSelected} t={t} />
      </Panel>
      <div className="emp-quick">
        <Button onClick={() => go('Post a Job')}>
          <Plus />
          {t('Post a Job')}
        </Button>
        <Button variant="outline" onClick={() => go('Candidate Matches')}>
          <Target />
          {t('Candidate Matches')}
        </Button>
        <Button variant="outline" onClick={() => go('Interviews')}>
          <CalendarDays />
          {t('Schedule interview')}
        </Button>
        <Button variant="outline" onClick={() => go('AI Recruitment Assistant')}>
          <Sparkles />
          {t('AI Recruitment Assistant')}
        </Button>
      </div>
    </>
  )
}

function JobForm({ data, update, go, t }: any) {
  const [draft, setDraft] = useState<Job>({
    id: 0,
    title: '',
    company: data.company.name,
    type: 'Full time',
    openings: 1,
    location: '',
    mode: 'On-site',
    experience: '',
    salary: '',
    description: '',
    required: '',
    preferred: '',
    qualification: '',
    deadline: '',
    benefits: '',
    status: 'Draft',
  })
  const submit = (e: FormEvent, status: JobStatus) => {
    e.preventDefault()
    if (!draft.title || !draft.location || !draft.deadline) {
      return
    }
    const job = { ...draft, id: Date.now(), status }
    update(
      (old: EmployerData) => ({
        ...old,
        jobs: [job, ...old.jobs],
        activities: [`${job.title} job ${status === 'Draft' ? 'saved' : 'published'}`, ...old.activities],
      }),
      status === 'Draft' ? 'Draft saved' : 'Job published and dashboard updated'
    )
    go('Manage Jobs')
  }
  return (
    <>
      <Heading eyebrow="RECRUITMENT / CREATE" title={t('Post a Job')} copy="Create a complete opportunity and publish it to NCCP candidates." />
      <form className="emp-form" onSubmit={(e) => submit(e, 'Active')}>
        <div className="emp-form-grid">
          <Field label="Job title *">
            <input required value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          </Field>
          <Field label="Company *">
            <input required value={draft.company} onChange={(e) => setDraft({ ...draft, company: e.target.value })} />
          </Field>
          <Field label="Job type">
            <select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })}>
              <option>Full time</option>
              <option>Part time</option>
              <option>Contract</option>
              <option>Internship</option>
            </select>
          </Field>
          <Field label="Openings">
            <input type="number" min="1" value={draft.openings} onChange={(e) => setDraft({ ...draft, openings: Number(e.target.value) })} />
          </Field>
          <Field label="Location *">
            <input required value={draft.location} onChange={(e) => setDraft({ ...draft, location: e.target.value })} />
          </Field>
          <Field label="Work mode">
            <select value={draft.mode} onChange={(e) => setDraft({ ...draft, mode: e.target.value })}>
              <option>On-site</option>
              <option>Hybrid</option>
              <option>Remote</option>
              <option>Field</option>
            </select>
          </Field>
          <Field label="Experience">
            <input value={draft.experience} onChange={(e) => setDraft({ ...draft, experience: e.target.value })} />
          </Field>
          <Field label="Salary / stipend">
            <input value={draft.salary} onChange={(e) => setDraft({ ...draft, salary: e.target.value })} />
          </Field>
          <Field label="Qualification">
            <input value={draft.qualification} onChange={(e) => setDraft({ ...draft, qualification: e.target.value })} />
          </Field>
          <Field label="Application deadline *">
            <input required type="date" min={today} value={draft.deadline} onChange={(e) => setDraft({ ...draft, deadline: e.target.value })} />
          </Field>
          <Field label="Required skills">
            <input value={draft.required} onChange={(e) => setDraft({ ...draft, required: e.target.value })} placeholder="Separate skills with commas" />
          </Field>
          <Field label="Preferred skills">
            <input value={draft.preferred} onChange={(e) => setDraft({ ...draft, preferred: e.target.value })} />
          </Field>
          <Field label="Job description" wide>
            <textarea value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          </Field>
          <Field label="Benefits" wide>
            <textarea value={draft.benefits} onChange={(e) => setDraft({ ...draft, benefits: e.target.value })} />
          </Field>
        </div>
        <footer>
          <Button variant="outline" type="button" onClick={(e) => submit(e as any, 'Draft')}>
            {t('Save draft')}
          </Button>
          <Button type="submit">
            <BriefcaseBusiness />
            {t('Publish job')}
          </Button>
        </footer>
      </form>
    </>
  )
}

function Field({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={wide ? 'wide' : ''}>
      <span>{label}</span>
      {children}
    </label>
  )
}

function Jobs({ data, update, t }: any) {
  const [tab, setTab] = useState('All')
  const [edit, setEdit] = useState<Job | null>(null)
  const jobs = data.jobs.filter((j: Job) => tab === 'All' || j.status === tab)
  const action = (id: number, status: JobStatus) =>
    update(
      (old: EmployerData) => ({
        ...old,
        jobs: old.jobs.map((j) => (j.id === id ? { ...j, status } : j)),
        activities: [`Job status changed to ${status}`, ...old.activities],
      }),
      `Job ${status.toLowerCase()}`
    )
  return (
    <>
      <Heading eyebrow="RECRUITMENT / JOBS" title={t('Manage Jobs')} copy="Edit, pause, publish, and close every opportunity." />
      <div className="emp-tabs">
        {['All', 'Active', 'Draft', 'Paused', 'Closed'].map((tabName) => (
          <Button variant="ghost" className={tab === tabName ? 'active' : ''} key={tabName} onClick={() => setTab(tabName)}>
            {t(tabName)}
            <b>{tabName === 'All' ? data.jobs.length : data.jobs.filter((j: Job) => j.status === tabName).length}</b>
          </Button>
        ))}
      </div>
      <div className="emp-card-grid">
        {jobs.map((j: Job) => (
          <article className="emp-job" key={j.id}>
            <header>
              <span>
                <BriefcaseBusiness />
              </span>
              <Status value={j.status} t={t} />
            </header>
            <h2>{j.title}</h2>
            <p>
              {j.location} · {j.mode} · {j.type}
            </p>
            <div>
              <small>{j.openings} openings</small>
              <small>{j.salary}</small>
              <small>Closes {j.deadline}</small>
            </div>
            <footer>
              <Button variant="outline" size="sm" onClick={() => setEdit(j)}>
                <Pencil />
                {t('Edit')}
              </Button>
              {j.status === 'Active' ? (
                <Button variant="outline" size="sm" onClick={() => action(j.id, 'Paused')}>
                  <Pause />
                  Pause
                </Button>
              ) : (
                <Button variant="outline" size="sm" onClick={() => action(j.id, 'Active')}>
                  <CheckCircle2 />
                  {t('Active')}
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => action(j.id, 'Closed')}>
                {t('Close')}
              </Button>
            </footer>
          </article>
        ))}
      </div>
      {edit && (
        <EditJob
          job={edit}
          close={() => setEdit(null)}
          save={(job) => {
            update((old: EmployerData) => ({ ...old, jobs: old.jobs.map((j) => (j.id === job.id ? job : j)) }), 'Job details updated')
            setEdit(null)
          }}
          t={t}
        />
      )}
    </>
  )
}

function Applications({ data, search, update, setSelected, t }: any) {
  const [filter, setFilter] = useState('All')
  const rows = data.applicants.filter(
    (a: Applicant) => (filter === 'All' || a.status === filter) && `${a.name} ${a.role} ${a.skills}`.toLowerCase().includes(search.toLowerCase())
  )
  const move = (id: number, status: ApplicantStatus) =>
    update(
      (old: EmployerData) => ({
        ...old,
        applicants: old.applicants.map((a) => (a.id === id ? { ...a, status } : a)),
        activities: [`Application moved to ${status}`, ...old.activities],
      }),
      `Application moved to ${status}`
    )
  return (
    <>
      <Heading eyebrow="RECRUITMENT / PIPELINE" title={t('Applications')} copy="Review candidates and move them through your hiring process." />
      <div className="emp-toolbar">
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option>All</option>
          {statuses.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <span>{rows.length} {t('Total records')}</span>
        <Button variant="outline">
          <Download />
          {t('Export')}
        </Button>
      </div>
      <CandidateTable applicants={rows} onOpen={setSelected} onStatus={move} t={t} />
    </>
  )
}

function CandidateTable({
  applicants,
  onOpen,
  onStatus,
  t,
}: {
  applicants: Applicant[]
  onOpen: (a: Applicant) => void
  onStatus?: (id: number, s: ApplicantStatus) => void
  t?: (k: string) => string
}) {
  return (
    <div className="emp-table-wrap">
      <table>
        <thead>
          <tr>
            <th>{t ? t('Name') : 'Candidate'}</th>
            <th>Applied for</th>
            <th>Skills match</th>
            <th>{t ? t('Location') : 'Location'}</th>
            <th>Applied</th>
            <th>{t ? t('Status') : 'Status'}</th>
            <th>{t ? t('Actions') : 'Action'}</th>
          </tr>
        </thead>
        <tbody>
          {applicants.map((a) => (
            <tr key={a.id}>
              <td>
                <button className="emp-person" onClick={() => onOpen(a)}>
                  <i>{initials(a.name)}</i>
                  <span>
                    <b>{a.name}</b>
                    <small>{a.education}</small>
                  </span>
                </button>
              </td>
              <td>{a.role}</td>
              <td>
                <strong className="emp-match">{a.match}%</strong>
              </td>
              <td>{a.location}</td>
              <td>{a.applied}</td>
              <td>
                {onStatus ? (
                  <select value={a.status} onChange={(e) => onStatus(a.id, e.target.value as ApplicantStatus)}>
                    {statuses.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                ) : (
                  <Status value={a.status} t={t} />
                )}
              </td>
              <td>
                <Button variant="ghost" size="sm" onClick={() => onOpen(a)}>
                  {t ? t('View') : 'View'} <ChevronRight />
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!applicants.length && <div className="emp-empty">No matching candidates found.</div>}
    </div>
  )
}

function Matches({ data, search, setSelected, update, t }: any) {
  const [skill, setSkill] = useState('All skills')
  const skills = Array.from(new Set<string>(data.applicants.flatMap((a: Applicant) => a.skills)))
  const matches = data.applicants
    .filter(
      (a: Applicant) =>
        (skill === 'All skills' || a.skills.includes(skill)) &&
        `${a.name} ${a.skills} ${a.location}`.toLowerCase().includes(search.toLowerCase())
    )
    .sort((a: Applicant, b: Applicant) => b.match - a.match)
  return (
    <>
      <Heading
        eyebrow="AI SKILL MATCHING"
        title={t('Candidate Matches')}
        copy="Compare verified skills, education, training, and readiness."
        action={
          <select value={skill} onChange={(e) => setSkill(e.target.value)}>
            <option>All skills</option>
            {skills.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        }
      />
      <div className="emp-match-grid">
        {matches.map((a: Applicant) => (
          <article key={a.id}>
            <header>
              <i>{initials(a.name)}</i>
              <div>
                <h2>{a.name}</h2>
                <p>
                  {a.role} · {a.location}
                </p>
              </div>
              <strong>
                {a.match}%<small>match</small>
              </strong>
            </header>
            <div className="emp-tags">
              {a.skills.map((s) => (
                <span key={s}>{s}</span>
              ))}
            </div>
            <dl>
              <div>
                <dt>Education</dt>
                <dd>{a.education}</dd>
              </div>
              <div>
                <dt>Certification</dt>
                <dd>{a.certification}</dd>
              </div>
              <div>
                <dt>Institution</dt>
                <dd>{a.institution}</dd>
              </div>
            </dl>
            <footer>
              <Button variant="outline" onClick={() => setSelected(a)}>
                {t('View')}
              </Button>
              <Button
                onClick={() =>
                  update(
                    (old: EmployerData) => ({
                      ...old,
                      applicants: old.applicants.map((x) => (x.id === a.id ? { ...x, status: 'Shortlisted' } : x)),
                    }),
                    `${a.name} shortlisted`
                  )
                }
              >
                {t('Shortlist')}
              </Button>
            </footer>
          </article>
        ))}
      </div>
    </>
  )
}

function Interviews({ data, update, t }: any) {
  const [show, setShow] = useState(false)
  const [candidate, setCandidate] = useState(data.applicants[0]?.name ?? '')
  const [date, setDate] = useState('2026-09-30')
  const [time, setTime] = useState('10:00')
  const schedule = (e: FormEvent) => {
    e.preventDefault()
    const person = data.applicants.find((a: Applicant) => a.name === candidate)
    if (!person) return
    const interview = { id: Date.now(), candidate, role: person.role, date, time, mode: 'Video', notes: '', status: 'Confirmed' }
    update(
      (old: EmployerData) => ({
        ...old,
        interviews: [interview, ...old.interviews],
        applicants: old.applicants.map((a) => (a.name === candidate ? { ...a, status: 'Interview' } : a)),
        activities: [`Interview scheduled with ${candidate}`, ...old.activities],
      }),
      'Interview scheduled and dashboard updated'
    )
    setShow(false)
  }
  return (
    <>
      <Heading
        eyebrow="RECRUITMENT / INTERVIEWS"
        title={t('Interviews')}
        copy="Schedule conversations, record notes, and keep decisions current."
        action={
          <Button onClick={() => setShow(true)}>
            <Plus />
            {t('Schedule interview')}
          </Button>
        }
      />
      <div className="emp-list">
        {data.interviews.map((i: Interview) => (
          <article key={i.id}>
            <span className="emp-date">
              <b>{i.date.slice(-2)}</b>
              <small>{i.date.slice(5, 7)}</small>
            </span>
            <div>
              <h2>{i.candidate}</h2>
              <p>
                {i.role} · {i.time} · {i.mode}
              </p>
              <small>{i.notes || 'No interview notes yet.'}</small>
            </div>
            <Status value={i.status} t={t} />
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const notes = window.prompt('Add interview notes', i.notes)
                if (notes !== null)
                  update(
                    (old: EmployerData) => ({
                      ...old,
                      interviews: old.interviews.map((x) => (x.id === i.id ? { ...x, notes, status: 'Completed' } : x)),
                    }),
                    'Interview notes saved'
                  )
              }}
            >
              <Pencil />
              Notes
            </Button>
            <Button variant="ghost" size="icon" onClick={() => setShow(true)} aria-label="Reschedule">
              <CalendarDays />
            </Button>
          </article>
        ))}
      </div>
      {show && (
        <Modal title={t('Schedule interview')} close={() => setShow(false)}>
          <form className="emp-modal-form" onSubmit={schedule}>
            <Field label="Candidate">
              <select value={candidate} onChange={(e) => setCandidate(e.target.value)}>
                {data.applicants.map((a: Applicant) => (
                  <option key={a.id}>{a.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Date">
              <input type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Time">
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </Field>
            <Button type="submit">{t('Schedule interview')}</Button>
          </form>
        </Modal>
      )}
    </>
  )
}

function Placements({ data, counts, update, t }: any) {
  const candidates = data.applicants.filter((a: Applicant) => ['Offer', 'Placed', 'Interview'].includes(a.status))
  return (
    <>
      <Heading eyebrow="HIRING OUTCOMES" title={t('Selection & Placements')} copy="Manage offers, joining progress, and placement history." />
      <div className="emp-metrics compact">
        {[
          ['Offers', counts.offers, FileText],
          ['Joined', counts.placements, Handshake],
          ['Offer rate', pct(counts.offers, data.applicants.length), BarChart3],
          ['Placement rate', pct(counts.placements, data.applicants.length), Award],
        ].map(([l, v, I]: any) => (
          <button key={l}>
            <span>
              <I />
            </span>
            <div>
              <strong>{v}</strong>
              <small>{t(String(l))}</small>
            </div>
          </button>
        ))}
      </div>
      <div className="emp-list">
        {candidates.map((a: Applicant) => (
          <article key={a.id}>
            <i className="emp-initial">{initials(a.name)}</i>
            <div>
              <h2>{a.name}</h2>
              <p>{a.role}</p>
              <small>{a.institution}</small>
            </div>
            <Status value={a.status} t={t} />
            <Button
              onClick={() =>
                update(
                  (old: EmployerData) => ({
                    ...old,
                    applicants: old.applicants.map((x) => (x.id === a.id ? { ...x, status: a.status === 'Placed' ? 'Offer' : 'Placed' } : x)),
                    activities: [`${a.name} ${a.status === 'Placed' ? 'offer reopened' : 'marked as joined'}`, ...old.activities],
                  }),
                  a.status === 'Placed' ? 'Offer reopened' : 'Joining confirmed'
                )
              }
            >
              {a.status === 'Placed' ? 'Reopen offer' : 'Confirm joining'}
            </Button>
          </article>
        ))}
      </div>
    </>
  )
}

function Analytics({ data, counts, t }: { data: EmployerData; counts: any; t?: (k: string) => string }) {
  const funnel = [
    ['Shortlisting rate', pct(counts.shortlisted, counts.applicants)],
    ['Interview rate', pct(counts.interviews, counts.applicants)],
    ['Offer rate', pct(counts.offers, counts.applicants)],
    ['Placement rate', pct(counts.placements, counts.applicants)],
  ]
  return (
    <>
      <Heading eyebrow="RECRUITMENT INTELLIGENCE" title={t ? t('Analytics') : 'Analytics'} copy="Track hiring performance and identify skill demand." />
      <div className="emp-metrics compact">
        {[
          ['Jobs posted', data.jobs.length, BriefcaseBusiness],
          ['Applicants', counts.applicants, UsersRound],
          ...funnel.slice(0, 2).map((x, i) => [x[0], x[1], i ? CalendarDays : UserCheck]),
        ].map(([l, v, I]: any) => (
          <button key={l}>
            <span>
              <I />
            </span>
            <div>
              <strong>{v}</strong>
              <small>{t ? t(String(l)) : l}</small>
            </div>
          </button>
        ))}
      </div>
      <div className="emp-grid-two">
        <Panel title="Conversion rates" sub="Current applicant pipeline">
          <div className="emp-rate-list">
            {funnel.map(([l, v]) => (
              <div key={l}>
                <span>
                  {l}
                  <b>{v}</b>
                </span>
                <i>
                  <em style={{ width: v }} />
                </i>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Skill demand" sub="Skills listed in active jobs">
          <div className="emp-skills">
            {topJobSkills(data.jobs).map(([s, n]) => (
              <button key={s}>
                <span>
                  {s}
                  <b>{n} jobs</b>
                </span>
                <i>
                  <em style={{ width: `${Math.min(100, n * 34)}%` }} />
                </i>
              </button>
            ))}
          </div>
        </Panel>
      </div>
      <Panel title="Candidate match statistics">
        <div className="emp-distribution">
          {[
            ['90–100%', data.applicants.filter((a) => a.match >= 90).length],
            ['80–89%', data.applicants.filter((a) => a.match >= 80 && a.match < 90).length],
            ['70–79%', data.applicants.filter((a) => a.match >= 70 && a.match < 80).length],
            ['Below 70%', data.applicants.filter((a) => a.match < 70).length],
          ].map(([l, n]) => (
            <div key={l}>
              <b>{n}</b>
              <span>{l} match</span>
            </div>
          ))}
        </div>
      </Panel>
    </>
  )
}

function Assistant({ data, go, notify, t }: any) {
  const [prompt, setPrompt] = useState('')
  const [answer, setAnswer] = useState('Tell me what role or skill you are hiring for, and I will surface useful insights from your candidate pool.')
  const ask = () => {
    const q = prompt.toLowerCase()
    const best: Applicant | undefined = [...data.applicants].sort((a: Applicant, b: Applicant) => b.match - a.match)[0]
    setAnswer(
      q.includes('job description')
        ? 'Start with the impact of the role, list 3–5 essential skills, clarify work mode and provide a transparent salary range.'
        : q.includes('gap')
        ? 'The leading skill gaps are advanced MIS reporting, quality systems, and cooperative finance. Consider targeted training partnerships.'
        : best
        ? `Best current match: ${best.name} for ${best.role} at ${best.match}%. Verified strengths: ${best.skills.join(', ')}.`
        : 'No candidates are available yet.'
    )
    setPrompt('')
    notify('Recruitment insight generated')
  }
  return (
    <>
      <Heading eyebrow="NCCP INTELLIGENCE" title={t('AI Recruitment Assistant')} copy="Explore candidate matches, stronger job descriptions, and skill-gap insights." />
      <div className="emp-ai-layout">
        <section className="emp-ai-chat">
          <div className="emp-ai-answer">
            <Bot />
            <p>{answer}</p>
          </div>
          <div className="emp-ai-prompts">
            {['Find my best matching candidate', 'Help improve a job description', 'Show skill-gap insights'].map((q) => (
              <Button variant="outline" key={q} onClick={() => setPrompt(q)}>
                {q}
              </Button>
            ))}
          </div>
          <div className="emp-ai-input">
            <input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') ask()
              }}
              placeholder="Ask about candidates, skills, or jobs…"
            />
            <Button size="icon" onClick={ask} disabled={!prompt.trim()}>
              <Send />
            </Button>
          </div>
        </section>
        <Panel title="Recommended candidates">
          <div className="emp-recommend">
            {[...data.applicants]
              .sort((a: Applicant, b: Applicant) => b.match - a.match)
              .slice(0, 3)
              .map((a: Applicant) => (
                <button key={a.id} onClick={() => go('Candidate Matches')}>
                  <i>{initials(a.name)}</i>
                  <span>
                    <b>{a.name}</b>
                    <small>{a.skills.slice(0, 2).join(' · ')}</small>
                  </span>
                  <strong>{a.match}%</strong>
                </button>
              ))}
          </div>
        </Panel>
      </div>
    </>
  )
}

function Messages({ notify, t }: { notify: (s: string) => void; t?: (k: string) => string }) {
  const [thread, setThread] = useState('Ravi Kumar')
  const [text, setText] = useState('')
  const [messages, setMessages] = useState<Record<string, string[]>>({
    'Ravi Kumar': ['Thank you for shortlisting my application.', 'We would like to discuss your dairy operations experience.'],
    'Pooja Sharma': ['I am available for the interview tomorrow.'],
  })
  const send = () => {
    if (!text.trim()) return
    setMessages((m) => ({ ...m, [thread]: [...(m[thread] || []), text] }))
    setText('')
    notify('Message sent')
  }
  const activeMessages = messages[thread] ?? []
  return (
    <>
      <Heading eyebrow="COMMUNICATIONS" title={t ? t('Messages') : 'Messages'} copy="Stay connected with candidates throughout the hiring process." />
      <div className="emp-messages">
        <aside>
          {Object.keys(messages).map((n) => (
            <button className={thread === n ? 'active' : ''} key={n} onClick={() => setThread(n)}>
              <i>{initials(n)}</i>
              <span>
                <b>{n}</b>
                <small>Candidate conversation</small>
              </span>
            </button>
          ))}
        </aside>
        <section>
          <header>
            <b>{thread}</b>
            <Status value="Active" t={t} />
          </header>
          <div className="emp-chat">
            {activeMessages.map((m, i) => (
              <p className={i % 2 ? 'mine' : ''} key={`${m}-${i}`}>
                {m}
              </p>
            ))}
          </div>
          <footer>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') send()
              }}
              placeholder="Write a message…"
            />
            <Button size="icon" onClick={send}>
              <Send />
            </Button>
          </footer>
        </section>
      </div>
    </>
  )
}

function Company({ data, update, t }: any) {
  const [company, setCompany] = useState(data.company)
  return (
    <>
      <Heading eyebrow="EMPLOYER ACCOUNT" title={t('Company Profile')} copy="Keep your public employer identity accurate for candidates." />
      <form
        className="emp-form narrow"
        onSubmit={(e) => {
          e.preventDefault()
          update((old: EmployerData) => ({ ...old, company }), 'Company profile saved')
        }}
      >
        <div className="emp-logo-editor">
          <span>
            <Building2 />
          </span>
          <div>
            <b>Company logo</b>
            <small>NCCP verified organization</small>
          </div>
        </div>
        <div className="emp-form-grid">
          <Field label="Company name">
            <input value={company.name} onChange={(e) => setCompany({ ...company, name: e.target.value })} />
          </Field>
          <Field label="Sector">
            <input value={company.sector} onChange={(e) => setCompany({ ...company, sector: e.target.value })} />
          </Field>
          <Field label="Location">
            <input value={company.location} onChange={(e) => setCompany({ ...company, location: e.target.value })} />
          </Field>
          <Field label="Website">
            <input value={company.website} onChange={(e) => setCompany({ ...company, website: e.target.value })} />
          </Field>
          <Field label="About the company" wide>
            <textarea value={company.about} onChange={(e) => setCompany({ ...company, about: e.target.value })} />
          </Field>
        </div>
        <footer>
          <Button type="submit">{t('Save changes')}</Button>
        </footer>
      </form>
    </>
  )
}

function Notifications({ data, notify, t }: { data: EmployerData; notify: (s: string) => void; t?: (k: string) => string }) {
  return (
    <>
      <Heading eyebrow="EMPLOYER ACCOUNT" title={t ? t('Notifications') : 'Notifications'} copy="Review hiring activity and important updates." />
      <div className="emp-notifications">
        {data.activities.map((x, i) => (
          <button key={`${x}-${i}`} onClick={() => notify('Notification opened')}>
            <span>
              <Bell />
            </span>
            <div>
              <b>{x}</b>
              <small>{i === 0 ? 'Just now' : `${i + 1} hours ago`}</small>
            </div>
            <i />
          </button>
        ))}
      </div>
    </>
  )
}

function SettingsView({ notify, t }: { notify: (s: string) => void; t?: (k: string) => string }) {
  const [email, setEmail] = useState(true)
  const [matches, setMatches] = useState(true)
  const [digest, setDigest] = useState(false)
  return (
    <>
      <Heading eyebrow="EMPLOYER ACCOUNT" title={t ? t('Settings') : 'Settings'} copy="Control your recruitment preferences and notifications." />
      <Panel title="Notification preferences">
        <div className="emp-settings">
          {[
            ['Email application alerts', email, setEmail],
            ['Weekly candidate matches', matches, setMatches],
            ['Monthly hiring digest', digest, setDigest],
          ].map(([l, v, set]: any) => (
            <label key={l}>
              <span>
                <b>{l}</b>
                <small>Keep this update enabled for your recruitment team.</small>
              </span>
              <input type="checkbox" checked={v} onChange={(e) => set(e.target.checked)} />
            </label>
          ))}
          <Button onClick={() => notify('Settings saved')}>{t ? t('Save changes') : 'Save preferences'}</Button>
        </div>
      </Panel>
    </>
  )
}

function Help({ notify, t }: { notify: (s: string) => void; t?: (k: string) => string }) {
  return (
    <>
      <Heading eyebrow="SUPPORT" title={t ? t('Help & Support') : 'Help & Support'} copy="Find answers or contact the NCCP employer support team." />
      <div className="emp-help">
        {[
          ['Posting a job', 'Create, save, publish, pause, or close opportunities.'],
          ['Managing applicants', 'Review profiles and update candidate status at every step.'],
          ['Candidate matching', 'Use verified skills and training records to compare candidates.'],
          ['Placement reporting', 'Confirm joining to keep NCCP outcomes accurate.'],
        ].map(([title, content]) => (
          <details key={title}>
            <summary>
              {title}
              <ChevronDown />
            </summary>
            <p>{content}</p>
          </details>
        ))}
        <Button onClick={() => notify('Support request created')}>
          <Mail />
          Contact support
        </Button>
      </div>
    </>
  )
}

function Status({ value, t }: { value: string; t?: (k: string) => string }) {
  return <span className={`emp-status ${value.toLowerCase().replaceAll(' ', '-')}`}>{t ? t(value) : value}</span>
}

function Modal({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  return (
    <div className="emp-modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}>
      <section className="emp-modal" role="dialog" aria-modal="true">
        <header>
          <h2>{title}</h2>
          <Button variant="ghost" size="icon" onClick={close}>
            <X />
          </Button>
        </header>
        {children}
      </section>
    </div>
  )
}

function CandidateModal({
  candidate,
  onClose,
  onStatus,
  t,
}: {
  candidate: Applicant
  onClose: () => void
  onStatus: (s: ApplicantStatus) => void
  t?: (k: string) => string
}) {
  return (
    <Modal title="Candidate Profile" close={onClose}>
      <div className="emp-profile-head">
        <i>{initials(candidate.name)}</i>
        <div>
          <h2>{candidate.name}</h2>
          <p>
            {candidate.role} · {candidate.location}
          </p>
        </div>
        <strong>
          {candidate.match}%<small>match</small>
        </strong>
      </div>
      <div className="emp-profile-grid">
        <div>
          <span>Education</span>
          <b>{candidate.education}</b>
        </div>
        <div>
          <span>Assessment performance</span>
          <b>{candidate.score}%</b>
        </div>
        <div>
          <span>Skill Wallet</span>
          <b>{candidate.skills.join(', ')}</b>
        </div>
        <div>
          <span>Certificate</span>
          <b>{candidate.certification}</b>
        </div>
        <div>
          <span>Training</span>
          <b>{candidate.training}</b>
        </div>
        <div>
          <span>Institution</span>
          <b>{candidate.institution}</b>
        </div>
      </div>
      <footer className="emp-modal-actions">
        <Button variant="outline" onClick={() => onStatus('Rejected')}>
          {t ? t('Reject') : 'Reject'}
        </Button>
        <Button variant="outline" onClick={() => onStatus('Interview')}>
          Interview
        </Button>
        <Button onClick={() => onStatus('Offer')}>Make offer</Button>
      </footer>
    </Modal>
  )
}

function EditJob({ job, close, save, t }: { job: Job; close: () => void; save: (j: Job) => void; t?: (k: string) => string }) {
  const [draft, setDraft] = useState(job)
  return (
    <Modal title="Edit job" close={close}>
      <form
        className="emp-modal-form"
        onSubmit={(e) => {
          e.preventDefault()
          save(draft)
        }}
      >
        <Field label="Job title">
          <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
        </Field>
        <Field label="Openings">
          <input type="number" value={draft.openings} onChange={(e) => setDraft({ ...draft, openings: Number(e.target.value) })} />
        </Field>
        <Field label="Location">
          <input value={draft.location} onChange={(e) => setDraft({ ...draft, location: e.target.value })} />
        </Field>
        <Field label="Deadline">
          <input type="date" value={draft.deadline} onChange={(e) => setDraft({ ...draft, deadline: e.target.value })} />
        </Field>
        <Button type="submit">{t ? t('Save changes') : 'Save changes'}</Button>
      </form>
    </Modal>
  )
}

function topSkills(applicants: Applicant[]) {
  const map = new Map<string, number>()
  applicants.forEach((a) => a.skills.forEach((s) => map.set(s, (map.get(s) || 0) + 1)))
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
}

function topJobSkills(jobs: Job[]) {
  const map = new Map<string, number>()
  jobs
    .filter((j) => j.status === 'Active')
    .forEach((j) =>
      j.required
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach((s) => map.set(s, (map.get(s) || 0) + 1))
    )
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
}
