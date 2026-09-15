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

/**
 * 장비 기본 이미지 규칙. 위에서부터 찾아 처음 맞는 규칙의 파일을 쓴다 — 순서가 결과를 바꾸므로
 * 같은 라인업 안에서는 긴(더 구체적인) 모델 문자열을 먼저 둔다.
 *   lineup   — device_name 에 들어 있어야 할 문자열. null 이면 라인업을 보지 않는다.
 *   model    — 모델 칸(device_name2)이 이 문자열로 시작해야 한다(startsWith).
 *              모델 칸이 빈 장비는 option 으로 같은 비교를 한다(아직 모델 칸이 빈 장비가 남아 있다).
 *   anywhere — true 면 라인업 칸·모델 칸 어디에든 들어 있기만 하면 된다
 *              (AXCEL: 「XYZAX AXCEL」처럼 라인업 칸 표기가 여러 가지다).
 * 비교는 모두 소문자·공백 제거 뒤에 한다. 파일은 Supabase Storage device-images 버킷에 있다.
 *
 * 라인업을 보지 않는 숫자 규칙(1800·1600·1400·73 단독)은 두지 않는다 — RONDCOM 에 SURFCOM 사진이,
 * SVA 에 1400 사진이 붙었다. 라인업이 목록에 없는 장비(SVA·RVF 등)는 일부러 맞추지 않는다.
 * 잘못된 사진보다 빈 자리가 낫다. 새 기종은 이 표에 한 줄을 넣고 사진을 버킷에 올리면 된다.
 */
type DefaultImageRule = { lineup: string | null; model: string; file: string; anywhere?: boolean }

const DEFAULT_IMAGE_RULES: DefaultImageRule[] = [
  { lineup: null, model: 'axcel', file: 'default_AXCEL.jpg', anywhere: true },
  { lineup: 'surfcom', model: 'nex040', file: 'default_SNEX040.png' },
  { lineup: 'surfcom', model: 'nex100', file: 'default_SNEX100.png' },
  { lineup: 'surfcom', model: 'nex200', file: 'default_SNEX200.jpg' },
  { lineup: 'surfcom', model: 'nex030', file: 'default_SNEX030.jpg' },
  { lineup: 'surfcom', model: 'nex001', file: 'default_SNEX001.jpg' },
  { lineup: 'surfcom', model: 'touch550', file: 'default_TOUCH550.png' },
  { lineup: 'surfcom', model: 's550', file: 'default_TOUCH550.png' },
  { lineup: 'surfcom', model: '550', file: 'default_TOUCH550.png' },
  { lineup: 'surfcom', model: 'touch50', file: 'default_STOUCH50.jpg' },
  // 공백을 지운 뒤 비교하므로 바로 위 규칙과 결과가 같다(표기 목록을 그대로 남겨 둔다).
  { lineup: 'surfcom', model: 'touch 50', file: 'default_STOUCH50.jpg' },
  { lineup: 'surfcom', model: 's480', file: 'default_S480.png' },
  { lineup: 'surfcom', model: '480', file: 'default_S480.png' },
  { lineup: 'surfcom', model: '1800', file: 'default_S1800.png' },
  { lineup: 'surfcom', model: '1400', file: 'default_S1400.png' },
  { lineup: 'rondcom', model: 'nex200', file: 'default_RNEX200.jpg' },
  { lineup: 'rondcom', model: 'nex300', file: 'default_RNEX300.png' },
  { lineup: 'rondcom', model: '43', file: 'default_R43C.png' },         // 43A 오타도 흡수
  { lineup: 'rondcom', model: '60a', file: 'default_R60A.png' },
  { lineup: 'rondcom', model: '73', file: 'default_R73A.jpg' },
  { lineup: 'contourecord', model: '1600', file: 'default_C1600.png' },
  { lineup: 'countourecord', model: '1600', file: 'default_C1600.png' }, // 라인업 오타 1건
  { lineup: 'contourecord', model: '1800', file: 'default_S1800.png' },
]

/** 비교용 — 소문자로 바꾸고 공백을 모두 지운다. */
const imageKey = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/\s+/g, '')

export function getDefaultImageUrl(device: Device, supabaseUrl: string): string | null {
  const base = `${supabaseUrl}/storage/v1/object/public/device-images`
  const lineup = imageKey(device.device_name)
  // 모델명은 device_name2 에 모여 있다. 모델 칸이 빈 장비만 option 을 모델로 본다.
  // NEX 뒤 숫자 앞에 붙은 글자(NEXRs200 의 Rs 등)는 같은 기종 표기라 지우고 nex200 으로 본다.
  const model = (imageKey(device.device_name2) || imageKey(device.option)).replace(/^nex[a-z]+(?=\d)/, 'nex')

  for (const rule of DEFAULT_IMAGE_RULES) {
    const key = imageKey(rule.model)
    if (rule.anywhere) {
      if (lineup.includes(key) || model.includes(key)) return `${base}/${rule.file}`
      continue
    }
    if (rule.lineup != null && !lineup.includes(imageKey(rule.lineup))) continue
    if (model && model.startsWith(key)) return `${base}/${rule.file}`
  }
  return null
}
