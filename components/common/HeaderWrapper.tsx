//header wrapper 컴포넌트 - 공개 페이지(로그인·리드 등록)에서는 헤더를 숨기기 위해 사용
'use client'

import { usePathname } from 'next/navigation'
import Header from '@/components/home/Header'
import NoticePopup from '@/components/common/NoticePopup'
import { isPublicPath } from '@/lib/publicPaths'

export default function HeaderWrapper() {
  const pathname = usePathname()

  if (isPublicPath(pathname)) return null

  // 공지 팝업도 여기에 둔다 — 로그인 영역에서만 렌더되고, 레이아웃에 붙어 있어
  // 화면을 옮겨 다녀도 다시 마운트되지 않는다(팝업이 매번 뜨지 않게 하는 조건).
  return (
    <>
      <Header />
      <NoticePopup />
    </>
  )
}