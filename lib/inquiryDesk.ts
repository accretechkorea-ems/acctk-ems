// 의뢰서 접수 창구 안내 데이터. 일본 본사(計測社技術部門) 시트 「依頼書/問い合わせ 受付窓口」(2025.06.01 업데이트)를
// xlsx에서 직접 읽어 옮긴 것이다. 담당자·연락처가 바뀌면 이 파일만 고치고 DESK_AS_OF도 함께 갱신한다.
// 한글 이름 표기는 원본의 로마자 표기를 바탕으로 한 참고용이다.

export const DESK_AS_OF = '2025.06.01'

export type DeskText = { ja: string; ko: string }
export type DeskPerson = { ja: string; ko: string; ext: string; mail: string }
export type DeskProductKey = '83' | '84' | '86'

export type DeskRow = {
  /** 분류 코드(A, B, E1, R1 …). 86 제품과 리플레이스 견적 툴 결과 확인(QC)은 null */
  code: string | null
  /** true면 「리플레이스 견적 툴 결과 확인」 항목(메일 제목 형식이 다르다) */
  qc?: boolean
  ja: string
  ko: string
  people: DeskPerson[]
  /** 회신 리드타임. 원본에서 그룹 맨 위에 적혀 있어 아래 항목들에 적용되는 것으로 읽었다 */
  lead?: DeskText
}

export type DeskProduct = {
  key: DeskProductKey
  ja: string
  ko: string
  /** 접수 메일링 리스트. 86 제품은 없다(null) */
  listMail: string | null
  listNote?: DeskText
  owners: { label?: DeskText; person: DeskPerson }[]
  rows: DeskRow[]
}

const P = {
  kawakami: { ja: '川上', ko: '가와카미', ext: '3154', mail: 't.kawakami@accretech.com' },
  masuta: { ja: '増田GL', ko: '마스타 GL', ext: '3082', mail: 'masutah@accretech.com' },
  yamauchi: { ja: '山内', ko: '야마우치', ext: '3041', mail: 'yamauchiy@accretech.com' },
  nakagawa: { ja: '中川', ko: '나카가와', ext: '3234', mail: 'kazunori.nakagawa@accretech.com' },
  yamaguchiKazuya: { ja: '山口 和也', ko: '야마구치 가즈야', ext: '3102', mail: 'yamaguchik@accretech.com' },
  yamaguchiKazuma: { ja: '山口 和真', ko: '야마구치 가즈마', ext: '3280', mail: 'kazuma.yamaguchi@accretech.com' },
  katamachi: { ja: '片町', ko: '가타마치', ext: '3157', mail: 's.katamachi@accretech.com' },
  kokubun: { ja: '國分', ko: '고쿠분', ext: '3515', mail: 'yamato.kokubun@accretech.com' },
  homma: { ja: '本間（慎）', ko: '혼마(신페이)', ext: '3279', mail: 'honmas@accretech.com' },
  inoue: { ja: '井上', ko: '이노우에', ext: '3294', mail: 'naoya.inoue@accretech.com' },
  uemura: { ja: '上村', ko: '우에무라', ext: '3213', mail: 'uemurah@accretech.com' },
  kuwahara: { ja: '桑原', ko: '구와하라', ext: '3248', mail: 'kuwaharak@accretech.com' },
  ueno: { ja: '上野（航）', ko: '우에노(와타루)', ext: '3277', mail: 'uenow@accretech.com' },
  kamiya: { ja: '紙谷', ko: '가미야', ext: '3263', mail: 'kamiyah@accretech.com' },
  sekimoto: { ja: '関本', ko: '세키모토', ext: '3132', mail: 'sekimotom@accretech.com' },
  murata: { ja: '村田', ko: '무라타', ext: '3245', mail: 'muratar@accretech.com' },
} satisfies Record<string, DeskPerson>

const LEAD_2W_PLUS: DeskText = { ja: '返信までのリードタイム：2週間以上', ko: '회신까지 리드타임: 2주 이상' }
const LEAD_4W: DeskText = { ja: '返信までの標準リードタイム：4週間', ko: '회신까지 표준 리드타임: 4주' }
const LEAD_2W: DeskText = { ja: '返信までの標準リードタイム：2週間', ko: '회신까지 표준 리드타임: 2주' }

