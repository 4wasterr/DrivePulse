export function readStorage(key, fallback) {
  try { const value = localStorage.getItem(`drivepulse:${key}`); return value ? JSON.parse(value) : fallback } catch { return fallback }
}

export function writeStorage(key, value) {
  localStorage.setItem(`drivepulse:${key}`, JSON.stringify(value))
}

function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('drivepulse-client', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('documents', { keyPath: 'id' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function putDocument(id, file) {
  const db = await database()
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction('documents', 'readwrite')
      tx.objectStore('documents').put({ id, file, name: file.name, size: file.size, uploadedAt: new Date().toISOString() })
      tx.oncomplete = resolve
      tx.onerror = () => reject(tx.error)
    })
  } finally { db.close() }
}

export async function getDocument(id) {
  const db = await database()
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('documents').objectStore('documents').get(id)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  } finally { db.close() }
}

export function downloadFile(content, filename, type = 'text/plain') {
  const url = URL.createObjectURL(content instanceof Blob ? content : new Blob([content], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const validateFile = (file) => {
  if (!file) return 'Please choose a file.'
  if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return 'Choose a PDF, JPG, PNG, or WebP file.'
  if (file.size > 5 * 1024 * 1024) return 'The file must be smaller than 5 MB.'
  return null
}
