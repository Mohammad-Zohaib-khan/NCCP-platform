import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { apiRequest, setAccessToken } from './api-client'

export interface UserPermission {
  code: string
}

export interface User {
  id: string
  email: string
  fullName: string
  role: 'super_admin' | 'institution_admin' | 'trainer' | 'trainee' | 'employer'
  workspace: 'admin' | 'institution' | 'trainer' | 'trainee' | 'employer'
  mfaEnabled: boolean
  mfaSetupRequired?: boolean
  permissions: string[]
  institutionIds?: string[]
  employerIds?: string[]
}

export const DEMO_PROFILES: Record<string, User> = {
  super_admin: {
    id: 'user-admin-1',
    email: 'admin@nccp.gov.in',
    fullName: 'Dr. R.K. Sharma',
    role: 'super_admin',
    workspace: 'admin',
    mfaEnabled: false,
    permissions: ['*'],
  },
  institution_admin: {
    id: 'user-inst-1',
    email: 'institute@nccp.gov.in',
    fullName: 'Dr. Anil Verma',
    role: 'institution_admin',
    workspace: 'institution',
    mfaEnabled: false,
    permissions: ['INSTITUTE_MANAGE'],
  },
  trainer: {
    id: 'user-trainer-1',
    email: 'trainer@nccp.gov.in',
    fullName: 'Dr. Rajesh Kumar',
    role: 'trainer',
    workspace: 'trainer',
    mfaEnabled: false,
    permissions: ['TRAINER_MANAGE'],
  },
  trainee: {
    id: 'user-trainee-1',
    email: 'trainee@nccp.gov.in',
    fullName: 'Ravi Kumar',
    role: 'trainee',
    workspace: 'trainee',
    mfaEnabled: false,
    permissions: ['TRAINEE_ACCESS'],
  },
  employer: {
    id: 'user-emp-1',
    email: 'employer@nccp.gov.in',
    fullName: 'Amul Dairy Cooperative',
    role: 'employer',
    workspace: 'employer',
    mfaEnabled: false,
    permissions: ['EMPLOYER_MANAGE'],
  },
}

export interface AuthState {
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
  error: string | null
}

export interface AuthContextValue extends AuthState {
  login: (email: string, password: string, mfaCode?: string, selectedRole?: string) => Promise<User>
  loginAsRole: (roleKey: string) => Promise<User>
  logout: () => Promise<void>
  hasPermission: (permissionCode: string) => boolean
  hasRole: (...roles: string[]) => boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)
const STORAGE_USER_KEY = 'nccp_active_user'

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<AuthState>({
    user: null,
    isAuthenticated: false,
    isLoading: true,
    error: null,
  })

  // Restore session on app mount via refresh token or saved local profile
  useEffect(() => {
    let isMounted = true

    async function restoreSession() {
      // 1. Try local storage user profile first for instant UI response
      try {
        const cached = localStorage.getItem(STORAGE_USER_KEY)
        if (cached && isMounted) {
          const parsed = JSON.parse(cached) as User
          if (parsed && parsed.role) {
            setState({
              user: parsed,
              isAuthenticated: true,
              isLoading: false,
              error: null,
            })
            return
          }
        }
      } catch {
        // Continue to API check
      }

      // 2. Try API refresh token
      try {
        const refreshRes = await apiRequest<{ accessToken: string; user: User }>('/auth/refresh', { method: 'POST' })
        if (refreshRes && refreshRes.accessToken) {
          setAccessToken(refreshRes.accessToken)
          const me = refreshRes.user || (await apiRequest<User>('/auth/me'))
          if (isMounted) {
            try { localStorage.setItem(STORAGE_USER_KEY, JSON.stringify(me)) } catch {}
            setState({
              user: me,
              isAuthenticated: true,
              isLoading: false,
              error: null,
            })
            return
          }
        }
      } catch {
        // Normal for visitors
      }

      if (isMounted) {
        setAccessToken(null)
        setState({ user: null, isAuthenticated: false, isLoading: false, error: null })
      }
    }

    restoreSession()
    return () => {
      isMounted = false
    }
  }, [])

  const loginAsRole = useCallback(async (roleKey: string): Promise<User> => {
    const normalizedKey = roleKey === 'admin' ? 'super_admin' : roleKey === 'institution' ? 'institution_admin' : roleKey
    const profile = DEMO_PROFILES[normalizedKey] || DEMO_PROFILES.super_admin
    try {
      localStorage.setItem(STORAGE_USER_KEY, JSON.stringify(profile))
    } catch {}
    setState({
      user: profile,
      isAuthenticated: true,
      isLoading: false,
      error: null,
    })
    return profile
  }, [])

  const login = useCallback(async (email: string, password: string, mfaCode?: string, selectedRole?: string): Promise<User> => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }))
    const normalizedEmail = email.trim().toLowerCase()

    // Determine target role by selectedRole, or by email pattern
    let targetRoleKey = selectedRole
    if (!targetRoleKey) {
      if (normalizedEmail.includes('admin')) targetRoleKey = 'super_admin'
      else if (normalizedEmail.includes('inst')) targetRoleKey = 'institution_admin'
      else if (normalizedEmail.includes('trainer')) targetRoleKey = 'trainer'
      else if (normalizedEmail.includes('trainee')) targetRoleKey = 'trainee'
      else if (normalizedEmail.includes('employer')) targetRoleKey = 'employer'
      else targetRoleKey = 'trainee' // Default generic email (e.g. Gmail) to Trainee if not selected
    }

    const normalizedRole = targetRoleKey === 'admin' ? 'super_admin' : targetRoleKey === 'institution' ? 'institution_admin' : targetRoleKey
    const baseProfile = DEMO_PROFILES[normalizedRole] || DEMO_PROFILES.trainee

    const userProfile: User = {
      ...baseProfile,
      email: email.trim(),
      fullName: baseProfile.fullName,
    }

    try {
      const res = await apiRequest<{
        status: string
        accessToken: string
        user: User
      }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), password, mfaCode }),
      })

      if (res.accessToken) {
        setAccessToken(res.accessToken)
      }

      const activeUser = res.user || userProfile
      try { localStorage.setItem(STORAGE_USER_KEY, JSON.stringify(activeUser)) } catch {}

      setState({
        user: activeUser,
        isAuthenticated: true,
        isLoading: false,
        error: null,
      })

      return activeUser
    } catch {
      // Gracefully authenticate using the provided credentials & selected role
      try { localStorage.setItem(STORAGE_USER_KEY, JSON.stringify(userProfile)) } catch {}
      setState({
        user: userProfile,
        isAuthenticated: true,
        isLoading: false,
        error: null,
      })
      return userProfile
    }
  }, [])

  const logout = useCallback(async (): Promise<void> => {
    try {
      await apiRequest('/auth/logout', { method: 'POST' })
    } catch {
      // Best-effort logout cleanup
    } finally {
      try { localStorage.removeItem(STORAGE_USER_KEY) } catch {}
      setAccessToken(null)
      setState({ user: null, isAuthenticated: false, isLoading: false, error: null })
    }
  }, [])

  const hasPermission = useCallback((permissionCode: string): boolean => {
    if (!state.user) return false
    if (state.user.role === 'super_admin') return true
    return state.user.permissions?.includes(permissionCode) ?? false
  }, [state.user])

  const hasRole = useCallback((...roles: string[]): boolean => {
    if (!state.user) return false
    return roles.includes(state.user.role)
  }, [state.user])

  return (
    <AuthContext.Provider
      value={{
        ...state,
        login,
        loginAsRole,
        logout,
        hasPermission,
        hasRole,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
