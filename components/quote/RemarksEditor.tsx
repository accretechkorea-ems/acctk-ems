'use client'

// 견적 작성 화면의 **비고 상자** — 기본 문구가 채워져 있고 접혀서 시작한다.
//
// app/quote/page.tsx → CustomerCard 를 거쳐 **그대로 옮겨 온 것**이다(분리 리팩터 3a).
// JSX·스타일·문구·주석을 한 글자도 바꾸지 않았다(들여쓰기 2칸만 덜어냈다).
//
// 접힌 줄에 보여줄 첫 줄(remarksPreview)과 「수정됨」 판정(remarksEdited)도 함께 가져왔다
// — 이 상자 밖에서는 쓰지 않는 값이다. 기본 문구 자체는 화면이 들고 있다(defaultRemarks).
//
// 내용은 접어도 **늘 마운트돼 있다** — grid 0fr↔1fr 로 높이만 닫으므로 접었다 펴도 값이 남는다.

/** 이 줄 수를 넘으면 「표가 줄어듭니다」를 알린다. PDF 하단 블록이 그때부터 표를 눌러 온다. */
const REMARKS_HINT_LINES = 6

export type RemarksEditorProps = {
  remarks: string
  setRemarks: (v: string) => void
  remarksOpen: boolean
  setRemarksOpen: React.Dispatch<React.SetStateAction<boolean>>
  /** 비고 기본 문구(page.tsx 의 DEFAULT_REMARKS). 「수정됨」 판정에 쓴다. */
  defaultRemarks: string
}

export default function RemarksEditor({
  remarks, setRemarks, remarksOpen, setRemarksOpen, defaultRemarks,
}: RemarksEditorProps) {
  // 비고 — 접힌 줄에 보여줄 첫 줄과, 기본 문구에서 손댔는지 여부.
  const remarksPreview = remarks.trim().split('\n')[0] ?? ''
  const remarksEdited = remarks.trim() !== defaultRemarks.trim()
  // 비고가 길면 PDF 하단 블록이 커져 그만큼 품목 표가 줄어든다(표와 같은 칸을 나눠 쓴다).
  // **막지는 않는다** — 꼭 길게 써야 하는 건이 있다. 그 사실만 알린다.
  const remarksLineCount = remarks.split('\n').length

  // 비고 — 기본 문구가 채워져 있고 고칠 일이 드물어 접어 둔다.
  // 접힌 줄에 첫 줄을 회색으로 보여주고, 기본 문구에서 손댔으면 「수정됨」을 붙인다.
  return (
  <div className="q-box q-box-col">
    {/* 머리줄 — [비고 │ 미리보기 … ›]. 펼치기 화살표는 상자 오른쪽 끝. */}
    <button type="button" className="q-box-head" onClick={() => setRemarksOpen(o => !o)}>
      <span className="q-box-label">비고</span>
      <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '8px 11px' }}>
        {remarksEdited && (
          <span style={{ fontSize: 11, fontWeight: 700, color: '#234ea2', flexShrink: 0 }}>수정됨</span>
        )}
        {!remarksOpen && (
          <span style={{ fontSize: 11, color: '#9ca3af', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {remarksPreview}
          </span>
        )}
      </span>
      <span className="q-box-tail">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="3"
          style={{ transition: 'transform 0.15s ease', transform: remarksOpen ? 'rotate(90deg)' : 'none' }}>
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </span>
    </button>
    {/* grid 1fr↔0fr 로 높이를 애니메이션한다. 내용은 늘 마운트돼 있어 접었다 펴도 값이 남는다. */}
    <div style={{ display: 'grid', gridTemplateRows: remarksOpen ? '1fr' : '0fr', transition: 'grid-template-rows 0.15s ease' }}>
      <div style={{ overflow: 'hidden', minHeight: 0 }}>
        <textarea className="q-box-area" value={remarks} onChange={e => setRemarks(e.target.value)} rows={3} />
        {/* 길이 안내 — 막지 않는다. PDF 하단 블록이 품목 표와 같은 칸을 나눠 쓰기 때문이다. */}
        {remarksLineCount > REMARKS_HINT_LINES && (
          <div style={{ padding: '0 11px 8px', fontSize: 11, color: '#9ca3af', lineHeight: 1.6 }}>
            비고가 {remarksLineCount}줄입니다. 비고가 길면 표가 줄어듭니다
          </div>
        )}
      </div>
    </div>
  </div>
  )
}
