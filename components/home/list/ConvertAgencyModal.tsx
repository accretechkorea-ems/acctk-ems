'use client'

/**
 * 회사 → **대리점 전환** 확인 창 (2026-11-21).
 *
 * CRM 정리에서 「회사 + 사업장 한 곳」으로 들어온 줄 중에, 사실은 우리 고객이 아니라
 * **대리점**인 곳이 섞여 있다. 그 둘을 한 줄(대리점)로 모은다.
 *
 * 두 걸음이다 — 사업장 병합 창과 같은 규칙이다(SiteMergeModal).
 *   ① 열면 바로 **dry run** 을 돌려 「막는 것이 있는가 · 무엇이 따라가는가」를 보여 준다.
 *   ② 막는 것이 없을 때만 「전환」이 켜진다.
 *
 * 되돌리기는 자동으로 없다 — SQL 파일 머리말의 수동 절차뿐이다
 * (db/convert_company_to_agency_20261121.sql).
 */

import { useEffect, useState } from 'react'
import ModalOverlay from '@/components/common/ModalOverlay'
import ModalCard from '@/components/common/ModalCard'
import { TABLE_LABEL } from '@/components/home/list/SiteMergeModal'
import { R } from '@/lib/radius'

const BORDER = '#ebebeb'
const TEXT = '#111827'
const SUB = '#6b7280'
const MUTED = '#9ca3af'
const BLUE = '#234ea2'
const NEUTRAL = '#f3f4f6'
const DANGER = '#ef4444'

/** DB 함수가 돌려주는 값(db/convert_company_to_agency_20261121.sql 머리말). */
export type ConvertReport = {
  ok: boolean
  dry_run: boolean
  company_id: number
  company_name: string | null
  site_id: number
  site_name: string | null
  agency_name?: string | null
  /** 막는 참조 — 회사 줄에 직접 붙어 있어 줄을 닫을 수 없는 것들. */
  blockers?: Record<string, number>
  blocker_total?: number
  /** 사업장 줄에 붙어 **그대로 따라가는** 기록. */
  follows?: Record<string, number>
  follows_total?: number
}

const btnGhost = (busy: boolean) => ({
  padding: '9px 15px', background: '#fff', color: SUB, borderRadius: R.icon,
  border: `1px solid ${BORDER}`, cursor: busy ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: 13,
})

