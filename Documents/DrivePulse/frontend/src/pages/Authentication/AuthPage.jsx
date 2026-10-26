import ValidatedField from '../../components/ui/ValidatedField.jsx'
import ValidatedForm from '../../components/ui/ValidatedForm.jsx'
import { useEffect, useState } from 'react'
import { api } from '../../api.js'
import BrandMark from '../../components/ui/BrandMark.jsx'
import Icon from '../../components/ui/Icon.jsx'
import PasswordFields from '../../components/ui/PasswordFields.jsx'
import { validPassword } from '../../utils/password.js'
import { hashParam } from '../../utils/navigation.js'

// One request per emailed token, even if React mounts the page twice in development.
const verifications = new Map()
const completed = new Set()
const verifyOnce = token => {
  if (!verifications.has(token)) verifications.set(token, api('/auth/verify-email', { method: 'POST', body: { token } }))
  return verifications.get(token)
}

const copy = {
  login: { eyebrow: 'GOOD TO SEE YOU AGAIN', title: 'Welcome back.', description: 'Clients, booking agents, fleet mechanics and operations managers all sign in here. Your account opens your assigned workspace.' },
  signup: { eyebrow: 'LET’S GET YOU STARTED', title: 'Create a client account.', description: 'Register as a client to manage your rentals. We’ll email you a link to verify your address. Staff accounts are provided by your Admin.' },
  'forgot-password': { eyebrow: 'PASSWORD RECOVERY', title: 'Forgot your password?', description: 'Enter the email address on your DrivePulse account and we’ll send you a secure link to set a new password.' },
  'reset-password': { eyebrow: 'PASSWORD RECOVERY', title: 'Set a new password.', description: 'Choose a strong password you haven’t used before. Signing in with the new password ends every other active session.' },
  'verify-email': { eyebrow: 'VERIFY YOUR EMAIL', title: 'Confirming your email.', description: 'One moment while we verify your DrivePulse client account.' },
}

function StatusPanel({ icon, title, children }) {
  return <div className="auth-status" role="status">
    <span className="auth-status-icon"><Icon name={icon} size={26} /></span>
    <h2>{title}</h2>
    {children}
  </div>
}

