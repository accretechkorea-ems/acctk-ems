// 의뢰서 라우트. 동작은 action 으로 나눈다(견적 삭제·결재 라우트와 같은 방식).
//   · create — 번호를 발급하고 의뢰서를 만든다.
//   · update — 제목·상태를 고친다.
//   · peek   — 종류별 「다음 사용 번호」를 읽기만 한다. 채번 함수를 부르지 않는다.
//   · register — 이미 바깥에 나간 번호를 뒤늦게 등록한다(소급).
//   · cancel — 취소한다. 마지막 번호면 반환(행 삭제 + 카운터 −1), 아니면 버림(cancelled 로 남김).
//              판정과 실행은 DB 함수 cancel_inquiry 가 한 덩어리로 한다
//              (inquiries_cancel_function.sql — 왜 함수인지 그 파일 머리말에 적혀 있다).
// 기존 번호 등록(소급)·파일 등록은 다음 단계다.
//
// 클라이언트를 둘로 나눠 쓴다. 섞으면 안 된다.
//   세션 클라이언트 — 로그인 확인과 engineers 조회. 권한 판정 자료를 여기서 읽는다.
//   service role   — 채번 함수 호출과 inquiries insert. inquiries 에는 읽기 정책만 있고
//                    claim_inquiry_seq 의 EXECUTE 도 service_role 에만 있다.
//
// created_by 는 본문 값을 쓰지 않고 세션에서 강제한다 — 누가 발급했는지가 책임 소재다.
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { canViewMenu, isSuperAdmin } from '@/lib/permissions'
import { withTeamPerm } from '@/lib/teamPermsServer'
import { todayKST } from '@/lib/date'
import {
  buildInquiryNo, inquiryTypeOf, periodKeyFor,
  EDITABLE_STATUSES, INQUIRY_TYPES, REQ20_SERIES, REQ80_SERIES, type InquiryType,
} from '@/lib/inquiries'

const TAG = 'inquiry'

/** 제목 길이 상한. 화면도 같은 값으로 입력을 자른다. */
const TITLE_MAX = 200

/** 의뢰서 첨부 버킷. 취소로 행이 사라지기 전에 파일을 먼저 지운다. */
const ATTACHMENT_BUCKET = 'inquiry-attachments'

/**
 * 번호가 겹쳤을 때 다시 발급해 보는 횟수.
 *
 * 채번 자체는 원자적이라 정상 흐름에서는 겹치지 않는다. 이 재시도는 소급 등록이 카운터를
 * 앞질러 둔 경우처럼 예외적인 상황을 위한 것이다.
 */
const MAX_TRIES = 5

type Caller = { engineer_id: number; permission_level: string | null; teams: string | null }

const admin = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status })

/** 로그인 + 의뢰서 메뉴 권한. 통과하면 caller 를 돌려준다. */
async function authorize(): Promise<{ error: NextResponse; caller: null } | { error: null; caller: Caller }> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return { error: bad('Unauthorized', 401), caller: null }

  const { data: row, error } = await supabase
    .from('engineers')
    .select('engineer_id, permission_level, teams')
    .eq('email', user.email)
    .single()
  if (error) console.error(`[${TAG}] caller lookup failed`, { email: user.email, error })
  const caller = await withTeamPerm((row ?? null) as Caller | null)
  if (!caller || !canViewMenu(caller, 'inquiries')) return { error: bad('Forbidden', 403), caller: null }
  return { error: null, caller }
}

/**
 * 장비 계열을 종류에 맞게 정리한다.
 *   80 의뢰서 — 81·83·84 중 하나 필수. 번호에 들어가는 값이라 틀리면 발급 자체를 막는다.
 *   20 의뢰서 — 화면이 뭘 보냈든 '20' 으로 강제한다(계열이 하나뿐이다).
 *   그 밖      — null 로 강제한다. 번호에 쓰이지 않는 값이 DB 에 남으면 나중에 근거로 오해된다.
 */
function resolveSeries(type: InquiryType, raw: unknown): { ok: true; series: string | null } | { ok: false; error: string } {
  if (type === 'req80') {
    const s = typeof raw === 'string' ? raw.trim() : ''
    if (!REQ80_SERIES.includes(s)) return { ok: false, error: '80 의뢰서는 장비 계열(81·83·84)을 골라주세요.' }
    return { ok: true, series: s }
  }
  if (type === 'req20') return { ok: true, series: REQ20_SERIES }
  return { ok: true, series: null }
}

