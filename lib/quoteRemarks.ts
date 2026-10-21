// 견적서 **비고 기본 문구** — 양식마다 다르다.
//
// 비고는 사람이 고치는 글자다. 이 파일은 **처음 채워 두는 값**만 정한다
// (화면: app/quote/page.tsx → RemarksEditor. 고치면 그 글자가 그대로 PDF 로 간다).
//
// ── 담당자 줄은 여기에 없다 ─────────────────────────────────────────────────
//   「* 담당 : 이름 직급 (전화번호)」는 **PDF 가 만든다**(app/quote/QuotePDFDoc.tsx 의
//   noteBody). 비고 본문에 넣으면 저장된 글자가 되어, 「다시쓰기」로 그 견적을 되살린
//   **다른 사람**의 문서에 원작성자 이름이 따라붙는다. 사람 정보는 늘 그릴 때 붙인다.
//
// DB·화면에 의존하지 않는다(import 가 없다) — 스크립트로 그대로 돌려 볼 수 있다.

import { FALLBACK_FORM_KIND, isFormKind, type FormKind } from './quoteForms'

/**
 * 양식별 기본 문구.
 *
 * 줄 하나가 PDF 비고 칸의 한 행이다. 그래서 긴 문구는 **접은 자리에서 줄을 나누고**
 * 이어지는 줄 앞에 공백 둘을 둔다(「*」로 시작하지 않는 줄은 앞 줄의 계속이라는 뜻) —
 * 한 줄로 길게 두면 칸 폭에서 저절로 접히는데, 그 접힘은 글자 크기·줄 수 계산
 * (QuotePDFDoc 의 noteBlockHeight)에 잡히지 않아 비고가 칸을 넘는다.
 */
export const DEFAULT_REMARKS_BY_FORM: Record<FormKind, string> = {
  general20: [
    '* 발주 후 주문 취소 시 발주 금액의 30%의 위약금이 발생합니다.',
    '* 모든 아크레텍 제품에 대해 성능 저하, 안전 문제, 보증 불가 등의 우려가 있으므로',
    '  당사 외 수리를 일체 금지함을 알려드립니다.',
  ].join('\n'),
  parts80: '* 발주 진행 시 팩스 또는 메일로 발주서 회신 요망 (FAX : 031-786-4090)',
  equip80: [
    '* 발주 후 주문 취소 시 발주 금액의 30%의 위약금이 발생합니다.',
    '* 설치 및 KOLAS 교정 일정은 담당자와 협의합니다.',
  ].join('\n'),
}

/**
 * 그 양식의 기본 문구. 양식을 아직 고르지 않았거나 모르는 값이면 **파츠 문구**로 떨어진다
 * (FALLBACK_FORM_KIND 와 같은 기준이다 — 가장 오래 쓰인 문구다).
 */
export function defaultRemarksFor(formKind: string | null | undefined): string {
  return DEFAULT_REMARKS_BY_FORM[isFormKind(formKind) ? formKind : FALLBACK_FORM_KIND]
}

/** 지금 비고가 **그 양식의 기본 문구 그대로**인가(손댔는지 판정). */
export const isDefaultRemarks = (remarks: string, formKind: string | null | undefined): boolean =>
  remarks.trim() === defaultRemarksFor(formKind).trim()
