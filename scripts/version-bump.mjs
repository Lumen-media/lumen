import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')

const raw = process.argv[2] ?? ''
const match = /^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(raw.trim())
if (!match) {
  console.error(`Versão inválida: "${raw}". Use vX.Y.Z (ex: v0.5.0).`)
  process.exit(1)
}
const version = match[1]

const updateJson = (rel) => {
  const path = resolve(root, rel)
  const json = JSON.parse(readFileSync(path, 'utf8'))
  json.version = version
  writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`)
}

updateJson('package.json')
updateJson('src-tauri/tauri.conf.json')

const cargoPath = resolve(root, 'src-tauri/Cargo.toml')
const cargo = readFileSync(cargoPath, 'utf8')
const versionLine = /^(version\s*=\s*)"[^"]*"/m
if (!versionLine.test(cargo)) {
  console.error('Cargo.toml sem campo "version" encontrado.')
  process.exit(1)
}
writeFileSync(cargoPath, cargo.replace(versionLine, `$1"${version}"`))

console.log(
  `Versão bumpada para ${version} em package.json, src-tauri/Cargo.toml e src-tauri/tauri.conf.json`,
)