export default function AuthPage({ mode, emailDelivery = null, onSuccess, onNavigate }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [pendingEmail, setPendingEmail] = useState('')
  const [sentTo, setSentTo] = useState('')
  const [verifyState, setVerifyState] = useState(() => mode === 'verify-email' && !hashParam('token') ? 'invalid' : 'working')
  const [resetDone, setResetDone] = useState(false)
  const signup = mode === 'signup', login = mode === 'login'
  const go = to => onNavigate ? onNavigate(to) : window.location.assign(`#${to}`)

  useEffect(() => {
    if (mode !== 'verify-email') return
    const token = hashParam('token')
    if (!token) return
    let active = true
    verifyOnce(token)
      .then(async result => { if (!active || completed.has(token)) return; completed.add(token); setVerifyState('done'); await onSuccess(result.user) })
      .catch(problem => { if (active) { setVerifyState('invalid'); setError(problem.message) } })
    return () => { active = false }
  }, [mode, onSuccess])

  async function run(task) {
    setError(''); setNotice(''); setBusy(true)
    try { await task() } catch (problem) { setError(problem.message); if (problem.code === 'EMAIL_NOT_VERIFIED') setPendingEmail(problem.data?.email || '') }
    finally { setBusy(false) }
  }

  const resendVerification = email => run(async () => {
    const result = await api('/auth/resend-verification', { method: 'POST', body: { email } })
    setError(''); setNotice(result.message)
  })

  function submit(event) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    setPendingEmail('')
    return run(async () => {
      if (mode === 'forgot-password') {
        const result = await api('/auth/forgot-password', { method: 'POST', body: { email: data.get('email') } })
        setSentTo(String(data.get('email')).trim()); setNotice(result.message)
        return
      }
      if (signup || mode === 'reset-password') {
        if (!validPassword(data.get('password'))) throw new Error('Use 8–128 characters with uppercase, lowercase, and a special character.')
        if (data.get('password') !== data.get('confirm')) throw new Error('Your passwords do not match.')
      }
      if (mode === 'reset-password') {
        await api('/auth/reset-password', { method: 'POST', body: { token: hashParam('token'), password: data.get('password') } })
        setResetDone(true)
        return
      }
      const body = { [signup ? 'email' : 'username']: data.get(signup ? 'email' : 'username'), password: data.get('password') }
      if (signup) Object.assign(body, { name: data.get('name'), role: 'client' })
      const result = await api(`/auth/${mode}`, { method: 'POST', body })
      if (result.verificationRequired) { setSentTo(result.email); return }
      await onSuccess(result.user)
    })
  }

  const text = copy[mode] || copy.login
  const feedback = <>
    {error && <p className="error-banner" role="alert"><Icon name="info" />{error}</p>}
    {notice && <p className="auth-notice" role="status"><Icon name="check" />{notice}</p>}
  </>

  let body
  if (signup && sentTo) {
    body = <StatusPanel icon="mail" title="Check your inbox.">
      <p>We sent a verification link to <strong>{sentTo}</strong>. Click <em>Verify email &amp; open DrivePulse</em> in that email to activate your account and continue to your workspace.</p>
      <p className="auth-status-hint">The link expires in 24 hours. Don’t see it? Check your spam or promotions folder.</p>
      {feedback}
      <div className="auth-status-actions">
        <button type="button" className="button button-outline" disabled={busy} onClick={() => resendVerification(sentTo)}>{busy ? 'Sending…' : 'Resend verification email'}<Icon name="refresh" /></button>
        <a className="button button-dark" href="#login">Back to sign in<Icon name="arrow" /></a>
      </div>
    </StatusPanel>
  } else if (mode === 'verify-email') {
    body = verifyState === 'invalid'
      ? <StatusPanel icon="info" title="This link can’t be used.">
          <p>{error || 'The verification link is missing or incomplete.'}</p>
          <p className="auth-status-hint">Sign in with your email and password to request a fresh verification link.</p>
          <div className="auth-status-actions"><a className="button button-dark" href="#login">Go to sign in<Icon name="arrow" /></a></div>
        </StatusPanel>
      : <StatusPanel icon={verifyState === 'done' ? 'check' : 'shield'} title={verifyState === 'done' ? 'Email verified.' : 'Verifying your email…'}>
          <p>{verifyState === 'done' ? 'Your account is active. Opening your client workspace…' : 'This only takes a moment.'}</p>
          <span className="loading-line" />
        </StatusPanel>
  } else if (mode === 'reset-password' && (resetDone || !hashParam('token'))) {
    body = resetDone
      ? <StatusPanel icon="check" title="Password updated.">
          <p>Your password has been changed and other sessions were signed out. Sign in with your new password to continue.</p>
          <div className="auth-status-actions"><button type="button" className="button button-dark" onClick={() => go('login')}>Continue to sign in<Icon name="arrow" /></button></div>
        </StatusPanel>
      : <StatusPanel icon="info" title="This link can’t be used.">
          <p>The password reset link is missing or incomplete. Request a new one to continue.</p>
          <div className="auth-status-actions"><a className="button button-dark" href="#forgot-password">Request a new link<Icon name="arrow" /></a></div>
        </StatusPanel>
  } else if (mode === 'forgot-password' && sentTo) {
    body = <StatusPanel icon="mail" title="Check your inbox.">
      <p>{notice}</p>
      <p className="auth-status-hint">Sent to <strong>{sentTo}</strong>. Open <em>Reset password</em> in that email to choose a new password.</p>
      <div className="auth-status-actions">
        <button type="button" className="button button-outline" onClick={() => { setSentTo(''); setNotice('') }}>Use a different email</button>
        <a className="button button-dark" href="#login">Back to sign in<Icon name="arrow" /></a>
      </div>
    </StatusPanel>
  } else {
    const recovery = ['forgot-password', 'reset-password'].includes(mode)
    body = <>
      {mode === 'forgot-password' && emailDelivery === false && <p className="info-note"><Icon name="info" />Password recovery is currently unavailable. Please contact your operations manager for help.</p>}
      <ValidatedForm onSubmit={submit} className="auth-form"><fieldset disabled={busy}>
        {signup && <label className="form-field">Full name<ValidatedField name="name" required maxLength={70} autoComplete="name" placeholder="Your full name" /></label>}
        {mode !== 'reset-password' && <label className="form-field">{login ? 'Email or username' : 'Email address'}<ValidatedField name={login ? 'username' : 'email'} type={login ? 'text' : 'email'} data-validate={login ? 'login-identifier' : 'email'} required maxLength={160} autoComplete={mode === 'forgot-password' ? 'email' : 'username'} autoCapitalize="none" spellCheck={false} placeholder={login ? 'Username or you@example.com' : 'you@example.com'} /></label>}
        {mode !== 'forgot-password' && <PasswordFields creation={!login} />}
        {login && <div className="auth-forgot-row"><a className="text-link" href="#forgot-password">Forgot password?</a></div>}
        {feedback}
        {pendingEmail && emailDelivery && <button type="button" className="button button-outline full-width auth-resend" onClick={() => resendVerification(pendingEmail)}>Resend verification email<Icon name="mail" /></button>}
        <button type="submit" className="button button-dark full-width">{busy ? 'One moment…' : { signup: 'Create client account', 'forgot-password': 'Send reset link', 'reset-password': 'Update password' }[mode] || 'Sign in'}<Icon name="arrow" /></button>
      </fieldset></ValidatedForm>
      {recovery
        ? <p className="auth-switch">Remembered your password? <a href="#login">Back to sign in<Icon name="diagonal" size={15} /></a></p>
        : <p className="auth-switch">{signup ? 'Already have an account?' : 'New client?'} <a href={signup ? '#login' : '#signup'}>{signup ? 'Sign in' : 'Create a client account'}<Icon name="diagonal" size={15} /></a></p>}
    </>
  }

  return <div className="auth-page">
    <aside className="auth-story">
      <div className="auth-story-image" />
      <a className="auth-brand" href="#home"><BrandMark /><span>drivepulse.</span></a>
      <div className="auth-story-copy">
        <p className="landing-eyebrow">ONE PLATFORM. EVERY ROLE.</p>
        <h2>The right tools.<br />For every role.</h2>
        <p>Connect reservations, vehicle readiness and daily operations in one shared system.</p>
        <div><Icon name="road" />Your account opens your assigned workspace.</div>
      </div>
      <a className="auth-back" href="#home"><Icon name="arrow" />Back to DrivePulse</a>
    </aside>

    <main className="auth-main"><div className="auth-form-wrap">
      <a className="auth-mobile-brand" href="#home"><BrandMark /><span>drivepulse.</span></a>
      <p className="landing-eyebrow">{text.eyebrow}</p>
      <h1>{text.title}</h1>
      <p className="auth-description">{text.description}</p>
      {body}
      <div className="auth-footnote"><Icon name="shield" size={17} />{['forgot-password', 'reset-password', 'verify-email'].includes(mode) ? 'Recovery and verification links are single-use and expire automatically.' : 'Your account opens the workspace assigned to you.'}</div>
    </div></main>
  </div>
}
