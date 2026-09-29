import React, { useState, useEffect } from 'react'
import {
  CheckCircle2,
  QrCode,
  Sparkles,
  UsersRound,
  GraduationCap,
  CalendarDays,
  ShieldCheck,
  Clock,
  ArrowRight,
  UserCheck,
  Building2,
  RefreshCw,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import brand from '@/assets/nccp/10_institution_logo_brand.png'
import {
  ATTENDANCE_SYSTEM_NAME,
  getActiveSession,
  getRegisteredTrainees,
  recordAttendance,
  RegisteredTrainee,
} from '@/lib/attendance-sync'

interface MobileAttendanceCheckInProps {
  onBackToPlatform?: () => void
}

export const MobileAttendanceCheckIn: React.FC<MobileAttendanceCheckInProps> = ({
  onBackToPlatform,
}) => {
  // Read params from current URL
  const [params, setParams] = useState<{
    token: string
    batch: string
    course: string
    trainer: string
    date: string
  }>({
    token: '',
    batch: '',
    course: '',
    trainer: '',
    date: '',
  })

  const [trainees, setTrainees] = useState<RegisteredTrainee[]>([])
  const [selectedTrainee, setSelectedTrainee] = useState<string>('')
  const [customName, setCustomName] = useState<string>('')
  const [traineeEmail, setTraineeEmail] = useState<string>('')
  const [isCustom, setIsCustom] = useState<boolean>(false)
  const [submitting, setSubmitting] = useState<boolean>(false)
  const [success, setSuccess] = useState<boolean>(false)
  const [successData, setSuccessData] = useState<{
    name: string
    time: string
    batch: string
    course: string
  } | null>(null)
  const [currentTime, setCurrentTime] = useState<string>('')

  // Parse query params and active session on load
  useEffect(() => {
    const search = new URLSearchParams(window.location.search)
    const token = search.get('token') || ''
    const batch = search.get('batch') || ''
    const course = search.get('course') || ''
    const trainer = search.get('trainer') || ''
    const date = search.get('date') || ''

    // If params are present in URL, use them. Otherwise fallback to active session from localStorage
    const active = getActiveSession()
    setParams({
      token: token || active?.token || 'NCCP-DCM-8921',
      batch: batch || active?.batch || 'DCM-2026-04',
      course: course || active?.course || 'Dairy Cooperative Management',
      trainer: trainer || active?.trainer || 'Dr. Rajesh Kumar',
      date: date || active?.date || new Date().toISOString().slice(0, 10),
    })

    const list = getRegisteredTrainees()
    setTrainees(list)
    if (list.length > 0) {
      setSelectedTrainee(list[0].name)
      setTraineeEmail(list[0].email)
    }

    const timer = setInterval(() => {
      setCurrentTime(
        new Date().toLocaleTimeString('en-IN', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true,
        })
      )
    }, 1000)
    setCurrentTime(
      new Date().toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      })
    )

    return () => clearInterval(timer)
  }, [])

  const handleSelectTrainee = (trainee: RegisteredTrainee) => {
    setIsCustom(false)
    setSelectedTrainee(trainee.name)
    setTraineeEmail(trainee.email)
  }

  const handleMarkPresent = async () => {
    const finalName = isCustom ? customName.trim() : selectedTrainee.trim()
    if (!finalName) {
      alert('Please select or enter your Trainee name.')
      return
    }

    setSubmitting(true)
    const timeFormatted = new Date().toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    })

    await recordAttendance({
      traineeName: finalName,
      traineeEmail,
      batchCode: params.batch,
      courseName: params.course,
      date: params.date,
      time: timeFormatted,
      method: 'Mobile QR Scan',
      token: params.token,
      systemName: ATTENDANCE_SYSTEM_NAME,
      status: 'Present',
      source: 'mobile_qr',
    })

    setSubmitting(false)
    setSuccess(true)
    setSuccessData({
      name: finalName,
      time: timeFormatted,
      batch: params.batch,
      course: params.course,
    })
  }

  const handleResetForAnother = () => {
    setSuccess(false)
    setSuccessData(null)
    setIsCustom(false)
    setCustomName('')
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-950 via-emerald-900 to-slate-900 text-slate-100 flex flex-col justify-between p-4 sm:p-6 md:p-10 font-sans">
      {/* Top Header / Ministry Badge */}
      <header className="max-w-md mx-auto w-full flex items-center justify-between pb-4 border-b border-emerald-800/40">
        <div className="flex items-center gap-3">
          <img src={brand} alt="NCCP Emblem" className="h-10 w-auto rounded-lg shadow-sm bg-white/10 p-1" />
          <div>
            <span className="text-[10px] tracking-widest uppercase font-semibold text-amber-300 block">
              Ministry of Cooperation · Govt. of India
            </span>
            <h1 className="text-base font-bold text-white tracking-tight leading-tight">
              {ATTENDANCE_SYSTEM_NAME}
            </h1>
          </div>
        </div>

        {onBackToPlatform && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onBackToPlatform}
            className="text-xs text-emerald-200 hover:text-white hover:bg-emerald-800/60"
          >
            Portal Home
          </Button>
        )}
      </header>

      {/* Main Card */}
      <main className="max-w-md mx-auto w-full my-auto py-6">
        {success && successData ? (
          <div className="bg-white rounded-3xl p-6 sm:p-8 shadow-2xl text-slate-800 text-center animate-in fade-in zoom-in duration-300 border-4 border-emerald-500/30">
            <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4 border-4 border-emerald-500 shadow-inner">
              <CheckCircle2 size={44} className="text-emerald-700 animate-bounce" />
            </div>

            <span className="inline-block px-3 py-1 rounded-full bg-emerald-50 text-emerald-800 text-xs font-bold uppercase tracking-wider mb-2 border border-emerald-200">
              Verified Attendance Check-In
            </span>

            <h2 className="text-2xl font-black text-emerald-950 mb-1">Attendance Marked!</h2>
            <p className="text-xs text-slate-600 mb-6">
              Your status is now <strong>PRESENT</strong> and synced directly with your Trainer's Dashboard in real time.
            </p>

            {/* Attendance Confirmation Details */}
            <div className="bg-emerald-50/70 rounded-2xl p-4 text-left border border-emerald-200 mb-6 space-y-2.5 text-xs">
              <div className="flex justify-between items-center pb-2 border-b border-emerald-200/60">
                <span className="text-slate-500 font-medium">Trainee Name:</span>
                <strong className="text-sm font-bold text-emerald-950">{successData.name}</strong>
              </div>
              <div className="flex justify-between items-center pb-2 border-b border-emerald-200/60">
                <span className="text-slate-500 font-medium">Attendance System:</span>
                <strong className="text-emerald-900 font-semibold">{ATTENDANCE_SYSTEM_NAME}</strong>
              </div>
              <div className="flex justify-between items-center pb-2 border-b border-emerald-200/60">
                <span className="text-slate-500 font-medium">Programme / Course:</span>
                <span className="text-slate-800 font-medium text-right">{successData.course}</span>
              </div>
              <div className="flex justify-between items-center pb-2 border-b border-emerald-200/60">
                <span className="text-slate-500 font-medium">Batch Code:</span>
                <span className="font-mono font-bold text-emerald-900 bg-white px-2 py-0.5 rounded border border-emerald-300">
                  {successData.batch}
                </span>
              </div>
              <div className="flex justify-between items-center pb-2 border-b border-emerald-200/60">
                <span className="text-slate-500 font-medium">Check-In Time:</span>
                <span className="text-slate-800 font-medium">{successData.time} (Today)</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500 font-medium">Session Token:</span>
                <span className="font-mono text-emerald-800 font-bold">{params.token}</span>
              </div>
            </div>

            <div className="space-y-3">
              <Button
                className="w-full bg-emerald-800 hover:bg-emerald-900 text-white font-semibold py-3 rounded-xl shadow-lg shadow-emerald-900/20"
                onClick={handleResetForAnother}
              >
                <UserCheck size={16} className="mr-2" /> Mark Attendance for Another Trainee
              </Button>

              {onBackToPlatform ? (
                <Button
                  variant="outline"
                  className="w-full border-slate-300 text-slate-700 hover:bg-slate-50 rounded-xl"
                  onClick={onBackToPlatform}
                >
                  Return to NCCP Main Platform
                </Button>
              ) : (
                <Button
                  variant="outline"
                  className="w-full border-slate-300 text-slate-700 hover:bg-slate-50 rounded-xl"
                  onClick={() => {
                    window.location.href = '/'
                  }}
                >
                  Go to NCCP Workspace Portal
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-3xl p-6 sm:p-7 shadow-2xl text-slate-800 border border-emerald-500/20">
            {/* Live session banner */}
            <div className="bg-gradient-to-r from-emerald-900 to-emerald-950 text-white rounded-2xl p-4 mb-5 shadow-md relative overflow-hidden">
              <div className="absolute right-[-10px] top-[-10px] opacity-10">
                <QrCode size={110} />
              </div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                  </span>
                  <span className="text-xs font-bold uppercase tracking-wider text-emerald-300">
                    Live Session Active
                  </span>
                </div>
                <div className="text-[11px] font-mono text-emerald-200 flex items-center gap-1 bg-white/10 px-2 py-0.5 rounded-full">
                  <Clock size={12} />
                  <span>{currentTime || 'Live'}</span>
                </div>
              </div>

              <h2 className="text-lg font-bold text-white mb-0.5">{params.course}</h2>
              <p className="text-xs text-emerald-200">
                Batch: <strong>{params.batch}</strong> · Trainer: <strong>{params.trainer}</strong>
              </p>

              <div className="mt-3 pt-2.5 border-t border-white/15 flex items-center justify-between text-xs">
                <span className="text-emerald-300 font-medium">Session Token:</span>
                <span className="font-mono font-black text-amber-300 bg-white/10 px-2 py-0.5 rounded tracking-wider">
                  {params.token}
                </span>
              </div>
            </div>

            {/* Instruction */}
            <div className="mb-4">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-2 flex items-center justify-between">
                <span>Select Your Name to Put Present</span>
                <span className="text-[10px] font-normal lowercase text-emerald-700">tap your name below</span>
              </label>

              {/* Trainee Quick Selection List */}
              <div className="grid grid-cols-1 gap-2 max-h-48 overflow-y-auto pr-1 mb-3">
                {trainees
                  .filter((t) => !params.batch || t.batch === params.batch || t.batch.startsWith('DCM'))
                  .map((t) => {
                    const isSelected = !isCustom && selectedTrainee === t.name
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => handleSelectTrainee(t)}
                        className={`text-left p-3 rounded-xl border text-xs transition-all flex items-center justify-between ${
                          isSelected
                            ? 'bg-emerald-50 border-emerald-600 ring-2 ring-emerald-600/20 text-emerald-950 font-bold shadow-sm'
                            : 'bg-slate-50 border-slate-200 text-slate-700 hover:border-emerald-300 hover:bg-emerald-50/50'
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <div
                            className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-[11px] ${
                              isSelected ? 'bg-emerald-700 text-white' : 'bg-slate-200 text-slate-700'
                            }`}
                          >
                            {t.name
                              .split(' ')
                              .map((n) => n[0])
                              .join('')
                              .slice(0, 2)}
                          </div>
                          <div>
                            <p className="font-semibold">{t.name}</p>
                            <p className="text-[10px] text-slate-500 font-normal">
                              {t.id} · {t.batch}
                            </p>
                          </div>
                        </div>

                        {isSelected && <CheckCircle2 size={18} className="text-emerald-700 shrink-0" />}
                      </button>
                    )
                  })}
              </div>

              {/* Or Enter Custom Name */}
              <div className="pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsCustom(!isCustom)}
                  className="text-xs text-emerald-800 font-semibold hover:underline mb-2 block"
                >
                  {isCustom ? '← Back to Enrolled Trainee List' : '+ Other Trainee? Enter Name Manually'}
                </button>

                {isCustom && (
                  <div className="space-y-2 bg-slate-50 p-3 rounded-xl border border-slate-200">
                    <input
                      type="text"
                      value={customName}
                      onChange={(e) => setCustomName(e.target.value)}
                      placeholder="Enter Full Name (e.g. Ramesh Kumar)"
                      className="w-full text-xs p-2.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-600 font-medium"
                      autoFocus
                    />
                    <input
                      type="email"
                      value={traineeEmail}
                      onChange={(e) => setTraineeEmail(e.target.value)}
                      placeholder="Email or Mobile (optional)"
                      className="w-full text-xs p-2.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Attendance System Info Badge */}
            <div className="bg-amber-50 rounded-xl p-3 border border-amber-200 text-[11px] text-amber-900 mb-5 flex items-start gap-2">
              <Sparkles size={15} className="text-amber-700 shrink-0 mt-0.5" />
              <div>
                <strong>{ATTENDANCE_SYSTEM_NAME}:</strong> Marking present will instantly log your name in Dr. Rajesh Kumar’s Trainer Dashboard and attendance totals.
              </div>
            </div>

            {/* Submit Button */}
            <Button
              className="w-full bg-emerald-700 hover:bg-emerald-800 text-white font-bold py-3.5 rounded-xl shadow-lg shadow-emerald-800/25 text-sm flex items-center justify-center gap-2 disabled:opacity-50"
              onClick={handleMarkPresent}
              disabled={submitting || (!isCustom && !selectedTrainee) || (isCustom && !customName.trim())}
            >
              {submitting ? (
                <>
                  <RefreshCw size={16} className="animate-spin" /> Recording Presence...
                </>
              ) : (
                <>
                  <CheckCircle2 size={18} /> Put Present (
                  {isCustom ? customName || 'Trainee' : selectedTrainee})
                </>
              )}
            </Button>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="max-w-md mx-auto w-full text-center text-emerald-400/80 text-[11px] pt-4 border-t border-emerald-800/40">
        <p className="font-semibold text-emerald-300">National Cooperative Capacity Building Platform (NCCP)</p>
        <p className="text-[10px] text-emerald-500/90 mt-0.5">
          Sahakar Se Samriddhi · Secure QR Mobile Attendance Verification
        </p>
      </footer>
    </div>
  )
}
