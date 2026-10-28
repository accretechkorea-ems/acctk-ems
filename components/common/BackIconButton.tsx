'use client'

// 카드 제목 앞에 붙는 **뒤로가기 화살표**.
//
// 의뢰서 상세(app/inquiries/[id])가 쓰던 모양을 그대로 뽑았다 — 고객사 상세도 같은 자리에
// 같은 화살표를 쓰게 되면서, 모양이 두 벌로 갈리지 않게 한곳에 둔다.
//
// 테두리를 두지 않는다: 이 카드에 대한 동작이 아니라 **화면을 떠나는 길**이고, 오른쪽
// 수정 아이콘(테두리 있음)과 역할이 달라 보여야 한다.
//
// marginLeft 음수는 버튼 안쪽 여백만큼 당겨 화살표를 카드 왼쪽 선에 맞춘다 —
// 이 버튼은 카드 머리줄의 **첫 칸**에 들어간다고 보고 만들었다.

const MUTED = '#6b7280'
const BLUE = '#234ea2'

export type BackIconButtonProps = {
  /** 눌렀을 때 — 보통 목록으로 돌아간다. */
  onClick: () => void
  /** 도움말·읽어 주는 글. 예: 「고객사 목록으로」 */
  label: string
}

export default function BackIconButton({ onClick, label }: BackIconButtonProps) {
  return (
    <button
      type="button" onClick={onClick}
      aria-label={label} title={label}
      onMouseEnter={e => { e.currentTarget.style.color = BLUE }}
      onMouseLeave={e => { e.currentTarget.style.color = MUTED }}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 6, marginLeft: -6, border: 'none', background: 'transparent',
        color: MUTED, cursor: 'pointer', flexShrink: 0,
        transition: 'color 0.15s ease',
      }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 12H5" />
        <path d="m12 19-7-7 7-7" />
      </svg>
    </button>
  )
}
