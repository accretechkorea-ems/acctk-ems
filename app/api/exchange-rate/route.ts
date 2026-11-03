import { loadCaller } from '@/lib/apiCaller'
import { RATE_SOURCE } from '@/lib/exchangeRate'
import { CURRENCIES, findEximRow, ratesFromExim, type Currency } from '@/lib/quoteCurrency'
import { NextResponse } from 'next/server'
import https from 'https'

// 한국수출입은행 API는 공공기관 CA(정부 인증서)를 사용하며 Node 기본 CA 번들에 없음.
// 이 요청에 한해 TLS 검증을 우회한다. 대상 호스트는 oapi.koreaexim.go.kr 로 고정되어 있고
// 수신 데이터는 공개 환율 숫자뿐이다. (완전 제거하려면 정부 CA 인증서를 ca 옵션으로 주입 필요)
function httpsGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { rejectUnauthorized: false, timeout: 10000 }, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => resolve(data))
    })
    req.on('timeout', () => { req.destroy(new Error('exchange-rate request timeout')) })
    req.on('error', reject)
  })
}

export async function GET() {
  // 로그인한 사용자만 호출 가능 (외부 무인증 호출로 인한 API 쿼터 남용 방지).
  // 읽기(GET)라 토큰을 그 자리에서 검증한다 — 환율 API 왕복에 Auth 왕복을 얹을 이유가 없다.
  const { error: authErr } = await loadCaller({ kind: 'login' }, { tag: 'exchange-rate', method: 'GET', readOnly: true })
  if (authErr) return authErr

  const authKey = process.env.KOREA_EXIM_API_KEY
  if (!authKey) {
    return NextResponse.json({ error: 'API key not configured' }, { status: 500 })
  }

  try {
    const today = new Date()
    // 공휴일·주말 연속 최대 7일까지 소급 조회
    for (let i = 0; i < 7; i++) {
      const d = new Date(today)
      d.setDate(today.getDate() - i)
      const date = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`

      const text = await httpsGet(
        `https://oapi.koreaexim.go.kr/site/program/financial/exchangeJSON?authkey=${authKey}&searchdate=${date}&data=AP01`
      )
      const json = JSON.parse(text)
      if (!Array.isArray(json) || json.length === 0) continue

      // **한 번의 호출에서 통화 둘을 집는다** — 같은 응답에 23종이 들어 있다(2026-11-03 실측).
      // 엔은 100단위라 100으로 나눈다(lib/quoteCurrency.ts 의 rateFromExim).
      const rates = ratesFromExim(json)
      // 엔을 못 읽은 날짜는 **쓰지 않는다** — 종전 동작과 같다(다음 날짜로 넘어간다).
      // 달러만 없는 날은 엔으로 진행한다(화면의 달러 환율은 사람이 정한 값으로 시작한다).
      if (rates.JPY === undefined) continue

      const byCurrency: Partial<Record<Currency, { rate: number; date: string }>> = {}
      for (const cur of CURRENCIES) {
        const rate = rates[cur]
        if (rate !== undefined) byCurrency[cur] = { rate, date }
      }

      // source — 화면이 「어디서 온 값인가」를 그대로 적는다. 이름은 lib/exchangeRate.ts
      // 한 곳에 있다(저장된 값을 보여 줄 때도 같은 글자를 쓴다).
      // date 는 **그 기관의 기준일**로, 주말·공휴일이면 소급 조회한 날짜라 오늘이 아니다.
      //
      // jpy·date 는 **옛 모양 그대로 함께 보낸다** — 이 라우트를 부르는 자리가 더 있을 때
      // 한꺼번에 깨지지 않게 둔다(화면은 아래 JPY·USD 를 읽는다).
      return NextResponse.json({
        JPY: byCurrency.JPY ?? null,
        USD: byCurrency.USD ?? null,
        source: RATE_SOURCE,
        date,
        jpy: findEximRow(json, 'JPY'),
      })
    }
    return NextResponse.json({ error: 'no data' }, { status: 500 })
  } catch (e: unknown) {
    console.error('[exchange-rate] 조회 실패', e)
    return NextResponse.json({ error: '환율 조회에 실패했습니다.' }, { status: 500 })
  }
}
