// 고객사 목록 엑셀 — 옛 관리 엑셀 양식(고객사 × 장비 한 줄)을 그대로 따른다.
//
// 받는 쪽이 쓰던 양식이 기준이라 열 순서·이름을 여기서 바꾸지 않는다. 화면이 거르고 난
// 목록을 그대로 받아 적는다(포캐스트 엑셀과 같은 원칙 — 화면과 다른 줄이 나오는 것이
// 가장 나쁜 사고다). 집계·재계산은 하지 않는다.
//
// 열에서 뺀 것 둘 ─
//   · 「담당자(우리 쪽)」 … 유일한 후보가 devices.install_engineer 인데 살아있는
//     1,447행이 전부 비어 있다(2026-10-23 확인). 넣으면 통째로 빈 열이 된다.
//   · 「고객 담당자(이름·전화)」 … 양식에서 뺐다(2026-10-23). contacts 는 조회에서도
//     읽지 않는다 — 임베딩을 지웠으므로 응답도 그만큼 가볍다.
//   되살릴 때 고칠 곳은 세 군데다 — CUSTOMER_EXCEL_SELECT(조회), CUSTOMER_EXCEL_HEADER
//   (머리글), customerRowsAoA(줄). 열 폭과 자동 필터 범위는 머리글 길이에서 따라온다.
//
// xlsx 는 누를 때 동적으로 불러온다(초기 번들에 넣지 않는다 — 포캐스트·리드 엑셀과 같은 방식).

/** 장비 한 대 — 엑셀이 읽는 칸만. */
export type ExcelDevice = {
  device_name: string | null
  device_name2: string | null
  option: string | null
  serial_number: string | null
  install_year: string | number | null
  install_date: string | null
}

export type ExcelCustomer = {
  customer_id: number
  status: string | null
  company_name: string | null
  region1: string | null
  region2: string | null
  address: string | null
  agency: string | null
  parent_customer_id: number | null
  devices?: ExcelDevice[] | null
}

/** 조회할 때 쓰는 select 문자열. 쓰는 열만 읽고, 장비는 임베딩으로 한 번에 받는다. */
export const CUSTOMER_EXCEL_SELECT =
  'customer_id, status, company_name, region1, region2, address, agency, parent_customer_id,' +
  ' devices(device_name, device_name2, option, serial_number, install_year, install_date, deleted_at)'

/** 조회 결과 한 줄(임베딩 포함). deleted_at 은 걸러내는 데만 쓴다. */
export type CustomerExcelRow = Omit<ExcelCustomer, 'devices'> & {
  devices?: (ExcelDevice & { deleted_at?: string | null })[] | null
}

/**
 * 조회 결과 → 엑셀이 읽는 꼴.
 * 지워진 장비를 여기서 걸러낸다 — 임베딩은 부모의 deleted_at 조건을 물려받지 않으므로,
 * 지운 장비가 그대로 줄이 되어 따라 들어온다.
 */
export function toExcelCustomer(row: CustomerExcelRow): ExcelCustomer {
  return {
    ...row,
    devices: (row.devices ?? []).filter(d => !d.deleted_at),
  }
}

/** 머리글. 열 순서가 곧 양식이다. */
export const CUSTOMER_EXCEL_HEADER = [
  '상태', '회사명', '지역1', '지역2',
  '장비명', '장비명2(모델)', '옵션', '납입년', '납입월', 'S/N',
  '대리점', '회사(소속)', '주소',
] as const

/**
 * 긴 시도 이름 → 저장된 지역1 과 같은 짧은 꼴.
 * customers.region1 이 비었을 때 주소에서 만들어 넣기 위한 것이며, 값이 있으면 쓰지 않는다.
 * (저장된 값에는 「남부」·「중부」 같은 사내 구역도 섞여 있어 그쪽이 늘 정본이다.)
 */
