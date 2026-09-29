import React, { useState } from 'react'
import { useAuth } from '../lib/auth-context'
import { useI18n } from '../lib/i18n-context'
import {
  LogIn,
  ShieldCheck,
  Globe,
  Loader2,
  AlertCircle,
  Building2,
  Lock,
  Mail,
  ArrowLeft,
  ArrowRight,
  Eye,
  EyeOff,
  UserCheck,
} from 'lucide-react'
import asset05 from '@/assets/nccp/05_landing_logo_brand.png'

const ROLES = [
  { id: 'admin', label: 'NCCT Super Admin', hindiLabel: 'एनसीटीसी सुपर एडमिन' },
  { id: 'institution', label: 'Institution Administrator', hindiLabel: 'संस्थान प्रशासक' },
  { id: 'trainer', label: 'Trainer', hindiLabel: 'प्रशिक्षक' },
  { id: 'trainee', label: 'Trainee / Rural Youth', hindiLabel: 'प्रशिक्षु / ग्रामीण युवा' },
  { id: 'employer', label: 'Employer / Recruiter', hindiLabel: 'नियोक्ता / भर्तीकर्ता' },
]

export const LoginView: React.FC<{
  onSuccess?: () => void
  onBack?: () => void
  onDemoPreview?: (role: string) => void
}> = ({ onSuccess, onBack, onDemoPreview }) => {
  const { login, isLoading, error } = useAuth()
  const { language, setLanguage, t } = useI18n()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('admin')
  const [showPassword, setShowPassword] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLocalError(null)

    if (!email.trim()) {
      setLocalError(language === 'hi' ? 'कृपया अपना ईमेल या जीमेल दर्ज करें' : 'Please enter your email or Gmail address')
      return
    }

    if (!password.trim()) {
      setLocalError(language === 'hi' ? 'कृपया अपना पासवर्ड दर्ज करें' : 'Please enter your password')
      return
    }

    try {
      await login(email.trim(), password, undefined, role)
      if (onDemoPreview) onDemoPreview(role)
      if (onSuccess) onSuccess()
    } catch (err: unknown) {
      setLocalError(err instanceof Error ? err.message : 'Sign in failed')
    }
  }

  return (
    <div className="min-h-screen w-full bg-[#031d17] text-slate-100 flex flex-col justify-between relative overflow-hidden font-sans">
      {/* Background Ambience */}
      <div className="absolute -top-40 -left-40 w-96 h-96 bg-emerald-600/15 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />

      {/* Official Government Header */}
      <header className="w-full bg-[#011410]/80 border-b border-emerald-900/40 backdrop-blur-md z-10">
        <div className="max-w-7xl mx-auto px-6 py-3 flex justify-between items-center">
          <div className="flex items-center space-x-3">
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                className="mr-2 px-3 py-1.5 rounded-lg bg-emerald-950/60 border border-emerald-800/60 text-emerald-200 hover:text-white hover:bg-emerald-900/60 text-xs font-medium flex items-center gap-1.5 transition-all"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>{language === 'hi' ? 'होम पेज' : 'Back to Home'}</span>
              </button>
            )}
            <img src={asset05} alt="NCCP" className="w-9 h-9 object-contain" />
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold tracking-tight text-white">NCCP</span>
                <span className="text-[11px] px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 font-medium">
                  {language === 'hi' ? 'सहकारिता मंत्रालय' : 'Ministry of Cooperation'}
                </span>
              </div>
              <p className="text-[11px] text-emerald-200/70">
                {language === 'hi' ? 'भारत सरकार • राष्ट्रीय सहकारी क्षमता निर्माण मंच' : 'Govt. of India • National Cooperative Capacity Building Platform'}
              </p>
            </div>
          </div>

          {/* Language Selector */}
          <div className="flex items-center space-x-1.5 bg-[#05261f] border border-emerald-800/50 rounded-full p-1 shadow-inner">
            <Globe className="w-3.5 h-3.5 text-emerald-400 ml-2" />
            <button
              type="button"
              onClick={() => setLanguage('en')}
              className={`px-3 py-1 text-xs font-semibold rounded-full transition-all ${
                language === 'en' ? 'bg-emerald-600 text-white shadow-md' : 'text-emerald-300 hover:text-white'
              }`}
            >
              English
            </button>
            <button
              type="button"
              onClick={() => setLanguage('hi')}
              className={`px-3 py-1 text-xs font-semibold rounded-full transition-all ${
                language === 'hi' ? 'bg-amber-600 text-white shadow-md' : 'text-emerald-300 hover:text-white'
              }`}
            >
              हिंदी
            </button>
          </div>
        </div>
      </header>

      {/* Main Login Portal */}
      <main className="flex-1 flex items-center justify-center p-6 z-10">
        <div className="w-full max-w-md bg-[#05261f]/95 backdrop-blur-xl border border-emerald-800/60 rounded-3xl p-8 shadow-2xl shadow-black/60 relative">
          
          {/* Emblem & Title */}
          <div className="text-center mb-6">
            <div className="w-13 h-13 mx-auto mb-2 rounded-2xl bg-gradient-to-tr from-emerald-600 to-amber-500 p-0.5 shadow-lg shadow-emerald-900/50">
              <div className="w-full h-full bg-[#041e18] rounded-[14px] flex items-center justify-center">
                <Building2 className="w-6 h-6 text-amber-400" />
              </div>
            </div>
            <h2 className="text-2xl font-bold text-white tracking-tight">
              {language === 'hi' ? 'पोर्टल में साइन इन करें' : 'Sign In to Portal'}
            </h2>
            <p className="text-xs text-emerald-300/80 mt-1">
              {language === 'hi' ? 'अपने क्रेडेंशियल दर्ज करें और डैशबोर्ड चुनें' : 'Enter your email & password to access your dashboard'}
            </p>
          </div>

          {(error || localError) && (
            <div className="mb-5 p-3.5 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-start space-x-3">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-rose-400" />
              <div>
                <p className="font-semibold text-rose-200">{language === 'hi' ? 'त्रुटि' : 'Notice'}</p>
                <p className="text-[11px] text-rose-300/90 mt-0.5">{error || localError}</p>
              </div>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-emerald-200 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5 text-emerald-400" />
                <span>{language === 'hi' ? 'ईमेल या जीमेल' : 'Email Address / Gmail'}</span>
              </label>
              <input
                type="text"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@gmail.com / name@nccp.gov.in"
                className="w-full px-4 py-2.5 bg-[#02130f]/80 border border-emerald-900/80 rounded-xl text-white placeholder-emerald-700/60 focus:outline-none focus:ring-2 focus:ring-amber-500/70 text-xs"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-emerald-200 uppercase tracking-wider mb-1.5 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-emerald-400" />
                  <span>{language === 'hi' ? 'पासवर्ड' : 'Password'}</span>
                </span>
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="text-[11px] text-emerald-400 hover:text-amber-300 flex items-center gap-1"
                >
                  {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  <span>{showPassword ? (language === 'hi' ? 'छिपाएं' : 'Hide') : (language === 'hi' ? 'दिखाएं' : 'Show')}</span>
                </button>
              </label>
              <input
                type={showPassword ? 'text' : 'password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full px-4 py-2.5 bg-[#02130f]/80 border border-emerald-900/80 rounded-xl text-white placeholder-emerald-700/60 focus:outline-none focus:ring-2 focus:ring-amber-500/70 text-xs"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-emerald-200 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                <UserCheck className="w-3.5 h-3.5 text-amber-400" />
                <span>{language === 'hi' ? 'डैशबोर्ड प्रोफ़ाइल का चयन करें' : 'Select Dashboard Profile'}</span>
              </label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-[#02130f]/90 border border-emerald-900/80 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-amber-500/70 text-xs cursor-pointer"
              >
                {ROLES.map((r) => (
                  <option key={r.id} value={r.id} className="bg-[#041e18] text-white">
                    {language === 'hi' ? r.hindiLabel : r.label}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full mt-4 py-3 px-4 bg-gradient-to-r from-emerald-600 via-emerald-500 to-amber-600 hover:from-emerald-500 hover:to-amber-500 text-white font-semibold rounded-xl shadow-lg transition-all flex items-center justify-center space-x-2 text-xs disabled:opacity-50"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{language === 'hi' ? 'सत्यापित किया जा रहा है...' : 'Verifying Credentials...'}</span>
                </>
              ) : (
                <>
                  <LogIn className="w-4 h-4" />
                  <span>{language === 'hi' ? 'साइन इन करें' : 'Sign In to Portal'}</span>
                  <ArrowRight className="w-3.5 h-3.5 ml-1" />
                </>
              )}
            </button>
          </form>

          {/* Security Note */}
          <div className="mt-5 pt-4 border-t border-emerald-900/50 flex items-center gap-2 text-[11px] text-emerald-300/70">
            <ShieldCheck className="w-4 h-4 text-amber-400 flex-shrink-0" />
            <span>
              {language === 'hi'
                ? 'सुरक्षित राष्ट्रीय पोर्टल • भूमिका आधारित अभिगम नियंत्रण (RBAC) सक्रिय'
                : 'Protected National Portal • Role-Based Access Control (RBAC) Active'}
            </span>
          </div>
        </div>
      </main>

      {/* Official Footer */}
      <footer className="w-full bg-[#011410] border-t border-emerald-900/40 p-3 text-center text-[11px] text-emerald-400/60 z-10">
        <p>
          {language === 'hi'
            ? '© 2026 राष्ट्रीय सहकारी विकास निगम (NCDC) • सहकारिता मंत्रालय, भारत सरकार'
            : '© 2026 National Cooperative Development Corporation (NCDC) • Ministry of Cooperation, Government of India'}
        </p>
      </footer>
    </div>
  )
}
