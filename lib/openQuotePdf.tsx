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

/** 열람 기록에 함께 남길 값 — 어느 견적인지 로그만 보고 알 수 있게. */
type ViewMark = { quoteNumber?: string | null; companyName?: string | null }

/**
 * 서버 값을 먼저, 비어 있으면 부르는 쪽 값을 쓴다.
 * 전개(spread)로 합치면 서버가 준 null 이 부르는 쪽 값을 덮어버린다 — 칸마다 따로 고른다.
 */
const pickMark = (fromServer: ViewMark | undefined, fallback: ViewMark): ViewMark => ({
  quoteNumber: fromServer?.quoteNumber ?? fallback.quoteNumber ?? null,
  companyName: fromServer?.companyName ?? fallback.companyName ?? null,
})

/**
 * 열람 기록 한 줄(download_logs, action 'view').
 *
 * **견적번호·업체명을 함께 넣는다** — 다운로드 기록(useQuoteSubmit)과 같은 모양이다.
 * 2026-10-28 전에는 그 두 칸을 null 로 넣어, 열람 줄만 「어느 견적인지」가 비어 있었다
 * (관리자 화면의 로그 표가 열람 줄에서는 빈칸이었다. quote_id 로 견적을 또 찾아야 했고,
 * 견적이 지워진 뒤에는 그 길도 끊긴다 — download_logs.quote_id 는 ON DELETE SET NULL 이다).
 *
 * 값은 **서버가 준 것**을 쓴다(/api/quote-pdf 의 quoteNumber·companyName). 결재자처럼 견적
 * 행을 RLS 로 못 읽는 사람도 PDF 는 열 수 있어, 브라우저가 다시 조회하면 또 비게 된다.
 * 서버가 주지 못한 경우(옛 synology URL 등)에는 부르는 쪽이 들고 있는 값을 쓴다.
 *
 * 실패해도 열기를 막지 않는다.
 */
async function logView(quoteId: number, engineerId: number | null, mark: ViewMark = {}) {
  if (quoteId <= 0) return
  try {
    const supabase = createClient()
    const { error } = await supabase.from('download_logs').insert({
      engineer_id: engineerId,
      quote_id: quoteId,
      quote_number: mark.quoteNumber ?? null,
      company_name: mark.companyName ?? null,
      action: 'view',
    })
    if (error) console.error('[quotePdf] 열람 기록 실패', { quoteId, error })
  } catch (e) {
    console.error('[quotePdf] 열람 기록 실패', { quoteId, error: e })
  }
}

/** 서명 URL 과 **열람 기록에 쓸 값**을 받아 새 탭으로 연다. 두 입구가 같은 응답을 쓴다. */
type SignedResult = OpenResult & { mark?: ViewMark }
async function openSigned(query: string): Promise<SignedResult> {
  const res = await fetch(`/api/quote-pdf?${query}`)
  const json = await res.json().catch(() => ({}))
  if (!res.ok || !json?.signedUrl) {
    return { ok: false, error: json?.error || '견적서를 열 수 없습니다' }
  }
  window.open(json.signedUrl, '_blank')
  return {
    ok: true,
    mark: {
      quoteNumber: typeof json.quoteNumber === 'string' ? json.quoteNumber : null,
      companyName: typeof json.companyName === 'string' ? json.companyName : null,
    },
  }
}

export type OpenQuotePdfInput = {
  quoteId: number
  /** 저장된 파일 경로(quotes.pdf_url). 있으면 경로로, 없으면 id 로 찾는다. */
  pdfUrl?: string | null
  /** 열람 기록에 남길 사람. 없으면 null 로 남는다(기존 목록과 같다). */
  engineerId?: number | null
  /**
   * 열람 기록에 남길 견적번호·업체명 — **서버가 주지 못할 때만** 쓰는 보조값이다
   * (옛 synology 전체 URL 은 라우트를 거치지 않는다). 서버가 주면 그쪽이 앞선다.
   */
  quoteNumber?: string | null
  companyName?: string | null
}

/**
 * 저장된 견적서 PDF 를 연다 — 경로를 아는 화면(실적 현황·내 견적)이 쓴다.
 *
 * 옛 synology 전체 URL 은 그대로 띄운다(종전 동작). 그 밖에는 버킷 경로만 뽑아 서명 URL 을 받는다.
 */
export async function openQuotePdf(input: OpenQuotePdfInput): Promise<OpenResult> {
  const { quoteId, pdfUrl, engineerId = null, quoteNumber = null, companyName = null } = input
  const fallback: ViewMark = { quoteNumber, companyName }
  try {
    if (pdfUrl?.trim()) {
      if (pdfUrl.includes('synology') || pdfUrl.startsWith('http')) {
        window.open(pdfUrl, '_blank')
        await logView(quoteId, engineerId, fallback)
        return { ok: true }
      }
      const path = pdfUrl.startsWith('quote-pdfs/')
        ? pdfUrl.replace('quote-pdfs/', '')
        : pdfUrl.split('/quote-pdfs/')[1]
      if (!path) return { ok: false, error: '견적서 파일 경로가 올바르지 않습니다' }
      const res = await openSigned(`path=${encodeURIComponent(path)}`)
      if (res.ok) await logView(quoteId, engineerId, pickMark(res.mark, fallback))
      return res
    }
    return await openQuotePdfById(quoteId, engineerId, fallback)
  } catch (e) {
    console.error('[quotePdf] 열기 실패', { quoteId, error: e })
    return { ok: false, error: '견적서를 열지 못했습니다' }
  }
}

/**
 * 견적 id 만 아는 화면이 쓴다 — 결재 문서의 품의서 본문·검토표, 수리 화면.
 * 서버가 그 견적의 pdf_url 을 찾아 서명 URL 을 돌려준다(같은 파일이다).
 */
export async function openQuotePdfById(
  quoteId: number,
  engineerId: number | null = null,
  fallback: ViewMark = {},
): Promise<OpenResult> {
  try {
    const res = await openSigned(`quoteId=${quoteId}`)
    if (res.ok) await logView(quoteId, engineerId, pickMark(res.mark, fallback))
    return res
  } catch (e) {
    console.error('[quotePdf] 열기 실패', { quoteId, error: e })
    return { ok: false, error: '견적서를 열지 못했습니다' }
  }
}