export const DESK_PRODUCTS: DeskProduct[] = [
  {
    key: '83',
    ja: '83製品（Surfcom）',
    ko: '83 제품 (Surfcom)',
    listMail: 'sfg_83request@accretech.com',
    listNote: {
      ja: '※但し、83製品メーリングリストには管理職は含まれていません。',
      ko: '※단, 83 제품 메일링 리스트에는 관리직이 포함되어 있지 않습니다.',
    },
    owners: [
      { label: { ja: '83製品', ko: '83 제품' }, person: P.kawakami },
      { label: { ja: '製品全般', ko: '제품 전반' }, person: P.masuta },
    ],
    rows: [
      { code: 'A', ja: 'ソフト', ko: '소프트웨어', people: [P.nakagawa] },
      { code: 'B', ja: '測定機特殊', ko: '측정기 특수', people: [P.yamaguchiKazuya, P.katamachi], lead: LEAD_2W_PLUS },
      { code: 'C', ja: '測定機アタッチメント（治具）', ko: '측정기 어태치먼트(지그)', people: [P.yamaguchiKazuma, P.katamachi], lead: LEAD_2W_PLUS },
      { code: 'D', ja: '測定子（触針、アーム）・検出器', ko: '측정자(촉침·암)·검출기', people: [P.yamaguchiKazuma, P.kokubun], lead: LEAD_2W_PLUS },
      { code: 'E1', ja: 'リプレース・バージョンアップ', ko: '리플레이스·버전업', people: [P.homma], lead: LEAD_4W },
      { code: 'E2', ja: '保守・修理部品', ko: '보수·수리 부품', people: [P.inoue], lead: LEAD_4W },
      { code: 'F', ja: '仕様書・技術資料（精度・設置環境・振動解析など）', ko: '사양서·기술 자료(정밀도·설치 환경·진동 해석 등)', people: [P.yamaguchiKazuma, P.kokubun], lead: LEAD_4W },
      { code: 'G', ja: '取扱説明書', ko: '취급 설명서', people: [P.homma], lead: LEAD_4W },
      { code: 'K', ja: '国内インチ表示対応・校正業務費用', ko: '국내 인치 표시 대응·교정 업무 비용', people: [P.yamaguchiKazuya], lead: LEAD_4W },
      { code: null, qc: true, ja: 'リプレース見積ツール結果確認', ko: '리플레이스 견적 툴 결과 확인', people: [P.homma], lead: LEAD_2W },
      { code: 'L', ja: '輸送・運送・現地作業費（リスト外）', ko: '수송·운송·현장 작업비(리스트 외)', people: [P.yamaguchiKazuya], lead: LEAD_2W },
      { code: 'M', ja: '特別決裁価格確認', ko: '특별 결재 가격 확인', people: [P.yamaguchiKazuma], lead: LEAD_2W },
    ],
  },
  {
    key: '84',
    ja: '84製品（Rondcom）',
    ko: '84 제품 (Rondcom)',
    listMail: 'sfg_84request@accretech.com',
    listNote: {
      ja: '※但し、84製品メーリングリストには管理職は含まれていません。',
      ko: '※단, 84 제품 메일링 리스트에는 관리직이 포함되어 있지 않습니다.',
    },
    owners: [{ person: P.yamauchi }],
    rows: [
      { code: 'R1', ja: 'リプレース', ko: '리플레이스', people: [P.ueno] },
      { code: 'R2', ja: 'メカ', ko: '메카(기구 관련)', people: [P.kamiya] },
      { code: 'R3', ja: '電気', ko: '전기 관련', people: [P.sekimoto] },
      { code: 'R4', ja: 'ソフト', ko: '소프트웨어', people: [P.murata] },
      { code: null, qc: true, ja: 'リプレース見積ツール結果確認', ko: '리플레이스 견적 툴 결과 확인', people: [P.ueno] },
    ],
  },
  {
    key: '86',
    ja: '86製品',
    ko: '86 제품',
    listMail: null,
    owners: [{ person: P.kawakami }],
    rows: [
      { code: null, ja: 'メカ', ko: '메카(기구 관련)', people: [P.uemura] },
      { code: null, ja: 'アプリ', ko: '애플리케이션', people: [P.kuwahara] },
    ],
  },
]

