'use client'

// 미리보기 — **적용하기 전에 무엇이 바뀌는지** 한 화면에 보여 준다.
//
// 보여 주는 것: 어느 시트의 몇째 행을 머리글로 읽었는지, 어느 열을 무엇으로 읽었는지,
// 파일 맨 위의 Valid date 문구, 읽은 줄과 등록 대상, DB 와 비교한 건수,
// 가격이 바뀌는 품목 스물, 그리고 오류와 경고.
//
// 오류와 경고를 **섞지 않는다.** 오류는 적용을 막고, 경고는 알리기만 한다.

import { BORDER, DANGER, FAINT, MUTED, NEUTRAL_BG, SUB, TEXT } from '@/components/common/ui'
import type { ParseResult } from '@/lib/priceListParse'
import type { PreviewChange, PreviewCounts } from './priceListImport'

export type PriceListPreviewProps = {
  parse: ParseResult
  sheetNote: string
  counts: PreviewCounts | null
  changes: PreviewChange[]
  bytes: number
}

const num = (n: number) => n.toLocaleString('ko-KR')
const yen = (n: number | null) => (n == null ? '-' : `¥${num(n)}`)

const label: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: MUTED }
const value: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: TEXT }
const box: React.CSSProperties = { border: `1px solid ${BORDER}`, borderRadius: 8, padding: '10px 12px' }

