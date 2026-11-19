// Writes latest.json next to the installers: what https://hadith.dev/offline shows as download links.
//   node desktop/scripts/write-latest-json.mjs <folder with the installers> <version>
// Only the files actually present are listed, so a platform whose build is missing simply isn't offered.
import { readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [dir, version] = process.argv.slice(2)
if (!dir || !version) { console.error('usage: write-latest-json.mjs <dir> <version>'); process.exit(1) }

const files = readdirSync(dir)
const pick = re => {
  const name = files.find(f => re.test(f))
  return name ? { file: name, size: statSync(join(dir, name)).size } : undefined
}
const v = version.replace(/^desktop-v|^v/, '').replace(/\./g, '\\.')
const downloads = {
  windows: pick(new RegExp(`^hadith-${v}-win-x64\\.exe$`)),
  macArm: pick(new RegExp(`^hadith-${v}-mac-arm64\\.dmg$`)),
  macIntel: pick(new RegExp(`^hadith-${v}-mac-x64\\.dmg$`)),
  linuxAppImage: pick(new RegExp(`^hadith-${v}-linux-x86_64\\.AppImage$`)),
  linuxDeb: pick(new RegExp(`^hadith-${v}-linux-amd64\\.deb$`)),
}
for (const k of Object.keys(downloads)) if (!downloads[k]) delete downloads[k]

const out = { version: version.replace(/^desktop-v|^v/, ''), date: new Date().toISOString().slice(0, 10), downloads }
writeFileSync(join(dir, 'latest.json'), JSON.stringify(out, null, 2) + '\n')
console.log(JSON.stringify(out, null, 2))
