import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { getAccessToken } from '../lib/auth'

export function RequireAuth() {
  const location = useLocation()
  if (!getAccessToken()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  return <Outlet />
}
