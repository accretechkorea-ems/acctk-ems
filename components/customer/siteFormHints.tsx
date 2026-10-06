'use client'

/**
 * 사업장 등록·수정 모달의 보조 안내 문구.
 *
 * 두 모달(components/home/AddCustomerModal · components/customer/modals/CustomerEditModal)이
 * 같은 글자를 보여야 해서 여기 한 곳에 둔다 — 양쪽에 따로 적어 두면 한쪽만 고쳐져 설명이 갈린다.
 *
 * 「회사명」 안내는 이 파일의 상수를 ParentPicker 가 직접 그린다(그 칸을 두 모달이 함께 쓰는
 * 부품이라, 거기 한 번 넣으면 두 모달에 모두 나온다).
 *
 * 스타일은 등록 모달이 이미 쓰고 있던 보조 글씨 값 그대로다
 * (AddCustomerModal 의 「선택 사항입니다…」 줄 — fontSize 12 · #9ca3af · marginTop 4).
 */

import type { CSSProperties } from 'react'

/** 사업장명 칸 아래 — 사업장이 한 곳뿐인 회사는 회사 칸을 비우고 여기에 회사 이름을 쓴다. */
export const SITE_NAME_HINT = '사업장이 1곳뿐이면 회사 이름을 그대로 입력하세요.'

/** 회사명 칸 아래 — 여러 사업장을 묶을 때만 고른다. */
export const PARENT_COMPANY_HINT = '사업장이 여러 곳일 때만 선택하세요. 1곳이면 비워 두세요.'

const hintStyle: CSSProperties = { fontSize: 12, color: '#9ca3af', marginTop: 4, lineHeight: 1.6 }

/** 입력칸 아래 보조 안내 한 줄. */
export function FieldHint({ text }: { text: string }) {
  return <div style={hintStyle}>{text}</div>
}
