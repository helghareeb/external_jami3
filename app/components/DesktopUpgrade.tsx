'use client'

// The announcement that «الجامع» is available as a desktop app for Windows, macOS and Linux: a small dismissible
// card with the three platforms' marks (the visitor's own highlighted) and one button to /offline#desktop, where
// the downloads are. Shown to visitors on a computer — in a browser tab or in the installed browser app (PWA) —
// once a release exists (latest.json on R2); not on phones, not inside the desktop app.
// Closing it hides it for good, except that it comes back once when the desktop app starts working offline
// (latest.json "offline": stage 2, docs/desktop.md), since that is news for readers using the PWA offline.
import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { detectOs, fetchDesktopLatest, inDesktopApp, type DesktopOs } from '@/lib/desktopApps'
import { AppleIcon, LinuxIcon, WindowsIcon } from '@/app/offline/PlatformIcons'

const DISMISS_KEY = 'desktop-announce-dismissed'      // 'online' | 'offline': the stage that was dismissed

const PLATFORMS = [
  { os: 'windows', name: 'ويندوز', Icon: WindowsIcon },
  { os: 'mac', name: 'ماك', Icon: AppleIcon },
  { os: 'linux', name: 'لينكس', Icon: LinuxIcon },
] as const

export default function DesktopUpgrade() {
  const pathname = usePathname()
  const [show, setShow] = useState<{ os: Exclude<DesktopOs, 'other'>; offline: boolean } | null>(null)

  useEffect(() => {
    if (inDesktopApp()) return
    const os = detectOs()
    if (os === 'other') return
    let live = true
    const t = setTimeout(() => {
      fetchDesktopLatest().then(latest => {
        if (!live || !latest || Object.keys(latest.downloads || {}).length === 0) return
        const stage = latest.offline ? 'offline' : 'online'
        let dismissed = ''
        try { dismissed = localStorage.getItem(DISMISS_KEY) || '' } catch {}
        if (dismissed === stage || dismissed === 'offline') return
        setShow({ os, offline: !!latest.offline })
      })
    }, 4000)
    return () => { live = false; clearTimeout(t) }
  }, [])

  if (!show || pathname === '/offline' || pathname === '/apps' || pathname === '/database') return null
  const close = () => {
    try { localStorage.setItem(DISMISS_KEY, show.offline ? 'offline' : 'online') } catch {}
    setShow(null)
  }

  return (
    <div role="dialog" aria-labelledby="desktop-announce-title"
      // bottom-right on wide windows (OfflineOffer uses the bottom-left corner), at the top in narrow ones
      className="fixed z-[60] top-3 inset-x-3 min-[900px]:top-auto min-[900px]:bottom-3 min-[900px]:inset-x-auto min-[900px]:right-4 min-[900px]:w-[26rem] rounded-2xl bg-[#0F3D2E] text-[#F8F1E4] shadow-2xl border border-[#C9A96B]/40 p-4 font-sans">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p id="desktop-announce-title" className="font-bold leading-snug">جديد: الجامع تطبيقًا لسطح المكتب</p>
          <p className="text-xs opacity-80 leading-relaxed mt-1">
            {show.offline
              ? 'يُثبَّت على جهازك، ويعمل دون إنترنت فيحفظ الموسوعة في ملفاته فلا يمسحها المتصفح، ويتحدّث تلقائيًا.'
              : 'يُثبَّت على جهازك كأي برنامج، ويفتح الجامع في نافذته، ويتحدّث تلقائيًا.'}
          </p>
        </div>
        <button type="button" onClick={close} aria-label="إغلاق" className="shrink-0 -mt-1 w-8 h-8 rounded-full text-[#F8F1E4]/70 hover:text-[#F8F1E4]">✕</button>
      </div>
      <ul className="mt-3 grid grid-cols-3 gap-2" aria-label="الأنظمة المتاحة">
        {PLATFORMS.map(({ os, name, Icon }) => {
          const mine = os === show.os
          return (
            <li key={os} className={'flex flex-col items-center gap-1 rounded-xl py-2 border ' + (mine ? 'border-[#C9A96B] bg-[#C9A96B]/15' : 'border-[#F8F1E4]/15')}>
              <Icon className="w-6 h-6" onDark />
              <span className="text-xs font-bold">{name}</span>
              {mine && <span className="text-[10px] opacity-70 -mt-0.5">جهازك</span>}
            </li>
          )
        })}
      </ul>
      <a href="/apps#desktop" onClick={close}
        className="mt-3 flex justify-center rounded-full bg-[#C9A96B] text-[#13261b] text-sm font-bold px-4 py-2">
        التنزيل والتفاصيل
      </a>
    </div>
  )
}
