'use client'

// 고객사 상세 **라우트** — 본문은 components/customer/CustomerDetailBody.tsx 가 그린다.
//
// 분할 보기(/?view=list)의 오른쪽 칸이 같은 컴포넌트를 쓴다. 이 파일에 남은 것은
// 라우트에만 있는 일 셋뿐이다 — 권한 문턱, 목록으로 돌아가는 길, 그리고 주소로 받은
// 담당자(?contact=)를 본문에 넘기는 일이다.
//
// 활동 「찾아가기」(?focus=)는 더 이상 이 화면이 받지 않는다. 활동은 회사 화면의
// 전체 타임라인에 모였고, 링크도 그쪽을 가리킨다(lib/activity.ts 의 activityHref).

import { Suspense } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { usePageGuard } from '@/hooks/usePageGuard'
import AccessGate from '@/components/common/AccessGate'
// 목록으로 돌아갈 때 저장된 화면 상태를 지운다(사이드바의 고객사 항목과 같은 규칙).
import { HOME_STATE_KEY } from '@/lib/home'
import CustomerDetailBody from '@/components/customer/CustomerDetailBody'

function CustomerDetailInner() {
  const { loading: guardLoading, authorized } = usePageGuard()
  const params = useParams()
  const search = useSearchParams()
  const customerId = Number(params.id)
  /**
   * ?contact=<id> — 열자마자 **그 담당자 수정 창**을 연다(2026-11-25).
   * 견적 저장 창의 「수신인에 이메일이 없습니다 — 담당자 정보에서 추가」가 보낸 길이다.
   */
  const openContactId = Number(search.get('contact')) || null

  if (!authorized) return <AccessGate loading={guardLoading} />

  return (
    <CustomerDetailBody
      customerId={customerId}
      openContactId={openContactId}
      onBack={() => { sessionStorage.removeItem(HOME_STATE_KEY); window.location.href = '/' }}
    />
  )
}

// useSearchParams 는 **Suspense 경계 안에서만** 쓸 수 있다 — 없으면 빌드가 멈춘다.
export default function CustomerDetailPage() {
  return (
    <Suspense fallback={null}>
      <CustomerDetailInner />
    </Suspense>
  )
}
