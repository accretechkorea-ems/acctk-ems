'use client'

/**
 * **대리점 화면** — 목록 보기의 대리점 탭에서 한 곳을 누르면 우측 pane 에 선다(2026-11-21).
 *
 * ── 전에는 ─────────────────────────────────────────────────────────────────
 *   대리점을 누르면 **회사 탭이 그 대리점의 사업장만 걸러** 보여 주고 우측은 비어 있었다.
 *   대리점 자체에 대해 아는 것(담당자·메모·거래 규모)이 화면에 아예 없었고, 거르기는
 *   필터 모달의 「대리점」 조건이 이미 하는 일이라 두 길이 겹쳤다.
 *
 * ── 지금은 ─────────────────────────────────────────────────────────────────
 *   회사 화면과 같은 급이다. 위에 대리점 카드 한 장(사업장 화면과 **같은 틀** —
 *   components/customer/HeaderBand.tsx), 그 아래 거래 사업장 표 한 장.
 *   통계 타일은 두지 않는다 — 셀 것이 「거래 사업장 수」와 「견적」뿐이고, 둘 다 제목
 *   줄과 표 머리줄에 이미 적힌다.
 *
 * ── 조회 ───────────────────────────────────────────────────────────────────
 *   표는 조회를 **더 하지 않는다**(목록 보기가 들고 있는 것으로 만든다 —
 *   lib/agencyPane.ts). 대리점을 고른 순간 담당자와 그 대리점 경유 견적만 읽는다
 *   (hooks/useAgencyDetail.ts).
 */

import { useMemo, useRef, useState } from 'react'
import BackIconButton from '@/components/common/BackIconButton'
import ScrollHints from '@/components/common/ScrollHints'
import HeaderBand, { STATUS_RESERVE } from '@/components/customer/HeaderBand'
import ContactAddModal from '@/components/customer/modals/ContactAddModal'
import ContactEditModal from '@/components/customer/modals/ContactEditModal'
import QuoteHistoryModal from '@/components/customer/modals/QuoteHistoryModal'
import CompanyEditModal, { type CompanyEditForm } from '@/components/home/list/CompanyEditModal'
import { useContactCrud } from '@/hooks/customer/useContactCrud'
import { useAgencyDetail } from '@/hooks/useAgencyDetail'
import { useQuotePdf } from '@/hooks/customer/useQuotePdf'
import {
  AGENCY_SORT_LABEL, type AgencySiteRow, type AgencySort,
  agencyQuoteCounts, buildAgencySites, filterAgencySites, sortAgencySites,
} from '@/lib/agencyPane'
import { invalidateAgencies, type AgencyOption } from '@/lib/customerAgency'
import { isStale } from '@/lib/customerList'
import { PENDING_STATUS } from '@/lib/quoteStatus'
import { createClient } from '@/lib/supabase/client'
import DeleteCustomerModal from '@/components/home/list/DeleteCustomerModal'
import { R } from '@/lib/radius'
import type { LastTouch } from '@/lib/customerLastTouch'
import type { Customer } from '@/lib/home'
import type { Quote } from '@/components/customer/types'

const BORDER = '#ebebeb'
const TEXT = '#111827'
const SUB = '#6b7280'
const MUTED = '#9ca3af'
const DANGER = '#ef4444'
const BLUE = '#234ea2'
const NEUTRAL = '#f3f4f6'

const STATUS_DOT: Record<string, string> = { '활성': '#16a34a', '잠재': '#f59e0b', '이탈': '#ef4444' }

const card = { background: '#ffffff', border: `1px solid ${BORDER}`, borderRadius: R.card } as const
const th = {
  fontSize: 11, fontWeight: 700, color: SUB, textAlign: 'left' as const, height: 36, padding: '0 10px',
  borderBottom: `1px solid ${BORDER}`, background: '#fafafa', whiteSpace: 'nowrap' as const,
}
const td = {
  height: 44, padding: '0 10px', borderBottom: `1px solid ${BORDER}`,
  whiteSpace: 'nowrap' as const, fontSize: 13, color: TEXT,
}

