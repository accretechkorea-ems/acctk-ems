'use client'

import { useRef, useState } from 'react'
import { INPUT_BORDER, TEXT_MUTED, TEXT_PRIMARY, TEXT_SECONDARY, WHITE_BUTTON_BG, WHITE_BUTTON_TEXT, modalOverlayStyle } from '../constants'
import { R } from '@/lib/radius'

type Props = {
  isOpen: boolean
  onClose: () => void
  onComplete: (engineerSignDataUrl: string, customerSignDataUrl: string) => void
}

export default function SignModal({ isOpen, onClose, onComplete }: Props) {
  const [signStep, setSignStep] = useState(1)
  const [engineerSigning, setEngineerSigning] = useState(false)
  const [customerSigning, setCustomerSigning] = useState(false)
  const engineerSignRef = useRef<HTMLCanvasElement>(null)
  const customerSignRef = useRef<HTMLCanvasElement>(null)

  if (!isOpen) return null

  const clearCanvas = () => {
    const ref = signStep === 1 ? engineerSignRef : customerSignRef
    ref.current?.getContext('2d')?.clearRect(0, 0, ref.current.width, ref.current.height)
  }

  const handleBack = () => {
    if (signStep === 2) {
      setSignStep(1)
    } else {
      setSignStep(1)
      onClose()
    }
  }

  const handleNext = async () => {
    if (signStep === 1) {
      setSignStep(2)
    } else {
      const engineerSignDataUrl = engineerSignRef.current!.toDataURL('image/png')
      const customerSignDataUrl = customerSignRef.current!.toDataURL('image/png')
      setSignStep(1)
      onComplete(engineerSignDataUrl, customerSignDataUrl)
    }
  }

  return (
    <div style={{ ...modalOverlayStyle, alignItems: 'flex-start', overflowY: 'auto' }}>
      <div style={{
        margin: 'auto', width: '100%', maxWidth: 260,
        background: '#ffffff', borderRadius: R.modal, padding: 16,
        boxShadow: '0 16px 48px rgba(0,0,0,0.22)', border: `1px solid ${INPUT_BORDER}`,
        animation: 'modal-in 0.18s ease',
      }}>
        {/* 스텝 인디케이터 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
          {[1, 2].map((step) => (
            <div key={step} style={{ display: 'flex', alignItems: 'center', flex: step === 1 ? 'none' : 1 }}>
              <div style={{
                width: 24, height: 24, borderRadius: '50%',
                background: step <= signStep ? WHITE_BUTTON_BG : '#e5e7eb',
                color: step <= signStep ? '#fff' : TEXT_MUTED,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 800, fontSize: 11, flexShrink: 0,
                transition: 'all 0.2s ease',
              }}>
                {step}
              </div>
              {step === 1 && (
                <div style={{
                  height: 2, flex: 1, margin: '0 6px',
                  background: signStep === 2 ? WHITE_BUTTON_BG : '#e5e7eb',
                  borderRadius: R.tag, transition: 'background 0.2s ease',
                }} />
              )}
            </div>
          ))}
        </div>

        {/* 타이틀 */}
        <div style={{ fontSize: 14, fontWeight: 800, color: TEXT_PRIMARY, marginBottom: 2 }}>
          {signStep === 1 ? '엔지니어 서명' : '고객 담당자 서명'}
        </div>
        <div style={{ fontSize: 11, color: TEXT_MUTED, marginBottom: 10 }}>
          {signStep === 1 ? '아래 칸에 서명해주세요' : '고객 담당자분께 서명을 받아주세요'}
        </div>

        {/* 서명 캔버스 — PDF 서명 칸과 동일 비율 (1:2 세로) */}
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          {[
            { ref: engineerSignRef, step: 1, signing: engineerSigning, setSigning: setEngineerSigning },
            { ref: customerSignRef, step: 2, signing: customerSigning, setSigning: setCustomerSigning },
          ].map(({ ref, step, signing, setSigning }) => (
            <canvas
              key={step}
              ref={ref}
              width={456}
              height={912}
              style={{
                width: 228, height: 456, borderRadius: R.tile, background: '#fafafa',
                border: `2px solid ${INPUT_BORDER}`, cursor: 'crosshair', touchAction: 'none',
                display: signStep === step ? 'block' : 'none',
              }}
              onPointerDown={(e) => {
                setSigning(true)
                const canvas = ref.current!
                const rect = canvas.getBoundingClientRect()
                const ctx = canvas.getContext('2d')!
                ctx.beginPath()
                ctx.moveTo((e.clientX - rect.left) * canvas.width / rect.width, (e.clientY - rect.top) * canvas.height / rect.height)
                canvas.setPointerCapture(e.pointerId)
              }}
              onPointerMove={(e) => {
                if (!signing) return
                const canvas = ref.current!
                const rect = canvas.getBoundingClientRect()
                const ctx = canvas.getContext('2d')!
                ctx.lineWidth = 8
                ctx.lineCap = 'round'
                ctx.lineJoin = 'round'
                ctx.strokeStyle = '#111'
                ctx.lineTo((e.clientX - rect.left) * canvas.width / rect.width, (e.clientY - rect.top) * canvas.height / rect.height)
                ctx.stroke()
              }}
              onPointerUp={() => setSigning(false)}
            />
          ))}
        </div>

        <button
          onClick={clearCanvas}
          style={{
            marginTop: 8, padding: '4px 11px',
            background: '#f4f5f7', border: `1px solid ${INPUT_BORDER}`,
            borderRadius: R.control, cursor: 'pointer', fontSize: 11, fontWeight: 600, color: TEXT_SECONDARY,
          }}
        >
          지우기
        </button>

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, gap: 8 }}>
          <button
            onClick={handleBack}
            style={{
              padding: '9px 16px', background: '#f4f5f7', border: `1px solid ${INPUT_BORDER}`,
              borderRadius: R.control, cursor: 'pointer', fontWeight: 700, fontSize: 13, color: TEXT_PRIMARY,
            }}
          >
            {signStep === 2 ? '← 이전' : '취소'}
          </button>
          <button
            onClick={handleNext}
            style={{
              padding: '9px 22px', background: WHITE_BUTTON_BG, color: WHITE_BUTTON_TEXT,
              border: 'none', borderRadius: R.control, cursor: 'pointer', fontWeight: 700, fontSize: 13,
            }}
          >
            {signStep === 1 ? '다음 →' : 'PDF 생성'}
          </button>
        </div>
      </div>
    </div>
  )
}
