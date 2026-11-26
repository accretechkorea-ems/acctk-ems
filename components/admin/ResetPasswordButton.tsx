'use client'

/**
 * 비밀번호 **초기화** 단추 — 직원 관리 표의 한 줄에 선다 (2026-11-26).
 *
 * 흐름은 셋이다.
 *   ① 확인창 — 「{이름}의 비밀번호를 초기화합니다. 임시 비밀번호는 한 번만 표시됩니다.」
 *   ② 서버가 임시값을 만들어 **한 번** 돌려준다(app/api/admin/reset-password).
 *   ③ 그 값을 큰 글씨로 보여 주고 「복사」를 둔다. **닫으면 다시 못 본다** —
 *     어디에도 저장하지 않으므로 우리도 꺼내 줄 수 없다. 그 사실을 창에 적어 둔다.
 */

import { useState, type CSSProperties } from 'react'
import ModalOverlay from '@/components/common/ModalOverlay'
import ModalCard from '@/components/common/ModalCard'
import { useConfirm } from '@/components/common/ConfirmDialog'
import { useToast } from '@/components/common/Toast'
import { R } from '@/lib/radius'
import { BLUE, BORDER, CARD_BG, MUTED, NEUTRAL_BG, TEXT } from '@/components/common/ui'
import { TEXT_LABEL } from '@/lib/textTokens'

type Props = {
  engineerId: number
  name: string
  /** 표의 다른 단추와 같은 생김새를 받는다(화면이 정한다). */
  style?: CSSProperties
}

/** 보여 줄 값 한 벌. 창을 닫으면 버린다. */
type Shown = { password: string; name: string; forced: boolean }

export default function ResetPasswordButton({ engineerId, name, style }: Props) {
  const confirm = useConfirm()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [shown, setShown] = useState<Shown | null>(null)
  const [copied, setCopied] = useState(false)

  const run = async () => {
    const ok = await confirm({
      title: '비밀번호 초기화',
      message: `${name}의 비밀번호를 초기화합니다. 임시 비밀번호는 한 번만 표시됩니다.`,
      confirmText: '초기화',
      cancelText: '취소',
      variant: 'danger',
    })
    if (!ok) return
    setBusy(true)
    try {
      const r = await fetch('/api/admin/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ engineer_id: engineerId }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j?.tempPassword) {
        toast.error(j?.error || '비밀번호를 초기화하지 못했습니다')
        return
      }
      setCopied(false)
      setShown({ password: j.tempPassword, name: j.name ?? name, forced: j.forced !== false })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '비밀번호를 초기화하지 못했습니다')
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    if (!shown) return
    try {
      await navigator.clipboard.writeText(shown.password)
      setCopied(true)
    } catch {
      // 비공개 모드·권한 거부 — 글자는 화면에 그대로 있으니 손으로 옮겨 적으면 된다.
      toast.error('복사하지 못했습니다. 화면의 값을 그대로 옮겨 적어주세요')
    }
  }

  return (
    <>
      <button type="button" onClick={() => void run()} disabled={busy} style={style}>
        {busy ? '초기화 중…' : '비밀번호 초기화'}
      </button>

      {shown && (
        // 닫는 길이 하나다 — 「닫기」. 바깥 클릭·Esc 로도 닫히지만, 어느 쪽이든 값은 사라진다.
        <ModalOverlay onClose={() => setShown(null)}>
          <ModalCard
            width={420}
            title={`${shown.name} — 임시 비밀번호`}
            footer={
              <button type="button" onClick={() => setShown(null)}
                style={{ flex: 1, padding: 10, background: BLUE, color: '#fff', border: 'none', borderRadius: R.control, fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
                닫기
              </button>
            }
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* 값 — 크고, 고르기 쉽고, 숫자·영문이 한 칸씩 선다. */}
              <div style={{
                padding: '14px 16px', background: NEUTRAL_BG, border: `1px solid ${BORDER}`,
                borderRadius: R.control, textAlign: 'center',
              }}>
                <code className="num" style={{
                  fontSize: 24, fontWeight: 800, color: TEXT, letterSpacing: '0.08em',
                  userSelect: 'all', wordBreak: 'break-all',
                }}>
                  {shown.password}
                </code>
              </div>

              <button type="button" onClick={() => void copy()}
                style={{
                  padding: '9px 0', background: copied ? NEUTRAL_BG : CARD_BG, color: copied ? MUTED : BLUE,
                  border: `1px solid ${BORDER}`, borderRadius: R.control, fontWeight: 700, fontSize: 13,
                  cursor: 'pointer', fontFamily: 'inherit',
                }}>
                {copied ? '복사했습니다' : '복사'}
              </button>

              <div style={{ fontSize: 12, color: TEXT_LABEL, lineHeight: 1.7 }}>
                이 값은 <b>지금 한 번만</b> 보입니다. 창을 닫으면 다시 볼 수 없습니다
                (어디에도 저장하지 않습니다).
                {shown.forced
                  ? ' 본인이 로그인하면 바로 새 비밀번호를 정하는 화면으로 갑니다.'
                  : ' ⚠ 강제 변경 표식은 켜지 못했습니다 — db/must_change_password_20261126.sql 을 적용하면 켜집니다. 지금은 본인에게 직접 바꾸라고 알려 주세요.'}
              </div>
            </div>
          </ModalCard>
        </ModalOverlay>
      )}
    </>
  )
}
