export const PAGE_SIZE = 10
export function paginate(items, page = 1) {
  const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE))
  const current = Math.max(1, Math.min(pages, Math.trunc(page) || 1))
  return { items: items.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE), page: current, pages, total: items.length }
}