export const DESK_TEXT = {
  title: { ja: '計測社技術部門 依頼書／問い合わせ 受付窓口', ko: '계측사 기술부문 의뢰서/문의 접수 창구' },
  sub: { ja: '技術SFG（83／84／86製品）', ko: '기술 SFG (83/84/86 제품)' },
  subjectNote: {
    ja: '【注意点】メールの件名の『依頼書No』と『客先名』は詳細に書き換えて下さい。',
    ko: '【주의】메일 제목의 『依頼書No(의뢰서 번호)』와 『客先名(고객사명)』 부분은 실제 내용으로 구체적으로 바꿔 적어 주세요.',
  },
  subjectRule: {
    ja: 'メールの件名は以下のように指定してください。（以下の件名以外は、受け付けておりませんのでご注意ください。）',
    ko: '메일 제목은 아래 형식으로 지정해 주세요. (아래 제목 이외에는 접수되지 않으니 주의해 주세요.)',
  },
  subjectExample: { ja: '例：ソフト（A）を選択した場合', ko: '예: 소프트웨어(A)를 선택한 경우' },
  listIntro: {
    ja: 'メールの宛先を自身で入力する場合は、以下宛先にお願いします。',
    ko: '메일 수신처를 직접 입력할 때는 아래 주소로 보내 주세요.',
  },
  listOnly: {
    ja: 'このメーリングリストは依頼書提出専用となっております。個別の質問については、各担当者へ直接連絡をお願いいたします。',
    ko: '이 메일링 리스트는 의뢰서 제출 전용입니다. 개별 질문은 각 담당자에게 직접 연락해 주세요.',
  },
  owner: { ja: '責任者', ko: '책임자' },
}

// 메일 제목 형식 (원본 규칙: 【依頼書_分類】依頼書No_客先名 / QC: 【リプレース見積確認_83】依頼書番号-QC_客先名)
// TODO(본사 확인): 원본의 규칙 문구는 「リプレース見積確認」인데 시트의 메일 링크는 「リプレース見積ツール結果確認」로 되어 있어 서로 다르다.
// 본사에 확인해 맞는 쪽으로 이 상수 한 곳만 고친다.
export const QC_SUBJECT_NAME = 'リプレース見積確認'
export const SUBJECT_86 = '【依頼書】依頼書No_客先名'
export const SUBJECT_EXAMPLE = '【依頼書_A】A00****_(株)****'
export const SUBJECT_FORMATS: { subject: string; ko: string }[] = [
  { subject: '【依頼書_分類】依頼書No_客先名', ko: '일반 의뢰서 (분류 = 분류 코드, 예: A, E1, R1)' },
  { subject: `【${QC_SUBJECT_NAME}_83】依頼書番号-QC_客先名`, ko: '83 제품 리플레이스 견적 툴 결과 확인' },
  { subject: `【${QC_SUBJECT_NAME}_84】依頼書番号-QC_客先名`, ko: '84 제품 리플레이스 견적 툴 결과 확인' },
]

export function deskSubject(product: DeskProductKey, row: DeskRow): string {
  if (row.qc) return `【${QC_SUBJECT_NAME}_${product}】依頼書番号-QC_客先名`
  if (product === '86') return SUBJECT_86
  return `【依頼書_${row.code}】依頼書No_客先名`
}

/** 83·84는 접수 메일링 리스트로, 86은 담당자에게 직접(책임자 CC). 원본 시트의 메일 링크와 같은 동작이다. */
export function deskMailto(p: DeskProduct, row: DeskRow): string {
  const subject = encodeURIComponent(deskSubject(p.key, row))
  if (p.listMail) return `mailto:${p.listMail}?subject=${subject}`
  return `mailto:${row.people[0].mail}?cc=${p.owners[0].person.mail}&subject=${subject}`
}
