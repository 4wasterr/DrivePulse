import { useContext, useState } from 'react'
import { DraftOwnerContext, draftKey, readDraft, writeDraft } from '../utils/drafts.js'

export default function useDraftState(scope, name, initial) {
  const owner = useContext(DraftOwnerContext)
  const key = draftKey(owner, `${scope}:${name}`)
  const [value, setValue] = useState(() => readDraft(key, typeof initial === 'function' ? initial() : initial))
  function update(next) {
    setValue(previous => {
      const value = typeof next === 'function' ? next(previous) : next
      writeDraft(key, value)
      return value
    })
  }
  return [value, update]
}
