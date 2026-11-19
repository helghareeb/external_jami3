// Where the reader is: inside one of our apps (desktop app, Android app, the browser app installed on the home
// screen) or on the website in an ordinary browser. Decides where «install» and «download the encyclopedia»
// lead: outside our apps to /apps (the installers), inside them to /offline (the encyclopedia's download/update).
import { inDesktopApp } from './desktopApps'
import { inAndroidApp } from './androidApp'

export type Where = 'desktop-app' | 'android-app' | 'pwa' | 'browser'

const installedPwa = () =>
  ['standalone', 'fullscreen', 'window-controls-overlay', 'tabbed', 'minimal-ui'].some(m => window.matchMedia(`(display-mode: ${m})`).matches) ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true

export function whereAmI(): Where {
  if (typeof window === 'undefined') return 'browser'
  if (inDesktopApp()) return 'desktop-app'
  if (inAndroidApp()) return 'android-app'
  if (installedPwa()) return 'pwa'
  return 'browser'
}

export const inOurApp = () => whereAmI() !== 'browser'

/** iPhone and iPad: no app of ours yet, so the browser app on the home screen is the app there. */
export const isIosDevice = () =>
  typeof navigator !== 'undefined' &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1))

export const isAndroidBrowser = () =>
  typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent) && !inAndroidApp()
