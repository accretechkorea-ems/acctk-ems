'use client'

import { useState, type CSSProperties } from 'react'

/**
 * 폼 필드 검증 에러 공용 모듈.
 *  - useFieldErrors: 필드별 에러 상태 + 수집(validate) + 해제(clearError)
 *  - FieldError: 에러 메시지 인라인 표시 (없으면 null → 공간 차지 안 함)
 *  - errText / errBorder: 에러 표기 스타일 토큰 (시간 검증 등 기존 빨간 표기와 동일 값)
 *
 * 시간 검증처럼 "항상 파생 표시"되는 에러는 이 훅에 넣지 말 것 —
 * 이 훅은 "저장 시 수집 + 값 변경 시 해제" 성격의 검증만 담당한다.
 */

// ── 스타일 토큰 ──
export const errText: CSSProperties = { marginTop: 6, fontSize: 12, color: '#dc2626' }
export const errBorder = '1px solid #dc2626'

// ── 에러 메시지 컴포넌트 ──
export function FieldError({ message, style }: { message?: string; style?: CSSProperties }) {
  if (!message) return null
  return <div style={{ ...errText, ...style }}>{message}</div>
}

// ── 필드 검증 에러 훅 ──
// K 를 필드 key 유니온으로 제약 → 존재하지 않는 key 사용을 컴파일 타임에 차단.
export function useFieldErrors<K extends string>() {
  const [errors, setErrors] = useState<Partial<Record<K, string>>>({})

  // 해당 필드 값이 바뀌면 그 필드 에러만 즉시 해제
  const clearError = (key: K) => setErrors(prev => {
    if (!prev[key]) return prev
    const next = { ...prev }
    delete next[key]
    return next
  })

  // rules: { key: message | null }. message 가 있으면 에러로 담는다.
  // 결과를 한 번에 setErrors 하고, 에러가 하나도 없으면 true(유효) 반환.
  const validate = (rules: Partial<Record<K, string | null | undefined>>): boolean => {
    const next: Partial<Record<K, string>> = {}
    for (const key in rules) {
      const msg = rules[key]
      if (msg) next[key as K] = msg
    }
    setErrors(next)
    return Object.keys(next).length === 0
  }

  return { errors, setErrors, clearError, validate }
}
