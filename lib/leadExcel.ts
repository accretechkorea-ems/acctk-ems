// 리드 목록 엑셀 내보내기 — 데이터 조회 + 시트 생성.
// 화면과 무관한 순수 로직만 둔다(버튼·선택 UI 는 components/leads/LeadExcelButton.tsx).
// 구조는 lib/quoteExcel.ts 와 같은 방식이다 — 다만 견적 쪽 코드는 건드리지 않고 따로 둔다
// (견적은 1건 = 시트 1장인 '분석표', 리드는 여러 건 = 한 시트의 목록이라 모양이 다르다).

import { createClient } from '@/lib/supabase/client'
// 타입만 가져온다(컴파일 시 사라짐). 런타임 exceljs 는 호출부에서 동적 import 한다.
import type { Workbook, Worksheet, Cell } from 'exceljs'

export type LeadExcelData = {
  lead_id: number
  lead_no: string | null
  created_at: string
  status: string | null
  assigned_by: number | null
  assigned_to: number | null
  partner_company: string | null
  partner_name: string | null
  partner_contact: string | null
  customer_company: string | null
  industry: string | null
  products: string | null
  city: string | null
  country: string | null
  interest_product: string | null
  budget_status: string | null
  purchase_period: string | null
  expected_purchase: string | null
  contact_name: string | null
  contact_title: string | null
  contact_dept: string | null
  contact_mobile: string | null
  contact_office_tel: string | null
  contact_email: string | null
  competitor: string[] | null
  competitor_other: string | null
  request_note: string | null
  admin_memo: string | null
}

// meeting_note 는 뽑지 않는다 — 수천 자라 셀에 넣으면 시트가 망가진다.
const SELECT = `
  lead_id, lead_no, created_at, status, assigned_by, assigned_to,
  partner_company, partner_name, partner_contact,
  customer_company, industry, products, city, country,
  interest_product, budget_status, purchase_period, expected_purchase,
  contact_name, contact_title, contact_dept, contact_mobile, contact_office_tel, contact_email,
  competitor, competitor_other, request_note, admin_memo
`

/**
 * 선택한 리드들의 엑셀용 데이터를 한 번에 조회한다.
 * 조회 범위는 RLS 가 결정한다(화면에서 보이던 리드만 넘어온다는 전제).
 * 실패 시 throw — 호출부에서 toast 등으로 처리한다.
 */
export async function fetchLeadsForExcel(ids: number[]): Promise<LeadExcelData[]> {
  if (ids.length === 0) return []

  const supabase = createClient()
  const { data, error } = await supabase
    .from('leads')
    .select(SELECT)
    .in('lead_id', ids)
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as LeadExcelData[]
}

// ── 시트 생성 ────────────────────────────────────────────────────────────────
// exceljs 인스턴스는 호출부가 동적 import 해서 넘긴다(번들 증가 방지).

const GRAY_BG = 'FFF3F4F6'

const fillBg = (cell: Cell, argb = GRAY_BG) => {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } }
}
const borderThin = (cell: Cell) => {
  cell.border = {
    top: { style: 'thin' }, left: { style: 'thin' },
    bottom: { style: 'thin' }, right: { style: 'thin' },
  }
}

/**
 * 긴 글이 들어가는 칸(요청사항·메모)의 상한.
 * 엑셀 셀 자체는 32,767자까지 담지만, 그만한 글이 한 칸에 들어가면 행 높이가 터져
 * 시트를 읽을 수 없게 된다. 원문이 더 길면 잘라내고 잘렸음을 남긴다.
 * request_note 는 입력 상한이 2,000자라 실제로는 거의 걸리지 않는다.
 */
const LONG_TEXT_MAX = 2000
const cut = (v: string | null): string => {
  const s = (v ?? '').trim()
  if (s.length <= LONG_TEXT_MAX) return s
  return s.slice(0, LONG_TEXT_MAX) + ' …(이하 생략)'
}

/** 'YYYY-MM-DD'. created_at 은 timestamptz 라 한국 날짜로 끊는다. */
const ymdKST = (v: string | null): string =>
  v ? new Date(v).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }) : ''

/** 공백으로 이어 붙이고 빈 값은 건너뛴다. 전부 비면 '-'. */
const join = (parts: (string | null | undefined)[], sep = ' '): string =>
  parts.map(v => (v ?? '').trim()).filter(Boolean).join(sep) || '-'

/** 열 정의 — 라벨·너비·값 추출을 한곳에 둬서 헤더와 본문이 어긋나지 않게 한다. */
type Col = { label: string; width: number; wrap?: boolean; get: (l: LeadExcelData) => string }

