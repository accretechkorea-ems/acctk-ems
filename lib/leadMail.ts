// 신규 리드 등록 메일. 공개 폼(/api/lead)이 리드를 저장한 뒤 관리자에게 보낸다.
//
// 왜 resend 패키지 대신 fetch 인가 —
//   Resend 의 전송은 https://api.resend.com/emails 로 JSON 한 번 POST 하는 것이 전부다.
//   패키지는 그 위의 얇은 래퍼라, 새 의존성(버전 관리·보안 감사·번들)을 들일 만큼의 이득이 없다.
//   이 저장소는 이미 외부 API(한국수출입은행 환율)를 fetch 로 직접 부르고 있어 방식도 일관된다.
//
// 왜 HTML 과 평문을 함께 보내는가 —
//   회의록이 길고 줄바꿈이 살아야 읽히므로 HTML 이 유리하다. 다만 HTML 만 있는 메일은
//   스팸 필터가 감점하는 항목이라(SpamAssassin MIME_HTML_ONLY), 같은 내용을 평문으로도 담는다.
//   메일 클라이언트가 알아서 읽을 수 있는 쪽을 고른다.
//
// 이 모듈의 함수는 예외를 밖으로 던지지 않는다 — 메일은 부가 작업이고, 실패해도 리드 등록은
// 성공으로 끝나야 한다. 실패는 console.error 로만 남긴다.

import { createClient } from '@supabase/supabase-js'
import { isSuperAdmin } from '@/lib/permissions'
import { leadLink } from '@/lib/leadNotify'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const FROM = '아크레텍코리아 EMS <acctk-ems@accretechkorea.com>'
const RESEND_ENDPOINT = 'https://api.resend.com/emails'

/**
 * ⚠️ 테스트용. 검증이 끝나면 이 배열을 비우고 이 주석과 함께 제거할 것. ⚠️
 *
 * 여기에 적은 주소는 수신자에서 빠진다. 시험 발송이 실제 담당자에게 가지 않게 하려는 임시 조치다.
 * 소문자로 적는다(비교할 때 양쪽을 소문자로 맞춘다).
 *
 * 예) ['someone@accretechkorea.com']
 */
const TEST_EXCLUDED_EMAILS: string[] = []

/**
 * 회의록을 메일에 넣을 최대 길이(자). 넘으면 잘라내고 안내를 붙인다.
 * 입력 상한은 5,000자지만 메일에 그대로 실으면 읽기 어렵고 클라이언트가 접어 버린다.
 */
const NOTE_MAX = 1500

/** 메일에 실을 리드 값. leads 의 컬럼 이름을 그대로 쓴다. */
export type LeadMailData = {
  lead_id: number
  lead_no: string | null
  partner_company: string | null
  partner_name: string | null
  partner_contact: string | null
  customer_company: string | null
  industry: string | null
  interest_product: string | null
  budget_status: string | null
  purchase_period: string | null
  expected_purchase: string | null
  contact_name: string | null
  contact_dept: string | null
  contact_title: string | null
  contact_mobile: string | null
  contact_office_tel: string | null
  contact_email: string | null
  meeting_note: string | null
}

/**
 * 메일 안의 링크가 가리킬 절대 주소.
 *
 * 요청 헤더(origin·host)를 쓰지 않는 이유 — 공개 폼은 어디서든 열릴 수 있고 헤더는 위조된다.
 * 로컬에서 시험 발송하면 링크가 localhost 로 박혀 남에게 보내면 열리지 않는다.
 * 하드코딩하지 않는 이유 — 도메인이 바뀌면 코드를 고쳐야 한다.
 * 그래서 환경변수를 우선하고, Vercel 이 자동으로 넣어 주는 배포 주소를 그다음으로 본다.
 */
export function siteUrl(): string {
  const explicit = process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL
  if (explicit) return explicit.replace(/\/+$/, '')
  // Vercel 은 스킴 없이 넣어 준다. 프리뷰 배포마다 값이 달라지므로 SITE_URL 이 있으면 그쪽이 이긴다.
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return 'http://localhost:3000'
}

/** 리드 관리자 이메일 — 종 알림과 같은 판정(재직 중인 superadmin)을 쓴다. */
export async function adminEmails(): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from('engineers')
    .select('email, permission_level, resigned_date')
    .is('resigned_date', null)
  if (error) {
    console.error('[leadMail] 관리자 조회 실패', error)
    return []
  }
  type Row = { email: string | null; permission_level: string | null; resigned_date: string | null }
  const excluded = new Set(TEST_EXCLUDED_EMAILS.map(e => e.toLowerCase()))
  return ((data ?? []) as Row[])
    .filter(e => isSuperAdmin(e))
    .map(e => (e.email ?? '').trim())
    .filter(email => email.length > 0)
    .filter(email => !excluded.has(email.toLowerCase()))
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const dash = (v: string | null | undefined) => {
  const s = (v ?? '').trim()
  return s.length > 0 ? s : '-'
}

/** 이름 · 직책 · 부서를 한 줄로. 빈 값은 건너뛴다. */
function contactLine(d: LeadMailData): string {
  const parts = [d.contact_name, d.contact_title, d.contact_dept].map(v => (v ?? '').trim()).filter(Boolean)
  return parts.length ? parts.join(' · ') : '-'
}

/** 휴대폰 · 사무실 · 이메일을 한 줄로. */
function contactTel(d: LeadMailData): string {
  const parts = [d.contact_mobile, d.contact_office_tel, d.contact_email].map(v => (v ?? '').trim()).filter(Boolean)
  return parts.length ? parts.join(' · ') : '-'
}

