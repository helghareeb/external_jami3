'use client'

// For readers who installed the site as a browser app (PWA) on Windows, macOS or Linux: once the desktop app
// works offline (latest.json says offline: true — stage 2, docs/desktop.md), a small bar offers the installer
// for their system. The desktop app keeps the database as files of its own, which browsers can't evict.
// Not shown in a normal browser tab, on phones, inside the desktop app, or within 14 days of being closed.
import { useEffect, useState } from 'react'
import { detectOs, fetchDesktopLatest, fileUrl, inDesktopApp, type DesktopFile, type DesktopOs } from '@/lib/desktopApps'
import { AppleIcon, LinuxIcon, WindowsIcon } from '@/app/offline/PlatformIcons'

const DISMISS_KEY = 'desktop-upgrade-dismissed'
const DISMISS_DAYS = 14
const NAMES: Record<Exclude<DesktopOs, 'other'>, string> = { windows: 'ويندوز', mac: 'ماك', linux: 'لينكس' }

const installedPwa = () =>
  ['standalone', 'window-controls-overlay', 'tabbed', 'minimal-ui'].some(m => window.matchMedia(`(display-mode: ${m})`).matches)

export default function DesktopUpgrade() {
  const [offer, setOffer] = useState<{ os: Exclude<DesktopOs, 'other'>; file?: DesktopFile } | null>(null)

  useEffect(() => {
    if (inDesktopApp() || !installedPwa()) return
    const os = detectOs()
    if (os === 'other') return
    try { if (Date.now() - (Number(localStorage.getItem(DISMISS_KEY)) || 0) < DISMISS_DAYS * 864e5) return } catch {}
    let live = true
    const t = setTimeout(() => {
      fetchDesktopLatest().then(latest => {
        if (!live || !latest?.offline) return
        // Windows and Linux get the file directly; Macs choose Apple silicon or Intel on /offline
        const file = os === 'windows' ? latest.downloads.windows : os === 'linux' ? latest.downloads.linuxAppImage : undefined
        if (os !== 'mac' && !file) return
        if (os === 'mac' && !latest.downloads.macArm && !latest.downloads.macIntel) return
        setOffer({ os, file })
      })
    }, 4000)
    return () => { live = false; clearTimeout(t) }
  }, [])

  if (!offer) return null
  const close = () => {
    setOffer(null)
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())) } catch {}
  }
  const Icon = offer.os === 'windows' ? WindowsIcon : offer.os === 'mac' ? AppleIcon : LinuxIcon

  return (
    <div role="dialog" aria-label="الجامع لسطح المكتب"
      // bottom-right on wide windows (OfflineOffer uses the bottom-left corner), at the top in narrow ones
      className="fixed z-[60] top-3 inset-x-3 min-[900px]:top-auto min-[900px]:bottom-3 min-[900px]:inset-x-auto min-[900px]:right-4 min-[900px]:max-w-md flex items-start gap-3 rounded-2xl bg-[#0F3D2E] text-[#F8F1E4] shadow-2xl border border-[#C9A96B]/40 p-3 font-sans">
      <Icon className="w-8 h-8 shrink-0 mt-0.5 text-[#C9A96B]" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold leading-snug">الجامع متاح برنامجًا لـ{NAMES[offer.os]}</p>
        <p className="text-xs opacity-80 leading-snug mt-0.5">
          أثبت من نسخة المتصفح: يحفظ الموسوعة على جهازك فلا يمسحها المتصفح، ويتحدّث تلقائيًا. بعد تثبيته يمكنك إزالة نسخة المتصفح.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {offer.file ? (
            <a href={fileUrl(offer.file)} download onClick={close}
              className="rounded-full bg-[#C9A96B] text-[#13261b] text-sm font-bold px-4 py-1.5">تنزيل لـ{NAMES[offer.os]}</a>
          ) : (
            <a href="/offline#desktop" onClick={close}
              className="rounded-full bg-[#C9A96B] text-[#13261b] text-sm font-bold px-4 py-1.5">اختر نسخة جهازك</a>
          )}
          <a href="/offline#desktop" onClick={close} className="text-sm underline underline-offset-2 opacity-90 py-1.5">التفاصيل</a>
        </div>
      </div>
      <button type="button" onClick={close} aria-label="إغلاق" className="shrink-0 w-8 h-8 rounded-full text-[#F8F1E4]/70 hover:text-[#F8F1E4]">✕</button>
    </div>
  )
}
