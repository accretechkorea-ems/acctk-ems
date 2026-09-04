// 조사(을/를 · 이/가 · 은/는 · 과/와 · 으로/로)를 앞 단어에 맞춰 고른다.
//
// 화면과 라우트가 「부서을(를) 입력해주세요」 처럼 두 형태를 나란히 쓰고 있었다.
// 파트너사·고객사가 보는 문구라 하나로 정리한다. 라벨마다 손으로 적지 않고 마지막 글자로 판정한다.

/** 받침(종성)이 있는지. 판정할 수 없으면 false — 없는 쪽 형태가 더 무난하게 읽힌다. */
export function hasFinalConsonant(word: string): boolean {
  // 따옴표·괄호·공백처럼 소리 나지 않는 문자는 건너뛰고 실제로 읽는 마지막 글자를 찾는다.
  //   예: "'영업기회 제목'" → '목'
  const trimmed = word.replace(/[\s'"“”‘’`()[\]{}<>.,!?:;·…-]+$/u, '')
  const ch = trimmed.slice(-1)
  if (!ch) return false

  // 한글 음절 — (코드 − 가) % 28 이 0 이면 종성이 없다.
  const code = ch.charCodeAt(0)
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 !== 0

  // 숫자 — 읽는 소리의 끝소리로 본다. 0 영·1 일·3 삼·6 육·7 칠·8 팔 에 받침이 있다.
  if (ch >= '0' && ch <= '9') return '013678'.includes(ch)

  // 로마자 — 글자 이름의 끝소리로 본다. 엘·엠·엔·알 만 받침이 있고 나머지는 모음으로 끝난다.
  //   예: Excel → 엘 → 받침 있음 / company → 와이 → 받침 없음
  if (/[a-z]/i.test(ch)) return 'lmnr'.includes(ch.toLowerCase())

  return false
}

/** 받침이 ㄹ 인지. '으로/로' 만 이 구분이 더 필요하다 — 서울'로', Excel'로' 처럼 ㄹ 뒤에는 '로' 가 붙는다. */
function endsWithRieul(word: string): boolean {
  const trimmed = word.replace(/[\s'"“”‘’`()[\]{}<>.,!?:;·…-]+$/u, '')
  const ch = trimmed.slice(-1)
  if (!ch) return false
  const code = ch.charCodeAt(0)
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 === 8   // 종성 ㄹ
  if (ch >= '0' && ch <= '9') return '178'.includes(ch)                    // 일·칠·팔
  if (/[a-z]/i.test(ch)) return ch.toLowerCase() === 'l'                   // 엘
  return false
}

/** 받침 있을 때 / 없을 때 형태. 키는 받침 있는 쪽이다. */
const PAIRS = {
  '을': ['을', '를'],
  '이': ['이', '가'],
  '은': ['은', '는'],
  '과': ['과', '와'],
  '으로': ['으로', '로'],
} as const

export type JosaForm = keyof typeof PAIRS

/**
 * 앞 단어에 맞는 조사 하나를 돌려준다. 단어와 조사 사이에 따옴표가 끼는 자리에서도 쓸 수 있다.
 *   josa('부서', '을')  → '를'   (부서를 입력해주세요)
 *   josa('이름', '을')  → '을'
 *   `'${title}'${josa(title, '을')}`
 */
export function josa(word: string, form: JosaForm): string {
  const [withFinal, withoutFinal] = PAIRS[form]
  // '으로' 만 예외가 하나 더 있다 — ㄹ 받침 뒤에는 받침이 있어도 '로' 다.
  if (form === '으로' && endsWithRieul(word)) return withoutFinal
  return hasFinalConsonant(word) ? withFinal : withoutFinal
}

/** 단어 + 조사. 사이에 낄 것이 없을 때 쓴다. */
export function withJosa(word: string, form: JosaForm): string {
  return word + josa(word, form)
}
