// 고객사 **전부 내보내기** — 네 시트의 2차원 배열을 만드는 순수 모듈 (2026-11-22).
//
// ── 옛 양식과 무엇이 다른가 ────────────────────────────────────────────────
//   전에는 시트 하나(「고객사목록」)에 **고객사 × 장비**를 한 줄로 폈다. 열 13개.
//     상태 · 회사명 · 지역1 · 지역2 · 장비명 · 장비명2(모델) · 옵션 · 납입년 · 납입월 ·
//     S/N · 대리점 · 회사(소속) · 주소
//   장비가 두 대면 사업장이 두 줄이 되어 **사업장을 세는 일**(필터 결과와 맞춰 보기)이
//   되지 않았고, 메모·담당자·견적 수·최근 활동은 아예 없었다.
//
//   이제 시트가 셋이다 — 사업장 · 회사 · 대리점.
//
//   「사업장」 시트는 **사업장 × 장비**로 편다(2026-11-22 수정). 장비 세 대면 사업장
//   정보가 세 줄 반복되고, 장비가 없는 사업장도 장비 칸만 비운 채 한 줄 남는다.
//   줄 수 = 사업장마다 max(장비 수, 1) 을 더한 값이다. **폐기한 장비도 넣고** 「폐기」 열에
//   폐기일을 적는다 — 그 자리에서 폐기인지 아닌지 보이게.
//   장비 칸은 devices 의 저장 칸 **그대로**다(라인업·모델·옵션을 한 칸에 합치지 않는다).
//   따로 두었던 「장비」 시트는 같은 내용이 겹쳐 걷었다.
//   옛 양식은 lib/customerExcel.ts 에 그대로 남아 있다(지우지 않았다. 지역·납입일
//   계산은 그 파일 것을 여기서도 쓴다 — 화면·두 양식이 같은 글자를 내야 한다).
//
// ── 담당자는 **열로 편다** ──────────────────────────────────────────────────
//   한 칸에 줄바꿈으로 여러 사람을 넣으면 엑셀에서 거르지도 세지도 못한다. 그래서
//   시트 맨 오른쪽에 「담당자1 이름 · 직급 · 부서 · 전화 · 이메일 · 담당자2 …」로 편다.
//   열 수는 **그 내보내기에서 담당자가 가장 많은 줄**이 정한다(N명 → 5N 열).
//   담당자가 적은 줄은 뒤가 빈 칸이다. id 열은 담당자 열 **앞**에 둔다.
//
// ── 날짜 ────────────────────────────────────────────────────────────────
//   진짜 날짜 칸은 Date 로 낸다(엑셀이 날짜로 인식해 거르기·정렬이 된다). 연·월만 있는
//   옛 납입 자료처럼 날짜가 못 되는 값은 글자 그대로 낸다 — 1일로 지어내지 않는다.

import { installYearMonth, regionsOf } from './customerExcel'

/** 엑셀 한 칸에 들어갈 수 있는 값. */
export type Cellish = string | number | Date | null

/** 담당자 한 사람 — 다섯 칸. */
export type ExportContact = {
  name: string | null
  position: string | null
  department: string | null
  phone: string | null
  email: string | null
}

/** 사업장에 붙은 장비 한 대 — 「사업장」 시트의 뒤 일곱 칸. */
export type ExportSiteDevice = {
  /** 라인업 — devices.device_name. */
  lineup: string
  /** 모델 — devices.device_name2. */
  model: string
  option: string
  serial: string
  /** 소프트웨어 — devices.program. */
  program: string
  installYear: string | number | null
  installDate: string | null
  /** 폐기일. 쓰고 있으면 null — 그 칸이 비어 있으면 쓰는 장비다. */
  disposedAt: string | null
}

/**
 * 사업장 한 줄.
 *
 * deviceCount·openQuotes·totalQuotes·touch*·note 는 「사업장」 시트에 **나가지 않는다**
 * (2026-11-22 에 그 아홉 열을 걷었다). 「회사」 시트의 합계가 이 값들로 만들어지므로 남긴다.
 */
