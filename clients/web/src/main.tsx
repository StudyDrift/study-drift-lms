import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './app'
import { LmsToaster } from './components/lms-toaster'
import { PermissionsProvider } from './context/permissions-provider'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <PermissionsProvider>
        <App />
        <LmsToaster />
      </PermissionsProvider>
    </BrowserRouter>
  </StrictMode>,
)
