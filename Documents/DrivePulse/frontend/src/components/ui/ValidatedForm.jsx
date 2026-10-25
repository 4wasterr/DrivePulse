import { useId, useRef, useState } from 'react'
import { inputError } from '../../../../shared/validation.mjs'
import { rentalPeriodError } from '../../data.js'
import { validateFile } from '../../storage.js'
import { validPassword } from '../../utils/password.js'
import { FormValidationContext } from './formValidationContext.js'

const controls = form => [...form.elements].filter(field => ['INPUT', 'SELECT', 'TEXTAREA'].includes(field.tagName) && !field.matches(':disabled') && !['hidden', 'submit', 'button', 'reset', 'range'].includes(field.type) && !field.readOnly)

function fieldLabel(field) {
  if (field.getAttribute('aria-label')) return field.getAttribute('aria-label')
  const label = field.labels?.[0]?.cloneNode(true)
  label?.querySelectorAll('input,select,textarea,button,.field-optional,.field-validation-message').forEach(element => element.remove())
  return label?.textContent.trim().replace(/\s+/g, ' ').slice(0, 100) || field.name || 'This field'
}

function controlError(field, form, submitter) {
  const label = fieldLabel(field)
  const required = field.required || field.dataset.requiredFor?.split(' ').includes(submitter?.value)
  if (field.type === 'checkbox' || field.type === 'radio') {
    const checked = field.checked || field.type === 'radio' && field.name && [...form.elements].some(other => other.type === 'radio' && other.name === field.name && other.checked)
    return required && !checked ? 'Please confirm this item to continue.' : ''
  }
  if (field.type === 'file') {
    if (!field.files?.length) return required ? 'Please choose a file.' : ''
    for (const file of field.files) {
      const error = validateFile(file)
      if (error) return error
      if (field.accept && !field.accept.split(',').map(item => item.trim()).includes(file.type)) return 'Choose a JPG, PNG or WebP image.'
    }
    return ''
  }
  if (field.validity.badInput) return 'Enter a complete, valid value.'
  const kind = field.dataset.validate || (['password', 'confirm'].includes(field.name) ? 'password' : field.name === 'name' ? 'name' : field.name === 'reference' ? 'reference' : field.type === 'tel' ? 'phone' : ['email', 'number', 'date', 'time'].includes(field.type) ? field.type : 'text')
  const error = inputError(field.value, {
    kind, label, required,
    maxLength: field.maxLength > 0 ? field.maxLength : field.type === 'email' ? 160 : 2000,
    minLength: field.minLength > 0 ? field.minLength : 0,
    min: field.getAttribute('min'), max: field.getAttribute('max'),
    step: kind === 'number' ? field.getAttribute('step') || '1' : undefined,
  })
  if (error) return error
  if (field.name === 'confirm' && field.value !== form.elements.namedItem('password')?.value) return 'The passwords do not match.'
  if (field.name === 'password' && field.autocomplete === 'new-password') {
    if (!validPassword(field.value)) return 'Use 8–128 characters with uppercase, lowercase, and a special character.'
  } else if (field.validity.customError) return field.validationMessage
  if (field.validity.patternMismatch) return field.title || 'Please use the requested format.'
  if (field.type === 'email' && field.validity.typeMismatch) return 'Enter an email such as name@example.com.'
  return ''
}

export default function ValidatedForm({ onSubmit, onChange, onChangeCapture, onBlurCapture, onPointerDownCapture, onPointerUpCapture, validate, validation, children, ...props }) {
  const [errors, setErrors] = useState([])
  const [submitted, setSubmitted] = useState(false)
  const id = useId()
  const lastSubmitter = useRef(null)
  const focusingError = useRef(false)
  const touched = useRef(new Set())
  const submittingPointer = useRef(false)

  function check(form, submitter = lastSubmitter.current) {
    const fields = controls(form)
    const found = fields.map(field => ({ field, message: controlError(field, form, submitter) })).filter(error => error.message)
    function add(name, message) {
      const field = typeof name === 'string' ? form.elements.namedItem(name) : name
      if (field && message && !found.some(error => error.field === field)) found.push({ field, message, crossField: true })
    }
    if (validation === 'rental' && form.elements.namedItem('start')) {
      const dates = Object.fromEntries(new FormData(form))
      add('end', rentalPeriodError(dates))
    }
    if (['report', 'date-range'].includes(validation)) {
      const start = form.elements.namedItem('start')?.value, end = form.elements.namedItem('end')?.value
      if (start && end && start > end) add('end', 'The end date must be on or after the start date.')
      else if (validation === 'report' && start && end && (Date.parse(end) - Date.parse(start)) / 86400000 >= 366) add('end', 'Choose a reporting period of up to 366 days.')
    }
    for (const error of validate?.(form, submitter) || []) add(error.name, error.message)
    return found.map(error => ({ ...error, label: fieldLabel(error.field), id: error.field.id ? `${error.field.id}-error` : `${id}-error-${fields.indexOf(error.field)}` }))
  }

  function update(event) {
    const form = event.currentTarget, field = event.target
    if (focusingError.current || submittingPointer.current || !field.matches('input,select,textarea')) return
    touched.current.add(field.id || field.name)
    const next = check(form).filter(error => error.field.dataset.liveValidation !== 'off' && (submitted || error.crossField || touched.current.has(error.field.id || error.field.name)))
    setErrors(next)
  }

  return <FormValidationContext.Provider value={errors}><form {...props} noValidate onSubmit={event => {
    lastSubmitter.current = event.nativeEvent.submitter
    const next = check(event.currentTarget)
    setSubmitted(true)
    setErrors(next)
    if (next.length) {
      event.preventDefault()
      focusingError.current = true
      next[0].field.focus()
      focusingError.current = false
      return
    }
    onSubmit?.(event)
  }} onBlurCapture={event => { if (!event.relatedTarget?.closest?.('button,a')) update(event); onBlurCapture?.(event) }} onChangeCapture={onChangeCapture} onChange={event => { update(event); onChange?.(event) }} onPointerDownCapture={event => {
    submittingPointer.current = event.target.closest('button,input')?.type === 'submit'
    onPointerDownCapture?.(event)
  }} onPointerUpCapture={event => { submittingPointer.current = false; onPointerUpCapture?.(event) }} onPointerCancelCapture={() => { submittingPointer.current = false }}>
    {submitted && errors.length > 0 && <div className="validation-summary" role="alert"><strong>Please check {errors.length === 1 ? 'this field' : 'these fields'}.</strong><ul>{errors.map(error => <li key={error.id}><button type="button" onClick={() => error.field.focus()}><strong>{error.label}:</strong> {error.message}</button></li>)}</ul></div>}
    {children}
  </form></FormValidationContext.Provider>
}
