import Icon from '../ui/Icon.jsx'

export default function WorkspaceEmpty({ title, copy }) { return <div className="workspace-empty"><Icon name="road" size={38} /><h3>{title}</h3><p>{copy}</p></div> }
