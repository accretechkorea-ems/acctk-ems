// 홀딩 **등록**의 저장 경로. 한 곳에만 둔다.
//
// 왜 꺼내 두었나: 홀딩을 거는 자리가 둘이 됐다 — 장비 카드(사업장 상세)와 회사 화면의
// 「+ 기록」 모달. 두 곳이 각자 insert 를 적으면 created_by 를 빼먹거나 최초 메모를
// 한쪽만 넣는 식으로 갈라진다. 그래서 **insert 는 여기 하나**이고, 화면은 이것을 부른다.
//
// 홀딩은 **장비에 붙는다**(holdings.device_id). 사업장에만 걸리는 홀딩은 없다 —
// 「어느 장비가 멈춰 있는가」가 홀딩의 뜻이기 때문이다. 그래서 deviceId 는 필수다.

import type { SupabaseClient } from '@supabase/supabase-js'

export type HoldingCreateInput = {
  customerId: number
  deviceId: number
  /** 어느 서비스 기록에서 걸었는가. 장비 카드에서 걸면 그 리포트, 그 밖에는 null. */
  serviceId?: number | null
  /** 사유. holdings.title 이다. */
  title: string
  /** 시작일 'YYYY-MM-DD'. */
  startedAt: string
  /** 최초 메모(선택). 비면 넣지 않는다. */
  firstNote?: string
  engineerId: number
}

export type HoldingCreateResult =
  | { ok: true; holdingId: number; noteFailed: boolean }
  | { ok: false; message: string }

/**
 * 홀딩 한 건을 넣는다. 최초 메모가 있으면 이어서 넣되, **메모가 실패해도 홀딩은 남긴다**
 * (`noteFailed` 로 알린다) — 홀딩을 되돌리면 「걸었다」는 사실까지 사라진다.
 */
export async function createHolding(
  supabase: SupabaseClient,
  input: HoldingCreateInput,
): Promise<HoldingCreateResult> {
  const title = input.title.trim()
  if (!title) return { ok: false, message: '사유를 입력해주세요' }
  if (!input.startedAt) return { ok: false, message: '시작일을 골라주세요' }

  const { data, error } = await supabase.from('holdings').insert({
    customer_id: input.customerId,
    device_id: input.deviceId,
    service_id: input.serviceId ?? null,
    title,
    started_at: input.startedAt,
    created_by: input.engineerId,
  }).select('holding_id').single()

  if (error || !data) {
    console.error('[holding] create failed', error)
    return { ok: false, message: error?.message || '홀딩 등록 중 오류가 발생했습니다' }
  }

  const note = (input.firstNote ?? '').trim()
  if (!note) return { ok: true, holdingId: data.holding_id, noteFailed: false }

  const { error: noteErr } = await supabase.from('holding_notes').insert({
    holding_id: data.holding_id,
    engineer_id: input.engineerId,
    content: note,
  })
  if (noteErr) console.error('[holding] create note failed', noteErr)
  return { ok: true, holdingId: data.holding_id, noteFailed: !!noteErr }
}
