import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const jobs = [
  spawn(process.execPath, ['--watch', 'index.js'], { cwd: resolve(root, 'backend'), stdio: 'inherit', windowsHide: true }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--strictPort'], { cwd: resolve(root, 'frontend'), stdio: 'inherit', windowsHide: true }),
]
let stopping = false
function stop(code = 0) { if (stopping) return; stopping = true; jobs.forEach(job => job.kill()); process.exitCode = code }
jobs.forEach(job => { job.on('error', error => { console.error(error.message); stop(1) }); job.on('exit', code => { if (!stopping) stop(code || 0) }) })
process.on('SIGINT', () => stop())
process.on('SIGTERM', () => stop())
