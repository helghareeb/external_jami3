'use client'

import { useEffect, useState } from 'react'
import OfflineManager from '@/app/offline/OfflineManager'
import AndroidApp from '@/app/offline/AndroidApp'
import { refreshOfflineStatus, useOfflineState } from '@/lib/offline/client'
import { whereAmI, type Where } from '@/lib/appContext'

export default function DatabasePageClient() {
  const [where, setWhere] = useState<Where | null>(null)
  const offline = useOfflineState()

  useEffect(() => {
    setWhere(whereAmI())
    refreshOfflineStatus()
  }, [])

  // In a browser: only a copy downloaded there before is managed here; the database comes with the apps
  const hasData =
    !!offline.status?.ready || (offline.status?.staged ?? 0) > 0 || offline.phase === 'download' || offline.phase === 'import'

  return (
    <div className="max-w-4xl mx-auto font-sans space-y-4">
      <header>
        <h1 className="text-2xl font-bold text-green-900">قاعدة البيانات</h1>
        <p className="text-sm text-muted mt-1">تحميل قاعدة بيانات الموسوعة وحفظها على جهازك للعمل دون اتصال بالإنترنت.</p>
      </header>
      {where && (where !== 'browser' ? (
        <div>
          <OfflineManager />
          {where === 'android-app' && <AndroidApp />}
        </div>
      ) : (
        <>
          {hasData && <OfflineManager />}
          <section className="rounded-2xl border border-border bg-surface p-4 sm:p-5 font-sans shadow-sm">
            <h2 className="font-bold text-green-900">قاعدة البيانات تُحمَّل داخل تطبيق الجامع</h2>
            <p className="text-sm text-muted mt-1 leading-relaxed">
              نزّل تطبيق الجامع لجهازك (ويندوز، ماك، لينكس، أو أندرويد)، ثم افتح «قاعدة البيانات» من داخله وحمّلها مرة واحدة.
            </p>
            <a href="/apps" className="mt-3 inline-flex items-center rounded-full bg-primary text-on-dark font-bold px-5 py-2.5 text-sm">
              تطبيقات الجامع
            </a>
          </section>
        </>
      ))}
    </div>
  )
}