export type AgencyPaneProps = {
  agency: AgencyOption
  /** 목록 조회가 준 사업장 줄 전체 — 이 중 이 대리점을 거치는 줄만 표에 선다. */
  customers: Customer[]
  companyName: (companyId: number) => string | null
  deviceCount: (customerId: number) => number
  openQuotes: (customerId: number) => number
  touchOf: (customerId: number) => LastTouch | null
  today: string
  /** 본인 — 견적 PDF 를 열 때 조회 기록에 남는다(회사 화면과 같다). */
  me: { engineer_id: number | null }
  /** 담당자를 지울 수 있는가(슈퍼관리자). 없으면 버튼을 내지 않는다. */
  canDeleteContact?: boolean
  /** 표의 줄을 누르면 그 사업장 화면으로. 돌아오면 이 대리점 화면이다. */
  onOpenSite: (siteId: number) => void
  /** 폰에서 목록으로 돌아가는 ← (넓은 화면에서는 CSS 가 감춘다). */
  onBackToList?: () => void
  /** 저장이 끝나면 부른다 — 화면이 목록을 다시 읽는다. */
  onSaved: () => void
  onError: (message: string) => void
  onToast: (message: string) => void
  /** 견적 PDF 를 열 때. 없으면 이 화면이 직접 연다. */
  onOpenQuote?: (q: Quote) => void
}

