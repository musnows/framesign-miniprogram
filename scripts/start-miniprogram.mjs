import { spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const preferred = Number(process.env.FRAMESIGN_MINI_PORT || process.env.YINGQIAN_MINI_PORT || 18320)
if (!Number.isInteger(preferred) || preferred < 10000 || preferred > 65500) throw new Error('FRAMESIGN_MINI_PORT must be between 10000 and 65500')
const output = path.join(root, '.ai-docs/miniprogram')
await mkdir(output, { recursive: true })
const built = spawnSync(process.execPath, ['scripts/build-miniprogram.mjs'], { cwd: root, stdio: 'inherit' })
if (built.status !== 0) process.exit(built.status || 1)
let port = preferred
for (;;) {
  const available = await new Promise(resolve => {
    const server = createServer()
    server.once('error', () => resolve(false))
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)))
  })
  if (available) break
  if (++port > 65535) throw new Error('No available local port')
}
const session = `framesign-mini-${port}`
const quote = value => `'${value.replace(/'/g, `'\\''`)}'`
const command = `${quote(process.execPath)} ${quote(path.join(root, 'node_modules/wxa-runner/bin/wxa-runner.js'))} dev ${quote(path.join(root, 'miniprogram'))} --host 127.0.0.1 --port ${port} --forward-console > ${quote(path.join(output, `runner-${port}.log`))} 2>&1`
const result = spawnSync('tmux', ['new-session', '-d', '-s', session, '-c', root, command], { encoding: 'utf8' })
if (result.status !== 0) throw new Error(result.stderr || 'tmux could not start wxa-runner')
await writeFile(path.join(output, 'server.json'), JSON.stringify({ port, session, url: `http://127.0.0.1:${port}` }, null, 2))
console.log(`Mini-program runner started in tmux session ${session}: http://127.0.0.1:${port}`)
