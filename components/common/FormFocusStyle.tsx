'use client'

/**
 * 폼 안의 **포커스 강조** — 한 곳에서 정한다.
 *
 * 고객사 상세 화면은 자기 페이지에 이 규칙을 전역으로 깔아 두었는데(파란 테두리 +
 * 옅은 테두리광), 모달에서 여는 폼은 그 바깥이라 규칙이 닿지 않았다. 그래서 등록 폼만
 * 포커스가 보이지 않아 「지금 어느 칸에 있는지」를 알 수 없었다(2026-11-20 지적).
 *
 * 쓰는 법 — 폼을 감싼 요소에 className="acc-form" 을 주고, 그 안 어딘가에 이 조각을 한 번 둔다.
 *
 *   <div className="acc-form">
 *     <FormFocusStyle />
 *     …input·select·textarea…
 *   </div>
 *
 * 색·치수는 새로 만들지 않는다 — 액센트 #234ea2 와 상세 화면이 쓰던 그림자 값 그대로다.
 */
export default function FormFocusStyle() {
  return (
    <style jsx global>{`
      .acc-form input:focus,
      .acc-form select:focus,
      .acc-form textarea:focus {
        border-color: #234ea2 !important;
        box-shadow: 0 0 0 3px rgba(35, 78, 162, 0.1) !important;
        outline: none;
      }
      /* 입력칸 사이 간격이 좁아도 테두리광이 잘리지 않게 — 겹쳐 그린다. */
      .acc-form input:focus,
      .acc-form select:focus,
      .acc-form textarea:focus {
        position: relative;
        z-index: 1;
      }
    `}</style>
  )
}
