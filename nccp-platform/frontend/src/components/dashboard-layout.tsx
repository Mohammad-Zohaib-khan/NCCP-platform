import React from 'react'
import { useAuth } from '../lib/auth-context'
import AdminDashboard from './nccp/AdminDashboard'
import InstituteDashboard from './nccp/InstituteDashboard'
import TrainerWorkspace from './nccp/TrainerWorkspace'
import TraineeWorkspace from './nccp/TraineeWorkspace'
import EmployerWorkspace from './nccp/EmployerWorkspace'

export const DashboardLayout: React.FC = () => {
  const { user, logout } = useAuth()

  if (!user) return null

  const currentRole = user.role

  const renderDashboard = () => {
    if (currentRole === 'super_admin' || currentRole === ('admin' as any)) {
      return <AdminDashboard onLogout={() => logout()} />
    }
    if (currentRole === 'institution_admin' || currentRole === ('institution' as any)) {
      return <InstituteDashboard onLogout={() => logout()} />
    }
    if (currentRole === 'trainer') {
      return <TrainerWorkspace onLogout={() => logout()} />
    }
    if (currentRole === 'trainee') {
      return <TraineeWorkspace onLogout={() => logout()} />
    }
    if (currentRole === 'employer') {
      return <EmployerWorkspace onLogout={() => logout()} />
    }
    return <AdminDashboard onLogout={() => logout()} />
  }

  return (
    <div className="relative min-h-screen">
      {renderDashboard()}
    </div>
  )
}
