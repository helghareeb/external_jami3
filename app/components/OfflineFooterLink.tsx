'use client'

// The footer's offline link: inside our apps «قاعدة البيانات» (/database, the database download and
// update), elsewhere the apps page with the installers (/apps).
import { useEffect, useState } from 'react'
import { inOurApp } from '@/lib/appContext'

const cls = 'inline-flex items-center gap-1.5 underline underline-offset-2 hover:opacity-80'

export default function OfflineFooterLink() {
  const [inApp, setInApp] = useState(false)
  useEffect(() => { setInApp(inOurApp()) }, [])
  return inApp
    ? <a href="/database" className={cls}>قاعدة البيانات (دون إنترنت)</a>
    : <a href="/apps" className={cls}>تطبيقات الجامع (تعمل دون إنترنت)</a>
}
