// The desktop app's downloads (desktop/, docs/desktop.md): latest.json, published by the release workflow next to
// the installers on R2. Shared by /offline («الجامع لسطح المكتب») and the upgrade prompt in the installed PWA.

export const DESKTOP_BASE = (process.env.NEXT_PUBLIC_DESKTOP_URL || 'https://files.hadith.dev/desktop').replace(/\/+$/, '')

export type DesktopFile = { file: string; size: number }
export type DownloadKey = 'windows' | 'macArm' | 'macIntel' | 'linuxAppImage' | 'linuxDeb'
export type DesktopLatest = {
  version: string
  date: string
  /** true once the desktop app works without a connection (stage 2): only then are PWA users asked to switch */
  offline?: boolean
  downloads: Partial<Record<DownloadKey, DesktopFile>>
}
export type DesktopOs = 'windows' | 'mac' | 'linux' | 'other'

declare global {
  interface Window { hadithDesktop?: { isDesktop: boolean; platform: string; version: string | null } }
}

export const inDesktopApp = () => typeof window !== 'undefined' && !!window.hadithDesktop?.isDesktop

export function detectOs(): DesktopOs {
  if (typeof navigator === 'undefined') return 'other'
  const ua = navigator.userAgent.toLowerCase()
  if (/android|iphone|ipad|ipod/.test(ua) || (ua.includes('macintosh') && navigator.maxTouchPoints > 1)) return 'other'
  const p = ((navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || ua).toLowerCase()
  if (p.includes('win')) return 'windows'
  if (p.includes('mac')) return 'mac'
  if (p.includes('linux') || p.includes('x11') || p.includes('cros')) return 'linux'
  return 'other'
}

export const fileUrl = (f: DesktopFile) => `${DESKTOP_BASE}/${encodeURIComponent(f.file)}`

/** latest.json, or null before the first release / without a connection. */
export async function fetchDesktopLatest(): Promise<DesktopLatest | null> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return null
  try {
    const r = await fetch(`${DESKTOP_BASE}/latest.json`, { cache: 'no-store' })
    return r.ok ? ((await r.json()) as DesktopLatest) : null
  } catch {
    return null
  }
}
