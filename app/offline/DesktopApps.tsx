'use client'

// «الجامع لسطح المكتب»: download links for the Windows, macOS and Linux apps (desktop/), read from the
// latest.json the release workflow publishes next to the installers on R2. Before the first release the
// file doesn't exist and the section says the apps are coming. Hidden inside the desktop app itself.
import { useEffect, useState } from 'react'
import { formatBytes } from '@/lib/offline/client'
import {
  detectOs, fetchDesktopLatest, fileUrl, inDesktopApp,
  type DesktopLatest, type DesktopOs, type DownloadKey,
} from '@/lib/desktopApps'
import { AppleIcon, LinuxIcon, WindowsIcon } from './PlatformIcons'

const PLATFORMS: {
  os: Exclude<DesktopOs, 'other'>
  name: string
  Icon: (p: { className?: string }) => React.JSX.Element
  links: { key: DownloadKey; label: React.ReactNode }[]
}[] = [
  { os: 'windows', name: 'ويندوز', Icon: WindowsIcon, links: [{ key: 'windows', label: 'تنزيل للويندوز' }] },
  { os: 'mac', name: 'ماك', Icon: AppleIcon, links: [{ key: 'macArm', label: <>معالج <bdi dir="ltr">Apple</bdi> (<bdi dir="ltr">M1</bdi> فما بعده)</> }, { key: 'macIntel', label: <>معالج <bdi dir="ltr">Intel</bdi></> }] },
  { os: 'linux', name: 'لينكس', Icon: LinuxIcon, links: [{ key: 'linuxAppImage', label: <bdi dir="ltr">AppImage</bdi> }, { key: 'linuxDeb', label: <>حزمة <bdi dir="ltr">deb</bdi> (أوبونتو ودبيان)</> }] },
]

export default function DesktopApps() {
  const [latest, setLatest] = useState<DesktopLatest | null | 'none'>(null)
  const [os, setOs] = useState<DesktopOs>('other')
  const [inApp, setInApp] = useState(false)

  useEffect(() => {
    setOs(detectOs())
    setInApp(inDesktopApp())
    fetchDesktopLatest().then(l => setLatest(l ?? 'none'))
  }, [])

  // Arrived from the announcement (/offline#desktop): the section appears after latest.json, so scroll to it then
  useEffect(() => {
    if (latest !== null && location.hash === '#desktop') {
      requestAnimationFrame(() => document.getElementById('desktop')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    }
  }, [latest])

  if (inApp || latest === null) return null
  const ordered = [...PLATFORMS].sort((a, b) => Number(b.os === os) - Number(a.os === os))

  return (
    <section id="desktop" className="mt-4 rounded-2xl border border-border bg-surface p-4 sm:p-5 font-sans shadow-sm scroll-mt-20" aria-labelledby="desktop-apps">
      <h2 id="desktop-apps" className="font-bold text-green-900">الجامع لسطح المكتب</h2>
      {latest === 'none' ? (
        <>
          <p className="text-sm text-muted mt-1">تطبيقات ويندوز وماك ولينكس قريبًا: برنامج يُثبَّت على الجهاز ويتحدّث تلقائيًا.</p>
          <div className="mt-3 flex gap-3 text-muted" aria-hidden="true">
            <WindowsIcon className="w-6 h-6" /><AppleIcon className="w-6 h-6" /><LinuxIcon className="w-6 h-6" />
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-muted mt-1">
            برنامج يُثبَّت على الجهاز ويتحدّث تلقائيًا{latest.offline ? '، ويعمل دون إنترنت' : ''}. الإصدار <bdi dir="ltr">{latest.version}</bdi>.
          </p>
          <ul className="mt-3 grid gap-3 sm:grid-cols-3">
            {ordered.map(({ os: pos, name, Icon, links: all }) => {
              const links = all.filter(l => latest.downloads[l.key])
              const mine = pos === os
              return (
                <li key={pos} className={'rounded-xl border p-3 ' + (mine ? 'border-primary bg-primary-soft' : 'border-border')}>
                  <p className="font-bold text-sm flex items-center gap-2">
                    <Icon className={'w-5 h-5 shrink-0 ' + (mine ? 'text-primary' : 'text-muted')} />
                    <span>{name}</span>
                    {mine && <span className="text-xs text-muted font-normal">— جهازك</span>}
                  </p>
                  {links.length === 0 ? (
                    <p className="text-xs text-muted mt-2">قريبًا</p>
                  ) : (
                    <div className="mt-2 flex flex-col gap-1.5">
                      {links.map(l => {
                        const f = latest.downloads[l.key]!
                        return (
                          <a key={l.key} href={fileUrl(f)} download
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
                  {pos === 'mac' && links.length > 0 && (
                    <p className="text-xs text-muted mt-2">أول تشغيل: انقر بالزر الأيمن على التطبيق ثم «فتح»، لأن النسخة غير موقّعة بعد.</p>
                  )}
                  {pos === 'windows' && links.length > 0 && (
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