/**
 * 감사 기록 한 줄. lib/approval/quoteDelete.ts 의 writeDeleteAudit 과 같은 모양이다
 * (actor_email·action·table_name·row_id 를 채우고 actor_uid 는 두지 않는다).
 *
 * inquiries 에는 감사 트리거를 붙이지 않았다(inquiries_schema.sql 참고) — service role 로 쓰면
 * 트리거가 auth.jwt() 에서 읽는 actor_email 이 어차피 비기 때문이다. 대신 여기서 직접 남긴다.
 *
 * row_id 에는 uuid 가 아니라 **번호**를 넣는다. 감사 기록을 뒤지는 사람이 아는 값이 번호이고,
 * 취소로 행이 사라진 뒤에는 uuid 로 되짚을 곳도 없다. uuid 는 new_data 에 함께 남긴다.
 *
 * best-effort 다 — 실패해도 처리는 이미 끝났으므로 되돌리지 않는다.
 */
async function writeInquiryAudit(
  sb: ReturnType<typeof admin>,
  opts: {
    action: 'INQUIRY_CREATE' | 'INQUIRY_REGISTER' | 'INQUIRY_UPDATE' | 'INQUIRY_CANCEL'
    inquiryNo: string
    actorId: number
    oldData?: Record<string, unknown> | null
    newData?: Record<string, unknown> | null
  },
) {
  const { data: actor, error: actorErr } = await sb
    .from('engineers').select('email, name').eq('engineer_id', opts.actorId).maybeSingle()
  if (actorErr) console.error(`[${TAG}] actor lookup failed`, { actorId: opts.actorId, error: actorErr })
  const who = (actor ?? null) as { email: string | null; name: string | null } | null

  const { error } = await sb.from('audit_log').insert({
    actor_email: who?.email ?? null,
    action: opts.action,
    table_name: 'inquiries',
    row_id: opts.inquiryNo,
    old_data: opts.oldData ?? null,
    new_data: { ...(opts.newData ?? {}), by: opts.actorId, by_name: who?.name ?? null },
  })
  if (error) console.error(`[${TAG}] audit insert failed`, { action: opts.action, inquiryNo: opts.inquiryNo, error })
}

