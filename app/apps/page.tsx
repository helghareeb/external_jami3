import { pageMeta } from '@/lib/siteMeta'
import AppsPage from './AppsPage'

// «تطبيقات الجامع»: where to get the apps — Windows, macOS, Linux (desktop/), Android (android/), and on iPhone/iPad
// the browser app added to the home screen. The encyclopedia's own download/update lives at /offline, inside the apps.
export const metadata = pageMeta({
  title: 'تطبيقات الجامع — ويندوز وماك ولينكس وأندرويد',
  description: 'نزّل تطبيق الجامع لموسوعة الحديث النبوي على جهازك: ويندوز وماك ولينكس وأندرويد، ويعمل دون إنترنت.',
  path: '/apps',
})

export default function Page() {
  return <AppsPage />
}
