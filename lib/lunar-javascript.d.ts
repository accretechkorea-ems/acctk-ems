// lunar-javascript(6tail) 는 타입 선언을 싣지 않는다(package.json 에 types 없음, .d.ts 없음).
// strict 설정에서 그대로 import 하면 TS7016 이 나므로, lib/holidays.ts 가 쓰는 부분만 적는다.
// 쓰는 API 가 늘면 여기에 함께 추가한다.
declare module 'lunar-javascript' {
  export class Solar {
    /** 2000-01-01 12:00 의 율리우스일(2451545). */
    static J2000: number
    static fromYmd(year: number, month: number, day: number): Solar
    static fromJulianDay(jd: number): Solar
    /** 그날 0시의 율리우스일(…x.5). */
    getJulianDay(): number
    /** 'YYYY-MM-DD' */
    toYmd(): string
  }

  export class Lunar {
    /** 음력 연·월·일. 윤달은 월을 음수로 준다. */
    static fromYmd(year: number, month: number, day: number): Lunar
    getSolar(): Solar
  }

  /** 수성(寿星) 천문 계산. 시각은 J2000 기준 일수이며 중국 표준시(+8h)가 더해져 있다. */
  export const ShouXingUtil: {
    PI_2: number
    /** 1/3 일 = 8시간 — 중국 표준시 보정값. */
    ONE_THIRD: number
    SECOND_PER_DAY: number
    /** 합삭 시각(고정밀). w = 합삭 번호 × 2π */
    shuoHigh(w: number): number
    /** 달·해 황경차가 w 가 되는 시각(정밀) — 율리우스 세기 단위 */
    msaLonT(w: number): number
    /** 같은 값의 빠른 근사 — 율리우스 세기 단위 */
    msaLonT2(w: number): number
    /** ΔT(지구시 − 세계시), 일 단위 */
    dtT(t: number): number
  }
}
