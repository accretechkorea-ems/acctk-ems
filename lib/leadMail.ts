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
  const explicit = (process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || '').trim()
  if (explicit) return normalizeOrigin(explicit)
  // Vercel 은 스킴 없이 넣어 준다. 프리뷰 배포마다 값이 달라지므로 SITE_URL 이 있으면 그쪽이 이긴다.
  const vercel = (process.env.VERCEL_URL || '').trim()
  if (vercel) return normalizeOrigin(vercel)
  return 'http://localhost:3000'
}

/**
 * 사람이 손으로 넣는 값이라 형태가 제각각이다. 링크가 깨지지 않게 두 가지를 방어한다.
 * - 스킴이 없으면 https 를 붙인다. 'ems.example.com' 그대로 두면 메일에서 상대 경로로 읽혀 열리지 않는다.
 * - 끝의 슬래시를 뗀다. 뒤에 '/leads?...' 를 붙이므로 남겨 두면 '//leads' 가 된다.
 */
function normalizeOrigin(raw: string): string {
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw.replace(/^\/+/, '')}`
  return withScheme.replace(/\/+$/, '')
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

// ── 파트너사(대리점) 메일 ─────────────────────────────────────────────
// 위 sendLeadMail 은 내부 직원에게 가는 알림이다. 아래 둘은 리드를 올린 파트너사 담당자에게 나간다.
// 외부로 나가는 메일이라 호출부가 성패를 알아야 한다 — 이쪽은 boolean 을 돌려준다(예외는 던지지 않는다).
// 카드 모양·발신 주소·평문 동시 발송은 내부 알림 메일과 같은 규칙을 쓴다.

/** 'YYYY-MM-DD HH:mm' (KST). 접수일시처럼 사람이 읽는 시각에 쓴다. */
const kstDateTime = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toLocaleString('sv-SE', { timeZone: 'Asia/Seoul', hour12: false }).slice(0, 16) : '-'

/**
 * Resend 한 번 호출(수신자 1명). 성공이면 true.
 * 실패는 여기서 전문을 로그로 남기고 false 로만 알린다 — 호출부가 응답에 담아 화면이 안내한다.
 */
async function sendPartnerResend(args: {
  to: string
  subject: string
  html: string
  text: string
  ctx: Record<string, unknown>
}): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.error('[leadMail] RESEND_API_KEY 가 없어 파트너사 메일을 보내지 않는다', args.ctx)
    return false
  }
  const to = args.to.trim()
  if (!to) {
    console.error('[leadMail] 파트너사 주소가 비어 있다', args.ctx)
    return false
  }
  // 내부 알림과 같은 시험용 제외 장치를 파트너사 주소에도 적용한다(목록이 비어 있으면 아무 영향 없다).
  if (TEST_EXCLUDED_EMAILS.map(e => e.toLowerCase()).includes(to.toLowerCase())) {
    console.error('[leadMail] 테스트 제외 주소 — 파트너사 메일을 보내지 않는다', { ...args.ctx, to })
    return false
  }
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [to], subject: args.subject, html: args.html, text: args.text }),
    })
    if (!res.ok) {
      console.error('[leadMail] 파트너사 발송 실패', { ...args.ctx, to, status: res.status, body: (await res.text()).slice(0, 300) })
      return false
    }
    console.log('[leadMail] 파트너사 발송', { ...args.ctx, to })
    return true
  } catch (e) {
    console.error('[leadMail] 파트너사 발송 중 오류', { ...args.ctx, to, error: e })
    return false
  }
}

/** 파트너사 메일 공통 껍데기. 제목 줄 · 인사말 · 표 · 맺음말 순서는 두 메일이 같다. */
function partnerMailHtml(args: {
  heading: string
  greeting: string
  lead: string[]
  rows: [string, string][]
  closing: string[]
}): string {
  const tr = args.rows
    .map(([k, v]) => `
      <tr>
        <td style="padding:7px 12px;background:#f3f4f6;color:#6b7280;font-size:13px;font-weight:700;white-space:nowrap;border-bottom:1px solid #ebebeb;">${esc(k)}</td>
        <td style="padding:7px 12px;color:#111827;font-size:13px;border-bottom:1px solid #ebebeb;">${esc(v)}</td>
      </tr>`)
    .join('')
  const para = (s: string) => `<div style="font-size:13px;color:#111827;line-height:1.8;">${esc(s)}</div>`
  return `<div style="margin:0;padding:24px 16px;background:#fafafa;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #ebebeb;border-radius:8px;overflow:hidden;">
    <div style="padding:18px 20px;border-bottom:1px solid #ebebeb;">
      <div style="font-size:16px;font-weight:800;color:#111827;">${esc(args.heading)}</div>
      <div style="font-size:12px;color:#6b7280;margin-top:4px;">아크레텍코리아 계측사업부</div>
    </div>
    <div style="padding:18px 20px;">
      <div style="font-size:13px;color:#111827;line-height:1.8;font-weight:700;">${esc(args.greeting)}</div>
      <div style="margin-top:12px;">${args.lead.map(para).join('')}</div>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin-top:16px;">${tr}</table>
      <div style="margin-top:16px;">${args.closing.map(para).join('')}</div>
    </div>
  </div>
  <div style="max-width:640px;margin:12px auto 0;font-size:11px;color:#9ca3af;text-align:center;">
    이 메일은 리드 등록·담당자 배정 시 자동으로 발송됩니다. 회신은 담당자에게 직접 부탁드립니다.
  </div>
