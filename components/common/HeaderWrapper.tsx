//header wrapper 컴포넌트 - 공개 페이지(로그인·리드 등록)에서는 헤더를 숨기기 위해 사용
'use client'

import { usePathname } from 'next/navigation'
import Header from '@/components/home/Header'
import { isPublicPath } from '@/lib/publicPaths'

export default function HeaderWrapper() {
  const pathname = usePathname()

  if (isPublicPath(pathname)) return null

  return <Header />
}