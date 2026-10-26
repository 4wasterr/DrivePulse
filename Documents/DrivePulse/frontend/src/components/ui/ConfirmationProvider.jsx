import { useEffect, useRef, useState } from 'react'
import { registerConfirmationHandler } from '../../utils/confirmations.js'
import Modal from './Modal.jsx'

export default function ConfirmationProvider({ children }) {
  const [requests, setRequests] = useState([])
  const pending = useRef(new Set())
  useEffect(() => {
    const unregister = registerConfirmationHandler(prompt => new Promise(resolve => {
      const request = { ...prompt, resolve }
      pending.current.add(request)
      setRequests(items => [...items, request])
    }))
    const active = pending.current
    return () => { unregister(); active.forEach(item => item.resolve(false)); active.clear() }
  }, [])
  const request = requests[0]
  const finish = accepted => {
    pending.current.delete(request)
    setRequests(items => items.slice(1))
    request.resolve(accepted)
  }
  return <>{children}{request && <Modal title={request.title} eyebrow="CONFIRM ACTION" onClose={() => finish(false)}>
    <p className="confirmation-message">{request.message}</p>
    <div className="confirmation-actions"><button type="button" data-initial-focus className="button button-outline" onClick={() => finish(false)}>Cancel</button><button type="button" className={`button ${request.destructive ? 'button-danger' : 'button-dark'}`} onClick={() => finish(true)}>{request.confirmLabel}</button></div>
  </Modal>}</>
}