export type ExportSite = {
  customerId: number
  companyId: number | null
  /** 회사명 — 묶는 회사 줄의 이름(없으면 그 줄 자신의 이름). */
  companyName: string
  /** 회사 영문명. */
  nameEn: string
  /** 분류(생산품) — customers.industry. */
  industry: string
  siteName: string
  status: string
  region1: string
  region2: string
  address: string
  /** 대리점 이름. 직판이면 '직판'. */
  agency: string
  deviceCount: number
  openQuotes: number
  totalQuotes: number
  /** 마지막 접점 — 날짜·갈래·우리 쪽 사람 이름. */
  touchDate: string
  touchSource: string
  touchActor: string
  note: string
  contacts: ExportContact[]
  /** 그 사업장의 장비(폐기 포함). 비어 있으면 장비 칸이 빈 한 줄이 된다. */
  devices: ExportSiteDevice[]
}

/** 회사 한 줄. */
export type ExportCompany = {
  companyId: number
  companyName: string
  nameEn: string
  industry: string
  siteCount: number
  deviceCount: number
  openQuotes: number
  totalQuotes: number
  touchDate: string
  note: string
}

/** 대리점 한 줄. */
export type ExportAgency = {
  agencyId: number
  name: string
  nameEn: string
  address: string
  siteCount: number
  openQuotes: number
  totalQuotes: number
  note: string
  contacts: ExportContact[]
}

/** 세 시트의 이름. 순서가 곧 통합 문서의 탭 순서다. */
export const SHEET_NAMES = ['사업장', '회사', '대리점'] as const
export type SheetName = (typeof SHEET_NAMES)[number]

/**
 * 담당자를 뺀 머리글. 담당자 열은 buildContactHeader 가 뒤에 붙인다.
 * 앞 아홉은 사업장, 뒤 일곱은 **그 줄의 장비**다(장비가 없으면 빈 칸).
 */
export const SITE_HEADER = [
  '회사명', '영문명', '분류', '사업장명', '상태', '지역1', '지역2', '주소', '대리점',
  '라인업', '모델', '옵션', 'S/N', '소프트웨어', '납입일', '폐기',
] as const

export const COMPANY_HEADER = [
  '회사명', '영문명', '분류', '사업장 수', '장비 수', '진행 견적', '전체 견적',
  '최근 활동일', '메모', 'id',
] as const

export const AGENCY_HEADER = [
  '대리점명', '영문명', '주소', '거래 사업장 수', '진행 견적', '전체 견적', '메모', 'id',
] as const

/** 담당자 한 사람이 차지하는 칸 수. */
export const CONTACT_FIELDS = ['이름', '직급', '부서', '전화', '이메일'] as const

/** 담당자 열 머리글 — 「담당자1 이름 … 담당자N 이메일」. */
export function buildContactHeader(maxContacts: number): string[] {
  const out: string[] = []
  for (let i = 1; i <= maxContacts; i++) for (const f of CONTACT_FIELDS) out.push(`담당자${i} ${f}`)
  return out
}

/** 담당자 칸 값 — 사람이 모자라면 빈 칸으로 채운다(열 수는 줄마다 같아야 한다). */
export function contactCells(contacts: ExportContact[], maxContacts: number): string[] {
  const out: string[] = []
  for (let i = 0; i < maxContacts; i++) {
    const c = contacts[i]
    out.push(c?.name ?? '', c?.position ?? '', c?.department ?? '', c?.phone ?? '', c?.email ?? '')
  }
  return out
}

/** 'YYYY-MM-DD' → Date. 날짜가 아니면 글자 그대로 돌려준다(빈 값은 ''). */
export function dateCell(value: string | null | undefined): Cellish {
  const s = (value ?? '').trim()
  if (!s) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (!m) return s
  // UTC 정오로 둔다 — 자정으로 두면 표준시가 다른 자리에서 하루가 밀려 보인다.
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12))
}

/**
 * 납입일 — 날짜가 온전하면 Date, 연·월만 있으면 'YYYY-MM', 연만 있으면 'YYYY'.
 * 옛 자료에는 install_date 에 월 하나('3')만 들어간 줄이 1,100개 넘는다(lib/customerExcel.ts).
 */
export function installCell(
  year: string | number | null | undefined,
  date: string | null | undefined,
): Cellish {
  const d = String(date ?? '').trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(d)) return dateCell(d)
  const ym = installYearMonth(year, date)
  if (ym.year === '') return ''
  if (ym.month === '') return String(ym.year)
  return `${ym.year}-${String(ym.month).padStart(2, '0')}`
}

