// The Android app's downloads (android/, docs/android.md): latest.json, published next to the signed APK
// on Cloudflare R2. Shared by /offline («الجامع للأندرويد») and in-app helpers via window.hadithAndroid.

export const ANDROID_BASE = (process.env.NEXT_PUBLIC_ANDROID_URL || 'https://files.hadith.dev/android').replace(/\/+$/, '')

export type AndroidLatest = {
  version: string
  versionCode: number
  date: string
  minAndroid?: string
  offline?: boolean
  file: string
  size: number
  sha256?: string
}

declare global {
  interface Window {
    hadithAndroid?: {
      isAndroid: () => boolean
      getVersionName: () => string
      getVersionCode: () => number
      share?: (title: string, text: string, url: string) => void
      copyText?: (text: string) => void
      setKeepScreenOn?: (enabled: boolean) => void
      onThemeChanged?: (isDark: boolean) => void
    }
  }
}

export const inAndroidApp = () =>
  typeof window !== 'undefined' &&
  (!!window.hadithAndroid?.isAndroid?.() ||
    (typeof navigator !== 'undefined' && /\bHadithAndroid\//i.test(navigator.userAgent)))

export function installedAndroidVersionCode(): number {
  if (!inAndroidApp()) return 0
  try {
    return Number(window.hadithAndroid?.getVersionCode?.()) || 0
  } catch {
    return 0
  }
}

export function isAndroidDevice(): boolean {
  if (inAndroidApp()) return true
  if (typeof navigator === 'undefined') return false
  return /android/i.test(navigator.userAgent)
}

export const androidApkUrl = (a: Pick<AndroidLatest, 'file'>) => `${ANDROID_BASE}/${encodeURIComponent(a.file)}`

/** latest.json, or null before the first release / without a connection. */
export async function fetchAndroidLatest(): Promise<AndroidLatest | null> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return null
  try {
    const r = await fetch(`${ANDROID_BASE}/latest.json`, { cache: 'no-store' })
    return r.ok ? ((await r.json()) as AndroidLatest) : null
  } catch {
    return null
  }
}
