'use client'

/**
 * **새 비밀번호를 정하는 화면** — 관리자가 초기화해 준 뒤 한 번 지난다 (2026-11-26).
 *
 * ── 왜 따로 있나 ───────────────────────────────────────────────────────────
 *   내 정보(/account)의 비밀번호 바꾸기는 **지금 비밀번호**를 함께 묻는다. 여기는 그것을
 *   묻지 않는다 — 방금 받은 임시값으로 **이미 들어와 있는 사람**이고, 임시값을 한 번 더
 *   적으라고 하는 것은 아무것도 지키지 못한다. 대신 여기서 벗어날 수 없다:
 *   미들웨어가 표식(must_change_password)이 켜진 사람을 어느 화면에서든 이리로 보낸다.
 *
 * ── 규칙은 그대로다 ────────────────────────────────────────────────────────
 *   길이 기준은 lib/accountRules.ts 한 곳이다(PASSWORD_MIN). 내 정보 화면과 같은 값·같은 문구다.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { PASSWORD_MIN, PASSWORD_SHORT_MESSAGE, isPasswordLongEnough } from '@/lib/accountRules'
import { invalidateMe } from '@/lib/appData/me'
import { R } from '@/lib/radius'
import { BLUE, BORDER, CARD_BG, DANGER, PAGE_BG, SUB, TEXT } from '@/components/common/ui'


const inputStyle = {
  width: '100%', padding: '10px 12px', boxSizing: 'border-box' as const,
  border: `1px solid ${BORDER}`, borderRadius: R.control, fontSize: 14,
  color: TEXT, background: CARD_BG, outline: 'none', fontFamily: 'inherit',
}

export default function ChangePasswordPage() {
  const router = useRouter()
  const supabase = createClient()
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const save = async () => {
    setError(null)
    if (!isPasswordLongEnough(next)) { setError(PASSWORD_SHORT_MESSAGE); return }
    if (next !== again) { setError('새 비밀번호가 일치하지 않습니다.'); return }
    setSaving(true)

    const { error: upErr } = await supabase.auth.updateUser({ password: next })
    if (upErr) {
      setSaving(false)
      setError(upErr.message || '비밀번호를 바꾸지 못했습니다.')
      return
    }

    // 표식을 끈다 — 이제 떠밀 일이 없다.
    // 칸이 아직 없으면(42703) 조용히 지나간다. 그때는 미들웨어도 떠밀지 않으므로 짝이 맞는다.
    const { data: session } = await supabase.auth.getUser()
    const email = session.user?.email
    if (email) {
      const { error: flagErr } = await supabase
        .from('engineers')
        .update({ must_change_password: false })
        .eq('email', email)
      if (flagErr && !['42703', 'PGRST204', 'PGRST205'].includes(flagErr.code ?? '')) {
        console.error('[change-password] 표식을 끄지 못했다', flagErr)
      }
    }
    invalidateMe()
    setSaving(false)
    setDone(true)
    // 표식이 꺼진 뒤라야 미들웨어가 통과시킨다 — 그 다음에 옮긴다.
    router.replace('/dashboard')
  }

  return (
    <main style={{ padding: 24, background: PAGE_BG, minHeight: '100dvh' }}>
      <div style={{
        maxWidth: 420, margin: '40px auto', background: CARD_BG,
        border: `1px solid ${BORDER}`, borderRadius: R.card, padding: '20px 22px',
      }}>
        <h1 style={{ fontSize: 18, fontWeight: 800, color: TEXT, margin: '0 0 6px' }}>새 비밀번호를 정해 주세요</h1>
        <p style={{ fontSize: 13, color: SUB, lineHeight: 1.7, margin: '0 0 18px' }}>
          관리자가 비밀번호를 초기화했습니다. 임시 비밀번호는 한 번 쓰는 값이라
          지금 바꿔야 다른 화면으로 갈 수 있습니다.
        </p>

        <div style={{ display: 'grid', gap: 12 }}>
          <div>
            <label htmlFor="pw-new" style={{ display: 'block', fontSize: 13, color: SUB, marginBottom: 6 }}>새 비밀번호</label>
            <input id="pw-new" type="password" value={next} autoComplete="new-password"
              onChange={e => setNext(e.target.value)}
              placeholder={`${PASSWORD_MIN}자 이상`} style={inputStyle} />
          </div>
          <div>
            <label htmlFor="pw-again" style={{ display: 'block', fontSize: 13, color: SUB, marginBottom: 6 }}>새 비밀번호 확인</label>
            <input id="pw-again" type="password" value={again} autoComplete="new-password"
              onChange={e => setAgain(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void save() }}
              placeholder="한 번 더" style={inputStyle} />
          </div>

          {error && <div style={{ fontSize: 12, color: DANGER, lineHeight: 1.6 }}>{error}</div>}
          {done && <div style={{ fontSize: 12, color: BLUE, lineHeight: 1.6 }}>바꿨습니다. 이동 중…</div>}

          <button type="button" onClick={() => void save()} disabled={saving || done}
            style={{
              padding: '11px 0', background: BLUE, color: '#fff', border: 'none',
              borderRadius: R.control, fontWeight: 700, fontSize: 14, cursor: 'pointer',
              fontFamily: 'inherit', opacity: saving || done ? 0.6 : 1,
            }}>
            {saving ? '바꾸는 중…' : '비밀번호 바꾸기'}
          </button>
        </div>
      </div>
    </main>
  )
}
