'use client'

// 견적 작성 화면의 **확정 확인 모달** — 예상 번호·안내·금액 요약 세 칸·막힌 이유·[취소][확인].
//
// app/quote/page.tsx 에서 **그대로 옮겨 온 것**이다(분리 리팩터 3a). JSX·스타일·문구·주석을
// 한 글자도 바꾸지 않았다(들여쓰기 8칸만 덜어냈다). 여는 조건({showConfirmModal && …})은
// 화면에 남아 있으므로, 이 컴포넌트는 **열려 있을 때만** 마운트된다(종전과 같다).
//
// 확인 버튼은 결재선을 거치지 않고 바로 확정한다(useQuoteSubmit 의 runConfirm 설명).
// 작성자 정보가 PDF 에 들어가므로 engineer 가 없으면 그 자리에서 멈춘다.

import { numKR } from '@/app/quote/format'
import { Z } from '@/lib/zIndex'
import type { useToast } from '@/components/common/Toast'

export type ConfirmQuoteModalProps = {
  quoteNo: string
  totalSupply: number
  totalCost: number
  totalProfit: number
  totalProfitRate: number
  errors: { company?: string; eu?: string; items?: string; expenses?: string }
  isSubmitting: boolean
  engineer: { engineer_id: number } | null
  toast: ReturnType<typeof useToast>
  setShowConfirmModal: (v: boolean) => void
  runConfirm: () => Promise<void>
}

export default function ConfirmQuoteModal({
  quoteNo, totalSupply, totalCost, totalProfit, totalProfitRate,
  errors, isSubmitting, engineer, toast, setShowConfirmModal, runConfirm,
}: ConfirmQuoteModalProps) {
  // 견적 확정 확인 모달
  return (
<div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: Z.modal, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
  <div style={{ background: '#fff', borderRadius: 8, padding: 32, width: '100%', maxWidth: 440, boxShadow: '0 24px 64px rgba(0,0,0,0.22)', animation: 'modal-in 0.18s ease' }}>
    <div style={{ fontSize: 20, fontWeight: 800, color: '#111827', marginBottom: 4, letterSpacing: '-0.3px' }}>견적 확정</div>
    <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 20, fontWeight: 500 }}>{quoteNo} <span style={{ color: '#9ca3af' }}>(예상 번호 — 확정할 때 발급)</span></div>
    <div style={{ background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 8, padding: '12px 14px', marginBottom: 20 }}>
      <div style={{ fontSize: 12, color: '#92400e', lineHeight: 1.8 }}>
        확정하면 <b>견적번호가 발급되고 실적으로 기록됩니다.</b>
        <br />견적서 PDF 가 바로 만들어져 내려받아집니다.
      </div>
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 24 }}>
      <div style={{ background: '#eff4ff', borderRadius: 8, padding: '12px 14px', border: '1px solid #c7d7f8', textAlign: 'center' }}>
        <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 4, fontWeight: 500 }}>공급가</div>
        <div style={{ fontSize: 14, fontWeight: 800, color: '#234ea2' }}>₩{numKR(totalSupply)}</div>
      </div>
      <div style={{ background: '#f3f4f6', borderRadius: 8, padding: '12px 14px', border: '1px solid #ebebeb', textAlign: 'center' }}>
        <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 4, fontWeight: 500 }}>원가</div>
        <div style={{ fontSize: 14, fontWeight: 800, color: '#111827' }}>₩{numKR(totalCost)}</div>
      </div>
      <div style={{ background: totalProfitRate >= 40 ? '#f0fdf4' : '#fef2f2', borderRadius: 8, padding: '12px 14px', border: `1px solid ${totalProfitRate >= 40 ? '#bbf7d0' : '#fecaca'}`, textAlign: 'center' }}>
        <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 4, fontWeight: 500 }}>순이익</div>
        <div style={{ fontSize: 13, fontWeight: 800, color: totalProfitRate >= 40 ? '#16a34a' : '#dc2626' }}>
          ₩{numKR(totalProfit)}<br />
          <span style={{ fontSize: 11 }}>({totalProfitRate.toFixed(1)}%)</span>
        </div>
      </div>
    </div>
    {/* 저장이 막혔을 때 창을 닫지 않고 이유를 여기 모아 보여준다(칸 옆 빨간 글씨는 그대로 있다) */}
    {(() => {
      const messages = [errors.company, errors.eu, errors.items, errors.expenses].filter(Boolean)
      if (messages.length === 0) return null
      return (
        <div style={{ marginBottom: 10, padding: '10px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6 }}>
          {messages.map((m, i) => (
            <div key={i} style={{ fontSize: 12, color: '#dc2626', lineHeight: 1.6 }}>{m}</div>
          ))}
        </div>
      )
    })()}
    <div style={{ display: 'flex', gap: 10 }}>
      <button onClick={() => setShowConfirmModal(false)}
        disabled={isSubmitting}
        style={{ flex: 1, padding: '12px', background: '#f3f4f6', border: 'none', borderRadius: 6, fontWeight: 700, fontSize: 14, cursor: isSubmitting ? 'not-allowed' : 'pointer', color: '#111827', opacity: isSubmitting ? 0.6 : 1 }}>
        취소
      </button>
      {/* 여기서 바로 확정한다 — 결재선을 받는 단계는 없앴다(runConfirm 설명). */}
      <button onClick={() => {
        if (isSubmitting) return
        // 작성자 정보(담당자 줄·대필 판정)가 PDF 에 들어가므로 먼저 있어야 한다.
        if (!engineer) { toast.error('엔지니어 정보를 불러오는 중입니다'); return }
        void runConfirm()
      }}
        disabled={isSubmitting}
        style={{ flex: 1, padding: '12px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 6, fontWeight: 700, fontSize: 14, cursor: isSubmitting ? 'not-allowed' : 'pointer', opacity: isSubmitting ? 0.6 : 1 }}>
        {isSubmitting ? '저장 중...' : '확인'}
      </button>
    </div>
  </div>
</div>
  )
}
