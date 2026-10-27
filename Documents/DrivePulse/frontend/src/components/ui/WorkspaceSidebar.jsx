import { useEffect } from 'react'

export default function WorkspaceSidebar({ open, onClose, className = '', children }) {
  useEffect(() => {
    if (!open) return
    const closeOnEscape = event => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [open, onClose])
  return <>
    {open && <button className="workspace-navigation-scrim" aria-label="Close navigation" onClick={onClose} />}
    <aside className={`${className} workspace-sidebar${open ? ' is-open' : ''}`}>{children}</aside>
  </>
}
