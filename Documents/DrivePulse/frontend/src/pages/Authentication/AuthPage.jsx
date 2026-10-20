import { useState } from 'react'
import { api } from '../../api.js'
import BrandMark from '../../components/ui/BrandMark.jsx'
import Icon from '../../components/ui/Icon.jsx'

const demoAccounts = [
  ['Client', 'client@drivepulse.demo'],
  ['Booking agent', 'agent@drivepulse.demo'],
  ['Fleet mechanic', 'mechanic@drivepulse.demo'],
  ['Operations manager', 'manager@drivepulse.demo'],
]

export default function AuthPage({ mode, onSuccess, config }) {
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const signup = mode === 'signup'

  async function submit(event) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    setError('')
    setBusy(true)
    try {
      if (signup && data.get('password') !== data.get('confirm')) throw new Error('Your passwords do not match.')
      const body = { email: data.get('email'), password: data.get('password') }
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
        <p className="landing-eyebrow">EVERY JOURNEY STARTS HERE</p>
        <h2>One great drive.<br />So many possibilities.</h2>
        <p>Explore DrivePulse and keep the details of every journey in one place.</p>
        <div><Icon name="road" />A smooth start with DrivePulse.</div>
      </div>
      <a className="auth-back" href="#home"><Icon name="arrow" />Back to DrivePulse</a>
    </aside>

    <main className="auth-main"><div className="auth-form-wrap">
      <a className="auth-mobile-brand" href="#home"><BrandMark /><span>drivepulse.</span></a>
      <p className="landing-eyebrow">{signup ? 'LET’S GET YOU STARTED' : 'GOOD TO SEE YOU AGAIN'}</p>
      <h1>{signup ? 'Create an account.' : 'Welcome back.'}</h1>
      <p className="auth-description">{signup ? 'Set up your account to start planning a rental.' : 'Sign in with your email and password to open your workspace.'}</p>

      <form onSubmit={submit} className="auth-form"><fieldset disabled={busy}>
        {signup && <label className="form-field">Full name<input name="name" required maxLength={70} autoComplete="name" placeholder="Your full name" /></label>}
        <label className="form-field">Email address<input name="email" type="email" required maxLength={160} autoComplete="username" placeholder="you@example.com" /></label>
        <label className="form-field">Password<span className="password-input">
          <input name="password" type={showPassword ? 'text' : 'password'} required minLength={8} maxLength={128} autoComplete={signup ? 'new-password' : 'current-password'} placeholder={signup ? 'At least 8 characters' : 'Enter your password'} />
          <button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? 'Hide' : 'Show'}</button>
        </span></label>
        {signup && <label className="form-field">Confirm password<input name="confirm" type={showPassword ? 'text' : 'password'} required minLength={8} maxLength={128} autoComplete="new-password" placeholder="Enter your password again" /></label>}
        {error && <p className="error-banner" role="alert"><Icon name="info" />{error}</p>}
        <button type="submit" className="button button-dark full-width">{busy ? 'One moment…' : signup ? 'Create account' : 'Sign in'}<Icon name="arrow" /></button>
      </fieldset></form>

      <p className="auth-switch">{signup ? 'Already have an account?' : 'New to DrivePulse?'} <a href={signup ? '#login' : '#signup'}>{signup ? 'Sign in' : 'Create an account'}<Icon name="diagonal" size={15} /></a></p>

      {config.demo && !signup && <details className="auth-demo">
        <summary>Demo accounts</summary>
        <p>Use any of these accounts in the sign-in form above.</p>
        <dl className="demo-credentials">{demoAccounts.map(([label, email]) => <div key={email}><dt>{label}</dt><dd><code>{email}</code></dd></div>)}</dl>
        <p className="demo-password">Password for all demo accounts: <code>DrivePulse123!</code></p>
        <p>Demo payments are simulated.</p>
      </details>}

      <div className="auth-footnote"><Icon name="shield" size={17} />Your account opens the workspace assigned to you.</div>
    </div></main>
  </div>
}