export async function POST(req: NextRequest) {
  const auth = await authorize()
  if (auth.error) return auth.error
  const caller = auth.caller

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const sbAdmin = admin()
  const action = typeof body.action === 'string' ? body.action : 'create'
  if (action === 'peek') return peek(sbAdmin)
  if (action === 'register') return register(sbAdmin, caller, body)
  if (action === 'update') return update(sbAdmin, caller, body)
  if (action === 'cancel') return cancel(sbAdmin, caller, body)
  if (action !== 'create') return bad('Invalid action')

  const type = inquiryTypeOf(body.type)
  if (!type) return bad('의뢰서 종류를 골라주세요.')

  const series = resolveSeries(type, body.equipment_series)
  if (!series.ok) return bad(series.error)

  const title = (typeof body.title === 'string' ? body.title : '').trim().slice(0, TITLE_MAX)

  // 발행일·연도는 KST 로 고정한다. 서버(Vercel)는 UTC 라 new Date() 를 그대로 쓰면
  // 한국 시간 아침 9시 전에 하루가 밀린다(lib/date.ts 머리말 참고).
  const issuedDate = todayKST()
  const year = issuedDate.slice(0, 4)
  const periodKey = periodKeyFor(type, year)
  const sb = sbAdmin

  // 번호가 겹치면 다시 발급한다. 실패한 번호는 재사용하지 않는다 —
  // 이미 나간 것으로 봐야 안전하고, 구멍보다 중복이 훨씬 위험하다.
  let lastError = ''
  for (let i = 0; i < MAX_TRIES; i++) {
    const { data: seqData, error: seqErr } = await sb.rpc('claim_inquiry_seq', {
      p_type: type,
      p_period: periodKey,
    })
    if (seqErr) {
      console.error(`[${TAG}] claim_inquiry_seq failed`, { type, periodKey, error: seqErr })
      return bad('번호를 발급하지 못했습니다.', 500)
    }
    const seq = Number(seqData)
    if (!Number.isInteger(seq) || seq < 1) {
      console.error(`[${TAG}] claim_inquiry_seq 가 이상한 값을 돌려줬다`, { type, periodKey, seqData })
      return bad('번호를 발급하지 못했습니다.', 500)
    }

    let inquiryNo: string
    try {
      inquiryNo = buildInquiryNo(type, { seq, year, series: series.series, issuedDate })
    } catch (e) {
      // 조립이 실패하면 검증이 뚫린 것이다. 발급된 순번은 되돌리지 않고 멈춘다.
      console.error(`[${TAG}] 번호 조립 실패 — 발급된 순번은 버린다`, { type, seq, error: e })
      return bad(e instanceof Error ? e.message : '번호를 만들지 못했습니다.')
    }

    const { data: made, error: insErr } = await sb
      .from('inquiries')
      .insert({
        inquiry_type: type,
        inquiry_no: inquiryNo,
        period_key: periodKey,
        seq,
        equipment_series: series.series,
        title,
        status: 'drafting',
        // 본문 값을 쓰지 않는다 — 발급한 사람이 곧 작성자다.
        created_by: caller.engineer_id,
        issued_date: issuedDate,
        is_backfill: false,
      })
      .select('id, inquiry_no, inquiry_type, period_key, seq, equipment_series, title, status, issued_date, created_by')
      .single()

    if (!insErr && made) {
      const row = made as { id: string; inquiry_no: string; inquiry_type: string; period_key: string; seq: number }
      await writeInquiryAudit(sb, {
        action: 'INQUIRY_CREATE', inquiryNo: row.inquiry_no, actorId: caller.engineer_id,
        newData: { id: row.id, inquiry_type: row.inquiry_type, period_key: row.period_key, seq: row.seq },
      })
      console.log(`[${TAG}] 발급`, { inquiryNo: row.inquiry_no, by: caller.engineer_id })
      return NextResponse.json({ inquiry: made })
    }

    // 23505 = unique_violation. inquiry_no 가 겹친 것이므로 다음 번호로 다시 해 본다.
    // 이 번호는 버린다(구멍이 생기지만 재사용하지 않는 것이 원칙이다).
    if (insErr?.code === '23505') {
      console.error(`[${TAG}] 번호 중복 — 버리고 다시 발급한다`, { inquiryNo, try: i + 1 })
      lastError = '번호가 겹쳐 다시 발급했습니다.'
      continue
    }

    console.error(`[${TAG}] insert failed`, { type, inquiryNo, error: insErr })
    return bad('의뢰서를 만들지 못했습니다.', 500)
  }

  console.error(`[${TAG}] 번호 발급을 ${MAX_TRIES}회 시도했지만 계속 겹쳤다`, { type, periodKey })
  return bad(`${lastError} 잠시 뒤 다시 시도해주세요.`.trim(), 409)
}

/** uuid 모양인지만 본다. 값 자체의 존재는 DB 가 판단한다. */
const idOf = (v: unknown): string | null =>
  typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v : null

// ── 수정 — 제목·상태 ────────────────────────────────────────────────
// 취소된 건은 손대지 않는다. 조건부 UPDATE(.neq)로 막아, 화면이 낡은 상태를 들고 있어도
// 취소된 의뢰서가 되살아나지 않는다. 0행이면 그 사이에 취소됐거나 없는 건이다.
async function update(sb: ReturnType<typeof admin>, caller: Caller, body: Record<string, unknown>) {
  const id = idOf(body.id)
  if (!id) return bad('의뢰서를 지정해주세요.')

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  let touched = false

  if (body.title !== undefined) {
    if (typeof body.title !== 'string') return bad('제목이 올바르지 않습니다.')
    patch.title = body.title.trim().slice(0, TITLE_MAX)
    touched = true
  }
  if (body.status !== undefined) {
    const st = typeof body.status === 'string' ? body.status : ''
    // 'cancelled' 는 여기서 못 만든다 — 취소는 번호 반환 판정이 따르는 별도 동작이다.
    if (!(EDITABLE_STATUSES as readonly string[]).includes(st)) return bad('상태가 올바르지 않습니다.')
    patch.status = st
    touched = true
  }
  if (!touched) return bad('바꿀 내용이 없습니다.')

  const { data: done, error } = await sb
    .from('inquiries')
    .update(patch)
    .eq('id', id)
    .neq('status', 'cancelled')
    .select('inquiry_no, title, status')
  if (error) {
    console.error(`[${TAG}] update failed`, { id, error })
    return bad('수정하지 못했습니다.', 500)
  }
  if (!done || done.length === 0) return bad('이미 취소되었거나 없는 의뢰서입니다.', 409)

  const row = done[0] as { inquiry_no: string; title: string | null; status: string }
  await writeInquiryAudit(sb, {
    action: 'INQUIRY_UPDATE', inquiryNo: row.inquiry_no, actorId: caller.engineer_id,
    newData: { title: row.title, status: row.status },
  })
  return NextResponse.json({ inquiry: row })
}

