export default function Tag({ children, solid = false }) { return <span className={`workspace-tag ${solid ? 'tag-solid' : ''}`}>{children}</span> }
