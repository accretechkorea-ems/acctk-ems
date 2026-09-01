// 대리점 리드 등록 폼(/lead)의 선택지와 입력 제한.
// 화면과 API 라우트가 같은 목록을 보고 검증한다 — 폼을 우회한 임의 값을 서버에서 막기 위해서다.

/** 산업군 — 대분류별 소분류. 소분류가 없는 대분류는 items 가 빈 배열이고 대분류 자체가 값이 된다. */
export const INDUSTRY_GROUPS: { group: string; items: string[] }[] = [
  { group: '1.항공', items: ['민간항공기, 엔진', '군용항공기', '일반항공 부품', '군용항공 부품', '우주선, 미사일', '헬리콥터', '드론', 'MRO (유지보수)', '기타'] },
  { group: '2.농업/건설', items: ['건축기계', '산림기계', '산업기계', '광업기계', '석유가스기계', '트렉터'] },
  { group: '3.자동차', items: ['완성차', '파워트레인', '기어,변속기', '전장', '현가장치', '기타'] },
  { group: '4.차체', items: ['내연기관', '전기/수소차', '외장', '내장', '배터리 트레이'] },
  { group: '5.방산', items: ['군용차', '함정(보트,잠수함)', '총기'] },
  { group: '6.전자', items: ['일반', '반도체', '가전제품', '컴퓨터'] },
  { group: '7.에너지', items: ['일반', '배터리(자동차X)', '수소', '핵에너지', '태양광', '풍력'] },
  { group: '8.기계', items: ['일반기계부품', '베어링', '컴프레서', '가스킷', '기어', '피스톤', '펌프', '터빈/임팰러', '밸브', '플라스틱부품', '기타금속부품'] },
  { group: '9.의료', items: ['의료기기', '임플란트', '기타'] },
  { group: '10.기계/툴', items: ['일반 기계 툴', 'Cast(주조물)', 'Forge(단조)', '스프링', '몰드제조', '지그/픽스처'] },
  { group: '11.전기차', items: ['전기차 제조사', 'E-Motor', '전동부분', '변속기', '배터리셀', '배터리부품'] },
  { group: '12.플라스틱/고무', items: ['일반', '파이프', '펌프', '포장'] },
  { group: '13.기타제조', items: [] },
]

/** 저장·검증에 쓰는 산업군 값 목록. 표기는 '1.항공 - 드론' 처럼 대분류 번호를 포함한다. */
export const INDUSTRIES: string[] = INDUSTRY_GROUPS.flatMap(g =>
  g.items.length ? g.items.map(i => `${g.group} - ${i}`) : [g.group]
)

export const INTEREST_PRODUCTS = [
  '조도측정기', '형상 측정기', '조도형상 측정기', '진원도 측정기',
  '대형 진원도 측정기', '삼차원 측정기', '포터블타입 소형 측정기',
] as const

export const COMPETITORS = ['미츠도요', '마하', '태일러홉슨', '코사카', '기타'] as const

/** 경쟁사에서 이 값을 고르면 직접 입력칸(competitor_other)이 열린다. */
export const COMPETITOR_OTHER = '기타'

export const BUDGET_STATUSES = ['현재 예산 없음', '예산 신청했음', '예산 승인 완료'] as const

export const PURCHASE_PERIODS = ['3개월 이내', '3 - 9 개월 사이', '9개월 이후'] as const

/** 회의록 최소 길이(자). 내용 없는 제출을 막는다. */
export const MEETING_NOTE_MIN = 30

/**
 * 텍스트 칸 최대 길이(자).
 * leads 의 컬럼이 전부 text 라 길이 제한이 없다 — 공개 라우트라 무제한 입력을 그대로 두면
 * 한 번에 수 MB 를 밀어 넣을 수 있으므로 화면과 서버 양쪽에서 같은 값으로 자른다.
 * 이메일 254 는 RFC 5321 의 주소 상한이고, 나머지는 실제 회사명·주소 길이에 여유를 둔 값이다.
 */
export const MAX_LEN = {
  partner_company: 100,
  partner_name: 50,
  partner_contact: 50,
  customer_company: 100,
  products: 200,
  address: 200,
  city: 50,
  country: 50,
  request_note: 2000,
  competitor_other: 100,
  contact_first_name: 50,
  contact_last_name: 50,
  contact_dept: 100,
  contact_title: 100,
  contact_email: 254,
  contact_office_tel: 30,
  contact_mobile: 30,
  meeting_note: 5000,
} as const

export const DEFAULT_COUNTRY = 'South Korea'

/** 봇 판별용 숨김 칸의 이름. 사람 눈에 보이지 않으므로 값이 차 있으면 봇이다. */
export const HONEYPOT_FIELD = 'website'

/** 성공 제출 뒤 이 시간(밀리초) 동안 같은 브라우저에서 다시 보내지 못하게 한다. */
export const RESUBMIT_BLOCK_MS = 60_000

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
