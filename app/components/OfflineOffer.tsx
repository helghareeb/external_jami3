'use client'

// In the installed app: the offer to download the database for use without internet — one button that
// opens «قاعدة البيانات» (/database), where the download runs with its progress bar in view — and while
// it downloads, a small progress pill on every page (tapping it opens /database with the details).
// Once the data is on the device, it asks the service worker to refresh its copy of the offline
// reader, so the reader matches the site after each release, and when a newer edition of the data
// is published (a different manifest version or checksum) it asks the reader to update — on any
// page, not only on /offline. «ليس الآن» asks again a day later, until the update is taken.
import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import {
  fetchOfflineManifest, formatBytes, offlineSupported, refreshOfflineStatus, startOfflineDownload,
  useOfflineState, type OfflineManifest,
} from '@/lib/offline/client'
import { desktopAppReplacesPwa, inDesktopApp } from '@/lib/desktopApps'
import { inAndroidApp } from '@/lib/androidApp'
import { isIosDevice, whereAmI } from '@/lib/appContext'

const DISMISS_KEY = 'offline-offer-dismissed'
const DISMISS_DAYS = 14
const UPDATE_DISMISS_KEY = 'offline-update-dismissed'   // «<version>|<time>»
const UPDATE_DISMISS_DAYS = 1

const standalone = () =>
  inDesktopApp() ||                                      // the desktop app counts as the installed app
  inAndroidApp() ||                                      // the Android app counts as the installed app
  window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true

