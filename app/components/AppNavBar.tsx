'use client'

// Browser controls for the installed app. Installed as an app (display: standalone), the window has
// no address bar, so no back, forward or reload, and no tabs. This slim bar puts them back, only in
// that window: back, forward, reload, a new window of the app at the same page, and copy the link.
// It works offline too: the offline app moves between pages with history.pushState, so back and
// forward walk its pages, and reloading or opening a new window is answered by the service worker.
//
// Where the browser offers it (Chromium's tabbed app mode, manifest display_override "tabbed"),
// the window has real tabs and its own controls, and this bar stays hidden.
import { useEffect, useState } from 'react'

type NavApi = EventTarget & { canGoBack?: boolean; canGoForward?: boolean }

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  window.matchMedia('(display-mode: fullscreen)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true

const navApi = (): NavApi | undefined => (window as unknown as { navigation?: NavApi }).navigation

export default function AppNavBar() {
  const [show, setShow] = useState(false)
  const [can, setCan] = useState({ back: true, forward: true })
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(display-mode: standalone)')
    const update = () => setShow(isStandalone())
    update()
    mq.addEventListener?.('change', update)
    return () => mq.removeEventListener?.('change', update)
  }, [])

  // Back and forward: greyed out at the ends of the history where the browser can tell
  // (the Navigation API in Chrome and Edge); elsewhere both stay available.
  useEffect(() => {
    if (!show) return
    const nav = navApi()
    if (!nav || typeof nav.canGoBack !== 'boolean') return
    const sync = () => setCan({ back: !!nav.canGoBack, forward: !!nav.canGoForward })
    sync()
    nav.addEventListener('currententrychange', sync)
    window.addEventListener('popstate', sync)
    return () => { nav.removeEventListener('currententrychange', sync); window.removeEventListener('popstate', sync) }
  }, [show])

  if (!show) return null

  const copy = () => {
    navigator.clipboard?.writeText(location.href).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }, () => {})
  }

  return (
    <nav aria-label="التنقل" data-no-convert
      className="app-nav-bar print:hidden flex items-center gap-1 h-9 px-2 sm:px-4 bg-[#0A2C21] text-[#F8F1E4]/85 border-b border-[#C9A96B]/25 font-sans text-xs select-none">
      <Btn label="رجوع" disabled={!can.back} onClick={() => history.back()}>
        {/* RTL: back points right */}
        <path d="M9 5l7 7-7 7" />
      </Btn>
      <Btn label="تقدّم" disabled={!can.forward} onClick={() => history.forward()}>
        <path d="M15 5l-7 7 7 7" />
      </Btn>
      <Btn label="إعادة تحميل الصفحة" onClick={() => location.reload()}>
        <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" /><path d="M19.5 4.5v4h-4" />
      </Btn>
      <span className="flex-1" />
      <Btn label={copied ? 'نُسخ الرابط' : 'نسخ رابط الصفحة'} onClick={copy} text={copied ? 'نُسخ ✓' : 'نسخ الرابط'}>
        <path d="M9.5 14.5l5-5" /><path d="M8 17l-1.4 1.4a3 3 0 0 1-4.2-4.2L5.6 11a3 3 0 0 1 4.2 0" /><path d="M16 7l1.4-1.4a3 3 0 0 1 4.2 4.2L18.4 13a3 3 0 0 1-4.2 0" />
      </Btn>
      <Btn label="فتح الصفحة في نافذة جديدة" onClick={() => openWindow(location.href)} text="نافذة جديدة">
        <rect x="3.5" y="5" width="13" height="13" rx="1.5" /><path d="M8 5V3.5h12.5V16H16.5" /><path d="M10 9v6M7 12h6" />
      </Btn>
    </nav>
  )
}

// A new window of the app. In Chrome and Edge an in-scope address opened from the app window
// opens as another app window (or a browser tab, depending on the browser's settings).
function openWindow(href: string) {
  const w = window.open(href, '_blank')
  if (w) { try { w.opener = null } catch { /* cross-window */ } }
}

function Btn({ label, onClick, disabled, text, children }: {
  label: string; onClick: () => void; disabled?: boolean; text?: string; children: React.ReactNode
}) {
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick} disabled={disabled}
      className="flex items-center gap-1.5 h-8 min-w-8 px-1.5 rounded-md hover:bg-white/10 hover:text-[#FFFDF7] disabled:opacity-35 disabled:hover:bg-transparent transition-colors">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {children}
      </svg>
      {text && <span className="hidden sm:inline">{text}</span>}
    </button>
  )
}
