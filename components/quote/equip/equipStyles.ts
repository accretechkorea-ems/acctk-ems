// 장비 구성 모달의 스타일 — 한곳에 모아 둔다.
//
// 값은 모두 **기존 토큰**이다(.claude/rules/design-system.md). 시안의 색은 다음과 같이 옮겼다.
//   시안 --card #fff → #ffffff · --line #d7dce6 → #ebebeb · --ink #1c2230 → #111827
//   --mut #6b7488 → #6b7280 · --pri #2b4fb8 → #234ea2 · --pri2 #e8eefc → #f3f4f6(+테두리 #c7d7f8)
//   --ok #1d7a4a → #16a34a · --red #c0392b → #dc2626 · 패널 바닥 #f8f9fc → #fafafa
//   묶음 머리 #f1f3f9 → #f3f4f6 · 흐린 글자 → #9ca3af / #d1d5db
// 새 색·새 글자 크기는 만들지 않았다. 그림자는 모달 바깥 한 겹에만 쓴다(그림자 정책).

import type { CSSProperties } from 'react'
import { Z } from '@/lib/zIndex'

const LINE = '#ebebeb'
const INK = '#111827'
const MUT = '#6b7280'
const DIM = '#9ca3af'
const PRI = '#234ea2'

export const C = { LINE, INK, MUT, DIM, PRI, FAINT: '#d1d5db', NEUTRAL: '#f3f4f6', PAGE: '#fafafa', RED: '#dc2626', OK: '#16a34a' } as const

