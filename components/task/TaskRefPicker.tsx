'use client'

/**
 * 할 일의 **연결 대상** 고르기 — 포캐스트 · 견적 · 리드 · 사업장 · 장비 (2026-11-26).
 *
 * 한 칸으로 다섯 표를 뒤진다. 먼저 **무엇을 걸지** 고르고, 그 다음 적어 찾는다 — 다섯 칸을
 * 나란히 두면 넷은 늘 비어 있고, 한 칸에 전부 섞으면 같은 이름이 어느 표의 것인지 알 수 없다.
 *
 * 읽기는 브라우저가 한다(RLS 가 볼 수 있는 줄만 내려 준다). 적힌 글자가 한 자 이상일 때만
 * 조회하고 20줄까지만 받는다 — 고르는 칸이지 목록 화면이 아니다.
 *
 * 비워 둘 수 있다. 연결 대상이 없는 할 일(「주간 보고 쓰기」)도 할 일이다.
 */

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { createClient } from '@/lib/supabase/client'
import SearchSelect from '@/components/common/SearchSelect'
import { BLUE_TINT, BLUE, BORDER, CARD_BG, NEUTRAL_BG } from '@/components/common/ui'
import { TEXT_NOTE, TEXT_PLACEHOLDER } from '@/lib/textTokens'
import { CUSTOMER_NAME_SELECT, customerDisplayName, type CustomerNameRowWithParent } from '@/lib/customerLabel'
import { REF_LABEL, TASK_REF_TYPES, type TaskRefType } from '@/lib/tasks'
import { R } from '@/lib/radius'

export type TaskRefPick = { type: TaskRefType; id: number; label: string }

/** PostgREST 의 or() 는 쉼표·괄호로 조건을 가른다 — 그 글자는 찾는 말에서 걷는다. */
const safe = (q: string) => q.replace(/[,()%*]/g, ' ').trim()

const PLACEHOLDER: Record<TaskRefType, string> = {
  forecast: '포캐스트 제목·회사명',
  quote: '견적번호',
  lead: '리드번호·회사명',
  customer: '회사명·사업장명',
  device: '장비명',
}

/** 그 종류의 줄을 찾는다. 돌려주는 것은 「id + 보여 줄 이름」뿐이다. */
async function search(type: TaskRefType, raw: string): Promise<TaskRefPick[]> {
  const q = safe(raw)
  if (!q) return []
  const supabase = createClient()
  const like = `*${q}*`
  try {
    if (type === 'forecast') {
      const { data } = await supabase
        .from('sales_opportunities')
        .select('opportunity_id, title, customers(company_name)')
        .ilike('title', like).order('opportunity_id', { ascending: false }).limit(20)
      return (data ?? []).map(r => {
        const co = (r as { customers?: { company_name?: string | null } | { company_name?: string | null }[] | null }).customers
        const name = Array.isArray(co) ? co[0]?.company_name : co?.company_name
        return {
          type, id: Number((r as { opportunity_id: number }).opportunity_id),
          label: `${name ? `${name} » ` : ''}${(r as { title?: string | null }).title ?? ''}`.trim(),
        }
      })
    }
    if (type === 'quote') {
      const { data } = await supabase
        .from('quotes').select('quote_id, quote_number, recipient')
        .ilike('quote_number', like).order('quote_id', { ascending: false }).limit(20)
      return (data ?? []).map(r => ({
        type, id: Number(r.quote_id),
        label: `${r.quote_number ?? r.quote_id}${r.recipient ? ` · ${r.recipient}` : ''}`,
      }))
    }
    if (type === 'lead') {
      const { data } = await supabase
        .from('leads').select('lead_id, lead_no, company')
        .or(`lead_no.ilike.${like},company.ilike.${like}`)
        .order('lead_id', { ascending: false }).limit(20)
      return (data ?? []).map(r => ({
        type, id: Number(r.lead_id),
        label: `${r.lead_no ?? r.lead_id}${r.company ? ` · ${r.company}` : ''}`,
      }))
    }
    if (type === 'customer') {
      const { data } = await supabase
        .from('customers').select(`customer_id, ${CUSTOMER_NAME_SELECT}`)
        .is('deleted_at', null).ilike('company_name', like).order('company_name').limit(20)
      return (data ?? []).map(r => ({
        type, id: Number((r as { customer_id: number }).customer_id),
        label: customerDisplayName(r as unknown as CustomerNameRowWithParent),
      }))
    }
    const { data } = await supabase
      .from('devices').select('device_id, device_name, device_name2, serial_number')
      .is('deleted_at', null)
      .or(`device_name.ilike.${like},device_name2.ilike.${like},serial_number.ilike.${like}`)
      .order('device_id', { ascending: false }).limit(20)
    return (data ?? []).map(r => ({
      type: 'device' as TaskRefType, id: Number(r.device_id),
      label: [r.device_name, r.device_name2].map(v => (v ?? '').trim()).filter(Boolean).join(' ')
        + (r.serial_number ? ` · ${r.serial_number}` : ''),
    }))
  } catch (e) {
    console.error('[task] 연결 대상을 찾지 못했다', { type, error: e })
    return []
  }
}