export default function PriceListPreview({ parse, sheetNote, counts, changes, bytes }: PriceListPreviewProps) {
  const variantMark = (v: string) =>
    v === 'jig_in' ? ' (Jig 포함)' : v === 'jig_out' ? ' (Jig 제외)' : ''

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* ── 어떻게 읽었나 ── */}
      <div style={box}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 10 }}>
          <div>
            <div style={label}>시트</div>
            <div style={value}>{parse.sheetName}</div>
          </div>
          <div>
            <div style={label}>머리글 행</div>
            <div style={value}>{parse.headerRow}행</div>
          </div>
          <div>
            <div style={label}>보낼 내용</div>
            <div style={value}>{num(Math.round(bytes / 1024))}KB</div>
          </div>
        </div>
        {sheetNote && <div style={{ fontSize: 12, color: SUB, marginBottom: 8 }}>{sheetNote}</div>}

        <div style={{ ...label, marginBottom: 4 }}>어느 열을 무엇으로 읽었나</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {parse.columns.map(c => (
            <span key={c.name} style={{ fontSize: 11, fontWeight: 600, color: SUB, background: NEUTRAL_BG, borderRadius: 99, padding: '2px 8px' }}>
              {c.name} · {c.index + 1}번째 열
            </span>
          ))}
        </div>

        <div style={{ ...label, marginTop: 10 }}>파일 맨 위 문구 (참고 · 기능 없음)</div>
        <div style={{ fontSize: 12, color: parse.validText ? SUB : FAINT, lineHeight: 1.6 }}>
          {parse.validText
            ?? (parse.topDate
              ? `Valid date 문구가 없습니다 · 파일 맨 위 날짜 ${parse.topDate} (등록 이력에는 남지 않습니다)`
              : '없음')}
        </div>
      </div>

      {/* ── 파일에서 읽은 숫자 ── */}
      <div style={{ ...box, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 10 }}>
        <div><div style={label}>품목 줄</div><div style={value}>{num(parse.counts.itemRows)}</div></div>
        <div><div style={label}>등록 대상</div><div style={{ ...value, color: '#234ea2' }}>{num(parse.counts.registered)}</div></div>
        <div><div style={label}>구입가 없어 제외</div><div style={value}>{num(parse.counts.noCost)}</div></div>
        <div><div style={label}>품목 아닌 줄</div><div style={value}>{num(parse.counts.nonItem)}</div></div>
        <div><div style={label}>묶음 제목</div><div style={value}>{num(parse.counts.sections)}</div></div>
        {parse.counts.headerRepeats > 0 && (
          <div><div style={label}>머리글 반복</div><div style={value}>{num(parse.counts.headerRepeats)}</div></div>
        )}
        {parse.counts.deliveryConverted > 0 && (
          <div><div style={label}>납기 환산</div><div style={value}>{num(parse.counts.deliveryConverted)}건</div></div>
        )}
        {parse.counts.variantTagged > 0 && (
          <div><div style={label}>구분 붙임</div><div style={value}>{num(parse.counts.variantTagged)}줄</div></div>
        )}
      </div>

      {/* ── DB 와 비교 ── */}
      <div style={{ ...box, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 10 }}>
        {!counts && <div style={{ fontSize: 12, color: MUTED }}>현재 가격표와 비교하는 중입니다…</div>}
        {counts && (
          <>
            <div><div style={label}>신규</div><div style={value}>{num(counts.isNew)}</div></div>
            <div><div style={label}>가격 변경</div><div style={{ ...value, color: DANGER }}>{num(counts.priceChanged)}</div></div>
            <div><div style={label}>그 밖 내용 변경</div><div style={value}>{num(counts.otherChanged)}</div></div>
            <div><div style={label}>동일</div><div style={value}>{num(counts.same)}</div></div>
            <div><div style={label}>파일에 없어 그대로</div><div style={value}>{num(counts.kept)}</div></div>
          </>
        )}
      </div>

      {/* ── 가격이 바뀌는 품목 ── */}
      {changes.length > 0 && (
        <div style={box}>
          <div style={{ ...label, marginBottom: 6 }}>
            가격이 바뀌는 품목 {counts ? `(${num(counts.priceChanged)}건 중 앞에서 ${changes.length}건)` : ''}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 1.4fr) 1fr 1fr', gap: 4, fontSize: 12 }}>
            <div style={{ ...label }}>품번</div>
            <div style={{ ...label, textAlign: 'right' }}>구입가</div>
            <div style={{ ...label, textAlign: 'right' }}>정가</div>
            {changes.map(c => (
              <div key={`${c.item_code}-${c.variant}`} style={{ display: 'contents' }}>
                <div style={{ color: TEXT, fontWeight: 600 }}>
                  {c.item_code}
                  <span style={{ color: MUTED, fontWeight: 500 }}>{variantMark(c.variant)}</span>
                </div>
                <div style={{ textAlign: 'right', color: c.old_cost !== c.new_cost ? DANGER : SUB }}>
                  {yen(c.old_cost)} → {yen(c.new_cost)}
                </div>
                <div style={{ textAlign: 'right', color: SUB }}>
                  {yen(c.old_price)} → {yen(c.new_price)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── 구입가 없어 빠지는 품번 ── */}
      {parse.skippedNoCost.length > 0 && (
        <div style={box}>
          <div style={{ ...label, marginBottom: 6 }}>
            구입가가 없어 등록에서 빠지는 품번 {parse.skippedNoCost.length}건
            {parse.skippedNoCost.length > 30 ? ' (앞에서 30건)' : ''}
          </div>
          <div style={{ fontSize: 12, color: SUB, lineHeight: 1.7 }}>
            {parse.skippedNoCost.slice(0, 30).map(s => s.item_code).join(', ')}
            {parse.skippedNoCost.length > 30 ? ' …' : ''}
          </div>
        </div>
      )}

      {/* ── 오류 ── 적용을 막는다 */}
      {parse.errors.length > 0 && (
        <div style={{ ...box, borderColor: DANGER }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: DANGER, marginBottom: 4 }}>오류 — 이대로는 등록할 수 없습니다</div>
          {parse.errors.map((e, i) => (
            <div key={i} style={{ fontSize: 12, color: DANGER, lineHeight: 1.7 }}>· {e}</div>
          ))}
        </div>
      )}

      {/* ── 경고 ── 막지 않는다 */}
      {parse.warnings.length > 0 && (
        <div style={box}>
          <div style={{ fontSize: 12, fontWeight: 700, color: SUB, marginBottom: 4 }}>참고</div>
          {parse.warnings.map((w, i) => (
            <div key={i} style={{ fontSize: 12, color: SUB, lineHeight: 1.7 }}>· {w}</div>
          ))}
        </div>
      )}
    </div>
  )
}
