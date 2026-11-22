// 고객사 엑셀 내보내기 — **고른 단위 하나**의 시트를 만드는 순수 모듈 (2026-11-22).
//
// ── 단위를 고른다 ──────────────────────────────────────────────────────────
//   화면의 엑셀 단추는 바로 내려받지 않고 창을 띄운다. 거기서 **무엇을 한 줄로 볼지**를
//   고르고, 파일에는 그 시트 하나만 담긴다.
//
//     회사          회사 한 줄 — 사업장 수·장비 수
//     사업장        사업장 한 줄 — 주소·대리점·장비 수
//     사업장 × 장비  장비 한 대가 한 줄 — 라인업·모델·옵션·S/N·납입일·폐기
//     대리점        대리점 한 줄 — 거래 사업장 수·견적
//
//   전에는 네 시트를 한 통에 담았다. 받는 사람은 그 중 한 장만 쓰는데 나머지가 늘 따라
//   왔고, 「사업장」 한 장이 장비 줄로 펴져 있어 사업장을 세려면 눈으로 묶어야 했다.
//   이제 **세는 단위와 줄이 같다** — 사업장 단위를 고르면 한 줄이 한 사업장이다.
//
// ── 담당자는 **열로 편다**(끌 수 있다) ────────────────────────────────────
//   한 칸에 줄바꿈으로 여러 사람을 넣으면 엑셀에서 거르지도 세지도 못한다. 그래서
//   시트 맨 오른쪽에 「담당자1 이름 · 직급 · 부서 · 전화 · 이메일 · 담당자2 …」로 편다.
//   열 수는 **그 내보내기에서 담당자가 가장 많은 줄**이 정한다(N명 → 5N 열).
//   담당자가 적은 줄은 뒤가 빈 칸이다. 창에서 끄면 그 열이 통째로 빠진다.
//
// ── 날짜 ────────────────────────────────────────────────────────────────
//   진짜 날짜 칸은 Date 로 낸다(엑셀이 날짜로 인식해 거르기·정렬이 된다). 연·월만 있는
//   옛 납입 자료처럼 날짜가 못 되는 값은 글자 그대로 낸다 — 1일로 지어내지 않는다.
//
//   옛 양식(고객사 × 장비 한 장)은 lib/customerExcel.ts 에 그대로 남아 있다. 지역·납입일
//   계산은 그 파일 것을 여기서도 쓴다 — 화면과 두 양식이 같은 글자를 내야 한다.

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

/** 사업장에 붙은 장비 한 대 — 「사업장 × 장비」 단위의 뒤 일곱 칸. */
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

/** 사업장 한 줄. */
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
  /** 대리점 이름. 직판이면 'ACCT-K'. */
  agency: string
  /** 화면과 같은 장비 수 — **폐기를 뺀** 수다. */
  deviceCount: number
  openQuotes: number
  totalQuotes: number
  note: string
  contacts: ExportContact[]
  /** 그 사업장의 장비(폐기 포함). 「사업장 × 장비」 단위가 쓴다. */
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

export type ExportInput = {
  sites: ExportSite[]
  companies: ExportCompany[]
  agencies: ExportAgency[]
}

// ── 단위 ───────────────────────────────────────────────────────────────────

/** 내보내기 단위 — 무엇을 한 줄로 볼지. */
export type ExportUnit = 'company' | 'site' | 'device' | 'agency'

export const EXPORT_UNITS: readonly ExportUnit[] = ['company', 'site', 'device', 'agency']

/** 창과 시트 이름과 파일 이름이 같은 글자를 쓴다. */
export const UNIT_LABEL: Record<ExportUnit, string> = {
  company: '회사',
  site: '사업장',
  device: '사업장×장비',
  agency: '대리점',
}

