'use client'

import { useState } from 'react'

export default function DeleteAccountButton() {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function onDelete() {
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/account', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'تعذّر حذف الحساب')
        setBusy(false)
        return
      }
      window.location.assign('/')
    } catch {
      setError('تعذّر الاتصال بالخادم')
      setBusy(false)
    }
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => { setConfirming(true); setError('') }}
        className="rounded-lg border border-red-300 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50"
      >
        حذف الحساب نهائيًا
      </button>
    )
  }

  return (
    <div className="rounded-xl border border-red-300 bg-red-50/70 p-4 space-y-3 text-sm">
      <p className="font-bold text-red-800">هل أنت متأكد من حذف حسابك نهائيًا؟</p>
      <p className="text-red-900/80 leading-relaxed">
        سيُزال حسابك وبريدك الإلكتروني وجميع الجلسات والرموز الشخصية ومجموعات «مكتبتي» وملاحظاتك وتظليلاتك نهائيًا ولا يمكن استعادتها.
      </p>
      {error && <p className="text-red-700 font-semibold">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onDelete}
          disabled={busy}
          className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50"
        >
          {busy ? 'جارٍ الحذف…' : 'نعم، احذف حسابي نهائيًا'}
        </button>
        <button
          type="button"
          onClick={() => { setConfirming(false); setError('') }}
          disabled={busy}
          className="rounded-lg border border-border bg-surface px-4 py-2 text-sm text-gray-700 hover:bg-paper"
        >
          إلغاء
        </button>
      </div>
    </div>
  )
}