// ── 취소 — 반환 또는 버림 ───────────────────────────────────────────
// 권한은 담당자 본인 또는 superadmin 이다(첨부 개별 삭제와 같은 기준 —
// app/api/service-attachment/route.ts:224). 남의 번호를 함부로 반환하지 못하게 한다.
//
// 스토리지 파일을 먼저 지운다. 반환이면 행이 사라지는데, 행이 없어지면 file_path 를 읽을 길이
// 없어 파일이 고아로 남는다. 버림으로 판정되더라도 취소한 건의 파일은 어차피 필요 없다.
async function cancel(sb: ReturnType<typeof admin>, caller: Caller, body: Record<string, unknown>) {
  const id = idOf(body.id)
  if (!id) return bad('의뢰서를 지정해주세요.')

  const { data: found, error: readErr } = await sb
    .from('inquiries')
    .select('id, inquiry_no, inquiry_type, period_key, seq, status, created_by, is_backfill, title, issued_date')
    .eq('id', id)
    .maybeSingle()
  if (readErr) {
    console.error(`[${TAG}] cancel lookup failed`, { id, error: readErr })
    return bad('의뢰서를 불러오지 못했습니다.', 500)
  }
  if (!found) return bad('의뢰서를 찾을 수 없습니다.', 404)
  const row = found as {
    id: string; inquiry_no: string; inquiry_type: string; period_key: string; seq: number
    status: string; created_by: number | null; is_backfill: boolean; title: string | null; issued_date: string
  }

  if (row.created_by !== caller.engineer_id && !isSuperAdmin(caller)) {
    return bad('담당자 본인 또는 관리자만 취소할 수 있습니다.', 403)
  }

  // 첨부 파일 정리 — 행이 하나도 없으면 스토리지를 건드리지 않는다.
  const { data: atts, error: attErr } = await sb
    .from('inquiry_attachments').select('file_path').eq('inquiry_id', id)
  if (attErr) {
    console.error(`[${TAG}] attachment lookup failed`, { id, error: attErr })
    return bad('첨부파일을 확인하지 못했습니다.', 500)
  }
  const paths = ((atts ?? []) as { file_path: string }[]).map(a => a.file_path).filter(Boolean)
  if (paths.length > 0) {
    const { error: rmErr } = await sb.storage.from(ATTACHMENT_BUCKET).remove(paths)
    // 파일을 못 지워도 취소는 진행한다 — 고아 파일이 남을 뿐이고, 취소를 막는 편이 더 나쁘다.
    if (rmErr) console.error(`[${TAG}] attachment remove failed`, { id, paths, error: rmErr })
  }

  const { data: result, error: rpcErr } = await sb.rpc('cancel_inquiry', { p_id: id })
  if (rpcErr) {
    console.error(`[${TAG}] cancel_inquiry failed`, { id, error: rpcErr })
    return bad('취소하지 못했습니다.', 500)
  }
  const outcome = String(result)

  if (outcome === 'not_found') return bad('의뢰서를 찾을 수 없습니다.', 404)

  if (outcome === 'released' || outcome === 'abandoned') {
    // 지워지기 전 행 내용을 old_data 에 남긴다 — 반환이면 이 기록이 유일한 흔적이다.
    await writeInquiryAudit(sb, {
      action: 'INQUIRY_CANCEL', inquiryNo: row.inquiry_no, actorId: caller.engineer_id,
      oldData: {
        id: row.id, inquiry_type: row.inquiry_type, period_key: row.period_key, seq: row.seq,
        status: row.status, title: row.title, issued_date: row.issued_date,
        created_by: row.created_by, is_backfill: row.is_backfill,
      },
      newData: { outcome, attachments_removed: paths.length },
    })
    console.log(`[${TAG}] 취소`, { inquiryNo: row.inquiry_no, outcome, by: caller.engineer_id })
  }

  return NextResponse.json({ outcome, inquiryNo: row.inquiry_no })
}

