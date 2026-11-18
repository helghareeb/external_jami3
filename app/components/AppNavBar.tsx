'use client'

// Browser controls and tabs for the installed app. Installed as an app (display: standalone), the
// window has no address bar, so no back, forward or reload, and no tabs. This slim bar puts them
// back, only in that window: back, forward, reload, tabs side by side in the same window («+» or
// Ctrl/middle-click on a link), and copy the link. It works offline too.
//
// Tabs. The first tab is the window's own page. Each further tab is a same-origin iframe of the
// site (named aljami-tab-<n>), kept alive while hidden so it keeps its page and scroll. The frames
// share the window's session history, so a frame never adds to it: in a frame, pushState becomes
// replaceState and links load with location.replace, and the bar keeps each frame's own back and
// forward list. Moving back in a frame is a link click with data-replace: the offline app opens it
// in place, online it is a location.replace. Offline, the frames share the one database through
// PGlite's worker (one leader for all of them).
//
// Where the browser offers it (Chromium's tabbed app mode, manifest display_override "tabbed"),
// the window has real tabs and its own controls, and this bar stays hidden.
import { useCallback, useEffect, useRef, useState } from 'react'

type NavApi = EventTarget & { canGoBack?: boolean; canGoForward?: boolean }
type Tab = { id: number; src: string; url: string; title: string; stack: string[]; idx: number; pending: number | null }
type Msg =
  // push: a new page in the frame; replace: the current one renamed; load/title: just where it is
  | { type: 'aljami-tab'; id: number; url: string; title: string; kind: 'push' | 'replace' | 'load' | 'title' }
  | { type: 'aljami-open'; url: string; activate: boolean }
  | { type: 'aljami-go'; url: string }

const FRAME_PREFIX = 'aljami-tab-'
const BAR_H = 36

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  window.matchMedia('(display-mode: fullscreen)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true
const navApi = (): NavApi | undefined => (window as unknown as { navigation?: NavApi }).navigation
const here = () => location.pathname + location.search + location.hash
const frameId = (): number | null => {
  if (typeof window === 'undefined' || window.top === window.self || !window.name.startsWith(FRAME_PREFIX)) return null
  try { if (window.top!.location.origin !== location.origin) return null } catch { return null }
  return Number(window.name.slice(FRAME_PREFIX.length))
}
// "الجامع — موسوعة الحديث النبوي الشريف - مصنف ابن أبي شيبة" → "مصنف ابن أبي شيبة"
const shortTitle = (t: string) =>
  t.split(/\s[—\-|]\s/).map(s => s.trim()).filter(s => s && !/الجامع|موسوعة الحديث|خادم الحرمين/.test(s)).pop() || 'الجامع'

// A same-origin page link that a click would follow, or null
function pageLink(e: MouseEvent): URL | null {
  const a = (e.target as HTMLElement | null)?.closest?.('a')
  if (!a || !a.href || a.hasAttribute('download')) return null
  const u = new URL(a.href, location.href)
  if (u.origin !== location.origin || u.pathname.startsWith('/api/')) return null
  return u
}
const wantsNewTab = (e: MouseEvent) => (e.button === 0 && (e.ctrlKey || e.metaKey || e.shiftKey)) || e.button === 1

// In a tab frame: keep the window's history untouched and tell the bar where the frame is.
// Runs when the module loads, before the routers keep their own reference to pushState.
const FRAME = frameId()
if (FRAME !== null) {
  const report = (kind: 'push' | 'replace' | 'load' | 'title') => {
    try { window.top!.postMessage({ type: 'aljami-tab', id: FRAME, url: here(), title: document.title, kind } satisfies Msg, location.origin) } catch { /* closed */ }
  }
  const replace = history.replaceState.bind(history)
  history.pushState = (data, unused, url) => { replace(data, unused, url); report('push') }
  history.replaceState = (data, unused, url) => { replace(data, unused, url); report('replace') }
  window.addEventListener('load', () => report('load'))
  if (document.readyState !== 'loading') report('load')
  else document.addEventListener('DOMContentLoaded', () => report('load'))
  let lastTitle = ''
  setInterval(() => { if (document.title !== lastTitle) { lastTitle = document.title; report('title') } }, 700)

  // Links and GET forms the page's own router left alone: load in place without a history entry
  window.addEventListener('click', e => {
    if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return
    const a = (e.target as HTMLElement | null)?.closest?.('a')
    const u = pageLink(e)
    if (!a || !u || (a.target && a.target !== '_self')) return
    if (u.pathname === location.pathname && u.search === location.search && u.hash) return
    e.preventDefault()
    location.replace(u.href)
  })
  window.addEventListener('submit', e => {
    const f = e.target as HTMLFormElement
    if (e.defaultPrevented || (f.method && f.method.toLowerCase() !== 'get') || !f.action) return
    const u = new URL(f.action, location.href)
    if (u.origin !== location.origin) return
    e.preventDefault()
    u.search = new URLSearchParams(new FormData(f) as unknown as Record<string, string>).toString()
    location.replace(u.href)
  })
  // Back and forward from the bar
  window.addEventListener('message', e => {
    const m = e.data as Msg
    if (e.origin !== location.origin || m?.type !== 'aljami-go') return
    const a = document.createElement('a')
    a.href = m.url
    a.setAttribute('data-replace', '')
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    a.remove()
  })
}

// Ctrl/Cmd/Shift-click, middle-click and same-origin target=_blank links: a new tab in the bar
function useNewTabLinks(enabled: boolean, open: (url: string, activate: boolean) => void) {
  useEffect(() => {
    if (!enabled) return
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented) return
      const u = pageLink(e)
      if (!u) return
      const a = (e.target as HTMLElement).closest('a')!
      const blank = e.button === 0 && !wantsNewTab(e) && a.target === '_blank'
      if (!wantsNewTab(e) && !blank) return
      e.preventDefault()
      e.stopPropagation()
      open(u.pathname + u.search + u.hash, blank)
    }
    document.addEventListener('click', onClick, true)
    document.addEventListener('auxclick', onClick, true)
    return () => { document.removeEventListener('click', onClick, true); document.removeEventListener('auxclick', onClick, true) }
  }, [enabled, open])
}