export default function AgencyPane({
  agency, customers, companyName, deviceCount, openQuotes, touchOf, today, me, canDeleteContact = false,
  onOpenSite, onBackToList, onSaved, onError, onToast, onOpenQuote,
}: AgencyPaneProps) {
  const supabase = createClient()
  const { contacts, quotes, reload } = useAgencyDetail(agency.customer_id)
  // 담당자 추가·수정·삭제는 **사업장 화면과 같은 훅**이다(대리점도 customers 의 한 줄이다).
  const contact = useContactCrud({
    customerId: agency.customer_id,
    fetchDetail: async () => { reload(); return true },
  })
  const { openQuotePdf } = useQuotePdf({ customer: null, engineerId: me.engineer_id })

  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<AgencySort>('touch')
  const [editOpen, setEditOpen] = useState(false)
  const [quoteHistoryOpen, setQuoteHistoryOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const tableRef = useRef<HTMLDivElement | null>(null)

  const all = useMemo(() => buildAgencySites({
    customers, agencyId: agency.customer_id, companyName, deviceCount, openQuotes, touchOf, today,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [customers, agency.customer_id, today])
  const rows = useMemo(
    () => sortAgencySites(filterAgencySites(all, query), sort),
    [all, query, sort],
  )
  const counts = agencyQuoteCounts(quotes, PENDING_STATUS)

  /**
   * 대리점 한 줄을 고친다 — **따라 바뀌는 줄이 없어** 라우트를 거치지 않는다
   * (회사명은 아래 사업장 이름까지 다시 만들어야 해 /api/company 가 맡는다).
   * 사업장 수정과 같은 자리에서 같은 방식으로 쓴다.
   */
  const save = async (form: CompanyEditForm) => {
    if (busy) return
    const name = form.name.trim()
    if (!name) { onError('대리점명을 입력해주세요'); return }
    setBusy(true)
    const { error } = await supabase.from('customers').update({
      company_name: name,
      name_en: form.nameEn.trim() || null,
      address: (form.address ?? '').trim() || null,
      note: form.note.trim() || null,
    }).eq('customer_id', agency.customer_id)
    setBusy(false)
    if (error) { onError(error.message || '대리점 정보를 저장하지 못했습니다'); return }
    invalidateAgencies()   // 대리점 목록 캐시가 옛 이름·주소를 들고 있다
    setEditOpen(false)
    onToast('대리점 정보를 수정했습니다')
    onSaved()
  }

  return (
    <>
      {/* 폰 전용 ← 의 보임/숨김은 화면이 한 곳에서 정한다(app/page.tsx 의 .pane-back). */}
      <style>{`
        .agency-row:hover { background: #fafafa }
      `}</style>

      <HeaderBand
        className="agency-band"
        contacts={contacts}
        memoTitle={agency.company_name}
        memo={agency.note}
        status={agency.status}
        onEdit={() => setEditOpen(true)}
        editLabel="대리점 정보 수정"
        onAddContact={() => contact.setIsAddContactModalOpen(true)}
        onEditContact={contact.setSelectedContact}
        left={<>
          {/* 1줄 — 대리점명 20 · 「대리점」 태그 · 영문명, 우측에 견적 배지.
              상태(「● 활성」)는 이 줄에 없다 — 좌 칸 우상단에 붙어 있다(HeaderBand).
              그 자리만큼 오른쪽을 비워 둔다(STATUS_RESERVE). */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, flexWrap: 'wrap', minWidth: 0, paddingRight: STATUS_RESERVE }}>
            {onBackToList && (
              <span className="pane-back" style={{ alignSelf: 'center' }}>
                <BackIconButton onClick={onBackToList} label="목록으로" />
              </span>
            )}
            <b style={{ fontSize: 20, fontWeight: 700, color: TEXT, letterSpacing: '-0.3px' }}>{agency.company_name}</b>
            <span style={{ alignSelf: 'center', fontSize: 11, fontWeight: 700, color: '#c2410c', background: NEUTRAL, borderRadius: R.tag, padding: '1px 5px' }}>
              대리점
            </span>
            {agency.name_en && <span style={{ fontSize: 13, color: MUTED }}>{agency.name_en}</span>}
            <span style={{ flex: 1 }} />
            {/* 그 대리점을 거친 견적 — 진행과 전체를 한 자리에서 본다(quotes.dealer_id).
                누르면 같은 수치를 제목에 단 견적 이력 창이 열린다. */}
            <button type="button" onClick={() => setQuoteHistoryOpen(true)}
              title={`견적 이력 — 이 대리점 경유 ${counts.all}건(끝난 건 포함)`}
              style={{
                alignSelf: 'center', display: 'inline-flex', alignItems: 'center', gap: 6, height: 26,
                padding: '0 9px', borderRadius: R.control, border: `1px solid ${BORDER}`,
                background: '#fafafa', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
              }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: counts.pending > 0 ? BLUE : MUTED }}>
                {`진행 견적 ${counts.pending}건`}
              </span>
              <span style={{ fontSize: 11, color: MUTED }}>{`· 전체 ${counts.all}건`}</span>
            </button>
          </div>

          {/* 2줄 — 주소. 「담당 영역」 줄은 두지 않는다: 그 칸이 DB 에 없다
              (2026-11-21 확인 — territory·coverage·sales_area 모두 없다). */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 10, fontSize: 13, color: '#374151', minWidth: 0 }}>
            <span style={{ color: MUTED, flexShrink: 0 }}>주소</span>
            <span style={{ color: agency.address ? '#374151' : MUTED, wordBreak: 'break-all', minWidth: 0 }}>
              {agency.address ?? '주소 없음'}
            </span>
          </div>

          {/* 3줄은 두지 않는다(2026-11-21) — 「거래 사업장 N곳」을 적어 두었더니 바로 아래
              표 제목의 「거래 사업장 N」과 같은 수를 두 번 말하는 꼴이었다. 카드는
              「제목 줄 / 주소」 두 줄이다. */}
        </>}
      />

      {/* ── 거래 사업장 표 ── */}
      <section style={{ ...card, overflow: 'hidden', display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', borderBottom: `1px solid ${BORDER}`, flexWrap: 'wrap' }}>
          <b style={{ fontSize: 16, fontWeight: 600, color: TEXT }}>{`거래 사업장 ${all.length}`}</b>
          {query.trim() && <span style={{ fontSize: 12, color: SUB }}>{`검색 ${rows.length}`}</span>}
          <span style={{ flex: 1 }} />
          {/* 표 안 검색 — 좌 패널의 검색과 다른 칸이다(이 표만 거른다). */}
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="이 목록에서 검색"
            style={{
              width: 200, height: 30, padding: '0 10px', boxSizing: 'border-box',
              border: `1px solid ${BORDER}`, borderRadius: R.control, outline: 'none',
              fontSize: 12, color: TEXT, fontFamily: 'inherit',
            }} />
          <select value={sort} onChange={e => setSort(e.target.value as AgencySort)}
            aria-label="정렬"
            style={{
              height: 30, padding: '0 6px', border: `1px solid ${BORDER}`, borderRadius: R.control,
              background: '#fff', fontSize: 12, color: SUB, cursor: 'pointer', fontFamily: 'inherit',
            }}>
            {(Object.keys(AGENCY_SORT_LABEL) as AgencySort[]).map(k => (
              <option key={k} value={k}>{AGENCY_SORT_LABEL[k]}</option>
            ))}
          </select>
        </div>

        {/* 많으면 표 안에서 구른다 — 스크롤바를 숨기고 위·아래 힌트를 둔다(Ⓒ 규칙).
            젠트 한 곳이 187곳을 거느린다(2026-11-21 실측). */}
        <div style={{ position: 'relative', minHeight: 0, flex: 1 }}>
          <ScrollHints scrollRef={tableRef} top={38} bottom={8} />
          <div ref={tableRef} className="stable-scroll" style={{ overflow: 'auto', maxHeight: '100%' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 760 }}>
              <thead>
                <tr>
                  <th style={th}>회사 » 사업장</th>
                  <th style={th}>지역</th>
                  <th style={th}>상태</th>
                  <th style={{ ...th, textAlign: 'right', width: 64 }}>장비</th>
                  <th style={{ ...th, textAlign: 'right', width: 86 }}>진행 견적</th>
                  <th style={th}>최근 활동</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ ...td, height: 90, textAlign: 'center', color: MUTED, fontSize: 13 }}>
                      {all.length === 0 ? '이 대리점을 거치는 사업장이 없습니다' : '검색 결과가 없습니다'}
                    </td>
                  </tr>
                ) : rows.map((r: AgencySiteRow) => {
                  const id = r.customer.customer_id
                  const late = isStale(r.days)
                  return (
                    <tr key={id} className="agency-row" onClick={() => onOpenSite(id)} style={{ cursor: 'pointer' }}>
                      <td style={{ ...td }}>
                        <div style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {r.companyName && <span style={{ color: SUB }}>{r.companyName}</span>}
                          {r.companyName && <span aria-hidden style={{ color: MUTED, margin: '0 5px' }}>»</span>}
                          {r.needsName
                            ? <span style={{ fontSize: 11, fontWeight: 700, color: DANGER, background: '#fef2f2', borderRadius: R.tag, padding: '2px 7px' }}>입력 필요</span>
                            : <b style={{ fontWeight: 600 }}>{r.siteName}</b>}
                        </div>
                      </td>
                      <td style={{ ...td, color: SUB }}>{r.region || '-'}</td>
                      <td style={td}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                          <span style={{ width: 7, height: 7, borderRadius: '50%', background: STATUS_DOT[r.customer.status ?? ''] ?? MUTED }} />
                          {r.customer.status ?? '-'}
                        </span>
                      </td>
                      <td className="num" style={{ ...td, textAlign: 'right', color: r.deviceCount > 0 ? TEXT : MUTED }}>{r.deviceCount}</td>
                      <td className="num" style={{ ...td, textAlign: 'right', fontWeight: 700, color: r.openQuotes > 0 ? BLUE : MUTED }}>{r.openQuotes}</td>
                      <td style={{ ...td, color: SUB }}>
                        {r.touch ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <b style={{ fontWeight: 600, color: late ? DANGER : TEXT }}>{r.touch.date}</b>
                            <span style={{ fontSize: 12, color: SUB }}>
                              {`${r.days ?? 0}일 · ${r.touch.source}`}
                            </span>
                          </span>
                        ) : <span style={{ color: MUTED }}>-</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* 대리점 정보 수정 — 회사 수정 창을 **대리점 모드**로 쓴다(분류 대신 주소). */}
      {editOpen && (
        <CompanyEditModal
          kind="agency"
          initial={{
            name: agency.company_name,
            nameEn: agency.name_en ?? '',
            industry: '',
            note: agency.note ?? '',
            address: agency.address ?? '',
          }}
          siteCount={all.length}
          canRename
          isSaving={busy}
          onClose={() => setEditOpen(false)}
          onSave={form => void save(form)}
        />
      )}

      {/* 담당자 — 사업장 화면이 쓰는 그 모달 그대로 */}
      <ContactAddModal
        isOpen={contact.isAddContactModalOpen}
        isSaving={contact.isSavingContact}
        onClose={() => contact.setIsAddContactModalOpen(false)}
        onSave={contact.handleAddContact}
      />
      <ContactEditModal
        contact={contact.selectedContact}
        isSaving={contact.isSavingContactEdit}
        onClose={() => contact.setSelectedContact(null)}
        onSave={contact.handleUpdateContact}
        onDelete={canDeleteContact ? contact.openDeleteContact : undefined}
      />
      {contact.deleteContactOpen && contact.selectedContact && (
        <DeleteCustomerModal
          key={`contact-${contact.selectedContact.contact_id}`}
          target="contact"
          name={contact.selectedContact.name ?? ''}
          counts={null}
          busy={contact.isSavingContactEdit}
          onClose={() => contact.setDeleteContactOpen(false)}
          onDelete={(reason: string) => void contact.confirmDeleteContact(reason)}
        />
      )}

      {/* 견적 이력 — 이 대리점을 거친 견적 전부(끝난 건 포함). 제목에 두 수치가 적힌다. */}
      {quoteHistoryOpen && (
        <QuoteHistoryModal
          isOpen
          customer={null}
          quotes={quotes}
          family={{ name: agency.company_name, siteCount: all.length }}
          onOpenPdf={q => { if (onOpenQuote) onOpenQuote(q); else void openQuotePdf(q) }}
          onClose={() => setQuoteHistoryOpen(false)}
        />
      )}
    </>
  )
}
