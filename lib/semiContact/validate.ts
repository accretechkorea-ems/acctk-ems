// 반도체 고객 접촉 보고 — **입력 검증**(순수 모듈).
//
// 화면은 저장 전에, 라우트는 받은 뒤에 같은 함수로 검증한다(화면 검증만 믿지 않는다).
// 오류는 필드별 문장으로 돌려준다 — components/common/fieldErrors.tsx 의 errors 맵에 그대로 넣을 수 있다.
//
// 규칙
//   · 등록표의 required 필드가 비었으면 오류(공백만 있어도 빈 값).
//   · select 필드(접촉방법 포함)는 값이 있으면 선택지 안이어야 한다. 「미확인」은 선택지에 있는 유효한 값이다.
//   · date 필드는 값이 있으면 'YYYY-MM-DD' 이고 실제로 있는 날짜여야 한다(2026-02-30 은 오류).
//   · Action 은 1개 이상. 「Action 없음」을 명시(noAction: true)하면 0개여도 통과한다.
//     둘을 함께 두면(없음인데 줄이 있음) 어느 쪽이 맞는지 모르므로 오류다.
//   · 모든 칸이 빈 Action 줄은 없는 줄로 본다 — 화면이 빈 줄을 먼저 만들어 두므로 안 채운 줄이 남을 수 있다.
//     저장할 때도 meaningfulActions 로 걸러 같은 기준을 쓴다.
//   · 각 Action 은 할 일·담당·기한을 갖춰야 하고, 기한은 날짜 형식, 상태·우선순위는 값이 있으면 선택지 안.
//
// DB·화면에 의존하지 않는다 — 스크립트로 그대로 돌려 볼 수 있다.

import {
  ACTION_LABELS, ACTION_PRIORITIES, ACTION_STATUSES, FIELDS,
  type ActionField, type ActionInput, type FieldKey,
} from './fields'
import type { PartialInput } from './prefill'
import { withJosa } from '../josa'

export type ValidateResult = {
  ok: boolean
  /** 필드 key → 오류 문장. 'actions' 는 Action 목록 전체에 대한 오류(0개 등). */
  errors: Partial<Record<FieldKey | 'actions', string>>
  /** meaningfulActions 를 거친 줄 순서대로의 줄별 오류. 오류 없는 줄은 빈 객체. */
  actionErrors: Partial<Record<ActionField, string>>[]
}

/**
 * 보고서 입력과 Action 줄을 검증한다.
 * @param opts.noAction 「이번 접촉에서 Action 없음」을 명시했는지.
 */
export function validateReport(
  input: PartialInput,
  actions: readonly Partial<ActionInput>[] | null | undefined,
  opts?: { noAction?: boolean },
): ValidateResult {
  const errors: ValidateResult['errors'] = {}

  for (const f of FIELDS) {
    const v = trimmed(input[f.key])
    if (v === '') {
      if (f.required) errors[f.key] = f.kind === 'select' || f.kind === 'date'
        ? `${withJosa(f.label, '을')} 선택해주세요`
        : `${withJosa(f.label, '을')} 입력해주세요`
      continue
    }
    if (f.kind === 'select' && 'options' in f && !(f.options as readonly string[]).includes(v)) {
      errors[f.key] = `${f.label}: 목록에 없는 값입니다`
    } else if (f.kind === 'date' && !isYmd(v)) {
      errors[f.key] = `${f.label}: 날짜 형식(YYYY-MM-DD)이 올바르지 않습니다`
    }
  }

  const rows = meaningfulActions(actions)
  const actionErrors = rows.map(validateAction)

  if (opts?.noAction) {
    if (rows.length > 0) errors.actions = 'Action 없음을 선택했는데 Action 줄이 있습니다. 둘 중 하나만 남겨주세요'
  } else if (rows.length === 0) {
    errors.actions = 'Action을 1개 이상 입력하거나 「Action 없음」을 선택해주세요'
  }

  const ok = Object.keys(errors).length === 0 && actionErrors.every(e => Object.keys(e).length === 0)
  return { ok, errors, actionErrors }
}

/** 모든 칸이 빈 줄을 뺀 Action 목록. 상태·우선순위는 기본값이 미리 들어 있으므로 보지 않는다. */
export function meaningfulActions<T extends Partial<ActionInput>>(actions: readonly T[] | null | undefined): T[] {
  return (actions ?? []).filter(a =>
    trimmed(a.what) !== '' || trimmed(a.owner) !== '' || trimmed(a.due_date) !== '' || trimmed(a.note) !== '',
  )
}

function validateAction(a: Partial<ActionInput>): Partial<Record<ActionField, string>> {
  const e: Partial<Record<ActionField, string>> = {}
  if (trimmed(a.what) === '') e.what = `${withJosa(ACTION_LABELS.what, '을')} 입력해주세요`
  if (trimmed(a.owner) === '') e.owner = `${withJosa(ACTION_LABELS.owner, '을')} 입력해주세요`
  const due = trimmed(a.due_date)
  if (due === '') e.due_date = `${withJosa(ACTION_LABELS.due_date, '을')} 선택해주세요`
  else if (!isYmd(due)) e.due_date = `${ACTION_LABELS.due_date}: 날짜 형식(YYYY-MM-DD)이 올바르지 않습니다`
  const status = trimmed(a.status)
  if (status !== '' && !(ACTION_STATUSES as readonly string[]).includes(status)) e.status = `${ACTION_LABELS.status}: 목록에 없는 값입니다`
  const priority = trimmed(a.priority)
  if (priority !== '' && !(ACTION_PRIORITIES as readonly string[]).includes(priority)) e.priority = `${ACTION_LABELS.priority}: 목록에 없는 값입니다`
  return e
}

/** 'YYYY-MM-DD' 이고 실제로 있는 날짜인지(윤년 포함). */
export function isYmd(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return false
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3])
  const t = new Date(Date.UTC(y, mo - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d
}

function trimmed(v: unknown): string {
  if (v == null) return ''
  return (typeof v === 'string' ? v : String(v)).trim()
}