const SIDO_SHORT: Record<string, string> = {
  서울특별시: '서울', 부산광역시: '부산', 대구광역시: '대구', 인천광역시: '인천',
  광주광역시: '광주', 대전광역시: '대전', 울산광역시: '울산', 세종특별자치시: '세종',
  경기도: '경기', 강원도: '강원', 강원특별자치도: '강원',
  충청북도: '충북', 충청남도: '충남', 전라북도: '전북', 전북특별자치도: '전북',
  전라남도: '전남', 경상북도: '경북', 경상남도: '경남',
  제주도: '제주', 제주특별자치도: '제주',
}

/** 주소 첫 토큰 → 지역1. 표에 없으면 꼬리의 시/도만 떼어 본다. */
export function shortSido(token: string): string {
  const t = token.trim()
  if (!t) return ''
  if (SIDO_SHORT[t]) return SIDO_SHORT[t]
  const cut = t.replace(/(특별자치도|특별자치시|광역시|특별시|[시도])$/, '')
  return cut.length >= 2 ? cut : t
}

/** 주소 둘째 토큰 → 지역2. 「화성시」→「화성」(저장된 지역2 와 같은 꼴). */
export function shortCity(token: string): string {
  const t = token.trim()
  if (!t) return ''
  const cut = t.replace(/[시군구]$/, '')
  return cut.length >= 2 ? cut : t
}

/**
 * 지역1·지역2 — 저장된 컬럼이 정본이고, 비어 있을 때만 주소 앞 두 토큰에서 만든다.
 * 한쪽만 비어 있어도 그쪽만 채운다.
 */
export function regionsOf(c: Pick<ExcelCustomer, 'region1' | 'region2' | 'address'>): [string, string] {
  const r1 = (c.region1 ?? '').trim()
  const r2 = (c.region2 ?? '').trim()
  if (r1 && r2) return [r1, r2]
  const tokens = (c.address ?? '').trim().split(/\s+/).filter(Boolean)
  return [
    r1 || (tokens[0] ? shortSido(tokens[0]) : ''),
    r2 || (tokens[1] ? shortCity(tokens[1]) : ''),
  ]
}

/**
 * 납입년·납입월.
 *
 * devices 의 두 칸은 옛 자료가 섞여 있다(2026-10-23 집계, 살아있는 1,447행):
 *   · install_year + install_date='3' 처럼 **월만** 들어간 꼴 … 1,116행
 *   · install_date='2014-02-01' / '2016-05' 처럼 날짜인 꼴 … 248행
 * 그래서 연도는 install_year 를 먼저 보고, 없으면 날짜의 앞 네 자리를 쓴다.
 * 월은 날짜에서 뽑고, 날짜가 월 하나뿐이면 그 숫자를 그대로 쓴다.
 * 1~12 를 벗어난 월은 버린다 — 엑셀에 둘 수 없는 값을 억지로 싣지 않는다.
 */
export function installYearMonth(
  year: string | number | null | undefined,
  date: string | null | undefined,
): { year: number | ''; month: number | '' } {
  const y = String(year ?? '').trim()
  const d = String(date ?? '').trim()
  const full = /^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/.exec(d)
  const monthOnly = /^(\d{1,2})$/.exec(d)

  const outYear = /^\d{4}$/.test(y) ? Number(y) : full ? Number(full[1]) : ''
  const rawMonth = full ? Number(full[2]) : monthOnly ? Number(monthOnly[1]) : NaN
  const outMonth = Number.isFinite(rawMonth) && rawMonth >= 1 && rawMonth <= 12 ? rawMonth : ''
  return { year: outYear, month: outMonth }
}

/**
 * 장비 줄 순서 — 임베딩으로 받은 배열 순서는 보장되지 않으므로 여기서 정한다.
 * 납입년·월이 이른 것부터, 값이 없는 것은 뒤로.
 */
function sortDevices(devices: ExcelDevice[]): ExcelDevice[] {
  const key = (d: ExcelDevice) => {
    const { year, month } = installYearMonth(d.install_year, d.install_date)
    return year === '' ? Number.MAX_SAFE_INTEGER : year * 100 + (month === '' ? 0 : month)
  }
  return [...devices].sort((a, b) =>
    key(a) - key(b) ||
    (a.device_name ?? '').localeCompare(b.device_name ?? '', 'ko') ||
    (a.serial_number ?? '').localeCompare(b.serial_number ?? '', 'ko'))
}

