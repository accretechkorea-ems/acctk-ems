'use client'

/**
 * 사업장 병합 — 같은 회사 안의 사업장 여러 줄을 한 줄로 합친다.
 *
 * 두 걸음이다.
 *   ① 남길 줄을 고르고(라디오), 남길 이름을 정한다(비우면 지금 이름 그대로).
 *   ② **dry run** 으로 「어느 표의 몇 줄이 옮겨 가는지」를 먼저 보여 주고 확인을 받는다.
 *      견적 12건·장비 4대처럼 숫자로 보여야 합쳐도 되는 줄인지 판단할 수 있다.
 *
 * 되돌리기는 없다. 합쳐진 줄은 닫히고(삭제 표시) 목록에서 사라진다.
 * 실제 이동은 DB 함수 한 번이다 — db/merge_customer_sites_20261119.sql.
 */

import { useState } from 'react'
import ModalOverlay from '@/components/common/ModalOverlay'
import ModalCard, { keepPads } from '@/components/common/ModalCard'
import type { SiteRow } from '@/lib/customerList'
import { R } from '@/lib/radius'

const BORDER = '#ebebeb'
const TEXT = '#111827'
const SUB = '#4b5563'
const MUTED = '#6b7280'
const BLUE = '#234ea2'
const NEUTRAL = '#f3f4f6'
const DANGER = '#ef4444'

/** 표 이름을 사람 말로. 모르는 표는 그대로 보여 준다(새 표가 생겨도 숫자는 보인다). */
export const TABLE_LABEL: Record<string, string> = {
  'quotes.customer_id': '견적(수요처)',
  'quotes.dealer_id': '견적(대리점)',
  'devices.customer_id': '장비',
  'contacts.customer_id': '고객 담당자',
  'service_history.customer_id': '서비스 기록',
  'sales_activities.customer_id': '영업 활동',
  'sales_opportunities.customer_id': '영업기회',
  'holdings.customer_id': '홀딩',
  'leads.customer_id': '리드',
  'repairs.customer_id': '수리',
  'showroom_usage.customer_id': '쇼룸 사용',
  'showroom_sites.customer_id': '쇼룸 설정',
  'customers.parent_customer_id': '소속 사업장',
  'customers.agency_customer_id': '이 줄을 대리점으로 쓰던 업체',
}

export type MergeReport = {
  keep_id: number
  from_ids: number[]
  dry_run: boolean
  moved: Record<string, number>
  dropped?: Record<string, number>
  filled?: string[]
  total: number
}

type Props = {
  /** 고른 사업장들(두 곳 이상). */
  rows: SiteRow[]
  busy: boolean
  /** ① 다음 → dry run 을 돌려 준다. 실패하면 null. */
  onDryRun: (keepId: number, fromIds: number[]) => Promise<MergeReport | null>
  /** ② 실행. */
  onRun: (keepId: number, fromIds: number[], siteName: string) => void
  onClose: () => void
}

/**
 * 카드의 바탕·테두리·그림자는 공용 카드(ModalCard)가 든다. 여기 남는 것은 **여백**뿐이다 —
 * 옛 카드의 padding 22, 그리고 바닥줄 위 간격 18(옛 버튼 줄의 marginTop)이다.
 * 머리 간격은 0 이다 — 제목 줄이 스스로 marginBottom(12 · 6→14)을 들고 있다.
 */
const PADS = keepPads({ x: 22, top: 22, bottom: 22 }, 0, 18)