export default function AppNavBar() {
  const [show, setShow] = useState(false)
  useEffect(() => {
    if (FRAME !== null) return
    const mq = window.matchMedia('(display-mode: standalone)')
    const update = () => setShow(isStandalone())
    update()
    mq.addEventListener?.('change', update)
    return () => mq.removeEventListener?.('change', update)
  }, [])
  const toHost = useCallback((url: string, activate: boolean) => {
    window.top!.postMessage({ type: 'aljami-open', url, activate } satisfies Msg, location.origin)
  }, [])
  useNewTabLinks(FRAME !== null, toHost)
  if (FRAME !== null || !show) return null
  return <Bar />
}

function Bar() {
  // Tab 0 is the window's own page; its url/stack fields are unused (the window's history serves it)
  const [tabs, setTabs] = useState<Tab[]>(() => [{ id: 0, src: '', url: here(), title: document.title, stack: [], idx: 0, pending: null }])
  const [active, setActive] = useState(0)
  const [hidden0, setHidden0] = useState(false)
  const [can0, setCan0] = useState({ back: true, forward: true })
  const [copied, setCopied] = useState(false)
  const nextId = useRef(1)
  const frames = useRef(new Map<number, HTMLIFrameElement>())
  const visible = tabs.filter(t => t.id !== 0 || !hidden0)
  const cur = tabs.find(t => t.id === active) ?? tabs[0]

  const open = useCallback((url: string, activate: boolean) => {
    const id = nextId.current++
    setTabs(ts => [...ts, { id, src: url, url, title: '', stack: [url], idx: 0, pending: null }])
    if (activate) setActive(id)
  }, [])
  useNewTabLinks(true, open)

  // The window's own page: where it is, and whether it can go back or forward
  useEffect(() => {
    const nav = navApi()
    const sync = () => {
      setTabs(ts => ts.map(t => (t.id === 0 ? { ...t, url: here(), title: document.title } : t)))
      if (nav && typeof nav.canGoBack === 'boolean') setCan0({ back: !!nav.canGoBack, forward: !!nav.canGoForward })
    }
    sync()
    nav?.addEventListener('currententrychange', sync)
    window.addEventListener('popstate', sync)
    const t = setInterval(() => setTabs(ts => (ts[0].title === document.title ? ts : ts.map(x => (x.id === 0 ? { ...x, title: document.title } : x)))), 1000)
    return () => { nav?.removeEventListener('currententrychange', sync); window.removeEventListener('popstate', sync); clearInterval(t) }
  }, [])

  // Messages from the frames
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== location.origin) return
      const m = e.data as Msg
      if (m?.type === 'aljami-open') open(m.url, m.activate)
      if (m?.type !== 'aljami-tab') return
      setTabs(ts => ts.map(t => {
        if (t.id !== m.id) return t
        let { stack, idx, pending } = t
        if (pending !== null && stack[pending] === m.url) { idx = pending; pending = null }
        else if (m.kind === 'replace') stack = stack.map((u, i) => (i === idx ? m.url : u))
        else if (m.kind !== 'title' && stack[idx] !== m.url) { stack = [...stack.slice(0, idx + 1), m.url]; idx = stack.length - 1 }
        return { ...t, url: m.url, title: m.title, stack, idx, pending }
      }))
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [open])

  // A frame tab covers the window's page; the window's page must not scroll under it
  const frameActive = active !== 0
  useEffect(() => {
    document.documentElement.style.overflow = frameActive ? 'hidden' : ''
    return () => { document.documentElement.style.overflow = '' }
  }, [frameActive])

  const go = (step: -1 | 1) => {
    if (active === 0) { if (step < 0) history.back(); else history.forward(); return }
    const t = cur
    const to = t.idx + step
    if (to < 0 || to >= t.stack.length) return
    setTabs(ts => ts.map(x => (x.id === t.id ? { ...x, pending: to } : x)))
    frames.current.get(t.id)?.contentWindow?.postMessage({ type: 'aljami-go', url: t.stack[to] } satisfies Msg, location.origin)
  }
  const reload = () => {
    if (active === 0) location.reload()
    else frames.current.get(active)?.contentWindow?.location.reload()
  }
  const close = (id: number) => {
    if (visible.length <= 1) return
    const i = visible.findIndex(t => t.id === id)
    const next = visible[i + 1] ?? visible[i - 1]
    if (id === active) setActive(next.id)
    if (id === 0) setHidden0(true)
    else { setTabs(ts => ts.filter(t => t.id !== id)); frames.current.delete(id) }
  }
  const copy = () => {
    navigator.clipboard?.writeText(location.origin + cur.url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }, () => {})
  }

  const canBack = active === 0 ? can0.back : cur.idx > 0
  const canFwd = active === 0 ? can0.forward : cur.idx < cur.stack.length - 1

  return (
    <>
      <nav aria-label="التنقل" data-no-convert style={{ height: BAR_H }}
        className="app-nav-bar print:hidden flex items-center gap-1 px-2 sm:px-3 bg-[#0A2C21] text-[#F8F1E4]/85 border-b border-[#C9A96B]/25 font-sans text-xs select-none">
        <Btn label="رجوع" disabled={!canBack} onClick={() => go(-1)}>
          {/* RTL: back points right */}
          <path d="M9 5l7 7-7 7" />
        </Btn>
        <Btn label="تقدّم" disabled={!canFwd} onClick={() => go(1)}>
          <path d="M15 5l-7 7 7 7" />
        </Btn>
        <Btn label="إعادة تحميل الصفحة" onClick={reload}>
          <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" /><path d="M19.5 4.5v4h-4" />
        </Btn>
        <div role="tablist" aria-label="الألسنة" className="flex-1 min-w-0 flex items-end gap-1 self-stretch pt-1 overflow-x-auto [scrollbar-width:none]">
          {visible.length > 1 && visible.map(t => (
            <div key={t.id} role="tab" aria-selected={t.id === active} title={t.title || t.url}
              onClick={() => setActive(t.id)} onAuxClick={e => { if (e.button === 1) { e.preventDefault(); close(t.id) } }}
              className={`group flex items-center gap-1 h-full min-w-[72px] max-w-[200px] flex-1 ps-2.5 pe-1 rounded-t-md cursor-pointer transition-colors ${t.id === active ? 'bg-[#0F3D2E] text-[#FFFDF7]' : 'hover:bg-white/5'}`}>
              <span className="truncate flex-1">{shortTitle(t.title) || '…'}</span>
              <button type="button" aria-label="إغلاق اللسان" title="إغلاق اللسان"
                onClick={e => { e.stopPropagation(); close(t.id) }}
                className="shrink-0 w-5 h-5 grid place-items-center rounded hover:bg-white/15 opacity-70 hover:opacity-100">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
              </button>
            </div>
          ))}
          <Btn label="لسان جديد" onClick={() => open('/', true)} text={visible.length > 1 ? undefined : 'لسان جديد'}>
            <path d="M12 5v14M5 12h14" />
          </Btn>
        </div>
        <Btn label={copied ? 'نُسخ الرابط' : 'نسخ رابط الصفحة'} onClick={copy} text={copied ? 'نُسخ ✓' : 'نسخ الرابط'}>
          <path d="M9.5 14.5l5-5" /><path d="M8 17l-1.4 1.4a3 3 0 0 1-4.2-4.2L5.6 11a3 3 0 0 1 4.2 0" /><path d="M16 7l1.4-1.4a3 3 0 0 1 4.2 4.2L18.4 13a3 3 0 0 1-4.2 0" />
        </Btn>
      </nav>
      {tabs.length > 1 && (
        <div className="fixed inset-x-0 bottom-0 z-[55] bg-paper" style={{ top: BAR_H, display: frameActive ? 'block' : 'none' }}>
          {tabs.filter(t => t.id !== 0).map(t => (
            <iframe key={t.id} name={FRAME_PREFIX + t.id} src={t.src} title={t.title || 'لسان'}
              ref={el => { if (el) frames.current.set(t.id, el) }}
              className="absolute inset-0 w-full h-full border-0"
              style={{ visibility: t.id === active ? 'visible' : 'hidden' }} />
          ))}
        </div>
      )}
    </>
  )
}

function Btn({ label, onClick, disabled, text, children }: {
  label: string; onClick: () => void; disabled?: boolean; text?: string; children: React.ReactNode
}) {
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick} disabled={disabled}
      className="shrink-0 self-center flex items-center gap-1.5 h-8 min-w-8 px-1.5 rounded-md hover:bg-white/10 hover:text-[#FFFDF7] disabled:opacity-35 disabled:hover:bg-transparent transition-colors">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {children}
      </svg>
      {text && <span className="hidden sm:inline">{text}</span>}
    </button>
  )
}
