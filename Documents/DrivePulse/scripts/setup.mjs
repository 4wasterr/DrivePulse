import { spawn } from 'node:child_process'
import { copyFile, access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Use Node.js 24.x.')
const npm = process.env.npm_execpath
if (!npm) throw new Error('Run this setup with npm run setup (npm.cmd run setup in PowerShell).')
for (const folder of ['backend', 'frontend']) {
  await new Promise((resolveJob, reject) => {
    const child = spawn(process.execPath, [npm, 'ci', '--include=dev'], { cwd: resolve(root, folder), stdio: 'inherit', windowsHide: true })
    child.on('error', reject)
    child.on('exit', code => code === 0 ? resolveJob() : reject(new Error(`${folder} installation failed (${code}).`)))
  })
}
const localEnv = resolve(root, 'backend/.env')
try { await access(localEnv) }
catch { await copyFile(resolve(root, 'backend/.env.example'), localEnv, constants.COPYFILE_EXCL) }
console.log('Setup complete. Run npm run dev, then open http://127.0.0.1:5173.')
