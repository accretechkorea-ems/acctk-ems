// 사용 기록에 붙일 승인 정보 — 전자결재 문서 여러 건을 한 번에 읽어 내려 준다.
//
// 왜 라우트가 필요한가 — approval_documents 의 읽기 정책(ad_select)은 상신자·결재선 참여자·
// superadmin 에게만 열려 있다. 사용 기록 목록은 쇼룸을 보는 사람 누구나 보는 화면이라, 화면에서
// 직접 임베드하면 제3자에게는 승인 정보가 전부 null 로 온다. 그래서 service role 로 읽어 내려 준다 —
// 지금은 지운 옛 요청함 목록 라우트도 같은 이유로 service role 을 썼다.
//
// 내려 주는 것은 **표시에 필요한 최소값**이다(상태·사후 여부·마지막 처리자·처리 시각·대결 여부·
// 승인서 유무). 신청 내용(summary.payload)·의견·결재선 전체는 담지 않는다 — 그것을 볼 사람은
// 결재함에서 본다. 문서 종류는 showroom_usage 로 못 박아, 다른 유형 문서가 이 길로 새지 않게 한다.
//
// 읽기 전용이다. 권한은 쇼룸 메뉴 하나로 본다(기록 목록을 볼 수 있는 사람이면 그 승인 정보도 본다).

import { NextRequest, NextResponse } from 'next/server'
import { canViewMenu } from '@/lib/permissions'
import type { UsageApprovalDoc } from '@/lib/showroom'
import { admin, bad, loadCaller } from '../shared'

const TAG = 'showroom/requests/approvals'

const DOC_TYPE = 'showroom_usage'

/** 승인으로 보는 줄의 상태. 전결·대결도 승인이다(결재가 끝났다는 뜻이다). */
const APPROVED_STATES = ['승인', '전결', '대결']

/**
 * in() 에 넣는 id 묶음 크기. PostgREST 는 조건을 쿼리 문자열에 담으므로 한 번에 너무 많이 보내면
 * URL 길이에 걸린다. 한 달치 기록이라 보통 한 묶음에 끝난다.
 */
const CHUNK = 100

/**
 * 한 번에 받는 문서 id 수 상한. 부르는 쪽(showroomData 의 loadUsageApprovals)이 이보다 작은 묶음으로
 * 나눠 보내므로 평상시에는 걸리지 않는다 — 주소를 손으로 만들어 수천 건을 한 번에 긁는 것을 막는 선이다.
 */
const MAX_IDS = 300

type LineRow = {
  step: number | null
  kind: string
  state: string
  approver_id: number
  acted_by: number | null
  acted_at: string | null
}

type DocRow = {
  document_id: number
  status: string
  summary: { is_retroactive?: unknown; pdf_url?: unknown } | null
  approval_lines: LineRow[]
}

/**
 * 마지막으로 승인 처리한 줄. 처리 시각(acted_at) 이 늦은 쪽이고, 시각이 같으면 순번(step)이 큰 쪽이다
 * — 전결로 뒤가 생략된 경우에도 실제로 누른 마지막 줄이 잡힌다.
 */
function lastApproved(lines: LineRow[]): LineRow | null {
  const acted = (lines ?? []).filter(l => l.kind !== 'cc' && APPROVED_STATES.includes(l.state))
  if (acted.length === 0) return null
  return acted.reduce((a, b) => {
    const at = a.acted_at ?? ''
    const bt = b.acted_at ?? ''
    if (at !== bt) return at >= bt ? a : b
    return (a.step ?? 0) >= (b.step ?? 0) ? a : b
  })
}

export async function GET(req: NextRequest) {
  const auth = await loadCaller(TAG)
  if (auth.error) return auth.error
  if (!canViewMenu(auth.caller, 'showroom')) return bad('Forbidden', 403)

  // id 는 양의 정수만 받는다. 모양이 아닌 값은 조용히 버린다 — 한 건이 깨졌다고 목록 전체의 승인
  // 정보를 비우지 않는다(그 행만 doc 없이 그려지고, 화면은 상태를 꾸며 내지 않는다).
  const raw = req.nextUrl.searchParams.get('docs') ?? ''
  const parts = raw.split(',').map(s => s.trim()).filter(s => s !== '')
  if (parts.length > MAX_IDS) return bad(`한 번에 ${MAX_IDS}건까지 조회할 수 있습니다.`, 400)
  const ids = [...new Set(
    parts.map(s => (/^\d+$/.test(s) ? Number(s) : 0)).filter(n => Number.isSafeInteger(n) && n > 0),
  )]
  if (ids.length === 0) return NextResponse.json({ approvals: {} })

  const sb = admin()
  const approvals: Record<number, UsageApprovalDoc> = {}

  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK)
    const { data, error } = await sb
      .from('approval_documents')
      .select('document_id, status, summary, approval_lines(step, kind, state, approver_id, acted_by, acted_at)')
      .eq('doc_type', DOC_TYPE)
      .in('document_id', chunk)
    if (error) {
      console.error(`[${TAG}] lookup failed`, { count: chunk.length, error })
      return bad('승인 정보를 불러오지 못했습니다.', 500)
    }
    for (const d of (data ?? []) as DocRow[]) {
      const last = lastApproved(d.approval_lines ?? [])
      const pdf = d.summary?.pdf_url
      approvals[d.document_id] = {
        document_id: d.document_id,
        status: d.status,
        retroactive: d.summary?.is_retroactive === true,
        actedById: last?.acted_by ?? last?.approver_id ?? null,
        actedAt: last?.acted_at ?? null,
        // 대결 — 원래 결재자와 실제로 누른 사람이 다르다. 그 줄의 state 가 '대결' 인 것과 같은 뜻이지만,
        // 전결을 대리인이 처리하면 state 는 '전결' 이고 acted_by 만 달라지므로 id 를 비교한다.
        byDelegate: last != null && last.acted_by != null && last.acted_by !== last.approver_id,
        hasPdf: typeof pdf === 'string' && pdf.trim() !== '',
      }
    }
  }

  return NextResponse.json({ approvals })
}
