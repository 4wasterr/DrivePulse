import ValidatedField from './ValidatedField.jsx'

export default function VerificationCodeInput() {
  return <label className="form-field">Six-digit verification code
    <ValidatedField className="verification-code-input" name="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" title="Enter the six-digit code from your email." required minLength={6} maxLength={6} placeholder="000000" onInput={event => { event.currentTarget.value = event.currentTarget.value.replace(/\D/g, '').slice(0, 6) }} />
    <span className="field-hint">Expires after 10 minutes. Five unsuccessful attempts invalidate the code.</span>
  </label>
}