export default function OfflineOffer() {
  const s = useOfflineState()
  const pathname = usePathname()
  const router = useRouter()
  const [eligible, setEligible] = useState(false)
  const [offer, setOffer] = useState(false)
  const [update, setUpdate] = useState(false)
  const [manifest, setManifest] = useState<OfflineManifest | null>(null)

  useEffect(() => {
    if (!offlineSupported()) return
    // Only inside our apps (desktop, Android) and the iPhone/iPad home-screen copies, which have no app to move to.
    // A browser, or an old browser app on a computer or Android phone, is pointed to the apps instead
    // (DesktopUpgrade, the install bar) and is no longer asked to download or update the encyclopedia.
    const where = whereAmI()
    if (!(where === 'desktop-app' || where === 'android-app' || (where === 'pwa' && isIosDevice()))) return
    let started = false
    try { started = !!localStorage.getItem('offline-ready') || !!localStorage.getItem('offline-started') } catch {}
    if (!standalone() && !started) return
    setEligible(true)
    refreshOfflineStatus().then(status => {
      if (status?.ready) {
        // Bring the offline build up to date, unless this page itself came from the device
        if (pathname !== '/offline' && pathname !== '/database' && !('__OFFLINE_TARGET' in window)) navigator.serviceWorker?.ready.then(r => r.active?.postMessage({ type: 'cache-offline-shell' })).catch(() => {})
        // A newer edition of the data published since this device downloaded its copy?
        if (navigator.onLine) fetchOfflineManifest().then(m => {
          if (!m || !status.manifest) return
          if (m.version === status.version && (!m.sha256 || m.sha256 === status.manifest.sha256)) return
          let dismissed = ''
          try { dismissed = localStorage.getItem(UPDATE_DISMISS_KEY) || '' } catch {}
          const [v, t] = dismissed.split('|')
          if (v === m.version && Date.now() - Number(t || 0) < UPDATE_DISMISS_DAYS * 864e5) return
          setManifest(m)
          setTimeout(() => setUpdate(true), 2000)
        })
        return
      }
      let dismissed = 0
      try { dismissed = Number(localStorage.getItem(DISMISS_KEY)) || 0 } catch {}
      if (Date.now() - dismissed < DISMISS_DAYS * 864e5 && !status?.staged) return
      // On a computer with a desktop release out, the desktop app is offered instead (DesktopUpgrade)
      if (navigator.onLine) desktopAppReplacesPwa().then(desk => { if (!desk) fetchOfflineManifest().then(m => { if (m) { setManifest(m); setTimeout(() => setOffer(true), 3000) } }) })
    })
  }, [])

  if (!eligible || pathname === '/offline' || pathname === '/database') return null
  const busy = s.phase === 'download' || s.phase === 'import'

  if (busy) {
    const p = s.total > 0 ? Math.floor((s.done / s.total) * 100) : 0
    return (
      <a href="/database" aria-label="تقدّم تحميل قاعدة البيانات"
        className="fixed z-[60] left-3 rounded-full bg-[#0F3D2E] text-[#F8F1E4] shadow-xl border border-[#C9A96B]/40 pl-4 pr-2 py-2 flex items-center gap-2 font-sans text-sm"
        style={{ bottom: 'calc(12px + env(safe-area-inset-bottom))' }}>
        <Ring p={p} />
        {s.phase === 'download' ? 'تحميل قاعدة البيانات' : 'تجهيز قاعدة البيانات'} {p.toLocaleString('ar-EG')}٪
      </a>
    )
  }

  if (update && manifest && s.status?.ready) {
    const later = () => {
      setUpdate(false)
      try { localStorage.setItem(UPDATE_DISMISS_KEY, `${manifest.version}|${Date.now()}`) } catch {}
    }
    // Started here, followed on /database (a client-side move, so the download carries on)
    const go = () => { setUpdate(false); startOfflineDownload(); router.push('/database') }
    return (
      <div role="dialog" aria-label="تحديث قاعدة البيانات على جهازك"
        className="fixed inset-x-3 sm:inset-x-auto sm:left-4 sm:w-[420px] z-[60] rounded-2xl bg-[#0F3D2E] text-[#F8F1E4] shadow-2xl border border-[#C9A96B]/40 p-4 font-sans"
        style={{ bottom: 'calc(12px + env(safe-area-inset-bottom))' }}>
        <p className="font-bold">تحديث متاح لقاعدة البيانات</p>
        <p className="text-xs opacity-80 leading-relaxed mt-1">
          صدر إصدار أحدث من قاعدة البيانات ({manifest.version})، فحدِّث نسختك ليبقى ما تقرؤه دون إنترنت مطابقًا للموقع.
          {' '}حجم التحديث {formatBytes(manifest.downloadSize)} (يُفضَّل عبر Wi-Fi).
        </p>
        <div className="flex items-center gap-2 mt-3">
          <button type="button" onClick={go} className="rounded-full bg-[#C9A96B] text-[#13261b] text-sm font-bold px-4 py-2">
            تحديث الآن
          </button>
          <a href="/database" className="text-sm underline underline-offset-2 opacity-90">التفاصيل</a>
          <button type="button" onClick={later} className="mr-auto text-sm opacity-70 hover:opacity-100">ليس الآن</button>
        </div>
      </div>
    )
  }

  if (!offer || s.status?.ready) return null
  const resuming = (s.status?.staged ?? 0) > 0
  const dismiss = () => {
    setOffer(false)
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())) } catch {}
  }

  // In an installed native app (desktop or Android) «الجامع» is already installed: only the database to download
  const desk = inDesktopApp() || inAndroidApp()
  return (
    <div role="dialog" aria-label="تحميل قاعدة البيانات للعمل دون إنترنت"
      className="fixed inset-x-3 sm:inset-x-auto sm:left-4 sm:w-[420px] z-[60] rounded-2xl bg-[#0F3D2E] text-[#F8F1E4] shadow-2xl border border-[#C9A96B]/40 p-4 font-sans"
      style={{ bottom: 'calc(12px + env(safe-area-inset-bottom))' }}>
      <p className="font-bold">{resuming ? 'أكمل تحميل قاعدة البيانات' : 'تحميل قاعدة البيانات للعمل دون إنترنت'}</p>
      <p className="text-xs opacity-80 leading-relaxed mt-1">
        {resuming
          ? `تمّ تحميل ${formatBytes(s.status!.stagedBytes)}، ويكمل التحميل من حيث توقّف.`
          : desk
            ? 'التطبيق مثبّت لديك. حمّل قاعدة بيانات الموسوعة مرة واحدة ليعمل الجامع كاملًا دون اتصال بالإنترنت.'
            : 'حمّل قاعدة بيانات الموسوعة على جهازك مرة واحدة ليعمل الجامع كاملًا دون اتصال بالإنترنت.'}
        {manifest && <> حجم قاعدة البيانات {formatBytes(manifest.downloadSize)} (يُفضَّل عبر Wi-Fi).</>}
      </p>
      <div className="flex items-center gap-2 mt-3">
        {/* One way in: the download itself starts on /database, where its progress is shown in full */}
        <a href="/database" onClick={() => setOffer(false)} className="rounded-full bg-[#C9A96B] text-[#13261b] text-sm font-bold px-4 py-2">
          {resuming ? 'متابعة تحميل قاعدة البيانات' : 'تحميل قاعدة البيانات'}
        </a>
        <button type="button" onClick={dismiss} className="mr-auto text-sm opacity-70 hover:opacity-100">ليس الآن</button>
      </div>
    </div>
  )
}

const Ring = ({ p }: { p: number }) => (
  <svg width="22" height="22" viewBox="0 0 36 36" aria-hidden="true">
    <circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="5" />
    <circle cx="18" cy="18" r="15" fill="none" stroke="#C9A96B" strokeWidth="5" strokeLinecap="round"
      strokeDasharray={`${(p / 100) * 94.2} 94.2`} transform="rotate(-90 18 18)" />
  </svg>
)