/** 창의 라디오 아래 한 줄 설명 — 어떤 열이 나오는지. */
export const UNIT_DESC: Record<ExportUnit, string> = {
  company: '회사 한 줄 — 회사명·영문명·분류·사업장 수·장비 수',
  site: '사업장 한 줄 — 사업장명·상태·지역·주소·대리점·장비 수',
  device: '장비 한 대가 한 줄 — 라인업·모델·옵션·S/N·납입일·폐기',
  agency: '대리점 한 줄 — 거래 사업장 수·견적',
}

/** 목록 보기의 탭. */
export type ExportTab = 'company' | 'agency' | 'cleanup'

/**
 * 그 탭에서 고를 수 있는 단위.
 *
 * 회사 탭은 회사·사업장·장비 셋, 대리점 탭은 대리점 하나다 — 보고 있지 않은 것을
 * 내보내는 길을 만들지 않는다. 정리 필요 탭은 **사업장 하나**다(그 탭은 회사가 없거나
 * 이름이 비어 손봐야 하는 줄을 모아 보는 자리라, 회사·장비로 묶으면 뜻이 흐려진다).
 */
export function unitsForTab(tab: ExportTab): ExportUnit[] {
  if (tab === 'agency') return ['agency']
  if (tab === 'cleanup') return ['site']
  return ['company', 'site', 'device']
}

/** 그 탭의 기본 단위 — 사업장이 있으면 사업장, 없으면 첫 번째. */
export function defaultUnitForTab(tab: ExportTab): ExportUnit {
  const units = unitsForTab(tab)
  return units.includes('site') ? 'site' : units[0]
}

// ── 머리글 ─────────────────────────────────────────────────────────────────

/** 담당자를 뺀 머리글. 담당자 열은 buildContactHeader 가 뒤에 붙인다. */
export const COMPANY_HEADER = [
  '회사명', '영문명', '분류', '사업장 수', '장비 수',
] as const

export const SITE_HEADER = [
  '회사명', '영문명', '분류', '사업장명', '상태', '지역1', '지역2', '주소', '대리점',
  '장비 수',
] as const

/** 사업장 × 장비 — 앞 아홉은 사업장, 뒤 일곱은 **그 줄의 장비**다(장비가 없으면 빈 칸). */
export const DEVICE_HEADER = [
  '회사명', '영문명', '분류', '사업장명', '상태', '지역1', '지역2', '주소', '대리점',
  '라인업', '모델', '옵션', 'S/N', '소프트웨어', '납입일', '폐기',
] as const

export const AGENCY_HEADER = [
  '대리점명', '영문명', '주소', '거래 사업장 수', '진행 견적', '전체 견적', '메모',
] as const

export const UNIT_HEADER: Record<ExportUnit, readonly string[]> = {
  company: COMPANY_HEADER,
  site: SITE_HEADER,
  device: DEVICE_HEADER,
  agency: AGENCY_HEADER,
}

/** 담당자 열이 붙는 단위 — 회사는 붙지 않는다(사람이 회사 줄에 달리지 않는다). */
export const UNIT_HAS_CONTACTS: Record<ExportUnit, boolean> = {
  company: false, site: true, device: true, agency: true,
}

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

/** 가장 담당자가 많은 줄의 사람 수. 담당자가 하나도 없으면 0(담당자 열이 없다). */
export function maxContactsOf(rows: { contacts: ExportContact[] }[]): number {
  return rows.reduce((n, r) => Math.max(n, r.contacts.length), 0)
}

// ── 칸 값 ──────────────────────────────────────────────────────────────────

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

// ── 줄 수 ──────────────────────────────────────────────────────────────────

/** 「사업장 × 장비」의 줄 수 — 사업장마다 max(장비 수, 1). */
export function siteRowCount(sites: { devices: ExportSiteDevice[] }[]): number {
  return sites.reduce((n, s) => n + Math.max(1, s.devices.length), 0)
}

/**
 * 단위별 줄 수(머리줄 뺀 수). **창의 「예상 N줄」과 파일의 줄 수가 같은 함수를 쓴다** —
 * 두 군데에서 따로 세면 언젠가 어긋난다.
 */
