// Stages the signed Android release APK and writes latest.json for Cloudflare R2 (files.hadith.dev/android/).
// Usage: node android/scripts/stage-release.mjs
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..', '..')
const gradlePath = join(repoRoot, 'android', 'app', 'build.gradle.kts')
const apkSrc = join(repoRoot, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk')
const outDir = join(repoRoot, 'out', 'android')

if (!existsSync(apkSrc)) {
  console.error(`Missing signed release APK at ${apkSrc}. Run '.\\gradlew.bat assembleRelease' from android/ first.`)
  process.exit(1)
}

const gradleText = readFileSync(gradlePath, 'utf8')
const versionMatch = gradleText.match(/versionName\s*=\s*"([^"]+)"/)
const codeMatch = gradleText.match(/versionCode\s*=\s*(\d+)/)
if (!versionMatch || !codeMatch) {
  console.error('Could not parse versionName / versionCode from android/app/build.gradle.kts')
  process.exit(1)
}

const version = versionMatch[1]
const versionCode = Number(codeMatch[1])
const fileName = `hadith-${version}-android.apk`
const apkDest = join(outDir, fileName)

mkdirSync(outDir, { recursive: true })
copyFileSync(apkSrc, apkDest)

const size = statSync(apkDest).size
const sha256 = createHash('sha256').update(readFileSync(apkDest)).digest('hex')

const latest = {
  version,
  versionCode,
  date: new Date().toISOString().slice(0, 10),
  minAndroid: '8.0',
  offline: true,
  file: fileName,
  size,
  sha256,
}

writeFileSync(join(outDir, 'latest.json'), JSON.stringify(latest, null, 2) + '\n')
console.log(JSON.stringify(latest, null, 2))
