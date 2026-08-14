// 견적서 표기 헬퍼.
// 주의: 다른 화면(components/customer/constants.ts 등)의 numKR 은 Math.round 가 있어
//       구현이 다르다. 출력이 달라지므로 통합하지 않고 견적서 전용으로 둔다.

export const numKR = (n: number) => n.toLocaleString('ko-KR')

export function amountToKorean(n: number): string {
  if (n === 0) return '영원 정'
  const units = ['', '만', '억', '조']
  const nums = ['영', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구']
  let result = '', unitIdx = 0, num = n
  while (num > 0) {
    const chunk = num % 10000
    if (chunk > 0) {
      let s = ''
      const t = Math.floor(chunk / 1000), h = Math.floor((chunk % 1000) / 100)
      const te = Math.floor((chunk % 100) / 10), o = chunk % 10
      if (t > 0) s += (t > 1 ? nums[t] : '') + '천'
      if (h > 0) s += (h > 1 ? nums[h] : '') + '백'
      if (te > 0) s += (te > 1 ? nums[te] : '') + '십'
      if (o > 0) s += nums[o]
      result = s + units[unitIdx] + result
    }
    num = Math.floor(num / 10000); unitIdx++
  }
  return result + '원 정'
}
