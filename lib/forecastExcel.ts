// 포캐스트 엑셀 내보내기 — **지금 화면에 보이는 것**을 그대로 두 시트로 뽑는다.
//
// 본사 보고용이라 「화면과 다른 숫자가 나왔다」가 가장 나쁜 사고다. 그래서 여기서 다시
// 집계하지 않고 **화면이 만든 값(요약·줄)을 받아서** 적는다.
//
// xlsx 는 누를 때 동적으로 불러온다(초기 번들에 넣지 않는다 — 리드·견적 엑셀과 같은 방식).

import { BUCKET_KEYS, type Bucket, type ForecastRow } from './forecast'

export type ForecastExcelArgs = {
  /** 월별 요약 — 화면의 표 그대로. */
  months: { month: string; bucket: Bucket }[]
  /** 줄 목록 — 화면의 필터가 걸린 뒤의 줄. */
  rows: ForecastRow[]
  engineerName: (id: number | null) => string
  customerName: (id: number | null) => string
  categoryLabel: (code: string | null) => string
  formLabel: (code: string | null) => string
  /** 영업기회 제목(줄 목록의 「번호/제목」 칸). */
  titleOf: (row: ForecastRow) => string
  /** 파일 이름에 붙일 꼬리표 — 회계연도·필터를 적는다. */
  label: string
}

/** 요약 시트의 2차원 배열. 순수 — 시험할 수 있게 따로 둔다. */
export function summaryAoA(months: ForecastExcelArgs['months']): (string | number)[][] {
  const head = ['월', ...BUCKET_KEYS, '수주확정/목표(%)']
  const body = months.map(({ month, bucket }) => [
    month, ...BUCKET_KEYS.map(k => bucket[k]),
    bucket.목표 > 0 ? Math.round((bucket.수주확정 / bucket.목표) * 100) : '',
  ])
  const total = months.reduce((acc, m) => {
    for (const k of BUCKET_KEYS) acc[k] += m.bucket[k]
    return acc
  }, { 목표: 0, 포캐스트: 0, 지연: 0, 수주확정: 0, 실주: 0, 구매취소: 0 } as Bucket)
  body.push([
    '합계', ...BUCKET_KEYS.map(k => total[k]),
    total.목표 > 0 ? Math.round((total.수주확정 / total.목표) * 100) : '',
  ])
  return [head, ...body]
}

/** 줄 시트의 2차원 배열. 화면의 열 순서와 같다. */
export function rowsAoA(a: ForecastExcelArgs): (string | number)[][] {
  const head = ['예상월', '상태', '출처', '담당자', '고객사', '대리점', '분류', '양식', '번호/제목', '금액', '등록일', '원래 상태']
  const body = a.rows.map(r => [
    r.month,
    r.status,
    // 출처 — 견적서가 있는 줄인가, 아직 견적 전인 안건인가.
    r.source === 'quote' ? '견적' : '견적 전',
    a.engineerName(r.engineerId),
    a.customerName(r.customerId),
    r.dealerId ? a.customerName(r.dealerId) : '직판',
    a.categoryLabel(r.category),
    a.formLabel(r.formKind),
    a.titleOf(r),
    r.amount,
    (r.createdAt ?? '').slice(0, 10),
    r.rawStatus ?? '',
  ])
  return [head, ...body]
}

/** 두 시트를 담은 파일을 내려받는다. 브라우저에서만 부른다(동적 import). */
export async function exportForecastXlsx(a: ForecastExcelArgs): Promise<void> {
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryAoA(a.months)), '월별요약')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rowsAoA(a)), '안건목록')
  // 파일 이름에 쓸 수 없는 글자를 미리 지운다(윈도에서 저장이 막힌다).
  const safe = a.label.replace(/[\\/:*?"<>|]/g, '')
  XLSX.writeFile(wb, `포캐스트_${safe}.xlsx`)
}
