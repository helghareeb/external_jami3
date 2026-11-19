'use client'

// The apps page: the visitor's own device first. Inside one of our apps it points to /database instead, where the
// encyclopedia is downloaded and kept up to date (the Android app also sees its own update here, from AndroidApp).
import { useEffect, useState } from 'react'
import DesktopApps from '@/app/offline/DesktopApps'
import AndroidApp from '@/app/offline/AndroidApp'
import { isAndroidDevice } from '@/lib/androidApp'
import { whereAmI, type Where } from '@/lib/appContext'

export default function AppsPage() {
  const [where, setWhere] = useState<Where | null>(null)
  const [device, setDevice] = useState<'android' | 'computer'>('computer')

  useEffect(() => {
    setWhere(whereAmI())
    setDevice(isAndroidDevice() ? 'android' : 'computer')
  }, [])

  const cards = {
    computer: <DesktopApps key="desktop" />,
    android: <AndroidApp key="android" />,
  }
  const order: (keyof typeof cards)[] = device === 'android' ? ['android', 'computer'] : ['computer', 'android']

  return (
    <div dir="rtl" className="max-w-4xl mx-auto font-sans">
      <header className="mb-2">
        <h1 className="text-2xl font-bold text-green-900">تطبيقات الجامع</h1>
      </header>
      {where && where !== 'browser' && (
        <div className="mt-4 rounded-2xl border border-primary bg-primary-soft p-4 text-sm">
          <p className="font-bold text-green-900">أنت تستعمل تطبيق الجامع</p>
          <p className="text-muted mt-1">لتحميل قاعدة البيانات على جهازك أو تحديثها افتح صفحة «قاعدة البيانات».</p>
          <a href="/database" className="inline-flex mt-3 rounded-full bg-primary text-on-dark font-bold px-5 py-2 text-sm">قاعدة البيانات</a>
        </div>
      )}
      {where === 'android-app' ? <AndroidApp /> : where === 'browser' || where === 'pwa' ? order.map(k => cards[k]) : null}
    </div>
  )
}
