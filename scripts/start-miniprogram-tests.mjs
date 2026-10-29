import { spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const directory = path.join(root, '.ai-docs/miniprogram')
await mkdir(directory, { recursive: true })
const build = spawnSync(process.execPath, ['scripts/build-miniprogram.mjs'], { cwd: root, stdio: 'inherit' })
if (build.status !== 0) process.exit(build.status || 1)
async function freePort(start) {
  for (let port = start; port <= 65535; port++) {
    if (await new Promise(resolve => {
      const server = createServer()
      server.on('error', () => resolve(false))
      server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)))
    })) return port
  }
  throw new Error('No free test port')
}
const reporterPort = await freePort(18420)
const devices = []
let next = reporterPort + 1
for (const [width, height] of [[375, 812], [320, 568], [414, 896]]) {
  const port = await freePort(next)
  devices.push({ width, height, port, url: `http://127.0.0.1:${port}/?yingqianTest=1` })
  next = port + 1
}
const config = { reporterPort, devices }
const configPath = path.join(directory, 'runtime-servers.json')
await writeFile(configPath, JSON.stringify(config, null, 2))
const quote = value => `'${value.replace(/'/g, `'\\''`)}'`
const session = `framesign-mini-tests-${reporterPort}`
const command = `${quote(process.execPath)} ${quote(path.join(root, 'tests/miniprogram.wxa.server.mjs'))} ${quote(configPath)} > ${quote(path.join(directory, 'runtime-server.log'))} 2>&1`
const result = spawnSync('tmux', ['new-session', '-d', '-s', session, '-c', root, command], { encoding: 'utf8' })
if (result.status !== 0) throw new Error(result.stderr || 'Cannot start test servers in tmux')
console.log(`Runtime test servers started in tmux session ${session}. Open each URL in a browser:`)
for (const device of devices) console.log(`${device.width} x ${device.height}: ${device.url}`)
console.log(`Reports are saved to ${directory}/runtime-<width>.json`)