export function rowCountOf(input: ExportInput, unit: ExportUnit): number {
  if (unit === 'company') return input.companies.length
  if (unit === 'agency') return input.agencies.length
  if (unit === 'device') return siteRowCount(input.sites)
  return input.sites.length
}

// ── 시트 ───────────────────────────────────────────────────────────────────

/** 한 시트 = 머리글 한 줄 + 몸통. */
export type Sheet = { name: string; rows: Cellish[][] }

/**
 * 고른 단위의 시트 하나를 만든다. 줄 순서는 **넘겨받은 순서 그대로**다(화면 순서를 지킨다).
 * withContacts 가 false 면 담당자 열을 아예 만들지 않는다.
 */
export function buildCustomerSheet(input: ExportInput, unit: ExportUnit, withContacts = true): Sheet {
  const name = UNIT_LABEL[unit]
  const wantContacts = withContacts && UNIT_HAS_CONTACTS[unit]

  if (unit === 'company') {
    const rows: Cellish[][] = [[...COMPANY_HEADER]]
    for (const c of input.companies) {
      rows.push([c.companyName, c.nameEn, c.industry, c.siteCount, c.deviceCount])
    }
    return { name, rows }
  }

  if (unit === 'agency') {
    const n = wantContacts ? maxContactsOf(input.agencies) : 0
    const rows: Cellish[][] = [[...AGENCY_HEADER, ...buildContactHeader(n)]]
    for (const a of input.agencies) {
      rows.push([
        a.name, a.nameEn, a.address, a.siteCount, a.openQuotes, a.totalQuotes, a.note,
        ...contactCells(a.contacts, n),
      ])
    }
    return { name, rows }
  }

  const n = wantContacts ? maxContactsOf(input.sites) : 0

  if (unit === 'site') {
    const rows: Cellish[][] = [[...SITE_HEADER, ...buildContactHeader(n)]]
    for (const s of input.sites) {
      rows.push([
        s.companyName, s.nameEn, s.industry, s.siteName, s.status, s.region1, s.region2, s.address, s.agency,
        s.deviceCount,
        ...contactCells(s.contacts, n),
      ])
    }
    return { name, rows }
  }

  // 사업장 × 장비 — 장비 세 대면 사업장 정보가 세 줄 반복된다.
  const rows: Cellish[][] = [[...DEVICE_HEADER, ...buildContactHeader(n)]]
  for (const s of input.sites) {
    const head = [s.companyName, s.nameEn, s.industry, s.siteName, s.status, s.region1, s.region2, s.address, s.agency]
    const tail = contactCells(s.contacts, n)
    if (s.devices.length === 0) {
      // 장비가 없는 사업장도 한 줄 남긴다 — 장비 칸만 비운다.
      rows.push([...head, '', '', '', '', '', '', '', ...tail])
      continue
    }
    for (const d of s.devices) {
      rows.push([
        ...head,
        d.lineup, d.model, d.option, d.serial, d.program,
        installCell(d.installYear, d.installDate), dateCell(d.disposedAt),
        ...tail,
      ])
    }
  }
  return { name, rows }
}

/** 파일 이름 — 고객사_{단위}_YYYYMMDD_HHmm.xlsx. 시각은 한국 시각이다. */
export function customerExportFileName(unit: ExportUnit, now: Date = new Date()): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  const stamp = `${kst.getUTCFullYear()}${p(kst.getUTCMonth() + 1)}${p(kst.getUTCDate())}` +
    `_${p(kst.getUTCHours())}${p(kst.getUTCMinutes())}`
  return `고객사_${UNIT_LABEL[unit]}_${stamp}.xlsx`
}

/**
 * 열 폭 — 글자 수로 잰다(한글은 두 칸). 너무 넓어지면 읽기 어려워 40 에서 끊는다.
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
