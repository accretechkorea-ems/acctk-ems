// 결재함 「완료」 탭 — 내가 처리한 문서(최근 50건).
//
// 별도 라우트로 둔 이유: 대결(위임받아 대신 처리한 건)은 approval_lines.approver_id 가
// 위임자이고 acted_by 만 나다. RLS 는 approver_id 본인 기준이라 화면에서 직접 읽으면
// 대결한 건이 빠진다. 그래서 service role 로 acted_by 까지 함께 본다.
//
// 읽기 전용이다. 상태를 바꾸지 않으므로 캐시도 조건부 UPDATE 도 없다.

import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { nextPendingLine } from '@/lib/approval/engine'
import type { ApprovalDocument, ApprovalLine } from '@/lib/approval/types'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status })

/** 한 번에 보여주는 최대 건수. 더 필요하면 뒤 단계에서 기간 필터를 붙인다. */
const LIMIT = 50

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return bad('Unauthorized', 401)
  const { data: row } = await supabase
    .from('engineers')
    .select('engineer_id, resigned_date')
    .eq('email', user.email)
    .single()
  const me = row as { engineer_id: number; resigned_date: string | null } | null
  if (!me || me.resigned_date) return bad('Forbidden', 403)

  // 내가 처리한 줄 — 내 차례였던 것과 대결한 것 둘 다.
  const { data: acted, error: lineErr } = await supabaseAdmin
    .from('approval_lines')
    .select('document_id, acted_at')
    .or(`approver_id.eq.${me.engineer_id},acted_by.eq.${me.engineer_id}`)
    .neq('state', '대기')
    .order('acted_at', { ascending: false })
    .limit(LIMIT)
  if (lineErr) {
    console.error('[approval/done] line lookup failed', lineErr)
    return bad('처리한 문서를 불러오지 못했습니다.', 500)
  }

  const ids = [...new Set(((acted ?? []) as { document_id: number }[]).map(l => l.document_id))]
  if (ids.length === 0) return NextResponse.json({ box: 'done', documents: [] })

  const { data, error } = await supabaseAdmin
    .from('approval_documents')
    .select('*, approval_lines(*)')
    .in('document_id', ids)
    .order('updated_at', { ascending: false })
  if (error) {
    console.error('[approval/done] document lookup failed', error)
    return bad('처리한 문서를 불러오지 못했습니다.', 500)
  }

  const documents = ((data ?? []) as (ApprovalDocument & { approval_lines: ApprovalLine[] })[]).map(d => {
    const lines = [...(d.approval_lines ?? [])].sort(
      (a, b) => (a.step ?? 99) - (b.step ?? 99) || a.line_id - b.line_id,
    )
    const next = nextPendingLine(lines)
    const ordered = lines.filter(l => l.kind !== 'cc')
    return {
      ...d,
      approval_lines: lines,
      progress: {
        total: ordered.length,
        done: ordered.filter(l => l.state !== '대기').length,
        currentStep: next?.step ?? null,
        currentApproverId: next?.approver_id ?? null,
      },
    }
  })
  return NextResponse.json({ box: 'done', documents })
}
