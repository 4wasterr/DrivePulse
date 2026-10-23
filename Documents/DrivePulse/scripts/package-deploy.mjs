import { readdirSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const files = ['package.json', 'README.md', 'vercel.json', '.gitignore', '.vercelignore']
function collect(directory) {
  for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue
    if (['node_modules', 'data', 'dist', '.npm-cache', '.vercel', '.git'].includes(entry.name)) continue
    if ((entry.name === '.env' || entry.name.startsWith('.env.')) && !entry.name.endsWith('.example')) continue
    if (/\.pem$|\.sqlite(?:-|$)/.test(entry.name)) continue
    const relative = directory + '/' + entry.name
    if (entry.isDirectory()) collect(relative)
    else files.push(relative)
  }
}
for (const directory of ['backend', 'frontend', 'scripts', 'docs']) collect(directory)
mkdirSync(join(root, 'artifacts'), { recursive: true })
const archive = join(root, 'artifacts/drivepulse-source.tar.gz')
const manifest = join(tmpdir(), `drivepulse-package-${randomUUID()}.txt`)
try {
  writeFileSync(manifest, files.join('\n') + '\n')
  execFileSync(process.platform === 'win32' ? 'tar.exe' : 'tar', ['-czf', archive, '-T', manifest], { cwd: root, stdio: 'inherit', windowsHide: true })
} finally { unlinkSync(manifest) }
console.log('Created artifacts/drivepulse-source.tar.gz (source only; no credentials, local database, or dependencies).')
