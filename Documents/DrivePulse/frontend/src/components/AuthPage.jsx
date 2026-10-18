import { useState } from 'react'
import BrandMark from './BrandMark'
import Icon from './Icon'
import { api } from '../api'

export default function AuthPage({ mode, role, onNavigate, onSuccess, config }) {
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const signup = mode === 'signup', agent = role === 'agent'
  const path = (nextRole, nextMode) => `${nextRole === 'agent' ? 'agent-' : ''}${nextMode}`
  async function submit(event, demoRole) {
    event?.preventDefault(); setError(''); setBusy(true)
    try {
      let body
      if (demoRole) body = { email: `${demoRole}@drivepulse.demo`, password: 'DrivePulse123!', role: demoRole }
      else {
        const data = new FormData(event.currentTarget)
        if (signup && data.get('password') !== data.get('confirm')) throw new Error('Your passwords do not match.')
        body = { name: data.get('name'), email: data.get('email'), password: data.get('password'), role }
      }
      const result = await api(`/auth/${demoRole ? 'login' : mode}`, { method: 'POST', body })
      await onSuccess(result.user)
    } catch (problem) { setError(problem.message) }
    finally { setBusy(false) }
  }
  return <div className="auth-page">
    <aside className="auth-story"><div className="auth-story-image" /><a className="auth-brand" href="#home"><BrandMark /><span>drivepulse.</span></a><div className="auth-story-copy"><p className="landing-eyebrow">{agent ? 'THE PEOPLE BEHIND EVERY JOURNEY' : 'THE OPEN ROAD IS CALLING'}</p><h2>{agent ? <>A smooth journey.<br />Starts at your desk.</> : <>Your next chapter.<br />One great drive away.</>}</h2><p>{agent ? 'Reservations, customer reviews, payments, and dispatch. Everything you need for a well-run front desk.' : 'Find your ride, keep your plans together, and make a little room for possibility.'}</p><div><Icon name={agent ? 'shield' : 'road'} />{agent ? 'Booking Agent / Front Desk' : 'Your personal rental workspace'}</div></div><a className="auth-back" href="#home"><Icon name="arrow" />Back to DrivePulse</a></aside>
    <main className="auth-main"><div className="auth-form-wrap"><a className="auth-mobile-brand" href="#home"><BrandMark /><span>drivepulse.</span></a><div className="auth-role-tabs" aria-label="Account type">{[{ id: 'client', label: 'Client', icon: 'users' }, { id: 'agent', label: 'Booking agent', icon: 'grid' }].map(option => <button key={option.id} className={role === option.id ? 'active' : ''} aria-pressed={role === option.id} onClick={() => onNavigate(path(option.id, mode))}><Icon name={option.icon} size={18} />{option.label}</button>)}</div><p className="landing-eyebrow">{signup ? 'LET’S GET YOU STARTED' : 'GOOD TO SEE YOU AGAIN'}</p><h1>{signup ? agent ? 'Join the front desk.' : 'Make room for adventure.' : agent ? 'Welcome to your front desk.' : 'Welcome back.'}</h1><p className="auth-description">{signup ? `Create your ${agent ? 'booking-agent' : 'client'} account to get started.` : `Sign in to manage ${agent ? 'reservations and keep your day moving' : 'your bookings and your next journey'}.`}</p>
    {agent && signup && !config.agentSignup ? <div className="info-note"><Icon name="shield" /><span>Agent registration is managed by your administrator. Contact your team for an account.</span></div> : <form onSubmit={submit} className="auth-form"><fieldset disabled={busy}>
      {signup && <label className="form-field">Full name<input name="name" required maxLength={70} autoComplete="name" placeholder="Your full name" /></label>}
      <label className="form-field">Email address<input name="email" type="email" required maxLength={160} autoComplete="username" placeholder={agent ? 'you@company.com' : 'you@example.com'} /></label>
      <label className="form-field">Password<span className="password-input"><input name="password" type={showPassword ? 'text' : 'password'} required minLength={8} maxLength={128} autoComplete={signup ? 'new-password' : 'current-password'} placeholder={signup ? 'At least 8 characters' : 'Enter your password'} /><button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? 'Hide' : 'Show'}</button></span></label>
      {signup && <label className="form-field">Confirm password<input name="confirm" type={showPassword ? 'text' : 'password'} required minLength={8} maxLength={128} autoComplete="new-password" placeholder="Enter your password again" /></label>}
      {error && <p className="error-banner" role="alert"><Icon name="info" />{error}</p>}
      <button type="submit" className="button button-dark full-width">{busy ? 'One moment…' : signup ? 'Create account' : 'Sign in'}<Icon name="arrow" /></button>
    </fieldset></form>}
    <p className="auth-switch">{signup ? 'Already have an account?' : 'New to DrivePulse?'} <a href={`#${path(role, signup ? 'login' : 'signup')}`}>{signup ? 'Sign in' : 'Create an account'}<Icon name="diagonal" size={15} /></a></p>
    {config.demo && <div className="auth-demo"><span>EXPLORE THE DEVELOPMENT WORKSPACE</span><div><button className="button button-outline" disabled={busy} onClick={() => submit(null, 'client')}>Try client demo<Icon name="arrow" size={16} /></button><button className="button button-outline" disabled={busy} onClick={() => submit(null, 'agent')}>Try agent demo<Icon name="arrow" size={16} /></button></div><p>Demo payments are simulated. Agent self-registration is enabled for development.</p></div>}
    <div className="auth-footnote"><Icon name="shield" size={17} />{agent ? 'Your team’s workspace for every step of the rental.' : 'Your plans, documents, and bookings. All in one place.'}</div>
    </div></main>
  </div>
}
