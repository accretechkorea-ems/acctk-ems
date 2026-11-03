'use client'

// 화면 워터마크 — 원가·이익이 보이는 영역에 **보는 사람 이름**을 깔아 둔다.
//
// 캡처해서 밖으로 내보내면 누구 화면인지 남는다는 것이 목적이고, **읽는 데 방해가 되면
// 목적이 뒤집힌다**(사람이 숫자를 읽으려고 눈을 찌푸리게 된다). 그래서 2026-11-03 에
// 셋을 함께 바꿨다 — 더 연하게(0.05 → 0.03), 더 크게(42 → 56), 더 드물게(140 → 220px).
// 글자가 크고 드물수록 한 글자가 숫자 위에 겹칠 확률이 낮아진다.
//
// 예전에는 app/quote/page.tsx 안에 같은 모양이 **두 벌** 적혀 있었다(수익 분석·품목).
// 한쪽만 고치면 두 영역의 농도가 달라지므로 값을 여기 한 곳에 둔다.
//
// PDF 의 워터마크는 여기와 무관하다(app/quote/QuotePDFDoc.tsx) — 인쇄물이라 규칙이 다르다.

import { Z } from '@/lib/zIndex'

/** 농도 — 숫자를 가리지 않는 선. */
const WM_OPACITY = 0.03
/** 글자 크기. 크면 획이 굵어지는 대신 겹치는 횟수가 준다. */
const WM_SIZE = 56
/** 줄 간격(px). */
const WM_STEP = 220
/** 자간 — 넓히면 같은 글자가 더 성기게 퍼진다. */
const WM_TRACKING = '0.35em'

export type WatermarkProps = {
  /** 보는 사람 이름. 비어 있으면 아무것도 그리지 않는다. */
  name: string
  /** 몇 줄을 깔까 — 그 영역 높이 ÷ 220 보다 넉넉히. */
  rows?: number
  /** 감싼 상자의 모서리(그 상자와 같은 값을 준다). */
  radius?: number
}

export default function Watermark({ name, rows = 8, radius = 8 }: WatermarkProps) {
  if (!name) return null
  return (
    // 자체 overflow:hidden 상자로 분리한다 — 바깥 상자에 걸면 팝업·드롭다운이 잘린다.
    <div aria-hidden style={{
      position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none',
      zIndex: Z.decor, borderRadius: radius,
    }}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} style={{
          position: 'absolute', top: `${i * WM_STEP - 40}px`, left: 0, right: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transform: 'rotate(-20deg)', opacity: WM_OPACITY,
        }}>
          <span style={{ fontSize: WM_SIZE, fontWeight: 900, color: '#000', whiteSpace: 'nowrap', letterSpacing: WM_TRACKING }}>
            {name}
          </span>
        </div>
      ))}
    </div>
  )
}
