import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { canManageEngineers } from '@/lib/permissions'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: caller } = await supabase
    .from('engineers')
    .select('permission_level')
    .eq('email', user.email!)
    .single()
  if (!caller || !canManageEngineers(caller)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 30)
  const cutoffStr = cutoff.toISOString().split('T')[0]

  const { data: expired } = await supabaseAdmin
    .from('quotes')
    .select('quote_id')
    .eq('status', '견적중')
    .lt('quote_date', cutoffStr)

  if (!expired || expired.length === 0) {
    return NextResponse.json({ updated: 0 })
  }

  await supabaseAdmin
    .from('quotes')
    .update({ status: '실패', fail_reason: '유효기간 만료 (30일)' })
    .in('quote_id', expired.map((q: { quote_id: number }) => q.quote_id))

  return NextResponse.json({ updated: expired.length })
}
