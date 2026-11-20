'use client'

// **수리 건 정보 패널** — 견적 작성 화면과 견적 목록 드로어가 함께 쓴다.
//
// ── 두 자리, 한 컴포넌트 ────────────────────────────────────────────────────
//   견적 작성 화면 — 아직 저장되지 않은 견적이다. **저장할 곳(quote_id)이 없다.**
//                    그래서 글자는 화면이 들고 있다가(page.tsx 의 repairInfo 상태,
//                    임시저장에도 함께 담긴다) 확정할 때 한 번에 올린다.
//   견적 목록 드로어 — 이미 저장된 견적이다. 여기서는 **「저장」 버튼**이 바로 쓴다.
//   같은 칸을 두 번 그리지 않으려고 mode 로만 가른다.
//
// ── 위는 읽기, 아래는 입력 ──────────────────────────────────────────────────
//   위(구분·시리얼·입고·수리완료·출고)는 **수리 목록이 정본**이라 여기서 고치지 않는다.
//   한 사실을 두 곳에서 고칠 수 있게 두면 어느 쪽이 맞는지 알 수 없게 된다.
//
// 자동 저장은 없다 — 적다 만 글이 목록 뱃지를 「작성중」으로 바꿔 버리지 않게.

import { useRef, useState } from 'react'
import {
  MAX_PHOTOS, REPAIR_INFO_DOT, REPAIR_INFO_LABEL, canAddPhoto, repairDate, repairInfoState, shippedLabel,
  type RepairBrief, type RepairInfoFields, type RepairPhoto,
} from '@/lib/quoteRepairInfo'
import { R } from '@/lib/radius'

const BORDER = '#ebebeb'
const MUTED = '#9ca3af'
const GRAY = '#6b7280'
const TEXT = '#111827'

export type RepairInfoPanelProps = {
  /** 연결된 수리 건. 없으면 위 읽기 줄을 내지 않는다. */
  repair: RepairBrief | null
  value: RepairInfoFields
  onChange: (v: RepairInfoFields) => void
  /**
   * 'draft' — 아직 저장되지 않은 견적. 저장 버튼 없이 안내만 둔다.
   * 'saved' — 저장된 견적. 「저장」 버튼이 바로 쓴다.
   */
  mode: 'draft' | 'saved'
  /** mode='saved' 에서만 쓴다. 저장하는 함수(성공 여부를 돌려준다). */
  onSave?: () => Promise<boolean>
  /** 고칠 수 있는가 — 견적 작성자·관리자가 아니면 읽기만 한다. */
  canEdit?: boolean
  // ── 사진 ──
  /** 붙어 있는 사진(차례대로). 아직 저장되지 않은 견적에서는 늘 빈 배열이다. */
  photos?: RepairPhoto[]
  onAddPhotos?: (files: File[]) => void
  onDeletePhoto?: (photoId: number) => void
  onMovePhoto?: (photoId: number, dir: -1 | 1) => void
  /** 설명은 저장 버튼이 쓴다 — 여기서는 화면 값만 바꾼다. */
  onCaption?: (photoId: number, caption: string) => void
  /** 올리는 중 — 「2/3 올리는 중…」. */
  uploading?: { done: number; total: number } | null
  /**
   * 맨 아래 「상태 + 저장」 줄을 감춘다 — **모달이 그 줄을 자기 바닥에 고정**으로 두기
   * 때문이다(components/quote/RepairInfoModal.tsx). 패널 안에 또 두면 저장 단추가 둘이 된다.
   */
  hideSaveRow?: boolean
}

/** 위 읽기 줄의 한 칸. */
function ReadCell({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 11, color: MUTED, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 12, color: TEXT, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {value}
      </div>
    </div>
  )
}

/** 여러 줄 입력 한 칸. */
function Field({
  label, placeholder, value, onChange, disabled,
}: { label: string; placeholder: string; value: string; onChange: (v: string) => void; disabled: boolean }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 11, color: GRAY, fontWeight: 600, marginBottom: 3 }}>{label}</div>
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        rows={3}
        style={{
          width: '100%', boxSizing: 'border-box', resize: 'vertical',
          padding: '7px 9px', borderRadius: R.icon, border: `1px solid ${BORDER}`,
          fontSize: 12, lineHeight: 1.5, color: TEXT, outline: 'none', fontFamily: 'inherit',
          background: disabled ? '#f8fafc' : '#fff',
        }}
      />
    </div>
  )
}

