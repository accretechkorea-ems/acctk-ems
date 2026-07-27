import { createClient as createServerClient } from '@/lib/supabase/server'
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
  // 로그인한 사용자만 호출 가능 (외부 무인증 호출로 인한 API 쿼터 남용 방지)
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
      const jpy = json.find((x: { cur_unit: string; deal_bas_r: string }) => x.cur_unit === 'JPY(100)')
      if (jpy && jpy.deal_bas_r) {
        return NextResponse.json({ jpy, date })
      }
    }
    return NextResponse.json({ error: 'no data' }, { status: 500 })
  } catch (e: unknown) {
    console.error('[exchange-rate] 조회 실패', e)
    return NextResponse.json({ error: '환율 조회에 실패했습니다.' }, { status: 500 })
  }
}
