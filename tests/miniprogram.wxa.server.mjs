import { DevServer } from '@open-wxa/wxa-runner-core'
import { createServer } from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const config = JSON.parse(await readFile(process.argv[2], 'utf8'))
const directory = path.join(root, '.ai-docs/miniprogram')
const origins = new Set(config.devices.map(device => `http://127.0.0.1:${device.port}`))
const reports = createServer(async (request, response) => {
  if (origins.has(request.headers.origin)) response.setHeader('Access-Control-Allow-Origin', request.headers.origin)
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  if (request.method === 'OPTIONS') { response.writeHead(204).end(); return }
  if (request.method !== 'POST' || request.url !== '/report') { response.writeHead(404).end(); return }
  try {
    let body = ''
    for await (const chunk of request) { body += chunk; if (body.length > 100000) throw new Error('Report too large') }
    const report = JSON.parse(body)
    if (!config.devices.some(device => String(device.width) === report.device)) throw new Error('Unknown test device')
    await writeFile(path.join(directory, `runtime-${report.device}.json`), JSON.stringify(report, null, 2))
    console.log(`Runtime ${report.device}: ${report.complete ? 'PASS' : 'FAIL'} (${report.results.filter(item => item.passed).length}/${report.results.length})`)
    response.writeHead(200).end('ok')
  } catch { response.writeHead(400).end('Invalid test report') }
})
await new Promise(resolve => reports.listen(config.reporterPort, '127.0.0.1', resolve))
const servers = []
for (const device of config.devices) {
  process.env.WXA_DEVICE_ID = String(device.width)
  process.env.WXA_REPORT_URL = `http://127.0.0.1:${config.reporterPort}/report`
  const server = new DevServer({
    projectPath: path.join(root, 'miniprogram'), host: '127.0.0.1', port: device.port, watch: false,
    device: { screenWidth: device.width, screenHeight: device.height, statusBarHeight: device.width === 320 ? 20 : 44, safeAreaBottom: device.width === 320 ? 0 : 34 },
    setup: path.join(root, 'tests/miniprogram.wxa.setup.mjs'), forwardConsole: 'all'
  })
  await server.start()
  servers.push(server)
  console.log(`Runtime test ready: ${device.url}`)
}
async function stop() { await Promise.all(servers.map(server => server.close())); reports.close() }
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