const columns = (engName: (id: number | null) => string): Col[] => [
  { label: '리드번호', width: 13, get: l => l.lead_no ?? '' },
  { label: '등록일', width: 12, get: l => ymdKST(l.created_at) },
  { label: '상태', width: 10, get: l => l.status ?? '' },
  { label: '배정자', width: 14, get: l => (l.assigned_by ? engName(l.assigned_by) : '') },
  { label: '담당자', width: 14, get: l => (l.assigned_to ? engName(l.assigned_to) : '') },
  { label: '파트너사', width: 20, get: l => l.partner_company ?? '' },
  { label: '등록자', width: 12, get: l => l.partner_name ?? '' },
  { label: '파트너 연락처', width: 16, get: l => l.partner_contact ?? '' },
  { label: '고객사', width: 22, get: l => l.customer_company ?? '' },
  { label: '산업군', width: 20, get: l => l.industry ?? '' },
  { label: '생산품', width: 20, get: l => l.products ?? '' },
  { label: '지역', width: 18, get: l => join([l.city, l.country]) },
  { label: '관심제품', width: 18, get: l => l.interest_product ?? '' },
  { label: '예산', width: 14, get: l => l.budget_status ?? '' },
  { label: '구매 기간', width: 14, get: l => l.purchase_period ?? '' },
  { label: '예상 구매일', width: 13, get: l => l.expected_purchase ?? '' },
  { label: '고객 담당자', width: 22, get: l => join([l.contact_name, l.contact_title, l.contact_dept]) },
  { label: '휴대폰', width: 15, get: l => l.contact_mobile ?? '' },
  { label: '회사번호', width: 15, get: l => l.contact_office_tel ?? '' },
  { label: '이메일', width: 24, get: l => l.contact_email ?? '' },
  { label: '경쟁사', width: 20, get: l => competitorText(l) },
  { label: '요청사항', width: 46, wrap: true, get: l => cut(l.request_note) },
  { label: '메모', width: 46, wrap: true, get: l => cut(l.admin_memo) },
]

/**
 * 경쟁사 표시 — 배열을 쉼표로 잇고 '기타' 가 있으면 직접 입력값을 덧붙인다.
 * 화면(app/leads/page.tsx competitorText)과 같은 규칙이다.
 */
const COMPETITOR_OTHER = '기타'
function competitorText(l: LeadExcelData): string {
  const list = l.competitor ?? []
  if (!list.length) return ''
  const joined = list.join(', ')
  return list.includes(COMPETITOR_OTHER) && l.competitor_other
    ? `${joined} (${l.competitor_other})`
    : joined
}

/**
 * 리드 여러 건을 「리드 목록」 시트 한 장으로 그린다.
 * engName 은 화면이 이미 들고 있는 engineers 로 만든 id → '이름 직급' 함수다
 * (leads 에는 배정자·담당자가 id 로만 있어 조인이 필요하다).
 */
export function buildLeadSheet(
  workbook: Workbook,
  leads: LeadExcelData[],
  engName: (id: number | null) => string,
): Worksheet {
  const ws = workbook.addWorksheet('리드 목록')
  const cols = columns(engName)

  cols.forEach((c, i) => { ws.getColumn(i + 1).width = c.width })

  // 헤더 — 견적 시트와 같은 규칙(굵게 10pt · 가운데 · 회색 배경 · 얇은 테두리).
  const header = ws.getRow(1)
  cols.forEach((c, i) => {
    const cell = header.getCell(i + 1)
    cell.value = c.label
    cell.font = { bold: true, size: 10 }
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
    fillBg(cell)
    borderThin(cell)
  })
  header.height = 20
  // 헤더를 고정해 아래로 내려도 어느 칸인지 보인다.
  ws.views = [{ state: 'frozen', ySplit: 1 }]

  leads.forEach((lead, rowIdx) => {
    const row = ws.getRow(rowIdx + 2)
    cols.forEach((c, i) => {
      const cell = row.getCell(i + 1)
      cell.value = c.get(lead)
      cell.font = { size: 10 }
      // 긴 글만 줄바꿈을 켠다. 나머지는 한 줄로 둬야 행 높이가 들쭉날쭉하지 않다.
      cell.alignment = c.wrap
        ? { wrapText: true, vertical: 'top' }
        : { vertical: 'middle' }
      borderThin(cell)
    })
  })

  // 자동 필터 — 받은 사람이 엑셀에서 바로 걸러 볼 수 있게 한다.
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } }

  return ws
}