const pill = (on: boolean): CSSProperties => ({
  height: 26, padding: '0 10px', borderRadius: R.pill, fontSize: 12, fontWeight: 700,
  border: `1px solid ${on ? BLUE : BORDER}`, background: on ? BLUE_TINT : CARD_BG,
  color: on ? BLUE : TEXT_PLACEHOLDER, cursor: 'pointer', fontFamily: 'inherit',
})

export default function TaskRefPicker({ pick, onPick, fieldStyle }: {
  pick: TaskRefPick | null
  onPick: (v: TaskRefPick | null) => void
  fieldStyle?: CSSProperties
}) {
  const [type, setType] = useState<TaskRefType>('forecast')
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<TaskRefPick[]>([])
  // 마지막 조회만 반영한다 — 빨리 치면 먼저 띄운 조회가 나중에 돌아올 수 있다.
  const seq = useRef(0)

  // 적은 글자가 비면 **그릴 때** 비워 보인다(아래 shown) — 효과 안에서 바로 setState 하면
  // 렌더가 한 번 더 돈다(react-hooks/set-state-in-effect).
  const shown = safe(query) ? rows : []

  useEffect(() => {
    if (!safe(query)) return
    const mine = ++seq.current
    const timer = setTimeout(() => {
      void search(type, query).then(found => { if (seq.current === mine) setRows(found) })
    }, 180)
    return () => clearTimeout(timer)
  }, [type, query])

  if (pick) {
    return (
      <div style={{ ...fieldStyle, display: 'flex', alignItems: 'center', gap: 8, background: NEUTRAL_BG }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: BLUE }}>{REF_LABEL[pick.type]}</span>
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>
          {pick.label}
        </span>
        <button
          type="button" onClick={() => { onPick(null); setQuery('') }}
          style={{ border: 'none', background: 'none', color: BLUE, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
        >
          바꾸기
        </button>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
        {TASK_REF_TYPES.map(t => (
          <button key={t} type="button" onClick={() => { setType(t); setQuery('') }} style={pill(type === t)}>
            {REF_LABEL[t]}
          </button>
        ))}
      </div>
      <SearchSelect<TaskRefPick>
        items={shown}
        itemKey={r => `${r.type}:${r.id}`}
        renderItem={r => <span style={{ fontSize: 13 }}>{r.label}</span>}
        onSelect={r => { onPick(r); setQuery('') }}
        query={query}
        onQueryChange={setQuery}
        placeholder={PLACEHOLDER[type]}
        inputStyle={fieldStyle}
        emptyText="찾는 것이 없습니다"
      />
      <div style={{ fontSize: 11, color: TEXT_NOTE }}>비워 두어도 됩니다</div>
    </div>
  )
}
