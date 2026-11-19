'use client'

// 고객사 상세 **라우트** — 본문은 components/customer/CustomerDetailBody.tsx 가 그린다.
//
// 분할 보기(/?view=list)의 오른쪽 칸이 같은 컴포넌트를 쓴다. 이 파일에 남은 것은
// 라우트에만 있는 일 셋뿐이다 — 권한 문턱, 주소에서 읽는 값(id·tab·focus),
// 그리고 목록으로 돌아가는 길.

import { Suspense } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { usePageGuard } from '@/hooks/usePageGuard'
import AccessGate from '@/components/common/AccessGate'
import { HISTORY_TAB_PARAM } from '@/lib/activity'
// 목록으로 돌아갈 때 저장된 화면 상태를 지운다(사이드바의 고객사 항목과 같은 규칙).
import { HOME_STATE_KEY } from '@/lib/home'
import CustomerDetailBody from '@/components/customer/CustomerDetailBody'

function CustomerDetailPageInner() {
  const { loading: guardLoading, authorized } = usePageGuard()
  const params = useParams()
  const router = useRouter()
  const search = useSearchParams()
  const customerId = Number(params.id)
  // 활동 요약에서 넘어온 주소 — ?tab=history&focus=s-123
  const focusKey = search.get('tab') === HISTORY_TAB_PARAM ? search.get('focus') : search.get('focus')

  if (!authorized) return <AccessGate loading={guardLoading} />

  return (
    <CustomerDetailBody
      customerId={customerId}
      focusKey={focusKey}
      // 찾아가기가 끝나면 주소를 원래대로 — 새로고침·뒤로가기에 강조가 다시 뜨지 않게 한다.
      onFocused={() => router.replace(`/customer/${customerId}`, { scroll: false })}
      onBack={() => { sessionStorage.removeItem(HOME_STATE_KEY); window.location.href = '/' }}
    />
  )
}

// useSearchParams 는 Suspense 경계가 필요하다(재고·유지보수·결재 화면과 같은 패턴).
export default function CustomerDetailPage() {
  return (
    <Suspense fallback={null}>
      <CustomerDetailPageInner />
    </Suspense>
  )
}
