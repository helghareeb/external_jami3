// الجامع — hadith.dev for Windows, macOS and Linux.
//
// Stage 1 (now): the site itself in a secure window, with automatic app updates.
// Stage 2 (after the PWA work lands): the offline edition — the database downloaded once into the app's own
// folder (userData), not the browser's storage, so it is never evicted. See docs/desktop.md.
const { app, BrowserWindow, shell, Menu, dialog } = require('electron')
const path = require('node:path')

const SITE = 'https://hadith.dev'
const SITE_HOSTS = new Set(['hadith.dev', 'www.hadith.dev'])

// One window per running app: a second launch focuses the first.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const w = BrowserWindow.getAllWindows()[0]
    if (w) { if (w.isMinimized()) w.restore(); w.focus() }
  })
  app.whenReady().then(start)
}

function isSite(url) {
  try { const u = new URL(url); return u.protocol === 'https:' && SITE_HOSTS.has(u.hostname) } catch { return false }
}

function openOutside(url) {
  try { if (['https:', 'http:', 'mailto:'].includes(new URL(url).protocol)) shell.openExternal(url) } catch { /* ignore */ }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 380,
    minHeight: 500,
    title: 'الجامع — hadith.dev',
    icon: path.join(__dirname, 'build', 'icon.png'),
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      additionalArguments: [`--hadith-version=${app.getVersion()}`],
    },
  })
  win.once('ready-to-show', () => win.show())

  // Links to other sites open in the user's browser; hadith.dev pages stay in the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSite(url)) return { action: 'allow' }
    openOutside(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (!isSite(url) && !url.startsWith('file:')) { e.preventDefault(); openOutside(url) }
  })

  // No connection (stage 1 needs one): a local page that retries.
  win.webContents.on('did-fail-load', (_e, code, _desc, url, isMainFrame) => {
    if (isMainFrame && code !== -3 /* aborted */ && isSite(url)) {
      win.loadFile(path.join(__dirname, 'pages', 'no-connection.html'), { query: { to: url } })
    }
  })

  win.loadURL(SITE)
  return win
}

function setupUpdates() {
  if (!app.isPackaged) return
  // macOS only updates itself when the app is signed; until then the site tells Mac users about new versions.
  if (process.platform === 'darwin') return
  const { autoUpdater } = require('electron-updater')
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('update-downloaded', async info => {
    const { response } = await dialog.showMessageBox({
      type: 'info',
      buttons: ['أعد التشغيل الآن', 'لاحقًا'],
      defaultId: 0,
      cancelId: 1,
      title: 'تحديث الجامع',
      message: `الإصدار ${info.version} جاهز`,
      detail: 'يُثبَّت التحديث عند إعادة تشغيل التطبيق.',
    })
    if (response === 0) autoUpdater.quitAndInstall()
  })
  autoUpdater.on('error', err => console.error('update:', err?.message || err))
  autoUpdater.checkForUpdates().catch(() => {})
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 6 * 60 * 60 * 1000)
}

function start() {
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null)
  createWindow()
  setupUpdates()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
}

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
