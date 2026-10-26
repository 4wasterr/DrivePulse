import { Children, cloneElement, isValidElement, useState } from 'react'
import { paginate, PAGE_SIZE } from '../../utils/pagination.js'

function useRows(children, resetKey) {
  const rows = Children.toArray(children)
  const key = `${resetKey || ''}:${rows.map(row => row.key).join('|')}`
  const [position, setPosition] = useState({ key, page: 1 })
  return { ...paginate(rows, position.key === key ? position.page : 1), setPage: page => setPosition({ key, page }) }
}
export function Pagination({ page, pages, total, setPage }) {
  return <nav className="data-pagination" aria-label="Record pagination">
    <span role="status">{total ? `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total}` : '0 records'}</span>
    <span>{PAGE_SIZE} records per page</span>
    <div><button type="button" className="button button-outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page} of {pages}</span><button type="button" className="button button-outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button></div>
  </nav>
}
export function PaginatedList({ children, resetKey }) {
  const data = useRows(children, resetKey)
  return <>{data.items}<Pagination {...data} /></>
}
export function PaginatedTable({ children, resetKey, ...props }) {
  const parts = Children.toArray(children), body = parts.find(child => isValidElement(child) && child.type === 'tbody')
  const data = useRows(body?.props.children, resetKey)
  return <><table {...props}>{parts.map(child => child === body ? cloneElement(body, {}, data.items) : child)}</table><Pagination {...data} /></>
}
