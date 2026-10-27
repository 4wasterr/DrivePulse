import { useEffect, useState } from 'react'
import { api } from '../api.js'

export default function useLocations() {
  const [state, setState] = useState({ locations: [], branches: [], loading: true, error: '' })
  useEffect(() => {
    let active = true
    api('/locations').then(branches => { if (active) setState({ locations: branches.map(branch => branch.name), branches, loading: false, error: branches.length ? '' : 'No active branches are available.' }) })
      .catch(error => { if (active) setState({ locations: [], branches: [], loading: false, error: error.message }) })
    return () => { active = false }
  }, [])
  return state
}
