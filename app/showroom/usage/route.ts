// 예전 사용 기록 화면 주소(/showroom/usage) — 이제 /showroom 의 「전체기록」 탭이다.
// 페이지는 지웠고 이 경로는 이 핸들러만 받는다. 옛 주소의 조건(?device=&year=&month=&purpose=)을
// 새 탭 주소(devices · from/to · purpose)로 옮겨서 보낸다. 로그인·권한 확인은 /showroom 화면이 한다.
import { NextRequest, NextResponse } from 'next/server'
import { isUsagePurpose, periodRange } from '@/lib/showroom'

export function GET(req: NextRequest) {
  const old = req.nextUrl.searchParams
  const next = new URLSearchParams({ tab: 'usage' })

  const device = Number(old.get('device'))
  if (Number.isInteger(device) && device > 0) next.set('devices', String(device))

  const purpose = old.get('purpose')
  if (isUsagePurpose(purpose)) next.set('purpose', purpose)

  const year = Number(old.get('year'))
  const month = Number(old.get('month'))
  if (Number.isInteger(year) && year >= 2000 && year <= 2100 && Number.isInteger(month) && month >= 1 && month <= 12) {
    const r = periodRange({ mode: 'month', year, month })
    next.set('from', r.from)
    next.set('to', r.to)
  }

  const url = req.nextUrl.clone()
  url.pathname = '/showroom'
  url.search = next.toString()
  // 307 — 브라우저가 이 이동을 영구히 기억하지 않게(나중에 경로를 다시 쓸 수 있도록).
  return NextResponse.redirect(url, 307)
}
