import { useEffect, useState } from 'react'
import { api } from '../api.js'

export default function useLocations() {
  const [state, setState] = useState({ locations: [], loading: true, error: '' })
  useEffect(() => {
    let active = true
    api('/locations').then(locations => { if (active) setState({ locations: locations.map(location => location.name), loading: false, error: locations.length ? '' : 'No operational pick-up locations are available.' }) })
      .catch(error => { if (active) setState({ locations: [], loading: false, error: error.message }) })
    return () => { active = false }
  }, [])
  return state
}
