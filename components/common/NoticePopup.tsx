'use client'

// 로그인 후 첫 화면에서 게시 중인 공지를 팝업으로 보여준다.
//
// 세션당 한 번만 뜬다.
//   · 화면 이동(클라이언트 라우팅)에는 모듈 플래그가 막는다 — 레이아웃에 붙어 있어 다시 마운트되지 않는다.
//   · 새로고침·주소 직접 입력처럼 문서가 새로 뜨는 경우는 모듈 플래그가 사라지므로 sessionStorage 로 막는다.
//     탭을 닫으면 지워지니 "다음 접속" 에는 다시 뜬다(닫기(X)만 눌렀을 때의 요구 동작).
// 「보지 않기」는 localStorage 에 남긴다(누가 봤는지 볼 일이 없어 DB 에 쓰지 않는다).

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Z } from '@/lib/zIndex'
import { dismissNotice, isDismissed, noticePhase, todayKST, type DismissKind, type Notice } from '@/lib/notices'

/** 이 탭에서 이미 띄웠는지. 화면 이동에는 이 플래그가, 새로고침에는 sessionStorage 가 막는다. */
let shown = false
const SESSION_KEY = 'notice:shownThisSession'

function alreadyShownThisSession(): boolean {
  if (shown) return true
  try { return sessionStorage.getItem(SESSION_KEY) === '1' } catch { return false }
}

function markShownThisSession(): void {
  shown = true
  try { sessionStorage.setItem(SESSION_KEY, '1') } catch { /* 못 써도 모듈 플래그로 화면 이동은 막힌다 */ }
}

export default function NoticePopup() {
  const [list, setList] = useState<Notice[]>([])
  const [index, setIndex] = useState(0)

  useEffect(() => {
    if (alreadyShownThisSession()) return
    markShownThisSession()
    let cancelled = false
    const run = async () => {
      const supabase = createClient()
      // 로그인한 사람에게만 띄운다. 세션이 없으면 조용히 지나간다(공개 화면에서는 애초에 렌더되지 않는다).
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || cancelled) return

      const today = todayKST()
      // 기간 판정은 DB 에서 한 번 거르고(오늘이 시작~종료 사이), 화면에서 다시 확인한다.
      const { data, error } = await supabase
        .from('notices')
        .select('notice_id, title, body, image_urls, starts_at, ends_at, created_at')
        .lte('starts_at', today)
        .gte('ends_at', today)
        .order('notice_id', { ascending: false })
      if (error) { console.error('[notice] 공지 조회 실패', error); return }
      if (cancelled) return

      const rows = ((data ?? []) as Notice[])
        .filter(n => noticePhase(n, today) === 'active')
        .filter(n => !isDismissed(n.notice_id))
      setList(rows)
    }
    run()
    return () => { cancelled = true }
  }, [])

  if (list.length === 0) return null
  const notice = list[index]
  if (!notice) return null

  const close = () => {
    // 닫기만 하면 다음 접속에 다시 뜬다(요구 사항). 여기서는 화면에서만 치운다.
    if (index < list.length - 1) setIndex(i => i + 1)
    else setList([])
  }

  const dismiss = (kind: DismissKind) => {
    dismissNotice(notice.notice_id, kind)
    close()
  }

  const images = (notice.image_urls ?? []).filter(Boolean)

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: Z.modal,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div
        style={{
          background: '#ffffff', borderRadius: 14, width: '100%', maxWidth: 460,
          maxHeight: '86vh', display: 'flex', flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0,0,0,0.22)',
        }}
      >
        {/* 머리 — 제목과 (여러 건일 때) 순번 */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '16px 18px 12px', borderBottom: '1px solid #ebebeb' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {list.length > 1 && (
              <div style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', marginBottom: 4 }}>
                {index + 1} / {list.length}
              </div>
            )}
            <div style={{ fontSize: 16, fontWeight: 800, color: '#111827', lineHeight: 1.4, wordBreak: 'break-word' }}>
              {notice.title}
            </div>
          </div>
          <button
            onClick={close}
            aria-label="닫기"
            style={{ width: 30, height: 30, flexShrink: 0, borderRadius: '50%', background: '#f3f4f6', border: 'none', cursor: 'pointer', fontSize: 15, color: '#6b7280', lineHeight: 1 }}
          >✕</button>
        </div>

        {/* 본체 — 이미지는 세로로 쌓고 폭에 맞춰 줄인다. 본문은 줄바꿈을 그대로 살린다. */}
        <div style={{ overflowY: 'auto', padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {images.map((url, i) => (
            // 공지 이미지는 크기를 알 수 없어 next/image 대신 img 를 쓴다(외부 스토리지 URL).
            // eslint-disable-next-line @next/next/no-img-element
            <img key={url} src={url} alt={`공지 이미지 ${i + 1}`}
              style={{ width: '100%', height: 'auto', display: 'block', borderRadius: 8, border: '1px solid #ebebeb' }} />
          ))}
          {notice.body?.trim() && (
            <div style={{ fontSize: 13, color: '#111827', lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {notice.body}
            </div>
          )}
        </div>

        {/* 발 — 보지 않기 선택지와 넘기기 */}
        <div style={{ borderTop: '1px solid #ebebeb', padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {([
            { kind: 'day' as const, label: '하루 보지 않기' },
            { kind: 'week' as const, label: '1주일 보지 않기' },
            { kind: 'forever' as const, label: '다시 보지 않기' },
          ]).map(o => (
            <button key={o.kind} onClick={() => dismiss(o.kind)}
              style={{ padding: '7px 10px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 700, color: '#6b7280', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
              {o.label}
            </button>
          ))}
          <button onClick={close}
            style={{ marginLeft: 'auto', padding: '8px 16px', background: '#234ea2', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 700, fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
            {index < list.length - 1 ? '다음' : '확인'}
          </button>
        </div>
      </div>
    </div>
  )
}
