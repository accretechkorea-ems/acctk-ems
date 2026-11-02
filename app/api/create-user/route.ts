import { loadCaller } from '@/lib/apiCaller'
import { NextResponse } from 'next/server'
import { INITIALS_TAKEN_MESSAGE, isInitialsTaken, isInitialsUniqueViolation, normalizeInitials } from '@/lib/initials'

export async function POST(req: Request) {
  // 인증 확인
  // 인증·권한 — 관리자 전용(lib/apiCaller.ts 의 Need 가 그 판정을 한다).
  const { error: authErr, sb } = await loadCaller({ kind: 'superadmin' }, { tag: 'create-user', method: 'POST' })
  if (authErr) return authErr

  const body = await req.json()
  const { email, password, name, position, teams, initials, office, in_sales_stats } = body

  // 필수 입력값 검증
  if (!email?.trim() || !password?.trim() || !name?.trim()) {
    return NextResponse.json({ error: 'email, password, name은 필수입니다.' }, { status: 400 })
  }
  if (password.length < 8) {
    return NextResponse.json({ error: '비밀번호는 8자 이상이어야 합니다.' }, { status: 400 })
  }

  // 이니셜 중복은 Auth 계정을 만들기 전에 본다.
  // engineers 저장은 Auth 계정 생성 뒤라, 여기서 걸러내지 않으면 DB 인덱스가 튕겨낼 때
  // 로그인 계정만 덩그러니 남는다. 최종 판정은 아래 upsert 의 23505 처리가 한다.
  const wantInitials = normalizeInitials(initials)
  if (wantInitials) {
    const { data: peers, error: peerErr } = await sb
      .from('engineers')
      .select('engineer_id, initials, resigned_date')
      .eq('initials', wantInitials)
    if (peerErr) console.error('[create-user] 이니셜 조회 실패', peerErr)
    if (isInitialsTaken(peers, wantInitials)) {
      return NextResponse.json({ error: INITIALS_TAKEN_MESSAGE }, { status: 400 })
    }
  }

  // 1. Auth 계정 생성
  const { data: authData, error: authError } = await sb.auth.admin.createUser({
    email: email.trim(),
    password,
    email_confirm: true,
    user_metadata: { name: name.trim() },
  })

  if (authError) return NextResponse.json({ error: authError.message }, { status: 400 })

  // 실적 집계 개인 설정 — true/false 만 받고, 그 외(미지정)는 null 로 둔다(= 팀 설정을 따른다).
  const scope = typeof in_sales_stats === 'boolean' ? in_sales_stats : null

  // 이미 engineers 테이블에 있으면 update, 없으면 insert
  const { error: dbError } = await sb.from('engineers').upsert({
    name: name.trim(),
    position: position?.trim() || null,
    teams: teams?.trim() || null,
    initials: initials?.trim().toUpperCase() || null,
    email: email.trim(),
    office: office?.trim() || null,
    in_sales_stats: scope,
  }, { onConflict: 'email' })

  if (dbError) {
    // 위 사전 검사와 이 저장 사이에 다른 요청이 같은 이니셜을 채갈 수 있다. 인덱스가 최종 방어선이다.
    if (isInitialsUniqueViolation(dbError)) {
      return NextResponse.json({ error: INITIALS_TAKEN_MESSAGE }, { status: 400 })
    }
    return NextResponse.json({ error: dbError.message }, { status: 400 })
  }

  return NextResponse.json({ success: true })
}
