import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/index.css'
import App from './App.jsx'
import ConfirmationProvider from './components/ui/ConfirmationProvider.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ConfirmationProvider><App /></ConfirmationProvider>
  </StrictMode>,
)
