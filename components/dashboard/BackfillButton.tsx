'use client'

/**
 * 「＋ 사후 실적」 — 2026-11-26 에 **실적 현황에서 홈 「내 견적」 카드로 옮겼다**.
 *
 * 왜 옮겼나 — 실적 현황은 「다 모아 보는 화면」이라 숫자를 읽으러 간다. 거기에 쓰기 단추가
 * 하나 서 있었는데, 그 일은 **내 견적을 손보는 일**이다(EMS 밖에서 끝난 건을 내 실적 줄로
 * 적어 넣는다). 그래서 내 견적 카드의 머리로 왔다.
 *
 * 창은 **같은 창**이다(components/sales/BackfillModal.tsx) — 칸·검사·저장 라우트가 그대로다.
 * 달라진 것은 누르는 자리와, 재직자 목록을 **누를 때 비로소 읽는다**는 점뿐이다(홈이
 * 들어올 때마다 engineers 를 읽지 않게).
 *
 * 슈퍼관리자에게만 선다 — 남의 실적을 만드는 일이다. 라우트도 같은 문턱이다.
 */

import { useState, type CSSProperties } from 'react'
import { createClient } from '@/lib/supabase/client'
import BackfillModal, { type EngineerOption } from '@/components/sales/BackfillModal'
import { useToast } from '@/components/common/Toast'
import { BLUE, BORDER, CARD_BG } from '@/components/common/ui'
import { TEXT_DISABLED } from '@/lib/textTokens'
import { isActiveInPeriod } from '@/lib/engineers'
import { todayKST } from '@/lib/date'
import type { BackfillForm } from '@/lib/quoteBackfill'
import { R } from '@/lib/radius'

const btn: CSSProperties = {
  height: 24, padding: '0 9px', borderRadius: R.control, border: `1px solid ${BLUE}`,
  background: CARD_BG, color: BLUE, fontSize: 11, fontWeight: 700, cursor: 'pointer',
  fontFamily: 'inherit', whiteSpace: 'nowrap', flexShrink: 0,
}
const btnBusy: CSSProperties = { ...btn, borderColor: BORDER, color: TEXT_DISABLED, cursor: 'wait' }

export default function BackfillButton({ onSaved }: {
  /** 담은 뒤 — 부르는 쪽이 카드 숫자를 다시 읽는다. */
  onSaved?: () => void
}) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [engineers, setEngineers] = useState<EngineerOption[]>([])

  /** 누를 때 비로소 재직자를 읽는다 — 홈을 열 때마다 읽지 않는다. */
  const openModal = async () => {
    if (loading) return
    setLoading(true)
    try {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('engineers').select('engineer_id, name, initials, resigned_date').order('name')
      if (error) { console.error('[backfill] 재직자를 읽지 못했다', error); toast.error('담당자 목록을 읽지 못했습니다'); return }
      const today = todayKST()
      setEngineers((data ?? [])
        .filter(e => isActiveInPeriod((e as { resigned_date?: string | null }).resigned_date ?? null, today))
        .map(e => ({
          engineer_id: Number(e.engineer_id),
          name: (e as { name?: string | null }).name ?? null,
          initials: (e as { initials?: string | null }).initials ?? null,
        })))
      setOpen(true)
    } finally {
      setLoading(false)
    }
  }

  /** 담기 — PDF 가 함께 가므로 FormData 다(실적 현황에 있던 그 코드 그대로). */
  const save = async (form: BackfillForm, pdf: File) => {
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('form', JSON.stringify(form))
      fd.append('pdf', pdf)
      const res = await fetch('/api/quote-backfill', { method: 'POST', body: fd })
      const json = await res.json().catch(() => null)
      if (!res.ok) { toast.error((json?.error as string) ?? `담지 못했습니다 (${res.status})`); return }
      setOpen(false)
      onSaved?.()
      // PDF 만 실패했을 수 있다 — 그때도 줄은 담겼다(라우트가 그렇게 알려 준다).
      if (json?.warning) toast.error(String(json.warning))
      else toast.success(`${json?.quote_number ?? '실적'} 을 담았습니다`)
    } catch (e) {
      console.error('[backfill] 담기 실패', e)
      toast.error('네트워크 오류로 담지 못했습니다')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {/* 카드 전체가 눌리는 자리라 전파를 막는다 — 단추는 단추의 일만 한다. */}
      <button
        type="button"
        onClick={e => { e.stopPropagation(); void openModal() }}
        style={loading ? btnBusy : btn}
      >
        {loading ? '여는 중…' : '＋ 사후 실적'}
      </button>
      {open && (
        <div onClick={e => e.stopPropagation()}>
          <BackfillModal
            engineers={engineers}
            busy={busy}
            onClose={() => setOpen(false)}
            onSave={(form, pdf) => void save(form, pdf)}
          />
        </div>
      )}
    </>
  )
}
