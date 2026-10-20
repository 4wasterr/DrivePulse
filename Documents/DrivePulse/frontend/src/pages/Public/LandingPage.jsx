import BrandMark from '../../components/ui/BrandMark.jsx'
import { useState } from 'react'
import { vehicles } from '../../data.js'
import Icon from '../../components/ui/Icon.jsx'

function Brand() {
  return <a className="landing-brand" href="#home" aria-label="DrivePulse home"><BrandMark /><span>drivepulse.</span></a>
}

const steps = [
  { number: '01', icon: 'car', title: 'Find your kind of drive.', copy: 'Choose a car that fits your plans. Set your pick-up location and dates to see what is available.' },
  { number: '02', icon: 'file', title: 'Plan with confidence.', copy: 'Review the rental quotation and requirements, then arrange your reservation with our team.' },
  { number: '03', icon: 'road', title: 'Pick up and go.', copy: 'Collect your vehicle at the agreed location. Our team is here to help along the way.' },
]

export default function LandingPage({ user, onAuthenticate, renderVehicle, searchBar, onFeature }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const featured = ['bmw-3', 'porsche-panamera', 'range-rover'].map(id => vehicles.find(vehicle => vehicle.id === id))
  const closeMenu = () => setMenuOpen(false)
  const handleFleetClick = e => {
    if (!user && onAuthenticate) {
      e.preventDefault()
      onAuthenticate('fleet')
    }
    closeMenu()
  }

  return <>
    <a className="skip-link" href="#landing-main">Skip to content</a>
    <header className="landing-header">
      <div className="landing-container landing-header-inner">
        <Brand />
        <nav className={`landing-nav ${menuOpen ? 'is-open' : ''}`} id="landing-navigation" aria-label="Main navigation">
          <a href={user ? '#fleet' : '#login'} onClick={handleFleetClick}>Explore the fleet</a>
          <a href="#how-it-works" onClick={closeMenu}>How it works</a>
          <a href="#why-drivepulse" onClick={closeMenu}>Why DrivePulse</a>
          <a className="landing-mobile-portal" href="#login" onClick={closeMenu}>Sign in <Icon name="arrow" /></a>
          <a className="landing-mobile-portal" href="#signup" onClick={closeMenu}>Create account <Icon name="arrow" /></a>
        </nav>
        <div className="landing-header-actions">
          <a className="landing-signin" href="#login">Sign in</a>
          <a className="button button-dark landing-portal" href="#signup">Create account <Icon name="diagonal" /></a>
          <button className="icon-button landing-menu-toggle" aria-label={menuOpen ? 'Close menu' : 'Open menu'} aria-controls="landing-navigation" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}><Icon name={menuOpen ? 'close' : 'menu'} size={24} /></button>
        </div>
      </div>
    </header>

    <main id="landing-main" tabIndex={-1}>
      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="landing-hero-photo" />
        <div className="landing-container landing-hero-inner">
          <div className="landing-hero-copy">
            <p className="landing-eyebrow"><span /> THE OPEN ROAD IS CALLING</p>
            <h1 id="landing-title">Your next chapter.<br /><span>Starts with a drive.</span></h1>
            <p className="landing-hero-description">City plans. Weekend escapes. The long way home.<br className="desktop-break" /> Find the right ride for wherever life takes you.</p>
            <a href={user ? '#fleet' : '#login'} onClick={handleFleetClick} className="button landing-button-light">Explore the fleet <Icon name="diagonal" size={22} /></a>
            <div className="landing-hero-location"><Icon name="pin" size={17} /> Metro Manila, Philippines</div>
          </div>
          <button className="landing-featured-car" onClick={onFeature}><span><small>IN THE SPOTLIGHT</small><strong>Porsche Panamera</strong><span>For the love of the drive.</span></span><span className="landing-featured-arrow"><Icon name="diagonal" size={24} /></span></button>
        </div>
      </section>

      <div className="landing-container landing-search-wrap">{searchBar}</div>

      <section className="landing-container landing-fleet landing-section" aria-labelledby="landing-fleet-title">
        <div className="landing-section-heading"><div><p className="landing-eyebrow">A RIDE FOR EVERY REASON</p><h2 id="landing-fleet-title">Good plans deserve a great car.</h2></div><a className="landing-text-link" href={user ? '#fleet' : '#login'} onClick={handleFleetClick}>View all vehicles <Icon name="arrow" size={22} /></a></div>
        <div className="landing-vehicle-grid">{featured.map(renderVehicle)}</div>
        <p className="landing-fleet-note"><Icon name="info" size={17} /> Illustrative fleet and ratings. Daily rates are in PHP; availability reflects current fleet reservations.</p>
      </section>

      <section className="landing-how-section" id="how-it-works" aria-labelledby="how-title">
        <div className="landing-container landing-how-layout">
          <div className="landing-how-intro"><p className="landing-eyebrow">LESS ADMIN. MORE ADVENTURE.</p><h2 id="how-title">A few simple steps.<br />A world of possibility.</h2><p>From your first search to your next journey, keep the details in one easy place.</p><a href={user ? '#fleet' : '#login'} onClick={handleFleetClick} className="landing-text-link">Find your next ride <Icon name="arrow" size={22} /></a></div>
          <ol className="landing-steps">{steps.map(step => <li key={step.number}><span className="landing-step-number">{step.number}</span><div><h3>{step.title}</h3><p>{step.copy}</p></div><Icon name={step.icon} size={27} /></li>)}</ol>
        </div>
      </section>

      <section className="landing-container landing-why landing-section" id="why-drivepulse" aria-labelledby="why-title">
        <div className="landing-why-image"><img src="/images/mercedes.jpg" alt="Mercedes-Benz ready for the next journey" loading="lazy" /><span>TAKE THE LONG WAY HOME.</span></div>
        <div className="landing-why-copy"><p className="landing-eyebrow">THE DETAILS MAKE THE DIFFERENCE</p><h2 id="why-title">More clarity.<br />More open road.</h2><p>A thoughtful rental experience starts with knowing what to expect. Explore the fleet and find a ride that fits your plans.</p><ul><li><Icon name="check" /><span><strong>A clear quotation.</strong>See the daily rental and refundable deposit before you reserve.</span></li><li><Icon name="check" /><span><strong>Support along the way.</strong>Our team can help with rental requirements, pick-up, and return.</span></li><li><Icon name="check" /><span><strong>A car for your plans.</strong>Explore sedans, SUVs, luxury cars, and electric rides.</span></li></ul></div>
      </section>

      <section className="landing-cta" aria-labelledby="cta-title"><div className="landing-container landing-cta-inner"><div><p className="landing-eyebrow">YOUR NEXT CHAPTER IS OUT THERE</p><h2 id="cta-title">A little freedom.<br />A lot of possibility.</h2></div><div><a className="button landing-button-light" href={user ? '#fleet' : '#login'} onClick={handleFleetClick}>Explore the fleet <Icon name="diagonal" size={22} /></a><a className="landing-cta-portal" href="#how-it-works">See how it works <Icon name="arrow" size={19} /></a></div></div></section>
    </main>

    <footer className="landing-footer"><div className="landing-container"><div className="landing-footer-top"><div><Brand /><p>Go places. Make memories.</p></div><nav aria-label="Explore"><span>EXPLORE</span><a href={user ? '#fleet' : '#login'} onClick={handleFleetClick}>Our fleet</a><a href="#how-it-works">How it works</a><a href="#why-drivepulse">Why DrivePulse</a></nav><nav aria-label="Account"><span>ACCOUNT</span><a href="#login">Sign in</a><a href="#signup">Create an account</a></nav><div className="landing-footer-location"><span>FIND YOUR OPEN ROAD</span><p><Icon name="pin" size={19} />Metro Manila, Philippines</p><small>A car for every kind of chapter.</small></div></div><div className="landing-footer-bottom"><span>© {new Date().getFullYear()} DrivePulse.</span><p>Cash payments at the counter.</p><a href="#home">Back to top <Icon name="arrow" size={17} /></a></div></div></footer>
  </>
}
