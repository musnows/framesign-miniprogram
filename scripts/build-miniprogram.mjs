import { build } from 'esbuild'
import { copyFile, mkdir, readdir, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const target = path.join(root, 'miniprogram')
await Promise.all(['lib', 'logos', 'assets', 'workers'].map(name => mkdir(path.join(target, name), { recursive: true })))
try {
  await copyFile(path.join(root, 'project.config.example.json'), path.join(target, 'project.config.json'), constants.COPYFILE_EXCL)
} catch (error) {
  if (error.code !== 'EEXIST') throw error
}
await build({
  entryPoints: [path.join(root, 'src/core.ts')],
  outfile: path.join(target, 'lib/core.js'),
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2019',
  minify: true,
  inject: [path.join(root, 'src/binary.ts')],
  define: { global: 'globalThis' },
  alias: { '~': path.join(root, 'src/shared') },
  logLevel: 'warning'
})
await build({
  entryPoints: [path.join(root, 'src/watermark-worker.ts')],
  outfile: path.join(target, 'workers/watermark.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2019',
  minify: true,
  inject: [path.join(root, 'src/binary.ts')],
  logLevel: 'warning'
})
for (const filename of await readdir(path.join(root, 'assets/logos'))) {
  if (!/\.(png|svg)$/i.test(filename) || filename === 'default.svg') continue
  await sharp(path.join(root, 'assets/logos', filename), { density: 150 })
    .resize({ width: 640, height: 320, fit: 'inside', withoutEnlargement: true })
    .png({ palette: true }).toFile(path.join(target, 'logos', filename.replace(/\.svg$/, '.png')))
}
await sharp(path.join(root, 'assets/yingqian-logo.png')).resize(256, 256).png({ palette: true }).toFile(path.join(target, 'assets/yingqian-logo.png'))
await copyFile(path.join(root, 'assets/sample.jpg'), path.join(target, 'assets/sample.jpg'))
async function size(directory) {
  let bytes = 0
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, item.name)
    bytes += item.isDirectory() ? await size(fullPath) : (await stat(fullPath)).size
  }
  return bytes
}
const bytes = await size(target)
if (bytes > 2 * 1024 * 1024) throw new Error(`Mini-program package exceeds 2 MiB: ${bytes} bytes`)
console.log(`Mini-program built: ${(bytes / 1024).toFixed(0)} KiB. Import ${target} into WeChat DevTools.`)
