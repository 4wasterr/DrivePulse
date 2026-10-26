import { useEffect, useState } from 'react'
import BrandMark from '../../components/ui/BrandMark.jsx'
import Icon from '../../components/ui/Icon.jsx'
import NotificationCenter from '../../components/ui/NotificationCenter.jsx'
import HeroCarousel from './HeroCarousel.jsx'
import { workspaceHome, workspaceRoles } from '../../utils/roles.js'

const steps = [
  { number: '01', icon: 'shield', title: 'Capture every reservation.', copy: 'Coordinate online and walk-in bookings with vehicle availability, rental schedules, and customer requirements.' },
  { number: '02', icon: 'grid', title: 'Verify fleet readiness.', copy: 'Connect document checks, payment records, and inspection evidence before authorizing vehicle dispatch.' },
  { number: '03', icon: 'check', title: 'Control the rental lifecycle.', copy: 'Track handovers, returns, maintenance, deposits, and operational exceptions in a shared system of record.' },
]

function Brand() {
  return <a className="landing-brand" href="#home" aria-label="DrivePulse home"><BrandMark /><span>drivepulse.</span></a>
}

export default function LandingPage({ user, section = 'home' }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const role = workspaceRoles.find(role => role.id === user?.role)
  const destination = user ? '#' + workspaceHome(user.role) : '#login'
  const action = user ? 'Open my workspace' : 'Sign in to DrivePulse'
  const closeMenu = () => setMenuOpen(false)
  useEffect(() => {
    const id = section === 'why-drivepulse' ? 'workspaces' : section
    if (id === 'home') return
    const frame = requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: 'instant', block: 'start' }))
    return () => cancelAnimationFrame(frame)
  }, [section])

  return <div className="landing-shell general-landing">
    <a className="skip-link" href="#landing-main">Skip to content</a>
    <header className="landing-header"><div className="landing-container landing-header-inner">
      <Brand />
      <nav className={'landing-nav' + (menuOpen ? ' is-open' : '')} id="landing-navigation" aria-label="Main navigation">
        <a href="#workspaces" onClick={closeMenu}>Workspaces</a>
        <a href="#how-it-works" onClick={closeMenu}>How it works</a>
        <a className="landing-mobile-portal" href={destination} onClick={closeMenu}>{action}<Icon name="arrow" size={17} /></a>
      </nav>
      <div className="landing-header-actions"><NotificationCenter /><a className="button button-dark landing-portal" data-signed-in={Boolean(user)} href={destination}>{user ? 'My workspace' : 'Sign in'}<Icon name="arrow" size={18} /></a><button className="icon-button landing-menu-toggle" aria-label={menuOpen ? 'Close menu' : 'Open menu'} aria-controls="landing-navigation" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}><Icon name={menuOpen ? 'close' : 'menu'} /></button></div>
    </div></header>

    <main id="landing-main" tabIndex={-1}>
      <HeroCarousel><div className="landing-container landing-hero-inner">
        <div className="landing-hero-copy">
          <p className="landing-eyebrow">FLEET & RENTAL OPERATIONS</p>
          <h1 id="landing-title">Car rental operations.<br /><span>Fleet management, unified.</span></h1>
          <p className="landing-hero-description">DrivePulse connects booking logistics, fleet readiness, dispatch, maintenance, and financial records in one car rental operations platform.</p>
          <div className="landing-hero-actions"><a href={destination} className="button button-dark">{action}<Icon name="arrow" /></a><a className="landing-text-link" href="#workspaces">Explore platform capabilities<Icon name="down" size={18} /></a></div>
          <p className="landing-access-note"><Icon name="shield" size={17} />{user ? 'Signed in as ' + role?.name + ' · ' + user.name : 'Role-based access keeps booking, maintenance, and management responsibilities clearly defined.'}</p>
        </div>
        <aside className="landing-operation-card" aria-label="Connected workspaces">
          <div className="landing-operation-heading"><span className="landing-pulse" /><span>ONE CONNECTED OPERATION</span></div>
          <h2>Operational visibility.<br />Accountable teams.</h2>
          <div className="landing-operation-roles">{workspaceRoles.map(item => <div key={item.id}><span className="landing-role-icon"><Icon name={item.icon} size={21} /></span><div><strong>{item.name}</strong><span>{item.description}</span></div><Icon name="check" size={16} /></div>)}</div>
          <div className="landing-operation-foot"><Icon name="road" size={18} /><span>From booking confirmation to controlled vehicle dispatch.</span></div>
        </aside>
      </div></HeroCarousel>

      <section className="landing-container landing-section" id="workspaces" aria-labelledby="workspaces-title">
        <div className="landing-section-heading"><div><p className="landing-eyebrow">BUILT FOR RENTAL OPERATIONS</p><h2 id="workspaces-title">Coordinate the entire rental operation.</h2></div><p>Give clients, booking agents, mechanics, and managers the operational records and controls required for reliable fleet utilization.</p></div>
        <div className="landing-role-grid">{workspaceRoles.map(item => <article key={item.id} className="landing-role-card"><span className="landing-role-icon"><Icon name={item.icon} size={24} /></span><h3>{item.name}</h3><p>{item.description}</p><ul>{item.tasks.map(task => <li key={task}><Icon name="check" size={14} /><span>{task}</span></li>)}</ul></article>)}</div>
        <p className="landing-role-note"><Icon name="info" size={17} />Role-based workspaces connect customer bookings, dispatch coordination, fleet maintenance, and management oversight.</p>
      </section>

      <section className="landing-how-section" id="how-it-works" aria-labelledby="how-title"><div className="landing-container">
        <div className="landing-section-heading"><div><p className="landing-eyebrow">THE OPERATING WORKFLOW</p><h2 id="how-title">A consistent process from booking to return.</h2></div></div>
        <ol className="landing-steps">{steps.map(step => <li key={step.number}><span className="landing-step-number">{step.number}</span><Icon name={step.icon} size={24} /><h3>{step.title}</h3><p>{step.copy}</p></li>)}</ol>
      </div></section>

      <section className="landing-container landing-access-section" aria-labelledby="access-title"><div><p className="landing-eyebrow">CENTRALIZE YOUR RENTAL OPERATIONS</p><h2 id="access-title">Put DrivePulse to work.</h2><p>{user ? 'Return to your operational workspace to review bookings, fleet readiness, and outstanding actions.' : 'Access the platform to coordinate rental demand, vehicle dispatch, and fleet performance.'}</p></div><div className="landing-access-actions"><a className="button button-dark" href={destination}>{action}<Icon name="arrow" /></a>{!user && <p>New client? <a href="#signup">Create a client account</a><small>Staff accounts are provided by your Admin.</small></p>}</div></section>
    </main>

    <footer className="landing-footer"><div className="landing-container"><Brand /><p>DrivePulse · Car rental and fleet operations management.</p><span>© {new Date().getFullYear()} DrivePulse.</span><a className="landing-text-link" href="#home">Back to top<Icon name="arrow" size={17} /></a></div></footer>
  </div>
}
