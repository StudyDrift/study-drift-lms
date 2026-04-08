import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { PermissionsProvider } from './context/PermissionsProvider'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <PermissionsProvider>
        <App />
      </PermissionsProvider>
    </BrowserRouter>
  </StrictMode>,
)
