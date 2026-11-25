'use client'

/**
 * **숨긴 장비를 되살리는 자리** — 장비 그리드 끝의 한 줄 (2026-11-25).
 *
 * ── 왜 여기인가 ──────────────────────────────────────────────────────────
 *   장비 삭제를 로그인한 사람 전부에게 열었다(지시). 그러면 잘못 지우는 일도 생긴다.
 *   되살리는 길이 다른 화면에 있으면 지운 사람은 그 길을 못 찾는다 — **지운 자리**에
 *   둔다. 평소에는 접혀 있고, 숨긴 장비가 없으면 줄 자체가 없다.
 *
 * ── 누가 ─────────────────────────────────────────────────────────────────
 *   되살리기는 **관리 메뉴를 가진 사람**(+슈퍼관리자)이다. 지운 사람이 아니라 전체를
 *   보는 사람이 판단한다 — 라우트도 같은 문턱이다(app/api/customer-delete 의 ADMIN_ACTIONS).
 *   그 밖의 사람에게는 이 줄을 내주지 않는다(목록을 읽는 것도 같은 문턱이다).
 */

import { useCallback, useEffect, useState } from 'react'
import { customerDelete } from '@/lib/customerDelete.client'
import { useToast } from '@/components/common/Toast'
import { R } from '@/lib/radius'
import { BORDER, CARD_BG, MUTED, SUB, TEXT } from '@/components/common/ui'

/** 라우트가 돌려주는 숨긴 장비 한 줄. */
type Row = { device_id: number; name: string; serial_number: string | null; hint: string }

export default function DeletedDevices({
  customerId, canRestore, onRestored,
}: {
  customerId: number
  /** 관리 메뉴를 가진 사람인가 — 아니면 아무것도 그리지 않는다. */
  canRestore: boolean
  /** 되살린 뒤 — 화면이 장비를 다시 읽는다. */
  onRestored: () => void | Promise<unknown>
}) {
  const toast = useToast()
  const [rows, setRows] = useState<Row[]>([])
  const [open, setOpen] = useState(false)
  const [busyId, setBusyId] = useState<number | null>(null)

  /** 숨긴 장비를 읽어 온다. 못 읽으면 빈 목록이다 — 보조 줄이라 실패를 알리지 않는다. */
  const fetchRows = useCallback(
    () => customerDelete({ action: 'list-deleted', target: 'device', customerId })
      .then(r => (r.ok ? ((r.data.rows ?? []) as Row[]) : [])),
    [customerId],
  )

  // 숨긴 장비가 몇 대인지는 **접힌 채로도** 적어야 한다(그래야 펼칠 까닭이 생긴다) —
  // 그래서 열기 전에 한 번 읽는다. 권한이 없으면 부르지 않는다(403 이 날 길을 만들지 않는다).
  useEffect(() => {
    if (!canRestore) return
    void fetchRows().then(setRows)
  }, [canRestore, fetchRows])

  if (!canRestore || rows.length === 0) return null

  const restore = async (row: Row) => {
    setBusyId(row.device_id)
    const r = await customerDelete({ action: 'restore', target: 'device', id: row.device_id })
    setBusyId(null)
    if (!r.ok) { toast.error(r.error); return }
    toast.success(`${row.name} 을(를) 되살렸습니다`)
    setRows(await fetchRows())
    await onRestored()
  }

  return (
    <div className="dev-deleted" style={{ marginTop: 14 }}>
      <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 10px',
          border: `1px solid ${BORDER}`, borderRadius: R.control, background: CARD_BG,
          color: SUB, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
        }}>
        삭제된 장비 <span className="num">{rows.length}</span>대 {open ? '▴' : '▾'}
      </button>

      {open && (
        <div style={{
          marginTop: 8, border: `1px solid ${BORDER}`, borderRadius: R.card, background: CARD_BG,
          overflow: 'hidden', maxWidth: 520,
        }}>
          {rows.map((row, i) => (
            <div key={row.device_id}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                borderTop: i === 0 ? 'none' : `1px solid ${BORDER}`, minWidth: 0,
              }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13, color: TEXT, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {row.name}
                </div>
                <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>
                  {[row.serial_number ? `S/N ${row.serial_number}` : null, row.hint].filter(Boolean).join(' · ')}
                </div>
              </div>
              <button type="button" onClick={() => void restore(row)} disabled={busyId === row.device_id}
                style={{
                  height: 28, padding: '0 10px', border: `1px solid ${BORDER}`, borderRadius: R.control,
                  background: CARD_BG, color: SUB, fontSize: 12, fontWeight: 700,
                  cursor: busyId === row.device_id ? 'not-allowed' : 'pointer', fontFamily: 'inherit', flexShrink: 0,
                }}>
                {busyId === row.device_id ? '되살리는 중…' : '되살리기'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
