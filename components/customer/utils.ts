import type { Device, Quote } from './types'

// 이 업체 기준으로 견적이 직판인지 대리점 경유인지 가른다.
// 상세의 quotes 조회가 customer_id 와 dealer_id 를 함께 걸어오므로 두 종류가 섞여 있다.
// 두 컬럼이 모두 이 업체를 가리키는 경우는 없어야 하지만, 있으면 직판으로 본다.
export function isDealerQuote(q: Quote, customerId: number): boolean {
  if (q.customer_id === customerId) return false
  return q.dealer_id === customerId
}

export function countQuoteChannels(quotes: Quote[], customerId: number) {
  let direct = 0
  let dealer = 0
  let both = 0
  for (const q of quotes) {
    if (q.customer_id === customerId && q.dealer_id === customerId) both++
    if (isDealerQuote(q, customerId)) dealer++
    else direct++
  }
  return { direct, dealer, both, total: quotes.length }
}

export function getInstallDisplay(device: Device): string {
  const rawYear = device.install_year?.toString().trim() || ''
  const rawDate = device.install_date?.toString().trim() || ''
  if (!rawDate && !rawYear) return '-'
  if (rawYear && rawDate) {
    if (rawDate.startsWith(rawYear)) return rawDate
    return `${rawYear} - ${rawDate}`
  }
  if (rawDate) return rawDate
  return rawYear
}

export function getDefaultImageUrl(device: Device, supabaseUrl: string): string | null {
  const base = `${supabaseUrl}/storage/v1/object/public/device-images`
  const lineup = (device.device_name ?? '').toLowerCase()
  const combined = `${device.device_name2 ?? ''} ${device.option ?? ''}`.toLowerCase()
  const isSurfcom = lineup.includes('surfcom')
  const allText = `${lineup} ${combined}` // 라인업+모델+옵션 전체

  // AXCEL — 이름 어디에든 AXCEL이 포함되면 매칭
  if (allText.includes('axcel')) return `${base}/default_AXCEL.jpg`

  // SURFCOM 전용 (라인업 + 모델 동시 매칭) — RONDCOM 등 동일 모델번호와 구분
  if (isSurfcom && combined.includes('nex200')) return `${base}/default_SNEX200.jpg`
  if (isSurfcom && combined.includes('nex030')) return `${base}/default_SNEX030.jpg`
  if (isSurfcom && combined.includes('nex001')) return `${base}/default_SNEX001.jpg`
  if (isSurfcom && combined.includes('touch') && combined.includes('50')) return `${base}/default_STOUCH50.jpg`

  if (combined.includes('nex200')) return `${base}/default_RNEX200.jpg`
  if (combined.includes('1800')) return `${base}/default_S1800.png`
  if (combined.includes('1600')) return `${base}/default_C1600.png`
  if (combined.includes('1400')) return `${base}/default_S1400.png`
  if (combined.includes('73')) return `${base}/default_R73A.jpg`
  return null
}
