'use client'

// 장비 구성 모달 **왼쪽** — 기종별 구성 템플릿 목록.
//
// 묶는 기준은 model_key(기종)다. 기종 표가 따로 없어서 템플릿이 들고 있는 글자로 묶는다 —
// 비어 있는 템플릿은 「기종 미지정」으로 모인다.
// 정렬은 lib/quoteTemplates.ts 의 sortTemplates 가 정한다(내가 만든 것 먼저 → 최근 사용 순).
//
// 수정·삭제는 견적 작성 권한자 누구에게나 열려 있다. 다만 **남의 것을 고르면 저장이
// 「복사 저장」으로 기본**이 된다(그 판정은 SaveTemplateDialog 가 한다).

import { useMemo, useState } from 'react'
import { kstYmd } from '@/lib/date'
import { isMyTemplate, sortTemplates } from '@/lib/quoteTemplates'
import type { QuoteTemplate } from '@/lib/quoteTemplates'
import { C, S } from './equipStyles'

export type EquipTemplateListProps = {
  templates: QuoteTemplate[]
  counts: Map<string, number>
  loading: boolean
  myId: number | null
  pickedId: string | null
  onPick: (t: QuoteTemplate) => void
  onEmpty: () => void
  onAskDelete: (t: QuoteTemplate) => void
}

const UNSET = '기종 미지정'

export default function EquipTemplateList(props: EquipTemplateListProps) {
  const { templates, counts, loading, myId, pickedId, onPick, onEmpty, onAskDelete } = props
  const [q, setQ] = useState('')

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const hit = needle
      ? templates.filter(t =>
        (t.model_key ?? '').toLowerCase().includes(needle) || t.name.toLowerCase().includes(needle))
      : templates
    const byModel = new Map<string, QuoteTemplate[]>()
    for (const t of sortTemplates(hit, myId)) {
      const key = (t.model_key ?? '').trim() || UNSET
      const list = byModel.get(key)
      if (list) list.push(t)
      else byModel.set(key, [t])
    }
    // 묶음 순서는 그 안의 **첫 템플릿 순서**를 따른다 — 내 것·최근 쓴 것이 위로 온다.
    return Array.from(byModel.entries())
  }, [templates, q, myId])

  return (
    <div>
      <input
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder="기종 검색 (기종 · 구성 이름)"
        style={S.input}
      />

      {loading && <div style={{ ...S.tplMeta, marginTop: 12 }}>불러오는 중…</div>}
      {!loading && templates.length === 0 && (
        <div style={{ ...S.tplMeta, marginTop: 12 }}>저장된 구성이 없습니다</div>
      )}
      {!loading && templates.length > 0 && groups.length === 0 && (
        <div style={{ ...S.tplMeta, marginTop: 12 }}>검색 결과가 없습니다</div>
      )}

      {groups.map(([model, list]) => (
        <div key={model}>
          <div style={S.family}>{model}</div>
          {list.map(t => {
            const on = t.id === pickedId
            const mine = isMyTemplate(t, myId)
            const used = t.last_used_at ? kstYmd(t.last_used_at) : ''
            return (
              <div key={t.id}>
                <button type="button" onClick={() => onPick(t)} style={on ? S.tplOn : S.tpl}>
                  <span style={{ ...S.tplName, color: on ? C.PRI : C.INK }}>{t.name}</span>
                  <span style={S.tplMeta}>
                    {mine ? '내 구성' : t.owner_name}
                    {' · '}{counts.get(t.id) ?? 0}항목
                    {' · '}사용 {t.used_count}회
                    {used ? ` · ${used}` : ''}
                  </span>
                </button>
                {/* 삭제는 고른 구성에서만 보여 준다 — 목록을 누르려다 지우는 일을 막는다. */}
                {on && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '2px 2px 6px' }}>
                    <button type="button" onClick={() => onAskDelete(t)} style={{ ...S.miniBtn, color: C.RED }}>
                      이 구성 삭제
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ))}

      <div style={S.family}>직접 구성</div>
      <button type="button" onClick={onEmpty} style={pickedId === null ? S.tplOn : S.tpl}>
        <span style={{ ...S.tplName, color: pickedId === null ? C.PRI : C.INK }}>+ 빈 구성으로 시작</span>
        <span style={S.tplMeta}>가격표에서 검색해 추가</span>
      </button>
    </div>
  )
}
