'use client'

// 견적서 PDF 열기 — 화면 쪽 공용 헬퍼.
//
// **저장된 파일 하나뿐이다.** 확정 때 만들어 올린 그 문서에 확정일이 찍혀 있어 그 자체로
// 고객 발송용이다(app/quote/page.tsx 의 handleDownloadPDF). 결재 중·반려·승인 뒤 모두 같은
// 파일을 연다 — 예전처럼 저장값으로 그 자리에서 다시 그리지 않는다(그 체계는 걷어냈다).
//
// 길이 둘인데 **가는 곳은 같다**(/api/quote-pdf). 화면이 무엇을 들고 있느냐만 다르다.
//   · 경로를 안다  — 목록·고객사 상세·영업기회. `?path=`
//   · id 만 안다   — 결재 문서의 품의서 본문·검토표, 수리 화면. `?quoteId=`
//
// 열람 범위는 서버 한 곳이다(lib/approval/quotePdfAccess.ts) — 견적 열람 권한 또는 그 견적의
// 결재 문서 열람 권한. 결재자·참조자가 결재 화면에서 열 수 있는 것이 그 두 번째 줄이다.

import { createClient } from '@/lib/supabase/client'

export type OpenResult = { ok: true } | { ok: false; error: string }

/**
 * 열람 기록 한 줄 — 기존 방식을 그대로 쓴다(download_logs, action 'view').
 * 실패해도 열기를 막지 않는다. 목록의 PDF 링크가 이미 이렇게 남기고 있다.
 */
async function logView(quoteId: number, engineerId: number | null) {
  if (quoteId <= 0) return
  try {
    const supabase = createClient()
    const { error } = await supabase.from('download_logs').insert({
      engineer_id: engineerId,
      quote_id: quoteId,
      quote_number: null,
      company_name: null,
      action: 'view',
    })
    if (error) console.error('[quotePdf] 열람 기록 실패', { quoteId, error })
  } catch (e) {
    console.error('[quotePdf] 열람 기록 실패', { quoteId, error: e })
  }
}

/** 서명 URL 을 받아 새 탭으로 연다. 두 입구가 같은 응답을 쓴다. */
async function openSigned(query: string): Promise<OpenResult> {
  const res = await fetch(`/api/quote-pdf?${query}`)
  const json = await res.json().catch(() => ({}))
  if (!res.ok || !json?.signedUrl) {
    return { ok: false, error: json?.error || '견적서를 열 수 없습니다' }
  }
  window.open(json.signedUrl, '_blank')
  return { ok: true }
}

export type OpenQuotePdfInput = {
  quoteId: number
  /** 저장된 파일 경로(quotes.pdf_url). 있으면 경로로, 없으면 id 로 찾는다. */
  pdfUrl?: string | null
  /** 열람 기록에 남길 사람. 없으면 null 로 남는다(기존 목록과 같다). */
  engineerId?: number | null
}

/**
 * 저장된 견적서 PDF 를 연다 — 경로를 아는 화면(실적 현황·내 견적)이 쓴다.
 *
 * 옛 synology 전체 URL 은 그대로 띄운다(종전 동작). 그 밖에는 버킷 경로만 뽑아 서명 URL 을 받는다.
 */
export async function openQuotePdf(input: OpenQuotePdfInput): Promise<OpenResult> {
  const { quoteId, pdfUrl, engineerId = null } = input
  try {
    if (pdfUrl?.trim()) {
      if (pdfUrl.includes('synology') || pdfUrl.startsWith('http')) {
        window.open(pdfUrl, '_blank')
        await logView(quoteId, engineerId)
        return { ok: true }
      }
      const path = pdfUrl.startsWith('quote-pdfs/')
        ? pdfUrl.replace('quote-pdfs/', '')
        : pdfUrl.split('/quote-pdfs/')[1]
      if (!path) return { ok: false, error: '견적서 파일 경로가 올바르지 않습니다' }
      const res = await openSigned(`path=${encodeURIComponent(path)}`)
      if (res.ok) await logView(quoteId, engineerId)
      return res
    }
    return await openQuotePdfById(quoteId, engineerId)
  } catch (e) {
    console.error('[quotePdf] 열기 실패', { quoteId, error: e })
    return { ok: false, error: '견적서를 열지 못했습니다' }
  }
}

/**
 * 견적 id 만 아는 화면이 쓴다 — 결재 문서의 품의서 본문·검토표, 수리 화면.
 * 서버가 그 견적의 pdf_url 을 찾아 서명 URL 을 돌려준다(같은 파일이다).
 */
export async function openQuotePdfById(quoteId: number, engineerId: number | null = null): Promise<OpenResult> {
  try {
    const res = await openSigned(`quoteId=${quoteId}`)
    if (res.ok) await logView(quoteId, engineerId)
    return res
  } catch (e) {
    console.error('[quotePdf] 열기 실패', { quoteId, error: e })
    return { ok: false, error: '견적서를 열지 못했습니다' }
  }
}