// ── 다음 사용 번호 조회 ─────────────────────────────────────────────
// 읽기만 한다. claim_inquiry_seq 를 절대 부르지 않는다 — 부르면 보기만 해도 번호가 소진된다.
//
// 「예약」이 아니라는 점이 중요하다. 여기서 본 번호는 다음 사람이 먼저 점유하면 달라진다.
// 화면도 그렇게 안내하고, 실제 번호는 발급 응답이 정본이다.
async function peek(sb: ReturnType<typeof admin>) {
  const year = todayKST().slice(0, 4)
  // 종류마다 기간 키가 다르다(본사수리만 'ALL'). 한 번에 읽고 코드에서 짝지어 준다.
  const wanted = INQUIRY_TYPES.map(type => ({ type, periodKey: periodKeyFor(type, year) }))

  const { data, error } = await sb
    .from('inquiry_sequence')
    .select('type_code, period_key, seq')
    .in('type_code', wanted.map(w => w.type))
  if (error) {
    console.error(`[${TAG}] peek failed`, { year, error })
    return bad('다음 번호를 확인하지 못했습니다.', 500)
  }

  const rows = (data ?? []) as { type_code: string; period_key: string; seq: number }[]
  const counters = wanted.map(w => {
    const hit = rows.find(r => r.type_code === w.type && r.period_key === w.periodKey)
    // 카운터 행이 아직 없는 (종류, 기간) — 첫 발급이 1번이다.
    const lastSeq = hit ? Number(hit.seq) : 0
    return { type: w.type, period_key: w.periodKey, last_seq: lastSeq, next_seq: lastSeq + 1 }
  })
  return NextResponse.json({ counters })
}

