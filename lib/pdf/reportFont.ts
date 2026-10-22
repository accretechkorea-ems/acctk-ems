'use client'

// 서비스 보고서 PDF 의 한글 글꼴 등록.
//
// 예전에는 고객사 상세 화면(app/customer/[id]/page.tsx)이 모듈 수준에서
// `Font.register(...)` 를 불렀다 — 그 한 줄 때문에 `@react-pdf/renderer`(약 1.4MB)가
// 화면 첫 번들에 들어왔다. 보고서를 한 번도 만들지 않는 사람도 내려받던 셈이다.
//
// 그래서 등록을 PDF 를 만드는 순간으로 옮겼다. 여러 번 불러도 한 번만 등록한다.

type FontModule = { register: (opts: { family: string; src: string }) => void }

export const REPORT_FONT_FAMILY = 'NotoSansCJK'

const SRC = 'https://fonts.gstatic.com/s/notosanskr/v36/PbyxFmXiEBPT4ITbgNA5Cgms3VYcOA-vvnIzzuoyeLTq8H4hfeE.ttf'

let registered = false

/** @react-pdf/renderer 를 불러온 뒤 그 Font 를 넘겨 부른다. */
export async function registerReportFont(Font: FontModule): Promise<void> {
  if (registered) return
  Font.register({ family: REPORT_FONT_FAMILY, src: SRC })
  registered = true
}