function trimNote(note: string | null): { text: string; cut: boolean } {
  const s = (note ?? '').trim()
  if (s.length <= NOTE_MAX) return { text: s || '-', cut: false }
  return { text: s.slice(0, NOTE_MAX), cut: true }
}

export function leadMailSubject(d: LeadMailData): string {
  return `아크레텍코리아 계측사업부 리드 신규등록 알림 (${dash(d.partner_company)})`
}

/** 요약 표에 들어갈 항목. HTML·평문이 같은 순서를 쓰도록 한곳에서 만든다. */
function rows(d: LeadMailData): [string, string][] {
  const budget = [d.budget_status, d.purchase_period].map(v => (v ?? '').trim()).filter(Boolean).join(' · ')
  return [
    ['리드번호', dash(d.lead_no)],
    ['파트너사 / 등록자', `${dash(d.partner_company)} / ${dash(d.partner_name)}${(d.partner_contact ?? '').trim() ? ` (${d.partner_contact})` : ''}`],
    ['고객사 / 산업군', `${dash(d.customer_company)} / ${dash(d.industry)}`],
    ['관심 제품', dash(d.interest_product)],
    ['예산 / 예상 구매 시기', budget || '-'],
    ['예상 구매일', dash(d.expected_purchase)],
    ['고객 담당자', contactLine(d)],
    ['연락처', contactTel(d)],
  ]
}

export function leadMailHtml(d: LeadMailData): string {
  const url = `${siteUrl()}${leadLink(d.lead_id)}`
  const note = trimNote(d.meeting_note)
  const tr = rows(d)
    .map(([k, v]) => `
      <tr>
        <td style="padding:7px 12px;background:#f3f4f6;color:#6b7280;font-size:13px;font-weight:700;white-space:nowrap;border-bottom:1px solid #ebebeb;">${esc(k)}</td>
        <td style="padding:7px 12px;color:#111827;font-size:13px;border-bottom:1px solid #ebebeb;">${esc(v)}</td>
      </tr>`)
    .join('')
  return `<div style="margin:0;padding:24px 16px;background:#fafafa;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #ebebeb;border-radius:8px;overflow:hidden;">
    <div style="padding:18px 20px;border-bottom:1px solid #ebebeb;">
      <div style="font-size:16px;font-weight:800;color:#111827;">신규 리드가 등록되었습니다</div>
      <div style="font-size:12px;color:#6b7280;margin-top:4px;">아크레텍코리아 계측사업부</div>
    </div>
    <div style="padding:18px 20px;">
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">${tr}</table>
      <div style="margin-top:18px;">
        <div style="font-size:13px;font-weight:700;color:#6b7280;margin-bottom:6px;">회의록</div>
        <div style="font-size:13px;color:#111827;line-height:1.7;white-space:pre-wrap;word-break:break-word;background:#fafafa;border:1px solid #ebebeb;border-radius:6px;padding:12px 14px;">${esc(note.text)}${note.cut ? '\n\n… 이하 생략. 아래 링크에서 전문을 확인해주세요.' : ''}</div>
      </div>
      <div style="margin-top:22px;text-align:center;">
        <a href="${esc(url)}" style="display:inline-block;padding:11px 22px;background:#234ea2;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;border-radius:6px;">리드 관리 화면에서 열기</a>
      </div>
      <div style="margin-top:12px;font-size:11px;color:#9ca3af;text-align:center;word-break:break-all;">${esc(url)}</div>
    </div>
  </div>
  <div style="max-width:640px;margin:12px auto 0;font-size:11px;color:#9ca3af;text-align:center;">
    이 메일은 리드가 등록될 때 자동으로 발송됩니다. 명함 이미지는 링크에서 확인해주세요.
  </div>
</div>`
}

export function leadMailText(d: LeadMailData): string {
  const url = `${siteUrl()}${leadLink(d.lead_id)}`
  const note = trimNote(d.meeting_note)
  const lines = [
    '신규 리드가 등록되었습니다 — 아크레텍코리아 계측사업부',
    '',
    ...rows(d).map(([k, v]) => `${k}: ${v}`),
    '',
    '[회의록]',
    note.text + (note.cut ? '\n\n… 이하 생략. 아래 링크에서 전문을 확인해주세요.' : ''),
    '',
    `리드 관리 화면: ${url}`,
    '',
    '이 메일은 리드가 등록될 때 자동으로 발송됩니다. 명함 이미지는 링크에서 확인해주세요.',
  ]
  return lines.join('\n')
}

/**
 * 관리자에게 신규 리드 메일을 보낸다.
 * 실패해도 예외를 던지지 않는다 — 호출부(리드 등록)는 이 결과와 무관하게 성공으로 끝나야 한다.
 */
export async function sendLeadMail(d: LeadMailData): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.error('[leadMail] RESEND_API_KEY 가 없어 메일을 보내지 않는다', { leadId: d.lead_id })
    return
  }
  const to = await adminEmails()
  if (to.length === 0) {
    console.error('[leadMail] 받을 사람이 없다', { leadId: d.lead_id })
    return
  }
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM,
        to,
        subject: leadMailSubject(d),
        html: leadMailHtml(d),
        text: leadMailText(d),
      }),
    })
    if (!res.ok) {
      console.error('[leadMail] 발송 실패', { leadId: d.lead_id, status: res.status, body: (await res.text()).slice(0, 300) })
      return
    }
    console.log('[leadMail] 발송', { leadId: d.lead_id, to: to.length })
  } catch (e) {
    console.error('[leadMail] 발송 중 오류', { leadId: d.lead_id, error: e })
  }
}
