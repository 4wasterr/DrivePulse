import { useEffect, useState } from 'react'
import Icon from '../../components/ui/Icon.jsx'

const slides = [
  { image: '/images/hero-porsche.jpg', name: 'Porsche Panamera', position: 'center 60%' },
  { image: '/images/bmw.jpg', name: 'BMW M5', position: 'center 58%' },
  { image: '/images/mercedes.jpg', name: 'Mercedes-AMG GT', position: 'center 58%' },
]

export default function HeroCarousel({ children }) {
  const [slide, setSlide] = useState(0)
  const [playing, setPlaying] = useState(() => !window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [hovered, setHovered] = useState(false)
  const [hidden, setHidden] = useState(() => document.hidden)

  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const changeMotion = () => { if (motion.matches) setPlaying(false) }
    const changeVisibility = () => setHidden(document.hidden)
    motion.addEventListener('change', changeMotion)
    document.addEventListener('visibilitychange', changeVisibility)
    return () => {
      motion.removeEventListener('change', changeMotion)
      document.removeEventListener('visibilitychange', changeVisibility)
    }
  }, [])

  useEffect(() => {
    if (!playing || hovered || hidden) return
    const timer = setInterval(() => setSlide(current => (current + 1) % slides.length), 6500)
    return () => clearInterval(timer)
  }, [playing, hovered, hidden, slide])

  function select(index) {
    setPlaying(false)
    setSlide((index + slides.length) % slides.length)
  }

  return <section className="landing-hero" aria-labelledby="landing-title" aria-roledescription="carousel" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onFocusCapture={event => { if (!event.target.closest('[data-carousel-rotation]')) setPlaying(false) }}>
    <div className="landing-hero-photos" aria-hidden="true">{slides.map((item, index) => <img key={item.image} className={slide === index ? 'is-active' : ''} src={item.image} alt="" style={{ objectPosition: item.position }} fetchPriority={index === 0 ? 'high' : 'low'} decoding="async" />)}</div>
    {children}
    <div className="landing-container landing-carousel-bar">
      <div className="landing-carousel-caption"><span>FLEET OPERATIONS WITH DRIVEPULSE</span><strong>{slides[slide].name}</strong></div>
      <div className="landing-carousel-controls" role="group" aria-label="Hero slideshow controls" onKeyDown={event => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault()
          select(slide + (event.key === 'ArrowLeft' ? -1 : 1))
        }
      }}>
        <button type="button" className="landing-carousel-arrow" data-carousel-rotation aria-label={playing ? 'Pause slideshow' : 'Play slideshow'} onClick={() => setPlaying(current => !current)}><Icon name={playing ? 'pause' : 'play'} size={16} /></button>
        <button type="button" className="landing-carousel-arrow" aria-label="Previous car image" onClick={() => select(slide - 1)}><Icon name="arrowLeft" size={18} /></button>
        <div className="landing-carousel-dots">{slides.map((item, index) => <button key={item.image} type="button" aria-label={`Show ${item.name} image`} aria-pressed={slide === index} onClick={() => select(index)}><span /></button>)}</div>
        <button type="button" className="landing-carousel-arrow" aria-label="Next car image" onClick={() => select(slide + 1)}><Icon name="arrow" size={18} /></button>
        <span className="landing-carousel-count" aria-hidden="true">0{slide + 1}<span> / 0{slides.length}</span></span>
      </div>
      <span className="sr-only" aria-live={playing ? 'off' : 'polite'} aria-atomic="true">Image {slide + 1} of {slides.length}: {slides[slide].name}</span>
    </div>
  </section>
}
