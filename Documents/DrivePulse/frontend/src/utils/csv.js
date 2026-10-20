import { downloadFile } from '../storage.js'

const csvCell = value => `"${String(value ?? '').replace(/^[=+\-@\t\r]/, "'$&").replaceAll('"', '""')}"`

export function exportCSV(rows, name) {
  downloadFile('\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n'), name, 'text/csv;charset=utf-8')
}
