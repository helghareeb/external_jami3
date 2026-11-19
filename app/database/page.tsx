import type { Metadata } from 'next'
import DatabasePageClient from './DatabasePageClient'

// «قاعدة البيانات»: downloading, updating and removing the encyclopedia's database on the device, inside our
// apps (desktop app, Android app, and the browser app for those who installed it before). The installers are
// on /apps. Without a connection the service worker's kept /offline page shows this screen (app/offline/OfflineApp).
export const dynamic = 'force-static'

export const metadata: Metadata = {
  title: 'قاعدة البيانات',
  description: 'تحميل وتحديث قاعدة بيانات موسوعة الحديث النبوي للعمل دون اتصال بالإنترنت داخل تطبيق الجامع.',
}

export default function DatabasePage() {
  return <DatabasePageClient />
}
