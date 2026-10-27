import { createContext } from 'react'

export const DraftOwnerContext = createContext(null)
export const ModalDraftContext = createContext(null)
export const FormDraftContext = createContext(null)
const memory = new Map()
export const draftKey = (owner, scope) => owner ? `drivepulse:draft:${owner}:${scope}` : null
export function readDraft(key, fallback) {
  if (!key) return fallback
  if (memory.has(key)) return memory.get(key)
  try { const saved = sessionStorage.getItem(key); return saved ? JSON.parse(saved) : fallback } catch { return fallback }
}
export function writeDraft(key, value) {
  if (!key) return
  memory.set(key, value)
  // File objects remain in memory for dialog reopen; their bytes are never put in web storage.
  try { sessionStorage.setItem(key, JSON.stringify(value, (_key, item) => typeof File !== 'undefined' && item instanceof File ? null : item)) } catch { /* The in-memory draft still protects dialog closes when storage is full. */ }
}
export function clearDraftScope(owner, scope) {
  const prefix = draftKey(owner, scope)
  if (!prefix) return
  for (const key of memory.keys()) if (key === prefix || key.startsWith(`${prefix}:`)) memory.delete(key)
  try { for (const key of Object.keys(sessionStorage)) if (key === prefix || key.startsWith(`${prefix}:`)) sessionStorage.removeItem(key) } catch { /* unavailable storage */ }
}
export function clearDrafts() {
  memory.clear()
  try { for (const key of Object.keys(sessionStorage)) if (key.startsWith('drivepulse:draft:')) sessionStorage.removeItem(key) } catch { /* unavailable storage */ }
}
