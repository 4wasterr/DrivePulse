export default function Tag({ children }) { return <span className={`workspace-tag ${['Out of Service', 'Overdue', 'High', 'unsafe'].includes(children) ? 'tag-solid' : ''}`}>{children}</span> }