/** 지역 두 칸 — 화면과 같은 규칙(lib/customerExcel.ts 의 regionsOf). */
export function regionCells(c: { region1: string | null; region2: string | null; address: string | null }): [string, string] {
  return regionsOf(c)
}

/** 한 시트 = 머리글 한 줄 + 몸통. */
export type Sheet = { name: SheetName; rows: Cellish[][] }

export type ExportInput = {
  sites: ExportSite[]
  companies: ExportCompany[]
  agencies: ExportAgency[]
}

/** 「사업장」 시트의 줄 수(머리줄 뺀 수) — 사업장마다 max(장비 수, 1). */
export function siteRowCount(sites: { devices: ExportSiteDevice[] }[]): number {
  return sites.reduce((n, s) => n + Math.max(1, s.devices.length), 0)
}

/** 가장 담당자가 많은 줄의 사람 수. 담당자가 하나도 없으면 0(담당자 열이 없다). */
export function maxContactsOf(rows: { contacts: ExportContact[] }[]): number {
  return rows.reduce((n, r) => Math.max(n, r.contacts.length), 0)
}

/** 네 시트를 만든다. 줄 순서는 **넘겨받은 순서 그대로**다(화면 순서를 지킨다). */
export function buildCustomerSheets(input: ExportInput): Sheet[] {
  const siteContacts = maxContactsOf(input.sites)
  const agencyContacts = maxContactsOf(input.agencies)

  const siteRows: Cellish[][] = [[...SITE_HEADER, ...buildContactHeader(siteContacts)]]
  for (const s of input.sites) {
    const head = [s.companyName, s.nameEn, s.industry, s.siteName, s.status, s.region1, s.region2, s.address, s.agency]
    const tail = contactCells(s.contacts, siteContacts)
    if (s.devices.length === 0) {
      // 장비가 없는 사업장도 한 줄 남긴다 — 장비 칸만 비운다.
      siteRows.push([...head, '', '', '', '', '', '', '', ...tail])
      continue
    }
    for (const d of s.devices) {
      siteRows.push([
        ...head,
        d.lineup, d.model, d.option, d.serial, d.program,
        installCell(d.installYear, d.installDate), dateCell(d.disposedAt),
        ...tail,
      ])
    }
  }

  const companyRows: Cellish[][] = [[...COMPANY_HEADER]]
  for (const c of input.companies) {
    companyRows.push([
      c.companyName, c.nameEn, c.industry, c.siteCount, c.deviceCount, c.openQuotes, c.totalQuotes,
      dateCell(c.touchDate), c.note, c.companyId,
    ])
  }

  const agencyRows: Cellish[][] = [[...AGENCY_HEADER, ...buildContactHeader(agencyContacts)]]
  for (const a of input.agencies) {
    agencyRows.push([
      a.name, a.nameEn, a.address, a.siteCount, a.openQuotes, a.totalQuotes, a.note, a.agencyId,
      ...contactCells(a.contacts, agencyContacts),
    ])
  }

  return [
    { name: '사업장', rows: siteRows },
    { name: '회사', rows: companyRows },
    { name: '대리점', rows: agencyRows },
  ]
}

/** 파일 이름 — 고객사_YYYYMMDD_HHmm.xlsx. 시각은 한국 시각이다. */
export function customerExportFileName(now: Date = new Date()): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  const stamp = `${kst.getUTCFullYear()}${p(kst.getUTCMonth() + 1)}${p(kst.getUTCDate())}` +
    `_${p(kst.getUTCHours())}${p(kst.getUTCMinutes())}`
  return `고객사_${stamp}.xlsx`
}

/**
 * 열 폭 — 글자 수로 잰다(한글은 두 칸). 너무 넓어지면 읽기 어려워 40 에서 끊는다.
 * 옛 양식과 같은 규칙이지만 Date 칸이 섞여 있어 여기서 다시 쓴다.
 */
export function sheetWidths(rows: Cellish[][]): number[] {
  const text = (v: Cellish) => {
    if (v == null) return ''
    if (v instanceof Date) return '2026-11-22'
    return String(v)
  }
  const width = (v: Cellish) => {
    let n = 0
    for (const ch of text(v)) n += ch.charCodeAt(0) > 0x2e80 ? 2 : 1
    return n
  }
  const cols = rows[0]?.length ?? 0
  return Array.from({ length: cols }, (_, i) =>
    Math.min(40, Math.max(6, ...rows.map(r => width(r[i] ?? '') + 2))))
}