export default function RepairInfoPanel({
  repair, value, onChange, mode, onSave, canEdit = true,
  photos = [], onAddPhotos, onDeletePhoto, onMovePhoto, onCaption, uploading = null,
  hideSaveRow = false,
}: RepairInfoPanelProps) {
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  // 완료는 **글자 셋 + 사진 한 장**이다(lib/quoteRepairInfo.ts — 목록 뱃지와 같은 판정).
  const state = repairInfoState(value, photos.length)
  const set = (k: keyof RepairInfoFields) => (v: string) => onChange({ ...value, [k]: v })

  return (
    <div>
      {/* 수리 목록이 정본인 칸 — 여기서는 보기만 한다. */}
      {repair && (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8,
          padding: '9px 10px', borderRadius: R.icon, background: '#fafbfc', border: `1px solid ${BORDER}`,
          marginBottom: 10,
        }}>
          <ReadCell label="구분" value={(repair.item_type ?? '').trim() || '-'} />
          <ReadCell label="시리얼번호" value={(repair.serial_number ?? '').trim() || '-'} />
          <ReadCell label="입고일" value={repairDate(repair.received_date)} />
          <ReadCell label="수리완료일" value={repairDate(repair.repair_done_at)} />
          <ReadCell label="출고일" value={shippedLabel(repair.shipped_date)} />
        </div>
      )}

      <Field label="고장 증상" placeholder="예: 전원이 들어오지 않음" value={value.symptom ?? ''} onChange={set('symptom')} disabled={!canEdit} />
      <Field label="고장 원인" placeholder="예: 전원부 기판 소손" value={value.cause ?? ''} onChange={set('cause')} disabled={!canEdit} />
      <Field label="처리 결과" placeholder="예: 전원부 기판 교체 후 정상 동작 확인" value={value.result ?? ''} onChange={set('result')} disabled={!canEdit} />

      {/* ── 수리 사진 ─────────────────────────────────────────────────────
          확정 전 견적에는 올릴 곳(quote_id)이 없다 — 칸을 내되 잠그고 까닭을 적는다.
          사진은 **고르는 즉시** 올라간다(파일이라 초안에 담아 둘 수 없다). 설명 글자만
          저장 버튼이 함께 쓴다. */}
      <div style={{ marginTop: 10, marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
          <span style={{ fontSize: 11, color: GRAY, fontWeight: 600 }}>수리 사진</span>
          <span style={{ fontSize: 11, color: MUTED }}>{photos.length}/{MAX_PHOTOS}</span>
          <span style={{ flex: 1 }} />
          {uploading && (
            <span style={{ fontSize: 11, color: '#234ea2', fontWeight: 600 }}>
              {uploading.done}/{uploading.total} 올리는 중…
            </span>
          )}
          {mode === 'saved' && canEdit && !uploading && (
            <button
              onClick={() => fileRef.current?.click()}
              disabled={!canAddPhoto(photos.length)}
              title={canAddPhoto(photos.length) ? '사진을 고릅니다' : `사진은 ${MAX_PHOTOS}장까지 올릴 수 있습니다`}
              style={{
                height: 24, padding: '0 9px', borderRadius: R.icon, border: `1px solid ${BORDER}`,
                background: '#fff', color: canAddPhoto(photos.length) ? '#234ea2' : MUTED,
                fontSize: 11, fontWeight: 700,
                cursor: canAddPhoto(photos.length) ? 'pointer' : 'not-allowed',
              }}
            >사진 추가</button>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={e => {
            const list = [...(e.target.files ?? [])]
            e.target.value = ''   // 같은 파일을 다시 골라도 change 가 오게 비운다
            if (list.length > 0) onAddPhotos?.(list)
          }}
        />

        {mode === 'draft' ? (
          <div style={{ fontSize: 11, color: MUTED, padding: '8px 10px', borderRadius: R.icon, background: '#fafbfc', border: `1px solid ${BORDER}` }}>
            견적 확정 후 사진을 올릴 수 있습니다
          </div>
        ) : photos.length === 0 ? (
          <div style={{ fontSize: 11, color: MUTED, padding: '8px 10px', borderRadius: R.icon, background: '#fafbfc', border: `1px solid ${BORDER}` }}>
            올린 사진이 없습니다{canEdit ? ' — 「사진 추가」로 올립니다' : ''}
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 6 }}>
            {photos.map((ph, i) => (
              <div key={ph.photo_id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: 6, borderRadius: R.icon, border: `1px solid ${BORDER}` }}>
                {/* 미리보기 — 버킷이 비공개라 1시간 서명 URL 이다(라우트가 만든다). */}
                {/* 저장소에서 파일이 사라진 줄 — 빈 네모 대신 **「파일 없음」**이라고 적는다.
                    (옆의 ✕ 로 그 줄을 지울 수 있다 — 줄만 남아 떠도는 것을 사람이 치우게.) */}
                {ph.url
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={ph.url} alt={`수리 사진 ${i + 1}`} style={{ width: 76, height: 76, objectFit: 'cover', borderRadius: R.tag, flexShrink: 0, background: '#f3f4f6' }} />
                  : (
                    <div style={{ width: 76, height: 76, borderRadius: R.tag, background: '#f3f4f6', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: MUTED, textAlign: 'center', lineHeight: 1.3 }}>
                      파일 없음
                    </div>
                  )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <input
                    value={ph.caption ?? ''}
                    onChange={e => onCaption?.(ph.photo_id, e.target.value)}
                    disabled={!canEdit}
                    placeholder="사진 설명(선택)"
                    style={{
                      width: '100%', boxSizing: 'border-box', border: `1px solid ${BORDER}`, borderRadius: R.icon,
                      padding: '5px 8px', fontSize: 12, color: TEXT, outline: 'none', fontFamily: 'inherit',
                      background: canEdit ? '#fff' : '#f8fafc',
                    }}
                  />
                  <div style={{ fontSize: 11, color: MUTED, marginTop: 3 }}>{i + 1}번째</div>
                </div>
                {canEdit && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flexShrink: 0 }}>
                    <button onClick={() => onMovePhoto?.(ph.photo_id, -1)} disabled={i === 0} title="위로"
                      style={{ width: 22, height: 20, borderRadius: R.tag, border: `1px solid ${BORDER}`, background: '#fff', color: i === 0 ? '#d1d5db' : GRAY, cursor: i === 0 ? 'not-allowed' : 'pointer', fontSize: 10, lineHeight: 1 }}>▲</button>
                    <button onClick={() => onMovePhoto?.(ph.photo_id, 1)} disabled={i === photos.length - 1} title="아래로"
                      style={{ width: 22, height: 20, borderRadius: R.tag, border: `1px solid ${BORDER}`, background: '#fff', color: i === photos.length - 1 ? '#d1d5db' : GRAY, cursor: i === photos.length - 1 ? 'not-allowed' : 'pointer', fontSize: 10, lineHeight: 1 }}>▼</button>
                    <button onClick={() => onDeletePhoto?.(ph.photo_id)} title="사진 지우기"
                      style={{ width: 22, height: 20, borderRadius: R.tag, border: `1px solid ${BORDER}`, background: '#fff', color: MUTED, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {!hideSaveRow && (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
        {/* 지금 상태 — 목록 뱃지와 **같은 판정**이다(lib/quoteRepairInfo.ts). */}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: GRAY }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: REPAIR_INFO_DOT[state], flexShrink: 0 }} />
          수리정보 {REPAIR_INFO_LABEL[state]}
        </span>
        <span style={{ flex: 1 }} />
        {mode === 'draft' ? (
          <span style={{ fontSize: 11, color: MUTED }}>견적을 확정하면 함께 저장됩니다</span>
        ) : canEdit ? (
          <button
            onClick={async () => {
              if (saving || !onSave) return
              setSaving(true)
              try { await onSave() } finally { setSaving(false) }
            }}
            disabled={saving}
            style={{
              height: 30, padding: '0 14px', borderRadius: R.icon, border: 'none',
              background: '#234ea2', color: '#fff', fontSize: 12, fontWeight: 700,
              cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? '저장 중…' : '저장'}
          </button>
        ) : (
          <span style={{ fontSize: 11, color: MUTED }}>작성자만 고칠 수 있습니다</span>
        )}
      </div>
      )}
    </div>
  )
}
