'use client'

// 고객사 상세 **라우트** — 본문은 components/customer/CustomerDetailBody.tsx 가 그린다.
//
// 분할 보기(/?view=list)의 오른쪽 칸이 같은 컴포넌트를 쓴다. 이 파일에 남은 것은
// 라우트에만 있는 일 둘뿐이다 — 권한 문턱과 목록으로 돌아가는 길.
//
// 활동 「찾아가기」(?focus=)는 더 이상 이 화면이 받지 않는다. 활동은 회사 화면의
// 전체 타임라인에 모였고, 링크도 그쪽을 가리킨다(lib/activity.ts 의 activityHref).

import { useParams } from 'next/navigation'
import { usePageGuard } from '@/hooks/usePageGuard'
import AccessGate from '@/components/common/AccessGate'
// 목록으로 돌아갈 때 저장된 화면 상태를 지운다(사이드바의 고객사 항목과 같은 규칙).
import { HOME_STATE_KEY } from '@/lib/home'
import CustomerDetailBody from '@/components/customer/CustomerDetailBody'

export default function CustomerDetailPage() {
  const { loading: guardLoading, authorized } = usePageGuard()
  const params = useParams()
  const customerId = Number(params.id)

  if (!authorized) return <AccessGate loading={guardLoading} />

  return (
    <CustomerDetailBody
      customerId={customerId}
      onBack={() => { sessionStorage.removeItem(HOME_STATE_KEY); window.location.href = '/' }}
    />
  )
}
