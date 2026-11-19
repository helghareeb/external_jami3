'use client'

// «الجامع للأندرويد»: direct APK download link on /offline, read from latest.json published next to the
// signed APK on R2. Inside the Android app itself, hidden unless a newer versionCode is available.
import { useEffect, useState } from 'react'
import { formatBytes } from '@/lib/offline/client'
import {
  androidApkUrl, fetchAndroidLatest, inAndroidApp, installedAndroidVersionCode, isAndroidDevice,
  type AndroidLatest,
} from '@/lib/androidApp'
import { AndroidIcon } from './PlatformIcons'

export default function AndroidApp() {
  const [latest, setLatest] = useState<AndroidLatest | null | 'none'>(null)
  const [mine, setMine] = useState(false)
  const [inApp, setInApp] = useState(false)
  const [installedCode, setInstalledCode] = useState(0)

  useEffect(() => {
    setMine(isAndroidDevice())
    setInApp(inAndroidApp())
    setInstalledCode(installedAndroidVersionCode())
    fetchAndroidLatest().then(l => setLatest(l ?? 'none'))
  }, [])

  useEffect(() => {
    if (latest !== null && location.hash === '#android') {
      requestAnimationFrame(() => document.getElementById('android')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    }
  }, [latest])

  if (latest === null) return null
  if (inApp) {
    if (latest === 'none' || latest.versionCode <= installedCode) return null
    return (
      <section id="android" className="mt-4 rounded-2xl border border-primary bg-primary-soft p-4 sm:p-5 font-sans shadow-sm scroll-mt-20" aria-labelledby="android-app-update">
        <h2 id="android-app-update" className="font-bold text-green-900">تحديث متاح لتطبيق الأندرويد</h2>
        <p className="text-sm text-muted mt-1">
          يتوفّر الإصدار <bdi dir="ltr">{latest.version}</bdi> من تطبيق الجامع للأندرويد.
        </p>
        <div className="mt-3">
          <a href={androidApkUrl(latest)} download
            className="inline-flex items-center justify-between gap-4 rounded-full bg-primary text-on-dark font-bold px-5 py-2.5 text-sm">
            <span>تنزيل التحديث (APK)</span>
            <span className="text-xs font-normal opacity-80 whitespace-nowrap">{formatBytes(latest.size)}</span>
          </a>
        </div>
      </section>
    )
  }

  return (
    <section id="android" className="mt-4 rounded-2xl border border-border bg-surface p-4 sm:p-5 font-sans shadow-sm scroll-mt-20" aria-labelledby="android-app">
      <h2 id="android-app" className="font-bold text-green-900">الجامع للأندرويد</h2>
      {latest === 'none' ? (
        <>
          <p className="text-sm text-muted mt-1">تطبيق أندرويد مستقل قريبًا: يُثبَّت على هاتفك مباشرة ويعمل دون إنترنت.</p>
          <div className="mt-3" aria-hidden="true">
            <AndroidIcon className="w-6 h-6" />
          </div>
        </>
      ) : (
        <>
          <div className={'mt-3 rounded-xl border p-3 ' + (mine ? 'border-primary bg-primary-soft' : 'border-border')}>
            <p className="font-bold text-sm flex items-center gap-2">
              <AndroidIcon className="w-5 h-5 shrink-0" />
              <span>أندرويد (<bdi dir="ltr">APK</bdi>)</span>
              {mine && <span className="text-xs text-muted font-normal">— جهازك</span>}
            </p>
            <div className="mt-2.5 flex flex-wrap items-center gap-3">
              <a href={androidApkUrl(latest)} download
                className={mine
                  ? 'inline-flex items-center justify-between gap-4 rounded-full bg-primary text-on-dark font-bold px-5 py-2 text-sm'
                  : 'inline-flex items-center justify-between gap-4 rounded-full border border-primary text-primary font-bold px-5 py-2 text-sm'}>
                <span>تنزيل للأندرويد (<bdi dir="ltr">APK</bdi>)</span>
                <span className="text-xs font-normal opacity-80 whitespace-nowrap">{formatBytes(latest.size)}</span>
              </a>
            </div>
            <p className="text-xs text-muted mt-2">
              إن طُلب: اسمح بالتثبيت من المتصفح
            </p>
          </div>
        </>
      )}
    </section>
  )
}
