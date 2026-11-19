// الجامع — hadith.dev for Windows, macOS and Linux.
//
// The app is hadith.dev in its own window and its own browser profile (the app's userData folder). Offline works
// the way the installed browser app and the Android app do: the site's service worker keeps the offline reader,
// and «الجامع دون إنترنت» downloads the encyclopedia into the profile's storage (PGlite in OPFS). That profile
// belongs to the app alone, so nothing the user does in their browser — clearing data, private windows, quota —
// touches it. The site treats this window as an installed app (window.hadithDesktop, preload.js). docs/desktop.md.
const { app, BrowserWindow, shell, Menu, dialog, session } = require('electron')
const path = require('node:path')

const SITE = 'https://hadith.dev'
const SITE_HOSTS = new Set(['hadith.dev', 'www.hadith.dev'])

// A separate profile for tests (HADITH_PROFILE=<folder>), so a test never touches the user's downloaded data.
if (process.env.HADITH_PROFILE) app.setPath('userData', path.resolve(process.env.HADITH_PROFILE))

// One running app: a second launch focuses the window that is already open.
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

// What the site may ask the app for. Everything else (camera, location, notifications …) is refused.
const ALLOWED = new Set(['persistent-storage', 'clipboard-sanitized-write', 'clipboard-read', 'fullscreen', 'storage-access'])
function setupPermissions() {
  const ok = (permission, origin) => ALLOWED.has(permission) && isSite(origin || '')
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) =>
    callback(ok(permission, details?.requestingUrl || wc.getURL())))
  session.defaultSession.setPermissionCheckHandler((_wc, permission, origin) => ok(permission, origin))
}

const WEB_PREFS = {
  preload: path.join(__dirname, 'preload.js'),
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  spellcheck: false,
  additionalArguments: [`--hadith-version=${app.getVersion()}`],
}

// Every window (the main one and any the site opens): site pages stay in the app, other sites open in the
// user's browser, and the usual browser keys work although there is no menu bar.
function guard(wc) {
  wc.setWindowOpenHandler(({ url }) => {
    if (isSite(url)) {
      return { action: 'allow', overrideBrowserWindowOptions: { width: 1180, height: 820, autoHideMenuBar: true, icon: path.join(__dirname, 'build', 'icon.png'), webPreferences: WEB_PREFS } }
    }
    openOutside(url)
    return { action: 'deny' }
  })
  wc.on('will-navigate', (e, url) => {
    if (!isSite(url) && !url.startsWith('file:')) { e.preventDefault(); openOutside(url) }
  })
  wc.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return
    const mod = input.control || input.meta
    const key = input.key
    let handled = true
    if (input.alt && key === 'ArrowLeft') wc.navigationHistory.goBack()
    else if (input.alt && key === 'ArrowRight') wc.navigationHistory.goForward()
    else if (key === 'F5' || (mod && key.toLowerCase() === 'r')) wc.reload()
    else if (mod && (key === '=' || key === '+')) wc.setZoomLevel(wc.getZoomLevel() + 0.5)
    else if (mod && key === '-') wc.setZoomLevel(wc.getZoomLevel() - 0.5)
    else if (mod && key === '0') wc.setZoomLevel(0)
    else if (key === 'F11') { const w = BrowserWindow.fromWebContents(wc); if (w) w.setFullScreen(!w.isFullScreen()) }
    else handled = false
    if (handled) e.preventDefault()
  })
  // No connection and nothing kept by the site's service worker yet (the reader was never opened offline-ready):
  // a local page that explains and retries.
  wc.on('did-fail-load', (_e, code, _desc, url, isMainFrame) => {
    if (isMainFrame && code !== -3 /* aborted */ && isSite(url)) {
      wc.loadFile(path.join(__dirname, 'pages', 'no-connection.html'), { query: { to: url } })
    }
  })
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
    webPreferences: WEB_PREFS,
  })
  win.once('ready-to-show', () => win.show())
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
      detail: 'يُثبَّت التحديث عند إعادة تشغيل التطبيق. الموسوعة المحفوظة على الجهاز تبقى كما هي.',
    })
    if (response === 0) autoUpdater.quitAndInstall()
  })
  autoUpdater.on('error', err => console.error('update:', err?.message || err))
  autoUpdater.checkForUpdates().catch(() => {})
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 6 * 60 * 60 * 1000)
}

function start() {
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null)
  setupPermissions()
  app.on('web-contents-created', (_e, wc) => guard(wc))
  createWindow()
  setupUpdates()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
}

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
