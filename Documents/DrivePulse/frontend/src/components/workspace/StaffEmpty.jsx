import Icon from '../ui/Icon.jsx'

export default function Empty({ children }) { return <div className="workspace-empty"><Icon name="road" size={32} /><h3>Everything in its place.</h3><p>{children}</p></div> }
