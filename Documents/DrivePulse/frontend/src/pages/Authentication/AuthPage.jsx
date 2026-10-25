import ValidatedField from '../../components/ui/ValidatedField.jsx'
import ValidatedForm from '../../components/ui/ValidatedForm.jsx'
import { useState } from 'react'
import { api } from '../../api.js'
import BrandMark from '../../components/ui/BrandMark.jsx'
import Icon from '../../components/ui/Icon.jsx'
import PasswordFields from '../../components/ui/PasswordFields.jsx'
import { validPassword } from '../../utils/password.js'

export default function AuthPage({ mode, onSuccess }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const signup = mode === 'signup'

  async function submit(event) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    setError('')
    setBusy(true)
    try {
      if (signup && !validPassword(data.get('password'))) throw new Error('Use 8–128 characters with uppercase, lowercase, and a special character.')
      if (signup && data.get('password') !== data.get('confirm')) throw new Error('Your passwords do not match.')
      const body = { [signup ? 'email' : 'username']: data.get(signup ? 'email' : 'username'), password: data.get('password') }
      if (signup) Object.assign(body, { name: data.get('name'), role: 'client' })
      const result = await api(`/auth/${mode}`, { method: 'POST', body })
      await onSuccess(result.user)
    } catch (problem) {
      setError(problem.message)
    } finally {
      setBusy(false)
    }
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
      <p className="landing-eyebrow">{signup ? 'LET’S GET YOU STARTED' : 'GOOD TO SEE YOU AGAIN'}</p>
      <h1>{signup ? 'Create a client account.' : 'Welcome back.'}</h1>
      <p className="auth-description">{signup ? 'Register as a client to manage your rentals. Staff accounts are provided by your Admin.' : 'Clients, booking agents, fleet mechanics and operations managers all sign in here. Your account opens your assigned workspace.'}</p>

      <ValidatedForm onSubmit={submit} className="auth-form"><fieldset disabled={busy}>
        {signup && <label className="form-field">Full name<ValidatedField name="name" required maxLength={70} autoComplete="name" placeholder="Your full name" /></label>}
        <label className="form-field">{signup ? 'Email address' : 'Email or username'}<ValidatedField name={signup ? 'email' : 'username'} type={signup ? 'email' : 'text'} data-validate={signup ? 'email' : 'login-identifier'} required maxLength={160} autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder={signup ? 'you@example.com' : 'Username or you@example.com'} /></label>
        <PasswordFields creation={signup} />
        {error && <p className="error-banner" role="alert"><Icon name="info" />{error}</p>}
        <button type="submit" className="button button-dark full-width">{busy ? 'One moment…' : signup ? 'Create client account' : 'Sign in'}<Icon name="arrow" /></button>
      </fieldset></ValidatedForm>

      <p className="auth-switch">{signup ? 'Already have an account?' : 'New client?'} <a href={signup ? '#login' : '#signup'}>{signup ? 'Sign in' : 'Create a client account'}<Icon name="diagonal" size={15} /></a></p>

      <div className="auth-footnote"><Icon name="shield" size={17} />Your account opens the workspace assigned to you.</div>
    </div></main>
  </div>
}
