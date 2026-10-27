import { useEffect, useState } from 'react'
import { api } from '../../api.js'
import ValidatedField from '../../components/ui/ValidatedField.jsx'
import ValidatedForm from '../../components/ui/ValidatedForm.jsx'
import ClientProfileFields from '../../components/ui/ClientProfileFields.jsx'
import PasswordFields from '../../components/ui/PasswordFields.jsx'
import VerificationCodeInput from '../../components/ui/VerificationCodeInput.jsx'
import BrandMark from '../../components/ui/BrandMark.jsx'
import Icon from '../../components/ui/Icon.jsx'
import { validPassword } from '../../utils/password.js'
import { hashParam } from '../../utils/navigation.js'

const verifications = new Map()
const completed = new Set()
const verifyOnce = token => {
  if (!verifications.has(token)) verifications.set(token, api('/auth/verify-email', { method: 'POST', body: { token } }))
  return verifications.get(token)
}
const copy = {
  login: { eyebrow: 'DRIVEPULSE ACCESS', title: 'Sign in to DrivePulse.', description: 'Access reservations, fleet readiness, dispatch, and rental operations through your assigned workspace.' },
  signup: { eyebrow: 'CLIENT REGISTRATION', title: 'Create a client account.', description: 'Register your contact details to coordinate bookings and rental documentation. Verify your email to activate your account.' },
  'forgot-password': { eyebrow: 'PASSWORD RECOVERY', title: 'Recover your account.', description: 'Enter your registered email to receive a six-digit verification code. The code expires in 10 minutes.' },
  'reset-password': { eyebrow: 'PASSWORD RECOVERY', title: 'Set a new password.', description: 'Enter the six-digit code from your email and choose a new password. Existing sessions will be signed out.' },
  'verify-email': { eyebrow: 'EMAIL VERIFICATION', title: 'Verify your account.', description: 'Confirming your email address to activate your DrivePulse client workspace.' },
}
function StatusPanel({ icon, title, children }) {
  return <div className="auth-status" role="status"><span className="auth-status-icon"><Icon name={icon} size={26} /></span><h2>{title}</h2>{children}</div>
}
function ResendButton({ email, busy, seconds, onResend }) {
  return <button type="button" className="button button-outline" disabled={busy || seconds > 0} onClick={() => onResend(email)}>{seconds ? `Resend available in ${seconds}s` : 'Resend Verification Email'}<Icon name="mail" /></button>
}
export default function AuthPage({ mode, emailDelivery = null, onSuccess, onNavigate, sessionNotice = '', onDismissNotice }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [pendingEmail, setPendingEmail] = useState('')
  const [sentTo, setSentTo] = useState('')
  const [challengeId, setChallengeId] = useState(() => hashParam('challenge') || '')
  const [verifyState, setVerifyState] = useState(() => hashParam('token') ? 'working' : 'invalid')
  const [resetDone, setResetDone] = useState(false)
  const [resendUntil, setResendUntil] = useState(() => Number(sessionStorage.getItem('drivepulse-resend-until')) || 0)
  const [lockedUntil, setLockedUntil] = useState(() => Number(sessionStorage.getItem('drivepulse-login-until')) || 0)
  const [clock, setClock] = useState(Date.now)
  const signup = mode === 'signup', login = mode === 'login'
  const recovery = ['forgot-password', 'reset-password'].includes(mode)
  const codeStage = recovery && Boolean(challengeId)
  const resendSeconds = Math.max(0, Math.ceil((resendUntil - clock) / 1000))
  const lockSeconds = Math.max(0, Math.ceil((lockedUntil - clock) / 1000))
  const go = to => onNavigate ? onNavigate(to) : window.location.assign(`#${to}`)
  function cooldown(seconds = 60) {
    const until = Date.now() + seconds * 1000
    setResendUntil(until); setClock(Date.now()); sessionStorage.setItem('drivepulse-resend-until', String(until))
  }
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(timer) }, [])
  useEffect(() => {
    if (mode !== 'verify-email') return
    const token = hashParam('token')
    if (!token) return
    let active = true
    verifyOnce(token).then(async result => { if (active && !completed.has(token)) { completed.add(token); setVerifyState('done'); await onSuccess(result.user) } }).catch(problem => { if (active) { setVerifyState('invalid'); setError(problem.message) } })
    return () => { active = false }
  }, [mode, onSuccess])
  async function run(task) {
    if (busy) return
    setError(''); setNotice(''); setBusy(true)
    try { await task() }
    catch (problem) {
      setError(problem.code === 'ACCOUNT_LOCKED' ? 'Three unsuccessful sign-in attempts triggered a temporary account cooldown.' : problem.message)
      if (problem.code === 'EMAIL_NOT_VERIFIED') setPendingEmail(problem.data?.email || '')
      if (problem.code === 'ACCOUNT_LOCKED') {
        const until = Date.now() + (problem.data?.retryAfterSeconds || 60) * 1000
        setLockedUntil(until); setClock(Date.now()); sessionStorage.setItem('drivepulse-login-until', String(until))
      }
    } finally { setBusy(false) }
  }
  const resendVerification = email => run(async () => {
    if (resendSeconds) return
    const result = await api('/auth/resend-verification', { method: 'POST', body: { email } })
    cooldown(result.retryAfterSeconds); setNotice(result.message)
  })
  async function requestRecovery(email) {
    const result = await api('/auth/forgot-password', { method: 'POST', body: { email } })
    setSentTo(String(email).trim()); setChallengeId(result.challengeId); setNotice(result.message); cooldown(result.retryAfterSeconds)
  }
  function submit(event) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    setPendingEmail('')
    return run(async () => {
      if (codeStage) {
        if (!validPassword(data.get('password'))) throw new Error('Use 8–128 characters with uppercase, lowercase, and a special character.')
        if (data.get('password') !== data.get('confirm')) throw new Error('Your passwords do not match.')
        await api('/auth/reset-password', { method: 'POST', body: { challengeId, code: data.get('code'), password: data.get('password') } })
        sessionStorage.removeItem('drivepulse-login-until'); setLockedUntil(0); setResetDone(true); return
      }
      if (mode === 'forgot-password') { await requestRecovery(data.get('email')); return }
      const body = { [signup ? 'email' : 'username']: data.get(signup ? 'email' : 'username'), password: data.get('password') }
      if (signup) Object.assign(body, Object.fromEntries(['firstName', 'middleName', 'lastName', 'phone', 'street', 'city', 'postalCode', 'regionCode', 'cityCode', 'barangayCode'].map(key => [key, data.get(key)])), { role: 'client' })
      const result = await api(`/auth/${mode}`, { method: 'POST', body })
      if (result.verificationRequired) { setSentTo(result.email); cooldown(result.retryAfterSeconds); return }
      sessionStorage.removeItem('drivepulse-login-until'); await onSuccess(result.user)
    })
  }
  const feedback = <>{error && <p className="error-banner" role="alert"><Icon name="info" />{error}</p>}{notice && <p className="auth-notice" role="status"><Icon name="check" />{notice}</p>}</>
  let body
  if (resetDone) {
    body = <StatusPanel icon="check" title="Password updated."><p>Sign in with your new password. Previous sessions have been signed out.</p><div className="auth-status-actions"><button className="button button-dark" onClick={() => go('login')}>Continue to sign in<Icon name="arrow" /></button></div></StatusPanel>
  } else if (signup && sentTo) {
    body = <StatusPanel icon="mail" title="Verify your email."><p>We sent an activation link to <strong>{sentTo}</strong>. Open it to activate your client account.</p><p className="auth-status-hint">The link expires in 24 hours. Check your spam folder if needed.</p>{feedback}<div className="auth-status-actions"><ResendButton email={sentTo} busy={busy} seconds={resendSeconds} onResend={resendVerification} /><a className="button button-dark" href="#login">Back to sign in</a></div></StatusPanel>
  } else if (mode === 'verify-email') {
    body = verifyState === 'invalid' ? <StatusPanel icon="info" title="Request a verification email."><p>{error || 'Enter the email used to register your client account.'}</p><ValidatedForm className="auth-form" onSubmit={event => { event.preventDefault(); const email = new FormData(event.currentTarget).get('email'); setPendingEmail(String(email)); resendVerification(email) }}><label className="form-field">Email address<ValidatedField name="email" type="email" autoComplete="email" required /></label><button className="button button-dark" disabled={busy || resendSeconds > 0}>{resendSeconds ? `Resend available in ${resendSeconds}s` : 'Resend Verification Email'}</button></ValidatedForm>{notice && <p className="auth-notice">{notice}</p>}<a className="text-link" href="#login">Back to sign in</a></StatusPanel> : <StatusPanel icon="shield" title={verifyState === 'done' ? 'Email verified.' : 'Verifying your email…'}><p>{verifyState === 'done' ? 'Opening your client workspace.' : 'Please wait while we confirm your account.'}</p><span className="loading-line" /></StatusPanel>
  } else if (mode === 'reset-password' && !challengeId) {
    body = <StatusPanel icon="info" title="Request a recovery code."><p>Start password recovery to receive a new six-digit code.</p><div className="auth-status-actions"><a className="button button-dark" href="#forgot-password">Request a code</a></div></StatusPanel>
  } else {
    body = <>{mode === 'forgot-password' && emailDelivery === false && <p className="info-note">Password recovery is currently unavailable. Contact your operations manager for help.</p>}
      {codeStage && <p className="auth-status-hint">{sentTo ? `Enter the code sent to ${sentTo}.` : 'Enter the code from your recovery email.'}</p>}
      <ValidatedForm key={codeStage ? 'code' : mode} className="auth-form" onSubmit={submit}><fieldset disabled={busy} aria-busy={busy}>
        {signup && <ClientProfileFields />}
        {codeStage ? <VerificationCodeInput /> : <label className="form-field">{login ? 'Email or username' : 'Email address'}<ValidatedField name={login ? 'username' : 'email'} type={login ? 'text' : 'email'} data-validate={login ? 'login-identifier' : 'email'} required maxLength={160} autoComplete={login ? 'username' : 'email'} autoCapitalize="none" spellCheck={false} placeholder={login ? 'Username or you@example.com' : 'you@example.com'} /></label>}
        {(login || signup || codeStage) && <PasswordFields creation={!login} />}
        {login && <div className="auth-forgot-row"><a href="#forgot-password" className="text-link">Forgot password?</a></div>}
        {feedback}
        {login && lockSeconds > 0 && <p className="auth-notice" role="status">Account cooldown: {lockSeconds}s. Sign-in becomes available automatically after this timer.</p>}
        {pendingEmail && login && emailDelivery && <div className="auth-status-actions"><ResendButton email={pendingEmail} busy={busy} seconds={resendSeconds} onResend={resendVerification} /></div>}
        <button type="submit" className={`button button-dark ${login || signup ? 'full-width' : ''}`} disabled={busy || login && lockSeconds > 0}>{busy ? 'Please wait…' : login ? 'Log In' : signup ? 'Create client account' : codeStage ? 'Update password' : 'Send verification code'}<Icon name="arrow" /></button>
      </fieldset></ValidatedForm>
      {busy && <div className="auth-progress" role="status" aria-live="polite"><span className="auth-spinner" aria-hidden="true" />{login ? 'Authenticating, please wait…' : 'Processing your request, please wait…'}</div>}
      {codeStage && sentTo && <div className="auth-status-actions"><button className="button button-outline" type="button" disabled={busy || resendSeconds > 0} onClick={() => run(() => requestRecovery(sentTo))}>{resendSeconds ? `Resend code in ${resendSeconds}s` : 'Resend verification code'}</button><button className="text-link" onClick={() => { setChallengeId(''); setNotice(''); setError('') }}>Use a different email</button></div>}
      <p className="auth-switch">{signup ? 'Already registered?' : login ? 'New client?' : 'Return to your workspace.'} <a href={login ? '#signup' : '#login'}>{login ? 'Create a client account' : 'Back to sign in'}</a></p>
    </>
  }
  const text = codeStage ? copy['reset-password'] : copy[mode] || copy.login
  return <div className={`auth-page ${recovery || mode === 'verify-email' || signup && sentTo ? 'auth-account-flow' : ''}`}><aside className="auth-story"><div className="auth-story-image" /><a className="auth-brand" href="#home"><BrandMark /><span>drivepulse.</span></a><div className="auth-story-copy"><p className="landing-eyebrow">FLEET & RENTAL OPERATIONS</p><h2>Reliable fleets.<br />Coordinated operations.</h2><p>Manage bookings, dispatch, vehicle readiness, and operational records through DrivePulse.</p><div><Icon name="road" />One platform for rental operations and fleet management.</div></div><a className="auth-back" href="#home"><Icon name="arrow" />Back to DrivePulse</a></aside><main className="auth-main" onFocusCapture={onDismissNotice} onInputCapture={onDismissNotice} onPointerDownCapture={onDismissNotice}><div className="auth-form-wrap"><a className="auth-mobile-brand" href="#home"><BrandMark /><span>drivepulse.</span></a><p className="landing-eyebrow">{text.eyebrow}</p><h1>{text.title}</h1><p className="auth-description">{text.description}</p>{login && sessionNotice && <p className="auth-notice" role="alert">{sessionNotice}</p>}{body}<div className="auth-footnote"><Icon name="shield" size={17} />{recovery ? 'Recovery codes expire after 10 minutes and can only be used once.' : 'Access is limited to your assigned workspace.'}</div></div></main></div>
}
