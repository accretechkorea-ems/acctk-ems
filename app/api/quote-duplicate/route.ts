// 견적 「다시쓰기」 — 기존 견적의 내용을 작성 화면으로 넘겨준다. 원본은 건드리지 않는다.
//
// 서버 라우트로 둔 이유는 권한 때문이다. 화면에서만 막으면 주소창에 ?duplicate=<남의 견적 id>
// 를 넣어 남의 견적 내용을 열어볼 수 있다. 여기서 "본인 견적인가" 를 다시 본다.
//   본인 판정 = (created_by ?? engineer_id) === 호출자   ← 목록의 canRequestDelete 와 같은 기준.
//   대필로 쓴 건은 실적 담당자가 아니라 대필한 사람의 것이다.
//
// 읽기 전용이다. 새 견적은 사용자가 화면에서 「견적 확정」을 눌러야 만들어지고,
// 번호도 그때 기존 규칙(quote_sequence)대로 발급된다.
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function POST(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: caller } = await supabase
    .from('engineers')
    .select('engineer_id')
    .eq('email', user.email!)
    .single()
  if (!caller) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const quoteId = Number(body?.quoteId)
  if (!Number.isInteger(quoteId) || quoteId <= 0) {
    return NextResponse.json({ error: '견적을 지정해주세요.' }, { status: 400 })
  }

  const { data: quote, error } = await supabaseAdmin
    .from('quotes')
    .select('quote_id, quote_number, customer_id, dealer_id, opportunity_id, recipient, delivery_info, note, quote_type, engineer_id, created_by')
    .eq('quote_id', quoteId)
    .maybeSingle()
  if (error) {
    console.error('[quote-duplicate] 조회 실패', { quoteId, error })
    return NextResponse.json({ error: '견적을 불러오지 못했습니다.' }, { status: 500 })
  }
  if (!quote) return NextResponse.json({ error: '견적을 찾을 수 없습니다.' }, { status: 404 })

  // 본인 견적만. 남의 것이면 존재 여부도 알려주지 않도록 같은 문구로 막는다.
  const owner = quote.created_by ?? quote.engineer_id
  if (owner !== caller.engineer_id) {
    console.warn('[quote-duplicate] 남의 견적 접근', { quoteId, by: caller.engineer_id, owner })
    return NextResponse.json({ error: '본인이 작성한 견적만 다시 쓸 수 있습니다.' }, { status: 403 })
  }

  // 품목 — 가격표 품목은 selectedItem 복원을 위해 price_list 전체를 함께 가져온다.
  const { data: items } = await supabaseAdmin
    .from('quote_items')
    .select('item_id, price_list_id, part_code, row_kind, product_name, quantity, unit_price_jpy, unit_price_krw, supply_amount, profit_rate, tariff_rate, price_list(*)')
    .eq('quote_id', quoteId)
    .order('item_id', { ascending: true })

  // 부대비용 — 서비스비 행에 되돌려 붙인다.
  const { data: expenses } = await supabaseAdmin
    .from('quote_expenses')
    .select('item_name, unit_price, headcount, days, amount')
    .eq('quote_id', quoteId)
    .order('expense_id', { ascending: true })

  return NextResponse.json({
    quote: {
      quote_number: quote.quote_number,
      customer_id: quote.customer_id,
      dealer_id: quote.dealer_id,
      opportunity_id: quote.opportunity_id,
      recipient: quote.recipient,
      delivery_info: quote.delivery_info,
      note: quote.note,
      quote_type: quote.quote_type,
    },
    items: items ?? [],
    expenses: expenses ?? [],
  })
}