/**
 * 시트의 2차원 배열. 순수 — 시험할 수 있게 따로 둔다(scripts/customer-excel-check.js).
 * 고객사 순서는 **화면 순서 그대로**다. 장비가 없는 고객사도 장비 칸만 비운 채 한 줄 남긴다.
 */
export function customerRowsAoA(
  customers: ExcelCustomer[],
  parentName: (id: number | null) => string,
): (string | number)[][] {
  const body: (string | number)[][] = []
  for (const c of customers) {
    const [region1, region2] = regionsOf(c)
    const head = [c.status ?? '', c.company_name ?? '', region1, region2]
    const tail = [
      c.agency ?? '',
      parentName(c.parent_customer_id ?? null),
      c.address ?? '',
    ]
    const devices = sortDevices(c.devices ?? [])
    if (devices.length === 0) {
      body.push([...head, '', '', '', '', '', '', ...tail])
      continue
    }
    for (const d of devices) {
      const { year, month } = installYearMonth(d.install_year, d.install_date)
      body.push([
        ...head,
        d.device_name ?? '', d.device_name2 ?? '', d.option ?? '',
        year, month, d.serial_number ?? '',
        ...tail,
      ])
    }
  }
  return [[...CUSTOMER_EXCEL_HEADER], ...body]
}

/**
 * 열 폭 — 글자 수로 잰다. 한글은 두 칸으로 센다(엑셀의 폭 단위가 반각 기준이다).
 * 너무 넓어지면 읽기 어려워 40 에서 끊는다.
 */
export function columnWidths(aoa: (string | number)[][]): { wch: number }[] {
  const width = (v: string | number) => {
    const s = String(v ?? '')
    let n = 0
    for (const ch of s) n += ch.charCodeAt(0) > 0x2e80 ? 2 : 1
    return n
  }
  const cols = aoa[0]?.length ?? 0
  return Array.from({ length: cols }, (_, i) => ({
    wch: Math.min(40, Math.max(6, ...aoa.map(row => width(row[i] ?? '') + 2))),
  }))
}

export type CustomerExcelArgs = {
  /** 화면의 필터·검색이 걸린 뒤의 고객사 목록. 순서까지 그대로 쓴다. */
  customers: ExcelCustomer[]
  /** 소속회사 이름 — 부모 행(is_parent)에서 만든 맵을 넘긴다. */
  parentName: (id: number | null) => string
  /** 파일 이름에 붙일 날짜. 'YYYY-MM-DD' (todayKST). */
  today: string
}

/** 파일 이름 — 고객사목록_YYYYMMDD.xlsx */
export function customerExcelFileName(today: string): string {
  return `고객사목록_${today.replace(/-/g, '')}.xlsx`
}

/** 파일 하나를 내려받는다. 브라우저에서만 부른다(동적 import). */
export async function exportCustomerXlsx(a: CustomerExcelArgs): Promise<number> {
  const aoa = customerRowsAoA(a.customers, a.parentName)
  const XLSX = await import('xlsx')
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = columnWidths(aoa)
  // 머리글 고정(freeze)은 지금 쓰는 xlsx 0.18.5 가 쓰지 못한다 — 시트 뷰를 적는
  // write_ws_xml_sheetviews 가 workbookViewId 만 남긴다. 대신 자동 필터를 걸어
  // 머리글에서 바로 거르고 정렬할 수 있게 한다(엑셀에서 머리글 행이 표로 잡힌다).
  const last = XLSX.utils.encode_cell({ r: aoa.length - 1, c: CUSTOMER_EXCEL_HEADER.length - 1 })
  ws['!autofilter'] = { ref: `A1:${last}` }
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '고객사목록')
  XLSX.writeFile(wb, customerExcelFileName(a.today))
  return aoa.length - 1
}
