import { NextRequest, NextResponse } from 'next/server'
import { loadCaller } from '@/lib/apiCaller'

export async function POST(req: NextRequest) {
  // 인증·권한 — 관리자 전용이다(종전 canManageEngineers = superadmin 과 같은 문턱).
  const { error: authErr, sb } = await loadCaller({ kind: 'superadmin' }, { tag: 'delete-quote-pdf', req })
  if (authErr) return authErr

  const body = await req.json()
  const { filePath } = body
  if (!filePath?.trim()) return NextResponse.json({ error: 'filePath required' }, { status: 400 })

  // 경로 순회 공격 방지: 파일명만 허용 (폴더 구분자 금지)
  const safePath = filePath.trim().replace(/\.\./g, '').replace(/^\/+/, '')
  if (!safePath || safePath.includes('/')) {
    return NextResponse.json({ error: 'Invalid file path' }, { status: 400 })
  }

  // DB에서 해당 파일이 실제 견적서 PDF인지 확인
  const { count } = await sb
    .from('quotes')
    .select('quote_id', { count: 'exact', head: true })
    .eq('pdf_url', `quote-pdfs/${safePath}`)
  if (!count || count === 0) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 })
  }

  const { error } = await sb.storage.from('quote-pdfs').remove([safePath])
  if (error) {
    console.error('[delete-quote-pdf] 삭제 실패', error)
    return NextResponse.json({ error: '파일 삭제에 실패했습니다.' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
