'use client'

// «الجامع لسطح المكتب»: download links for the Windows, macOS and Linux apps (desktop/), read from the
// latest.json the release workflow publishes next to the installers on R2. Before the first release the
// file doesn't exist and the section says the apps are coming. Hidden inside the desktop app itself.
import { useEffect, useState } from 'react'
import { formatBytes } from '@/lib/offline/client'

const BASE = (process.env.NEXT_PUBLIC_DESKTOP_URL || 'https://files.hadith.dev/desktop').replace(/\/+$/, '')

type DlFile = { file: string; size: number }
type Latest = {
  version: string
  date: string
  downloads: Partial<Record<'windows' | 'macArm' | 'macIntel' | 'linuxAppImage' | 'linuxDeb', DlFile>>
}
type Os = 'windows' | 'mac' | 'linux' | 'other'

declare global {
  interface Window { hadithDesktop?: { isDesktop: boolean; platform: string; version: string | null } }
}

function detectOs(): Os {
  const p = ((navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.userAgent).toLowerCase()
  if (/android|iphone|ipad|ipod/.test(navigator.userAgent.toLowerCase())) return 'other'
  if (p.includes('win')) return 'windows'
  if (p.includes('mac')) return 'mac'
  if (p.includes('linux') || p.includes('x11')) return 'linux'
  return 'other'
}

const PLATFORMS: { os: Exclude<Os, 'other'>; name: string; links: { key: keyof Latest['downloads']; label: React.ReactNode }[] }[] = [
  { os: 'windows', name: 'ويندوز', links: [{ key: 'windows', label: 'تنزيل للويندوز' }] },
  { os: 'mac', name: 'ماك', links: [{ key: 'macArm', label: <>معالج <bdi dir="ltr">Apple</bdi> (<bdi dir="ltr">M1</bdi> فما بعده)</> }, { key: 'macIntel', label: <>معالج <bdi dir="ltr">Intel</bdi></> }] },
  { os: 'linux', name: 'لينكس', links: [{ key: 'linuxAppImage', label: <bdi dir="ltr">AppImage</bdi> }, { key: 'linuxDeb', label: <>حزمة <bdi dir="ltr">deb</bdi> (أوبونتو ودبيان)</> }] },
]

export default function DesktopApps() {
  const [latest, setLatest] = useState<Latest | null | 'none'>(null)
  const [os, setOs] = useState<Os>('other')
  const [inApp, setInApp] = useState(false)

  useEffect(() => {
    setOs(detectOs())
    setInApp(!!window.hadithDesktop?.isDesktop)
    if (!navigator.onLine) { setLatest('none'); return }
    fetch(`${BASE}/latest.json`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : 'none'))
      .then(setLatest)
      .catch(() => setLatest('none'))
  }, [])

  if (inApp || latest === null) return null
  const ordered = [...PLATFORMS].sort((a, b) => Number(b.os === os) - Number(a.os === os))

  return (
    <section className="mt-4 rounded-2xl border border-border bg-surface p-4 sm:p-5 font-sans shadow-sm" aria-labelledby="desktop-apps">
      <h2 id="desktop-apps" className="font-bold text-green-900">الجامع لسطح المكتب</h2>
      {latest === 'none' ? (
        <p className="text-sm text-muted mt-1">تطبيقات ويندوز وماك ولينكس قريبًا: برنامج يُثبَّت على الجهاز ويتحدّث تلقائيًا.</p>
      ) : (
        <>
          <p className="text-sm text-muted mt-1">
            برنامج يُثبَّت على الجهاز ويتحدّث تلقائيًا. الإصدار <bdi dir="ltr">{latest.version}</bdi>.
          </p>
          <ul className="mt-3 grid gap-3 sm:grid-cols-3">
            {ordered.map(p => {
              const links = p.links.filter(l => latest.downloads[l.key])
              const mine = p.os === os
              return (
                <li key={p.os} className={'rounded-xl border p-3 ' + (mine ? 'border-primary bg-primary-soft' : 'border-border')}>
                  <p className="font-bold text-sm">{p.name}{mine && <span className="text-xs text-muted font-normal"> — جهازك</span>}</p>
                  {links.length === 0 ? (
                    <p className="text-xs text-muted mt-2">قريبًا</p>
                  ) : (
                    <div className="mt-2 flex flex-col gap-1.5">
                      {links.map(l => {
                        const f = latest.downloads[l.key]!
                        return (
                          <a key={l.key} href={`${BASE}/${encodeURIComponent(f.file)}`} download
                            className={mine && l === links[0]
                              ? 'inline-flex items-center justify-between gap-2 rounded-full bg-primary text-on-dark font-bold px-4 py-2 text-sm'
                              : 'inline-flex items-center justify-between gap-2 rounded-full border border-primary text-primary font-bold px-4 py-2 text-sm'}>
                            <span>{l.label}</span>
                            <span className="text-xs font-normal opacity-80 whitespace-nowrap">{formatBytes(f.size)}</span>
                          </a>
                        )
                      })}
                    </div>
                  )}
                  {p.os === 'mac' && links.length > 0 && (
                    <p className="text-xs text-muted mt-2">أول تشغيل: انقر بالزر الأيمن على التطبيق ثم «فتح»، لأن النسخة غير موقّعة بعد.</p>
                  )}
                  {p.os === 'windows' && links.length > 0 && (
                    <p className="text-xs text-muted mt-2">إن ظهر تحذير ويندوز: «مزيد من المعلومات» ثم «تشغيل على أي حال».</p>
                  )}
                </li>
              )
            })}
          </ul>
        </>
      )}
    </section>
  )
}