export default function SiteMergeModal({ rows, busy, onDryRun, onRun, onClose }: Props) {
  const [keepId, setKeepId] = useState<number>(rows[0]?.customer.customer_id ?? 0)
  const [siteName, setSiteName] = useState('')
  const [report, setReport] = useState<MergeReport | null>(null)
  const [checking, setChecking] = useState(false)

  const keep = rows.find(r => r.customer.customer_id === keepId)
  const fromIds = rows.map(r => r.customer.customer_id).filter(id => id !== keepId)

  const next = async () => {
    setChecking(true)
    const r = await onDryRun(keepId, fromIds)
    setChecking(false)
    if (r) setReport(r)
  }

  // ── ② 확인 ──
  if (report) {
    const moved = Object.entries(report.moved ?? {})
    const dropped = Object.entries(report.dropped ?? {})
    return (
      <ModalOverlay onClose={() => setReport(null)}>
        {/* 구조는 공용 카드가 든다 — 머리줄 고정 / 본문 스크롤 / 바닥줄 고정.
            겉모양(제목 17/800 · 여백 22 · 버튼)은 옛 값 그대로다.
            ✕ 는 두지 않는다 — 길은 [뒤로]·Esc·바깥 클릭 셋이고 모두 앞 단계로 돌아간다. */}
        <ModalCard
          width={480}
          closeX={false}
          {...PADS}
          title={<>
            <div style={{ fontSize: 17, fontWeight: 800, color: TEXT, marginBottom: 12 }}>사업장 병합 — 한 번 더 확인</div>
          </>}
          footer={<>
            <button onClick={() => setReport(null)} disabled={busy}
              style={{ padding: '9px 15px', background: '#fff', color: SUB, borderRadius: R.icon, border: `1px solid ${BORDER}`, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>뒤로</button>
            <button onClick={() => onRun(keepId, fromIds, siteName.trim())} disabled={busy}
              style={{ padding: '9px 17px', background: DANGER, color: '#fff', borderRadius: R.icon, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, opacity: busy ? 0.6 : 1 }}>
              {busy ? '합치는 중…' : '합치기'}
            </button>
          </>}
        >
          <div style={{ fontSize: 13, color: TEXT, lineHeight: 1.9 }}>
            {rows.filter(r => r.customer.customer_id !== keepId).map(r => (
              <div key={r.customer.customer_id} style={{ color: SUB }}>{r.siteName || '입력 필요'}</div>
            ))}
            <div style={{ color: MUTED }}>↓</div>
            <b>{siteName.trim() || keep?.siteName || '입력 필요'}</b>
            <span style={{ color: SUB }}> 로 합칩니다.</span>
          </div>

          <div style={{ marginTop: 14, border: `1px solid ${BORDER}`, borderRadius: R.control, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: '#fafafa', borderBottom: `1px solid ${BORDER}` }}>
              <b style={{ fontSize: 12, fontWeight: 700, color: TEXT }}>옮겨 갈 기록</b>
              <span style={{ fontSize: 11, fontWeight: 700, color: SUB, background: NEUTRAL, borderRadius: R.pill, padding: '1px 7px' }}>{report.total}건</span>
            </div>
            {moved.length === 0 && dropped.length === 0 ? (
              <div style={{ padding: '14px 12px', fontSize: 12, color: MUTED }}>옮길 기록이 없습니다 — 줄만 합쳐집니다.</div>
            ) : (
              <div style={{ maxHeight: 190, overflowY: 'auto' }}>
                {moved.map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', borderBottom: `1px solid ${BORDER}`, fontSize: 12 }}>
                    <span style={{ color: TEXT }}>{TABLE_LABEL[k] ?? k}</span>
                    <span style={{ flex: 1 }} />
                    <b style={{ color: TEXT, fontWeight: 700 }}>{v}건</b>
                  </div>
                ))}
                {dropped.map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', borderBottom: `1px solid ${BORDER}`, fontSize: 12 }}>
                    <span style={{ color: SUB }}>{TABLE_LABEL[k] ?? k}</span>
                    <span style={{ flex: 1 }} />
                    <b style={{ color: DANGER, fontWeight: 700 }}>{v}건 버림</b>
                  </div>
                ))}
              </div>
            )}
          </div>

          <ul style={{ fontSize: 12, color: SUB, lineHeight: 1.9, marginTop: 12, paddingLeft: 18 }}>
            <li>남길 줄의 주소·대리점·메모가 <b>비어 있을 때만</b> 합쳐지는 줄의 값을 가져옵니다.</li>
            <li><b style={{ color: DANGER }}>되돌리기는 없습니다.</b> 합쳐진 줄은 닫히고 목록에서 사라집니다.</li>
          </ul>

        </ModalCard>
      </ModalOverlay>
    )
  }

  // ── ① 남길 줄 고르기 ──
  return (
    <ModalOverlay onClose={onClose}>
      {/* 같은 공용 카드. 겉모양(제목 17/800 · 설명 12 · 여백 22 · 버튼)은 옛 값 그대로다. */}
      <ModalCard
        width={480}
        closeX={false}
        {...PADS}
        title={<>
          <div style={{ fontSize: 17, fontWeight: 800, color: TEXT, marginBottom: 6 }}>사업장 병합</div>
          <div style={{ fontSize: 12, color: SUB, marginBottom: 14 }}>
            {`고른 ${rows.length}곳을 한 줄로 합칩니다. 남길 줄을 고르세요 — 나머지 줄의 기록이 그 줄로 옮겨 갑니다.`}
          </div>
        </>}
        footer={<>
          <button onClick={onClose} disabled={busy || checking}
            style={{ padding: '9px 15px', background: '#fff', color: SUB, borderRadius: R.icon, border: `1px solid ${BORDER}`, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>취소</button>
          <button onClick={() => void next()} disabled={busy || checking || fromIds.length === 0}
            style={{ padding: '9px 17px', background: BLUE, color: '#fff', borderRadius: R.icon, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, opacity: checking ? 0.6 : 1 }}>
            {checking ? '세는 중…' : '다음'}
          </button>
        </>}
      >

        <div style={{ border: `1px solid ${BORDER}`, borderRadius: R.control, overflow: 'hidden' }}>
          {rows.map(r => {
            const id = r.customer.customer_id
            const on = id === keepId
            return (
              <label key={id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                  borderBottom: `1px solid ${BORDER}`, cursor: 'pointer',
                  background: on ? '#eff4ff' : '#fff',
                }}>
                <input type="radio" name="keep-site" checked={on} onChange={() => setKeepId(id)} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: on ? 700 : 600, color: r.siteName ? TEXT : MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.siteName || '입력 필요'}</div>
                  <div style={{ fontSize: 11, color: MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {[r.customer.address, `장비 ${r.deviceCount}`, `진행 견적 ${r.openQuotes}`].filter(Boolean).join(' · ')}
                  </div>
                </div>
              </label>
            )
          })}
        </div>

        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, marginBottom: 4 }}>남길 사업장명</div>
          <input value={siteName} onChange={e => setSiteName(e.target.value)} disabled={busy || checking}
            placeholder={keep?.customer.site_name?.trim() || '비우면 지금 이름 그대로'}
            style={{ width: '100%', padding: '10px 12px', border: `1px solid ${BORDER}`, borderRadius: R.icon, boxSizing: 'border-box', fontSize: 14, color: TEXT, outline: 'none' }} />
        </div>

      </ModalCard>
    </ModalOverlay>
  )
}
