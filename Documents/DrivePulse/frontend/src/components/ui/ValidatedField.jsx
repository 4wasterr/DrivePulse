import { useContext, useId, useState } from 'react'
import { FormDraftContext, readDraft, writeDraft } from '../../utils/drafts.js'
import { FormValidationContext } from './formValidationContext.js'

export function FieldError({ fieldId, compact = false }) {
  const errors = useContext(FormValidationContext)
  if (errors === null) return null
  const error = errors.find(error => error.field.id === fieldId)
  if (compact && !error) return null
  return <span id={`${fieldId}-error`} className='field-validation-message' data-empty={!error} aria-hidden={!error || undefined} aria-live="polite">{error?.message || '\u00a0'}</span>
}

export default function ValidatedField({ as: Control = 'input', feedback = true, children, ...props }) {
  const errors = useContext(FormValidationContext)
  const draft = useContext(FormDraftContext)
  const [index] = useState(() => draft?.nextIndex() ?? 0)
  const fieldKey = draft?.key ? `${draft.key}:${props.name || props.id || `field-${index}`}` : null
  const saved = readDraft(fieldKey, undefined)
  const persist = event => {
    if (props.type !== 'password' && !props.readOnly && props.type !== 'file') writeDraft(fieldKey, ['checkbox', 'radio'].includes(props.type) ? event.target.checked : event.target.value)
    props.onChange?.(event)
  }
  const defaults = props.value === undefined && props.checked === undefined && saved !== undefined && props.type !== 'file' ? (['checkbox', 'radio'].includes(props.type) ? { defaultChecked: saved } : { defaultValue: saved }) : {}
  const generatedId = useId()
  const id = props.id || generatedId
  const error = errors?.find(error => error.field.id === id)
  const describedBy = [props['aria-describedby'], error && `${id}-error`].filter(Boolean).join(' ')
  const compact = ['checkbox', 'radio'].includes(props.type) || props.className?.includes('sr-only')
  const password = props.type === 'password' || props['data-sensitive'] === 'password'
  const protectClipboard = event => event.preventDefault()
  return <>
    <Control {...props} {...defaults} onChange={persist} placeholder={props.type === 'tel' ? '+63 9XX XXX XXXX' : props.placeholder || (password ? 'Enter your password' : undefined)} onCopy={password ? protectClipboard : props.onCopy} onCut={password ? protectClipboard : props.onCut} onPaste={password ? protectClipboard : props.onPaste} id={id} aria-label={props['aria-label'] || error?.label} aria-invalid={error ? true : props['aria-invalid']} aria-describedby={describedBy || undefined} data-validation-error={error ? 'true' : undefined}>{children}</Control>
    {feedback && <FieldError fieldId={id} compact={compact} />}
  </>
}