</div>`
}

/** 파트너사 메일 평문. HTML 과 같은 내용을 같은 순서로 담는다. */
function partnerMailText(args: {
  heading: string
  greeting: string
  lead: string[]
  rows: [string, string][]
  closing: string[]
}): string {
  return [
    `${args.heading} — 아크레텍코리아 계측사업부`,
    '',
    args.greeting,
    '',
    ...args.lead,
    '',
    ...args.rows.map(([k, v]) => `${k}: ${v}`),
    '',
    ...args.closing,
    '',
    '이 메일은 리드 등록·담당자 배정 시 자동으로 발송됩니다. 회신은 담당자에게 직접 부탁드립니다.',
  ].join('\n')
}

/** 접수 확인 메일에 실을 값. */
export type PartnerReceiptMailData = {
  lead_id: number
  lead_no: string | null
  partner_email: string | null
  partner_name: string | null
  customer_company: string | null
  interest_product: string | null
  created_at: string | null
}

/**
 * 리드 접수 확인 — 등록 직후 파트너사 담당자에게 보낸다.
 * 주소가 없으면 호출부가 아예 부르지 않는다(여기서도 방어한다).
 */
export async function sendPartnerReceiptMail(d: PartnerReceiptMailData): Promise<boolean> {
  const name = (d.partner_name ?? '').trim() || '담당자'
  const content = {
    heading: '리드 접수 확인',
    greeting: `${name}님, 안녕하십니까.`,
    lead: [
      '아크레텍코리아에 리드를 등록해 주셔서 감사합니다.',
      '아래 내용으로 정상 접수되었습니다.',
    ],
    rows: [
      ['접수번호', dash(d.lead_no)],
      ['접수일시', kstDateTime(d.created_at)],
      ['고객사', dash(d.customer_company)],
      ['관심제품', dash(d.interest_product)],
    ] as [string, string][],
    closing: [
      '담당자 배정이 완료되면 담당자 정보를 다시 안내드리겠습니다.',
      '감사합니다.',
    ],
  }
  return sendPartnerResend({
    to: d.partner_email ?? '',
    subject: `[아크레텍코리아] 리드 접수 확인 - ${dash(d.customer_company)}`,
    html: partnerMailHtml(content),
    text: partnerMailText(content),
    ctx: { kind: 'receipt', leadId: d.lead_id, leadNo: d.lead_no },
  })
}

/** 배정 통보 메일에 실을 값. */
export type PartnerAssignMailData = {
  lead_id: number
  lead_no: string | null
  partner_email: string | null
  partner_name: string | null
  customer_company: string | null
  /** 배정된 담당자. 휴대폰은 engineers.tel 이고, 비어 있으면 그 줄을 빼고 보낸다. */
  engineer: { name: string | null; position: string | null; tel: string | null; email: string | null }
  /** 이전 담당자가 있었으면 true — 제목·첫 문장이 '변경'으로 바뀐다. */
  changed: boolean
}

/** 담당자 배정(변경) 통보 — 배정 직후와 재발송 버튼이 함께 쓴다. */
export async function sendPartnerAssignMail(d: PartnerAssignMailData): Promise<boolean> {
  const name = (d.partner_name ?? '').trim() || '담당자'
  const who = [d.engineer.name, d.engineer.position].map(v => (v ?? '').trim()).filter(Boolean).join(' ')
  const tel = (d.engineer.tel ?? '').trim()
  const rows: [string, string][] = [['담당자', who || '-']]
  // 연락처는 값이 있을 때만 넣는다 — 빈 줄을 '-' 로 내보내면 연락처가 없는 것처럼 읽힌다.
  if (tel) rows.push(['연락처', tel])
  rows.push(['이메일', dash(d.engineer.email)])
  const content = {
    heading: d.changed ? '담당자 변경 안내' : '담당자 배정 안내',
    greeting: `${name}님, 안녕하십니까.`,
    lead: [
      d.changed
        ? `접수번호 ${dash(d.lead_no)} 건의 담당자가 변경되었습니다.`
        : `접수번호 ${dash(d.lead_no)} 건의 담당자가 배정되었습니다.`,
    ],
    rows,
    closing: [
      '담당자가 곧 연락드릴 예정이며, 진행 관련 문의는 위 연락처로 부탁드립니다.',
      '감사합니다.',
    ],
  }
  return sendPartnerResend({
    to: d.partner_email ?? '',
    subject: `[아크레텍코리아] ${d.changed ? '담당자 변경 안내' : '담당자 배정 안내'} - ${dash(d.customer_company)}`,
    html: partnerMailHtml(content),
    text: partnerMailText(content),
    ctx: { kind: 'assign', leadId: d.lead_id, leadNo: d.lead_no, changed: d.changed },
  })
}
