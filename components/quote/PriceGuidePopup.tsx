'use client'

// 견적 작성 화면 품목 카드의 **마진·정도검사 가격 안내 팝업**(! 버튼과 그 팝업).
//
// app/quote/page.tsx 에서 **그대로 옮겨 온 것**이다(분리 리팩터 3a). JSX·스타일·숫자·문구·
// 주석을 한 글자도 바꾸지 않았다(들여쓰기 14칸만 덜어냈다).
//
// 표의 값은 여기 **글자로 박혀 있다**(옮기기 전에도 그랬다). 바뀌면 이 파일을 고친다.
//
// 열림 상태와 바깥 클릭 판정용 ref 는 **화면이 들고 있다** — 품목 카드 아무 데나 누르면
// 닫히는 동작(page.tsx 의 카드 onClick)과 바깥 클릭 effect 가 같은 값을 봐야 하기 때문이다.

import { Z } from '@/lib/zIndex'

export type PriceGuidePopupProps = {
  open: boolean
  setOpen: React.Dispatch<React.SetStateAction<boolean>>
  /** 버튼과 팝업을 함께 감싸는 칸. 화면의 바깥 클릭 effect 가 이 ref 를 본다. */
  containerRef: React.RefObject<HTMLDivElement | null>
}

export default function PriceGuidePopup({ open, setOpen, containerRef }: PriceGuidePopupProps) {
  // 마진/정도검사 가이드 버튼 — 오른쪽 끝
  return (
<div ref={containerRef} style={{ marginLeft: 'auto', position: 'relative' }}>
  <button
    onClick={() => setOpen(p => !p)}
    title="마진 및 정도검사 가격 안내"
    style={{ width: 20, height: 20, borderRadius: '50%', background: open ? '#234ea2' : '#e8edf5', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 900, color: open ? '#fff' : '#234ea2', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, lineHeight: 1 }}
  >!</button>
  {/* 팝업 — 버튼 오른쪽, 세로 중앙 정렬 */}
  {open && (
    <div
      style={{ position: 'absolute', left: 'calc(100% + 8px)', top: '50%', transform: 'translateY(-50%)', zIndex: Z.inPage, background: '#fff', borderRadius: 8, border: '1px solid #ebebeb', boxShadow: '0 12px 36px rgba(0,0,0,0.16)', width: 340, padding: '16px 18px', maxHeight: '70vh', overflowY: 'auto' }}
    >
    {/* 닫기 */}
    <button onClick={() => setOpen(false)} style={{ position: 'absolute', top: 10, right: 10, width: 22, height: 22, borderRadius: '50%', border: 'none', background: '#f3f4f6', cursor: 'pointer', fontSize: 11, color: '#6b7280', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>

    {/* 섹션1: 견적서 마진 */}
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: '#fff', background: '#1e3a6e', borderRadius: 6, padding: '4px 10px', marginBottom: 8, display: 'inline-block' }}>견적서 제출 마진</div>
      {[
        { label: '대리점 및 기존 고객사 (스타일러스)', value: '40%' },
        { label: '신규고객사 (스타일러스)', value: '50%' },
        { label: '장비 업그레이드 / 일본가격문의', value: '60%' },
      ].map((item, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 6px', borderRadius: 6, background: i % 2 === 0 ? '#f3f4f6' : '#fff', marginBottom: 2 }}>
          <span style={{ fontSize: 11, color: '#111827' }}>{item.label}</span>
          <span style={{ fontSize: 12, fontWeight: 800, color: '#234ea2', flexShrink: 0, marginLeft: 8 }}>{item.value}</span>
        </div>
      ))}
    </div>

    <div style={{ height: 1, background: '#ebebeb', marginBottom: 14 }} />

    {/* 섹션2: 정도검사 */}
    <div>
      <div style={{ fontSize: 11, fontWeight: 800, color: '#fff', background: '#1e3a6e', borderRadius: 6, padding: '4px 10px', marginBottom: 8, display: 'inline-block' }}>측정기 정도 검사</div>
      {[
        { cat: '83', items: [{ label: '조도', price: '600,000' }, { label: '형상', price: '800,000' }, { label: '조도형상', price: '1,000,000' }] },
        { cat: '84', items: [{ label: '소형 43C', price: '800,000' }, { label: '중형 R-NEX200', price: '1,000,000' }, { label: 'R55/R60', price: '1,200,000' }, { label: 'R73A', price: '4,000,000' }] },
        { cat: '81', items: [{ label: 'CMM', price: '3,500,000' }] },
      ].map((group, gi) => (
        <div key={gi} style={{ display: 'flex', marginBottom: gi < 2 ? 6 : 0 }}>
          <div style={{ width: 28, flexShrink: 0, display: 'flex', alignItems: 'flex-start', paddingTop: 5 }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: '#fff', background: '#234ea2', borderRadius: 6, padding: '1px 5px' }}>{group.cat}</span>
          </div>
          <div style={{ flex: 1 }}>
            {group.items.map((item, ii) => (
              <div key={ii} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 6px', borderRadius: 6, background: ii % 2 === 0 ? '#f3f4f6' : '#fff', marginBottom: 2 }}>
                <span style={{ fontSize: 11, color: '#111827' }}>{item.label}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#111827' }}>₩{item.price}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  </div>
  )}
</div>
  )
}
