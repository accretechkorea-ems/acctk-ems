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
  // 성·이름을 한 칸으로 받아 leads.contact_name 에 그대로 저장한다.
  contact_name: 100,
  contact_dept: 100,
  contact_title: 100,
  contact_email: 254,
  contact_office_tel: 30,
  contact_mobile: 30,
  meeting_note: 5000,
  // 미진행 사유 — 한두 문장이면 충분하다.
  skip_reason: 500,
} as const

/**
 * 오류 문구에 쓰는 항목 이름. 폼 라벨과 같은 말을 쓴다 —
 * 파트너사가 보는 문구에 DB 컬럼명(contact_email 등)이 나가면 무슨 칸인지 알 수 없다.
 *
 * MAX_LEN 과 같은 키를 갖도록 타입으로 묶어 둔다. 길이 제한을 새로 추가하면서
 * 이름을 빠뜨리면 타입 검사에서 걸린다(라벨이 두 벌로 갈리지 않게 하는 장치다).
 *
 * 같은 '회사명' 이 파트너사·고객사 두 곳에 있어 그 둘만 앞에 소속을 붙인다.
 */
export const FIELD_LABELS: Record<keyof typeof MAX_LEN, string> = {
  partner_company: '파트너사 회사명',
  partner_name: '등록자 성함',
  partner_contact: '연락처',
  customer_company: '고객사 회사명',
  products: '생산품',
  address: '주소',
  city: '시',
  country: '국가',
  request_note: '요청사항',
  competitor_other: '경쟁사',
  contact_name: '이름',
  contact_dept: '부서',
  contact_title: '직위',
  contact_email: '이메일',
  contact_office_tel: '회사번호',
  contact_mobile: '휴대폰 번호',
  meeting_note: '회의록',
  skip_reason: '미진행 사유',
}

/**
 * 명함 이미지 — 화면에서 canvas 로 줄인 뒤 data URL 로 보낸다.
 *
 * 상한을 2MB 로 잡은 근거:
 *   · 6MB 짜리 폰 사진을 줄이면 실측 830KB 였다. 2MB 는 그 두 배가 넘는 여유다.
 *   · base64 는 원본의 4/3 로 부풀어, 2MB 이미지가 2.7MB 본문이 된다. 이 서비스는 본문이
 *     약 4MB 를 넘으면 라우트에 닿기도 전에 플랫폼이 500 으로 끊는다(실측). 그 아래에 두어야
 *     "이미지가 너무 큽니다" 라는 우리 문구가 사용자에게 보인다.
 * 화면과 서버가 같은 값을 본다 — 화면은 줄인 결과가 이 값을 넘으면 아예 보내지 않는다.
 */
export const CARD_MAX_EDGE = 1600
export const CARD_JPEG_QUALITY = 0.8
export const CARD_MAX_BYTES = 2 * 1024 * 1024
/** 스토리지 버킷 이름. 업로드(서버)와 서명 URL 발급(서버)이 같은 값을 본다. */
export const CARD_BUCKET = 'lead-cards'

/**
 * 리드 처리 상태. leads.status 의 기본값이 '신규' 다.
 * 리드는 영업기회로 전환할지 판단하는 대상이라 중간 상태를 두지 않는다.
 *   신규     — 등록되면 자동
 *   진행중   — 담당자가 배정되면 자동(배정을 풀면 신규로 돌아간다)
 *   전환완료 — 영업기회로 전환되면 자동. 종결
 *   미진행   — 담당자가 사유를 적어 종결. 되돌릴 수 없다
 * 손으로 고를 수 있는 것은 미진행 하나뿐이라 상태 드롭다운이 없다.
 */
export const LEAD_STATUSES = ['신규', '진행중', '전환완료', '미진행'] as const

/** 전환 시 남기는 영업활동의 유형. SalesActivityModal 의 ACTIVITY_TYPES 에 있는 값이어야 한다.
 *  파트너사가 현장에서 만나 적어 온 기록이라 '방문미팅' 으로 남긴다.
 *  (그 상수는 'use client' 모듈에 있어 API 라우트에서 import 할 수 없으므로 여기에 둔다) */
export const LEAD_CONVERT_ACTIVITY_TYPE = '방문미팅'

export const LEAD_STATUS_NEW = '신규'
export const LEAD_STATUS_ACTIVE = '진행중'
export const LEAD_STATUS_CONVERTED = '전환완료'
export const LEAD_STATUS_SKIPPED = '미진행'

/** 종결된 리드 — 배정을 바꿔도 상태를 건드리지 않고, 전환·미진행 버튼도 잠근다. */
export const isLeadClosed = (status: string | null | undefined) =>
  status === LEAD_STATUS_CONVERTED || status === LEAD_STATUS_SKIPPED

/**
 * 미진행 사유 최소 길이(자).
 * 회의록(30자)처럼 길게 요구하면 형식적으로 채우게 된다. '예산 부족'·'경쟁사 확정' 같은
 * 짧고 분명한 사유는 통과시키되 한두 글자로 때우는 것은 막는 선에서 5자로 둔다.
 */
export const SKIP_REASON_MIN = 5

/** 리드 번호 접두 — 'LD-26-' 처럼 연도 뒤 2자리까지 붙는다. */
export const LEAD_NO_PREFIX = 'LD'

/**
 * 알림 문구 앞에 붙이는 리드 번호 표시.
 * 번호가 없는 리드(발급 실패)는 대괄호째 빼서 문장이 어색해지지 않게 한다.
 *   있음: '[LD-26-001] 신규 리드가 등록되었습니다.'
 *   없음: '신규 리드가 등록되었습니다.'
 */
export const leadNoTag = (leadNo: string | null | undefined) => (leadNo ? `[${leadNo}] ` : '')

export const DEFAULT_COUNTRY = 'South Korea'

/** 봇 판별용 숨김 칸의 이름. 사람 눈에 보이지 않으므로 값이 차 있으면 봇이다. */
export const HONEYPOT_FIELD = 'website'

/**
 * 성공 제출 뒤 이 시간(밀리초) 동안 같은 브라우저에서 다시 보내지 못하게 한다.
 * 완료 화면의 '추가 등록하기' 로 연달아 등록하는 흐름을 막지 않을 만큼만 둔다(예외 없이 모든 제출에 적용).
 */
export const RESUBMIT_BLOCK_MS = 10_000

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
