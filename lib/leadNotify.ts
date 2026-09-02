// 리드 알림 공용 — 등록·배정·보류 세 라우트가 함께 쓴다.
//
// 알림은 어디까지나 부가 작업이다. 실패해도 원래 동작(등록·배정·상태 변경)을 되돌리지 않고
// console.error 만 남긴다. 그래서 이 모듈의 함수는 예외를 밖으로 던지지 않는다.
import { createClient } from '@supabase/supabase-js'
import { isSuperAdmin } from '@/lib/permissions'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/** 알림에서 리드를 여는 주소. 목록이 이 값을 보고 해당 건을 펼친다. */
export const leadLink = (leadId: number) => `/leads?lead=${leadId}`

/** 리드 관리자 = 재직 중인 superadmin. 등록·보류 알림을 받는다. */
export async function adminEngineerIds(): Promise<number[]> {
  const { data, error } = await supabaseAdmin
    .from('engineers')
    .select('engineer_id, permission_level, resigned_date')
    .is('resigned_date', null)
  if (error) {
    console.error('[leadNotify] 관리자 조회 실패', error)
    return []
  }
  type Row = { engineer_id: number; permission_level: string | null; resigned_date: string | null }
  return ((data ?? []) as Row[]).filter(e => isSuperAdmin(e)).map(e => e.engineer_id)
}

/** 알림을 만든다. 대상이 없거나 실패해도 조용히 넘어간다(로그만 남긴다). */
export async function notifyLead(args: {
  engineerIds: number[]
  title: string
  message: string
  type: string
  leadId: number
}): Promise<void> {
  const { engineerIds, title, message, type, leadId } = args
  if (!engineerIds.length) {
    console.error('[leadNotify] 알림 대상이 없습니다', { type, leadId })
    return
  }
  const { error } = await supabaseAdmin.from('notifications').insert(
    engineerIds.map(engineer_id => ({
      engineer_id,
      title,
      message,
      type,
      link: leadLink(leadId),
      is_read: false,
    }))
  )
  if (error) console.error('[leadNotify] 알림 생성 실패', { type, leadId, error })
}
