// What the site may know about the desktop app: that it runs inside it, its version and the platform.
// The site uses this to hide «download the desktop app» inside the app itself. Nothing else is exposed.
const { contextBridge } = require('electron')

const version = (process.argv.find(a => a.startsWith('--hadith-version=')) || '').split('=')[1] || null

contextBridge.exposeInMainWorld('hadithDesktop', {
  isDesktop: true,
  platform: process.platform,
  version,
})
