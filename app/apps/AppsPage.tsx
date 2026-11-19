'use client'

// The apps page: the visitor's own device first. Inside one of our apps it points to /offline instead, where the
// encyclopedia is downloaded and kept up to date (the Android app also sees its own update here, from AndroidApp).
import { useEffect, useState } from 'react'
import DesktopApps from '@/app/offline/DesktopApps'
import AndroidApp from '@/app/offline/AndroidApp'
import { AppleIcon } from '@/app/offline/PlatformIcons'
import { isAndroidDevice } from '@/lib/androidApp'
import { isIosDevice, whereAmI, type Where } from '@/lib/appContext'

export default function AppsPage() {
  const [where, setWhere] = useState<Where | null>(null)
  const [device, setDevice] = useState<'android' | 'ios' | 'computer'>('computer')

  useEffect(() => {
    setWhere(whereAmI())
    setDevice(isAndroidDevice() ? 'android' : isIosDevice() ? 'ios' : 'computer')
  }, [])

  const cards = {
    computer: <DesktopApps key="desktop" />,
    android: <AndroidApp key="android" />,
    ios: <IosCard key="ios" mine={device === 'ios'} />,
  }
  const order: (keyof typeof cards)[] =
    device === 'android' ? ['android', 'computer', 'ios'] : device === 'ios' ? ['ios', 'computer', 'android'] : ['computer', 'android', 'ios']

  return (
    <div dir="rtl" className="max-w-4xl mx-auto font-sans">
      <header className="mb-2">
        <h1 className="text-2xl font-bold text-green-900">تطبيقات الجامع</h1>
      </header>
      {where && where !== 'browser' && (
        <div className="mt-4 rounded-2xl border border-primary bg-primary-soft p-4 text-sm">
          <p className="font-bold text-green-900">أنت تستعمل تطبيق الجامع</p>
          <p className="text-muted mt-1">لتحميل الموسوعة على جهازك أو تحديثها افتح صفحة «الجامع دون إنترنت».</p>
          <a href="/offline" className="inline-flex mt-3 rounded-full bg-primary text-on-dark font-bold px-5 py-2 text-sm">الجامع دون إنترنت</a>
        </div>
      )}
      {where === 'android-app' ? <AndroidApp /> : where === 'browser' || where === 'pwa' ? order.map(k => cards[k]) : null}
    </div>
  )
}

// iPhone and iPad: no app yet (the browser app is not offered there), so the card only says it is coming.
function IosCard({ mine }: { mine: boolean }) {
  return (
    <section id="ios" className={'mt-4 rounded-2xl border p-4 sm:p-5 shadow-sm scroll-mt-20 ' + (mine ? 'border-primary bg-primary-soft' : 'border-border bg-surface')} aria-labelledby="ios-app">
      <h2 id="ios-app" className="font-bold text-green-900 flex items-center gap-2">
        <AppleIcon className={'w-5 h-5 ' + (mine ? 'text-primary' : 'text-muted')} />
        <span>iPhone وiPad</span>
        {mine && <span className="text-xs text-muted font-normal">— جهازك</span>}
      </h2>
      <p className="text-sm text-muted mt-1">قريبًا.</p>
    </section>
  )
}