// ── 기존 번호 등록(소급) ────────────────────────────────────────────
// 종이로 이미 나간 번호를 뒤늦게 시스템에 넣는다. 번호는 사람이 정하고, 카운터는 따라간다.
//
// 번호 문자열은 클라이언트가 보낸 것을 쓰지 않는다 — 화면의 미리보기는 눈으로 확인하는 용도이고,
// 저장되는 값은 서버가 같은 함수로 다시 조립한다.
//
// is_backfill=true 로 남긴다. 이 표시 때문에 cancel_inquiry 가 이 건을 절대 「반환」하지 않는다
// (번호가 이미 바깥에 나가 있어 다시 내주면 같은 번호의 서류가 둘이 된다).
async function register(sb: ReturnType<typeof admin>, caller: Caller, body: Record<string, unknown>) {
  const type = inquiryTypeOf(body.type)
  if (!type) return bad('의뢰서 종류를 골라주세요.')

  const issuedDate = typeof body.issued_date === 'string' ? body.issued_date.trim() : ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(issuedDate)) return bad('발행일을 골라주세요.')

  const series = resolveSeries(type, body.equipment_series)
  if (!series.ok) return bad(series.error)

  const seq = Number(body.seq)
  if (!Number.isInteger(seq) || seq < 1 || seq > 99999) return bad('일련번호는 1 이상 99999 이하의 정수여야 합니다.')

  const status = typeof body.status === 'string' ? body.status : ''
  if (!(EDITABLE_STATUSES as readonly string[]).includes(status)) return bad('상태가 올바르지 않습니다.')

  const title = (typeof body.title === 'string' ? body.title : '').trim().slice(0, TITLE_MAX)

  // 담당자 — 본문 값을 받지만 실재하는 직원인지 서버가 확인한다.
  // create 와 다른 점이다: 지난 건은 지금 등록하는 사람이 아니라 그때 담당자가 따로 있다.
  const createdBy = Number(body.created_by)
  if (!Number.isInteger(createdBy) || createdBy < 1) return bad('담당자를 골라주세요.')
  const { data: who, error: whoErr } = await sb
    .from('engineers').select('engineer_id').eq('engineer_id', createdBy).maybeSingle()
  if (whoErr) {
    console.error(`[${TAG}] engineer lookup failed`, { createdBy, error: whoErr })
    return bad('담당자를 확인하지 못했습니다.', 500)
  }
  if (!who) return bad('담당자를 찾을 수 없습니다.')

  // 번호는 발행일의 연도를 쓴다 — 번호가 매년 1월 1일에 리셋되므로, 지난해 건을 올해 등록해도
  // 그때의 연도가 들어가야 한다. periodKey 도 같은 연도로 잡아 카운터가 갈리지 않게 한다.
  const year = issuedDate.slice(0, 4)
  const periodKey = periodKeyFor(type, year)

  let inquiryNo: string
  try {
    inquiryNo = buildInquiryNo(type, { seq, year, series: series.series, issuedDate })
  } catch (e) {
    return bad(e instanceof Error ? e.message : '번호를 만들지 못했습니다.')
  }

  // 지금 카운터를 읽는다. 잠그지 않는다 — 소급 등록은 사람이 번호를 보고 넣는 일이라
  // 밀리초 단위 경합을 막을 이유가 없고, 마지막에 부르는 bump 가 greatest 라 뒤집히지 않는다.
  const { data: counterRow, error: cErr } = await sb
    .from('inquiry_sequence').select('seq')
    .eq('type_code', type).eq('period_key', periodKey).maybeSingle()
  if (cErr) {
    console.error(`[${TAG}] counter lookup failed`, { type, periodKey, error: cErr })
    return bad('카운터를 확인하지 못했습니다.', 500)
  }
  const lastSeq = counterRow ? Number((counterRow as { seq: number }).seq) : 0

  // 건너뛰는 번호가 생기면 사람에게 먼저 알린다. 한 번 올린 카운터는 내릴 수 없기 때문이다.
  if (seq > lastSeq + 1 && body.confirm_bump !== true) {
    return NextResponse.json({
      needs_confirm: true,
      skipped_from: lastSeq + 1,
      skipped_to: seq - 1,
      next_after: seq + 1,
    })
  }

  const { data: made, error: insErr } = await sb
    .from('inquiries')
    .insert({
      inquiry_type: type,
      inquiry_no: inquiryNo,
      period_key: periodKey,
      seq,
      equipment_series: series.series,
      title,
      status,
      created_by: createdBy,
      issued_date: issuedDate,
      is_backfill: true,
    })
    .select('id, inquiry_no, inquiry_type, period_key, seq, equipment_series, title, status, issued_date, created_by')
    .single()

  if (insErr) {
    // 23505 = 이미 그 번호가 있다. 카운터는 건드리지 않는다 — 아무것도 저장되지 않았다.
    if (insErr.code === '23505') return bad('이미 등록된 번호입니다.', 409)
    console.error(`[${TAG}] register insert failed`, { type, inquiryNo, error: insErr })
    return bad('등록하지 못했습니다.', 500)
  }

  // 저장이 끝난 뒤에만 카운터를 올린다. 순서를 뒤집으면 저장이 실패했을 때 카운터만 올라가
  // 쓰이지도 않은 번호가 소진된다. bump 는 greatest 라 seq <= lastSeq 면 아무 일도 하지 않는다.
  const { error: bumpErr } = await sb.rpc('bump_inquiry_seq', {
    p_type: type, p_period: periodKey, p_seq: seq,
  })
  if (bumpErr) {
    // 카운터가 밀리지 않았을 뿐 등록은 끝났다. 다음 발급이 이 번호와 겹치면 23505 로 걸리고
    // create 의 재시도가 다음 번호로 넘어간다 — 그래서 여기서 되돌리지 않는다.
    console.error(`[${TAG}] bump_inquiry_seq failed — 카운터가 밀리지 않았다`, { type, periodKey, seq, error: bumpErr })
  }

  const row = made as { id: string; inquiry_no: string; inquiry_type: string; period_key: string; seq: number }
  await writeInquiryAudit(sb, {
    action: 'INQUIRY_REGISTER', inquiryNo: row.inquiry_no, actorId: caller.engineer_id,
    newData: {
      id: row.id, inquiry_type: row.inquiry_type, period_key: row.period_key, seq: row.seq,
      issued_date: issuedDate, status, created_by: createdBy, is_backfill: true,
      counter_before: lastSeq, counter_bumped: seq > lastSeq,
    },
  })
  console.log(`[${TAG}] 소급 등록`, { inquiryNo: row.inquiry_no, seq, lastSeq, by: caller.engineer_id })
  return NextResponse.json({ inquiry: made })
}
