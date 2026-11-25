'use client'

// 실주 사유 목록을 화면으로 나르는 한 곳 (2026-11-26).
//
// 표가 아직 없어도 창은 돈다 — 그때는 **같은 여덟 줄**(lib/lostReason.ts 의
// FALLBACK_REASONS)을 돌려주고, 저장할 때 id 없이 글자만 담는다.
//
// 모듈 캐시다 — 앱이 살아 있는 동안 한 번만 읽는다(목록이 자주 바뀌지 않는다).
// 규칙은 lib/lostReason.ts 에 있다. 여기서는 읽어서 나르기만 한다.

import { createClient } from '@/lib/supabase/client'
import { FALLBACK_REASONS, type LostReason } from '@/lib/lostReason'

export type LostReasonList = {
  rows: readonly LostReason[]
  /** 표가 없거나 읽지 못했는가 — 그때는 글자만 저장한다. */
  fallback: boolean
}

let cache: Promise<LostReasonList> | null = null

/** 권한·세션이 바뀌면 버린다. */
export function invalidateLostReasons(): void { cache = null }

export function loadLostReasons(): Promise<LostReasonList> {
  if (cache) return cache
  cache = (async () => {
    try {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('lost_reasons')
        .select('reason_id, label, sort, active, requires_note, requires_competitor')
        .eq('active', true)
        .order('sort', { ascending: true })
      if (error || !data || data.length === 0) {
        if (error) console.warn('[lostReason] 목록을 읽지 못했다 — 기본 여덟 줄로 돈다', error.code)
        return { rows: FALLBACK_REASONS, fallback: true }
      }
      return { rows: data as unknown as LostReason[], fallback: false }
    } catch (e) {
      console.warn('[lostReason] 목록 조회가 던졌다 — 기본 여덟 줄로 돈다', e)
      cache = null
      return { rows: FALLBACK_REASONS, fallback: true }
    }
  })()
  return cache
}