export default function ConvertAgencyModal({
  companyName, siteCount, busy, onDryRun, onRun, onClose,
}: {
  companyName: string
  /** 살아있는 사업장 수 — 1곳이 아니면 애초에 이 창이 열리지 않는다(버튼이 잠긴다). */
  siteCount: number
  busy: boolean
  /** 열면 한 번 돌린다. 실패하면 사유를 글자로 돌려준다. */
  onDryRun: () => Promise<{ ok: true; report: ConvertReport } | { ok: false; error: string }>
  onRun: () => void
  onClose: () => void
}) {
  const [report, setReport] = useState<ConvertReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(true)

  // 열면서 한 번 — 아무것도 바꾸지 않는 조회다.
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      const r = await onDryRun()
      if (cancelled) return
      if (r.ok) { setReport(r.report); setError(null) }
      else { setError(r.error); setReport(null) }
      setChecking(false)
    }
    void run()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const blockers = Object.entries(report?.blockers ?? {})
  const follows = Object.entries(report?.follows ?? {})
  const can = !!report?.ok && blockers.length === 0 && siteCount === 1

  return (
    <ModalOverlay onClose={onClose}>
      {/* 구조는 공용 카드가 든다 — 머리줄 고정 / 본문 스크롤 / 바닥줄 고정. */}
      <ModalCard
        width={480}
        title="대리점으로 전환"
        footer={<>
          <button onClick={onClose} disabled={busy} style={btnGhost(busy)}>닫기</button>
          <button onClick={onRun} disabled={busy || !can}
            style={{
              padding: '9px 17px', background: can ? BLUE : NEUTRAL, color: can ? '#fff' : MUTED,
              borderRadius: R.icon, border: 'none', cursor: busy || !can ? 'not-allowed' : 'pointer',
              fontWeight: 700, fontSize: 13, opacity: busy ? 0.6 : 1,
            }}>
            {busy ? '전환 중…' : '전환'}
          </button>
        </>}
      >

        <div style={{ fontSize: 13, color: TEXT, lineHeight: 1.9 }}>
          <b>{companyName}</b>
          <span style={{ color: SUB }}> 를 회사에서 </span>
          <b style={{ color: '#c2410c' }}>대리점</b>
          <span style={{ color: SUB }}> 으로 바꿉니다.</span>
          <div style={{ color: MUTED, fontSize: 12 }}>
            {report?.site_name
              ? `사업장 「${report.site_name}」 줄이 대리점이 되고, 회사 줄은 닫힙니다.`
              : '하나뿐인 사업장 줄이 대리점이 되고, 회사 줄은 닫힙니다.'}
          </div>
        </div>

        {checking && (
          <div style={{ marginTop: 14, fontSize: 12, color: MUTED }}>확인 중…</div>
        )}

        {error && (
          <div style={{ marginTop: 14, fontSize: 12, lineHeight: 1.8, color: DANGER, background: '#fef2f2', border: `1px solid ${BORDER}`, borderRadius: R.control, padding: '9px 11px' }}>
            {error}
          </div>
        )}

        {/* 막는 것 — 회사 줄에 직접 붙은 참조. 하나라도 있으면 전환하지 않는다. */}
        {blockers.length > 0 && (
          <div style={{ marginTop: 14, border: `1px solid ${BORDER}`, borderRadius: R.control, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: '#fef2f2', borderBottom: `1px solid ${BORDER}` }}>
              <b style={{ fontSize: 12, fontWeight: 700, color: DANGER }}>회사 줄에 붙어 있어 먼저 옮겨야 하는 기록</b>
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: DANGER }}>{report?.blocker_total ?? 0}건</span>
            </div>
            <div style={{ maxHeight: 160, overflowY: 'auto' }}>
              {blockers.map(([k, v]) => (
                <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', borderBottom: `1px solid ${BORDER}`, fontSize: 12 }}>
                  <span style={{ color: TEXT }}>{TABLE_LABEL[k] ?? k}</span>
                  <span style={{ flex: 1 }} />
                  <b style={{ color: DANGER, fontWeight: 700 }}>{v}건</b>
                </div>
              ))}
            </div>
            <div style={{ padding: '8px 12px', fontSize: 11, color: SUB, lineHeight: 1.7 }}>
              회사 줄을 닫으면 이 기록이 닫힌 줄을 가리킵니다. 그 기록을 사업장 줄로 옮긴 뒤 다시 시도하세요.
            </div>
          </div>
        )}

        {/* 따라가는 것 — 사업장 줄에 붙어 있어 그대로 남는다. */}
        {can && (
          <div style={{ marginTop: 14, border: `1px solid ${BORDER}`, borderRadius: R.control, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: '#fafafa', borderBottom: `1px solid ${BORDER}` }}>
              <b style={{ fontSize: 12, fontWeight: 700, color: TEXT }}>그대로 따라가는 기록</b>
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: SUB, background: NEUTRAL, borderRadius: R.pill, padding: '1px 7px' }}>{report?.follows_total ?? 0}건</span>
            </div>
            {follows.length === 0 ? (
              <div style={{ padding: '14px 12px', fontSize: 12, color: MUTED }}>붙어 있는 기록이 없습니다 — 줄의 성격만 바뀝니다.</div>
            ) : (
              <div style={{ maxHeight: 160, overflowY: 'auto' }}>
                {follows.map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', borderBottom: `1px solid ${BORDER}`, fontSize: 12 }}>
                    <span style={{ color: TEXT }}>{TABLE_LABEL[k] ?? k}</span>
                    <span style={{ flex: 1 }} />
                    <b style={{ color: TEXT, fontWeight: 700 }}>{v}건</b>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <ul style={{ fontSize: 12, color: SUB, lineHeight: 1.9, marginTop: 12, paddingLeft: 18 }}>
          <li>대리점 이름은 <b>회사명</b>({companyName})이 됩니다. 사업장명은 비워집니다.</li>
          <li>담당자·장비·활동·견적은 사업장 줄에 붙어 있어 <b>그대로 따라갑니다</b>.</li>
          <li><b style={{ color: DANGER }}>되돌리기는 자동으로 없습니다.</b> 전환 뒤에는 목록의 대리점 탭에서 보입니다.</li>
        </ul>

      </ModalCard>
    </ModalOverlay>
  )
}
