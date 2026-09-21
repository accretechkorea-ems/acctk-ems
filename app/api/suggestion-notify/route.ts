// 건의사항 알림 — 신규 등록(created) · 답변/상태 변경(replied).
//
// 건의 저장 자체는 화면에서 직접 한다(그대로 둔다). 알림만 이리로 온다 —
// 남의 engineer_id 로 notifications 를 넣는 일은 service role 에서만 해야 하기 때문이다
// (출고 요청 /api/inventory-request 와 같은 이유).
//
// 제목·작성자·답변·상태는 본문에서 받지 않고 저장된 건의를 다시 읽어서 쓴다. 본문을 믿으면
// 아무 문구나 담은 알림을 남에게 보낼 수 있다. 다만 「직전 값」(답변 유무·이전 상태)은
// 저장이 끝난 뒤엔 DB 에 없으므로 화면이 보내 주되, DB 의 현재 값과 앞뒤가 맞는지 본다.
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { isSuperAdmin } from '@/lib/permissions'
import { withTeamPerm } from '@/lib/teamPermsServer'

/**
 * 건의사항을 받아 보는 관리자(권재원). 지금은 1인 관리자 체계라 하드코딩한다.
 * 관리자 체계가 바뀌면 이 상수를 superadmin 전원 조회로 바꾼다.
 */
const SUGGESTION_ADMIN_ENGINEER_ID = 4

/** 알림 제목·본문에 넣는 건의 제목의 최대 길이. 넘치면 잘라 붙인다. */
const TITLE_MAX = 40

/** suggestions.status 에 들어갈 수 있는 값. 화면이 보낸 이전 상태를 이 목록으로 검증한다. */
const KNOWN_STATUSES = ['접수', '검토중', '완료', '보류']

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status })
const skip = (reason: string) => NextResponse.json({ sent: false, reason })

type Caller = { engineer_id: number; name: string | null; position: string | null; permission_level: string | null; teams: string | null }
type Row = { suggestion_id: number; title: string; engineer_id: number; admin_reply: string | null; status: string }

const cut = (s: string) => (s.length > TITLE_MAX ? `${s.slice(0, TITLE_MAX)}…` : s)

export async function POST(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: callerRow, error: callerErr } = await supabase
    .from('engineers')
    .select('engineer_id, name, position, permission_level, teams')
    .eq('email', user.email)
    .single()
  if (callerErr) console.error('[suggestion-notify] caller lookup failed', { email: user.email, error: callerErr })
  const caller = await withTeamPerm(callerRow as Caller | null)
  if (!caller) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const action = typeof body.action === 'string' ? body.action : 'created'
  const suggestionId = Number(body.suggestionId)
  if (!Number.isInteger(suggestionId) || suggestionId < 1) return bad('건의사항을 지정해주세요.')

  const { data: row, error: sErr } = await supabaseAdmin
    .from('suggestions')
    .select('suggestion_id, title, engineer_id, admin_reply, status')
    .eq('suggestion_id', suggestionId)
    .maybeSingle()
  if (sErr) {
    console.error('[suggestion-notify] suggestion lookup failed', { suggestionId, error: sErr })
    return bad('건의사항을 확인하지 못했습니다.', 500)
  }
  if (!row) return bad('건의사항을 찾을 수 없습니다.', 404)
  const suggestion = row as Row

  return action === 'replied'
    ? notifyReplied(suggestion, caller, body)
    : notifyCreated(suggestion, caller)
}

/** 신규 등록 — 작성자 본인이 부른다. 관리자에게 보낸다. */
async function notifyCreated(suggestion: Row, caller: Caller) {
  // 자기가 올린 건의에만 알림을 걸 수 있다 — 남의 건 번호로 알림을 만들지 못하게 한다.
  if (suggestion.engineer_id !== caller.engineer_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  // 관리자 본인이 올린 건의면 보내지 않는다.
  if (suggestion.engineer_id === SUGGESTION_ADMIN_ENGINEER_ID) return skip('self')

  const writer = `${caller.name ?? ''} ${caller.position ?? ''}`.trim() || '알 수 없음'
  return insertNotification(SUGGESTION_ADMIN_ENGINEER_ID, {
    title: `새 건의사항: ${cut(suggestion.title)}`,
    message: `${writer}님이 건의사항을 등록했습니다`,
    type: 'suggestion_created',
  }, suggestion.suggestion_id)
}

/**
 * 답변·상태 변경 — 관리자가 부른다. 작성자에게 보낸다.
 * 보내는 경우는 셋뿐이다: 첫 답변 / 완료로 바뀜 / 보류로 바뀜.
 * 답변 문구만 고치거나 검토중으로 바꾼 것은 알리지 않는다.
 */
async function notifyReplied(suggestion: Row, caller: Caller, body: Record<string, unknown>) {
  if (!isSuperAdmin(caller)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // 답변을 단 사람이 곧 작성자면(관리자 본인의 건의) 보내지 않는다.
  if (suggestion.engineer_id === caller.engineer_id) return skip('self')

  const prevHadReply = body.prevHadReply === true
  const prevStatus = typeof body.prevStatus === 'string' ? body.prevStatus : ''
  const nowHasReply = !!suggestion.admin_reply?.trim()

  // 화면이 보낸 직전 값이 DB 의 현재 값과 앞뒤가 맞지 않으면 보내지 않는다.
  //   · 이전에 답변이 있었다는데 지금은 없다 → 저장된 내용과 어긋난다
  //   · 모르는 상태값을 보냈다 → 믿을 수 없다
  if (!KNOWN_STATUSES.includes(prevStatus)) return skip('bad-prev-status')
  if (prevHadReply && !nowHasReply) return skip('inconsistent')

  const firstReply = !prevHadReply && nowHasReply
  const toDone = prevStatus !== '완료' && suggestion.status === '완료'
  const toHold = prevStatus !== '보류' && suggestion.status === '보류'

  // 첫 답변과 상태 변경이 함께 일어나면 상태 쪽 문구로 하나만 보낸다.
  const title = toDone ? '건의사항이 완료 처리되었습니다'
    : toHold ? '건의사항이 보류되었습니다'
      : firstReply ? '건의사항에 답변이 등록되었습니다'
        : null
  if (!title) return skip('no-change')

  return insertNotification(suggestion.engineer_id, {
    title,
    message: cut(suggestion.title),
    type: 'suggestion_replied',
  }, suggestion.suggestion_id)
}

async function insertNotification(
  engineerId: number,
  fields: { title: string; message: string; type: string },
  suggestionId: number,
) {
  const { error } = await supabaseAdmin.from('notifications').insert({
    engineer_id: engineerId,
    title: fields.title,
    message: fields.message,
    type: fields.type,
    link: '/suggestions',
    is_read: false,
    created_at: new Date().toISOString(),
  })
  if (error) {
    console.error('[suggestion-notify] 알림 생성 실패', { suggestionId, type: fields.type, error })
    return bad('알림을 보내지 못했습니다.', 500)
  }
  console.log('[suggestion-notify] 알림 발송', { suggestionId, type: fields.type, to: engineerId })
  return NextResponse.json({ sent: true })
}
