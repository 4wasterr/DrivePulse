import ValidatedField, { FieldError } from './ValidatedField.jsx'
import { useId, useState } from 'react'
import Icon from './Icon.jsx'
import { passwordRequirements, suggestPassword, validPassword } from '../../utils/password.js'

export default function PasswordFields({ creation = true }) {
  const [password, setPassword] = useState(''), [confirm, setConfirm] = useState('')
  const [visible, setVisible] = useState(false), [confirmVisible, setConfirmVisible] = useState(false)
  const id = useId()
  return <div className="password-fields">
    <label className="form-field" htmlFor={`${id}-password`}>Password</label>
    <div className="secure-password-input">
      <ValidatedField feedback={false} data-sensitive="password" placeholder="Enter your password" id={`${id}-password`} name="password" type={visible ? 'text' : 'password'} required minLength={creation ? 8 : undefined} maxLength={128} data-live-validation={creation ? undefined : 'off'} value={password} onChange={e => { setPassword(e.target.value); e.target.setCustomValidity(creation && !validPassword(e.target.value) ? 'Use 8–128 characters with uppercase, lowercase, and a special character.' : '') }} autoComplete={creation ? 'new-password' : 'current-password'} aria-describedby={creation ? `${id}-rules` : undefined} />
      <button type="button" aria-label={visible ? 'Hide password' : 'Show password'} aria-pressed={visible} onClick={() => setVisible(!visible)}><Icon name={visible ? 'eye-off' : 'eye'} /></button>
    </div>
    <FieldError fieldId={`${id}-password`} />
    {creation && <>
      <button className="text-link password-suggest" type="button" onClick={() => { const value = suggestPassword(); setPassword(value); setConfirm(value); const input = document.getElementById(`${id}-password`); input?.setCustomValidity(''); document.getElementById(`${id}-confirm`)?.setCustomValidity('') }}>Suggest Strong Password<Icon name="shield" size={16} /></button>
      <ul id={`${id}-rules`} className="password-requirements" aria-live="polite">{passwordRequirements(password).map(rule => <li key={rule.label} className={rule.met ? 'met' : ''}><Icon name={rule.met ? 'check' : 'close'} size={13} />{rule.label}</li>)}</ul>
      <label className="form-field" htmlFor={`${id}-confirm`}>Confirm password</label>
      <div className="secure-password-input">
        <ValidatedField feedback={false} data-sensitive="password" placeholder="Enter your password" id={`${id}-confirm`} name="confirm" type={confirmVisible ? 'text' : 'password'} required minLength={8} maxLength={128} autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} aria-invalid={Boolean(confirm && confirm !== password)} aria-describedby={confirm === password ? `${id}-match` : undefined} />
        <button type="button" aria-label={confirmVisible ? 'Hide confirm password' : 'Show confirm password'} aria-pressed={confirmVisible} onClick={() => setConfirmVisible(!confirmVisible)}><Icon name={confirmVisible ? 'eye-off' : 'eye'} /></button>
      </div>
      <FieldError fieldId={`${id}-confirm`} />
      {confirm && confirm === password && <p id={`${id}-match`} className="password-match" role="status">Passwords match.</p>}
    </>}
  </div>
}
