import { useRef, useEffect } from 'react'
import Icon from './Icon.jsx'

export default function Modal({ title, eyebrow, onClose, children, wide = false }) {
  const ref = useRef(null)
  useEffect(() => {
    const dialog = ref.current
    const previous = document.activeElement
    dialog.showModal()
    document.body.style.overflow = 'hidden'
    return () => {
      dialog.close()
      document.body.style.overflow = ''
      previous?.focus()
    }
  }, [])
  return <dialog ref={ref} className={`modal ${wide ? 'modal-wide' : ''}`} onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) onClose() }} aria-labelledby="modal-title">
    <div className="modal-inner">
      <header className="modal-header"><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h2 id="modal-title">{title}</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close dialog"><Icon name="close" /></button></header>
      {children}
    </div>
  </dialog>
}
