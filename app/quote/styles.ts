// 견적서 화면 공용 인라인 스타일. page.tsx 컴포넌트 본문에 있던 값을 그대로 옮긴 것.
import type React from 'react'

export const inp: React.CSSProperties = {
  padding: '8px 11px', border: '1px solid #ebebeb', borderRadius: 6,
  fontSize: 12, outline: 'none', background: '#fff', boxSizing: 'border-box',
  color: '#111827', transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
}