export const S: Record<string, CSSProperties> = {
  // ── 껍데기 ──
  backdrop: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: Z.modal,
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
  },
  modal: {
    background: '#fff', borderRadius: 8, width: '100%', maxWidth: 1240,
    height: 'min(820px, 92vh)', display: 'flex', flexDirection: 'column', overflow: 'hidden',
    boxShadow: '0 20px 60px rgba(0,0,0,0.22)', animation: 'modal-in 0.18s ease',
  },
  head: {
    display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px',
    borderBottom: `1px solid ${LINE}`, flexShrink: 0,
  },
  title: { margin: 0, fontSize: 20, fontWeight: 800, color: INK, letterSpacing: '-0.5px' },
  headFields: { display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: MUT, fontWeight: 500 },
  closeBtn: {
    width: 28, height: 28, borderRadius: '50%', border: 'none', background: '#f3f4f6',
    color: MUT, fontSize: 14, cursor: 'pointer', flexShrink: 0,
  },
  body: { flex: 1, display: 'grid', gridTemplateColumns: '225px minmax(0, 1fr) 255px', minHeight: 0 },
  col: { overflow: 'auto', minHeight: 0 },
  left: { borderRight: `1px solid ${LINE}`, background: '#fafafa', padding: 12 },
  mid: { padding: '0 0 12px' },
  right: { borderLeft: `1px solid ${LINE}`, background: '#fafafa', padding: 14 },
  foot: {
    display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px',
    borderTop: `1px solid ${LINE}`, flexShrink: 0,
  },

  // ── 입력 ──
  input: {
    width: '100%', padding: '7px 9px', border: `1px solid ${LINE}`, borderRadius: 6,
    fontSize: 13, fontWeight: 500, color: INK, background: '#fff', font: 'inherit',
  },
  num: {
    width: 98, padding: '3px 6px', border: `1px solid ${LINE}`, borderRadius: 6,
    fontSize: 12, textAlign: 'right', color: INK, background: '#fff',
  },
  numSmall: {
    width: 64, padding: '4px 6px', border: `1px solid ${LINE}`, borderRadius: 6,
    fontSize: 12, textAlign: 'right', color: INK, background: '#fff',
  },
  qty: {
    width: 46, padding: '3px 4px', border: `1px solid ${LINE}`, borderRadius: 6,
    fontSize: 12, textAlign: 'center', color: INK, background: '#fff',
  },

  // ── 왼쪽(기종·템플릿) ──
  family: { margin: '12px 0 4px', fontSize: 11, fontWeight: 700, color: DIM },
  tpl: {
    padding: '8px 9px', borderRadius: 6, cursor: 'pointer', border: '1px solid transparent',
    background: 'transparent', width: '100%', textAlign: 'left', display: 'block',
  },
  tplOn: {
    padding: '8px 9px', borderRadius: 6, cursor: 'pointer', border: '1px solid #c7d7f8',
    background: '#f3f4f6', width: '100%', textAlign: 'left', display: 'block',
  },
  tplName: { display: 'block', fontSize: 13, fontWeight: 600, color: INK },
  tplMeta: { display: 'block', fontSize: 11, fontWeight: 500, color: DIM, marginTop: 3 },

  // ── 가운데(묶음 표) ──
  sec: { margin: '12px 16px 0', border: `1px solid ${LINE}`, borderRadius: 8, overflow: 'hidden' },
  secHead: {
    display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
    background: '#f3f4f6', fontSize: 13, fontWeight: 700, color: INK,
  },
  secHint: { fontSize: 11, fontWeight: 500, color: MUT },
  miniBtn: {
    fontSize: 11, fontWeight: 700, border: `1px solid ${LINE}`, background: '#fff',
    borderRadius: 6, padding: '2px 8px', cursor: 'pointer', color: PRI,
  },
  table: { width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' },
  th: {
    fontSize: 11, fontWeight: 500, color: DIM, textAlign: 'left',
    padding: '5px 8px', borderBottom: `1px solid ${LINE}`, background: '#fff',
  },
  td: { padding: '4px 8px', borderBottom: `1px solid ${LINE}`, verticalAlign: 'middle', fontSize: 12, color: INK },
  tdOff: { padding: '4px 8px', borderBottom: `1px solid ${LINE}`, verticalAlign: 'middle', fontSize: 12, color: DIM },
  addRow: {
    display: 'flex', gap: 8, alignItems: 'center', padding: '8px 12px',
    background: '#fafafa', borderTop: `1px dashed ${LINE}`, position: 'relative',
  },
  hint: { fontSize: 11, fontWeight: 500, color: DIM, whiteSpace: 'nowrap' },
  dropdown: {
    position: 'absolute', left: 12, right: 12, top: '100%', zIndex: Z.popover,
    background: '#fff', border: `1px solid ${LINE}`, borderRadius: 8, maxHeight: 260,
    overflow: 'auto', boxShadow: '0 16px 40px rgba(0,0,0,0.18)',
  },
  dropItem: {
    display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px',
    border: 'none', borderBottom: `1px solid ${LINE}`, background: '#fff', cursor: 'pointer',
  },

  // ── 오른쪽(요약) ──
  rightLabel: { margin: '0 0 8px', fontSize: 11, fontWeight: 600, color: DIM },
  pill: {
    padding: '6px 10px', borderRadius: 6, background: '#fff', border: `1px solid ${LINE}`,
    margin: '8px 0', fontSize: 12, fontWeight: 500, color: INK,
  },
  kv: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', fontSize: 12, color: INK },
  kvBold: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    borderTop: `1px solid ${LINE}`, marginTop: 4, paddingTop: 8, fontSize: 14, fontWeight: 700, color: INK,
  },

  // ── 버튼 ──
  btn: {
    padding: '8px 18px', borderRadius: 6, border: `1px solid ${LINE}`, background: '#fff',
    fontSize: 13, fontWeight: 700, color: PRI, cursor: 'pointer',
  },
  btnPri: {
    padding: '8px 18px', borderRadius: 6, border: 'none', background: PRI,
    fontSize: 13, fontWeight: 700, color: '#fff', cursor: 'pointer',
  },
  btnOff: {
    padding: '8px 18px', borderRadius: 6, border: `1px solid ${LINE}`, background: '#fff',
    fontSize: 13, fontWeight: 700, color: DIM, cursor: 'not-allowed',
  },
}

/** 원화 표시 — 화면 전용(저장값과 무관). */
export const won = (n: number): string => `₩${Math.round(n).toLocaleString('ko-KR')}`
/** 1,000 단위 구분만. 「-」는 부르는 쪽이 정한다. */
export const num = (n: number): string => Math.round(n).toLocaleString('ko-KR')
/** 숫자 입력칸에서 쉼표·공백을 걷어낸다. */
export const parseNum = (s: string): number => Number(s.replace(/[,\s]/g, '')) || 0
