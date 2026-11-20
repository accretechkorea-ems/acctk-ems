// 글자·간격 토큰 — 목록 보기(고객사)가 쓰는 한 벌.
//
// 왜 두는가: 같은 자리의 글자가 화면마다 13/700 과 14/700 로 갈렸고, 보조 글자는
// #6b7280 과 #9ca3af 가 섞여 「어느 것이 덜 중요한가」가 들쭉날쭉했다. 카드 머리줄,
// 본문, 라벨 셋만 정해 두고 그 밖은 만들지 않는다.
//
// 색은 .claude/rules/design-system.md 의 표에 있는 값만 쓴다(새 색 금지).

import type { CSSProperties } from 'react'

/** 카드·구역 머리줄 — 「사업장 6」·「활동 이력」·「장비」. */
export const TITLE: CSSProperties = { fontSize: 16, fontWeight: 600, color: '#111827', letterSpacing: '-0.2px' }

/** 본문 — 표의 값, 카드의 내용. */
export const BODY: CSSProperties = { fontSize: 13, color: '#111827' }

/** 보조 — 본문에 딸린 설명·메타. */
export const SUB: CSSProperties = { fontSize: 12, color: '#6b7280' }

/** 라벨 — 칸 이름(폼·정보 줄의 왼쪽). */
export const LABEL: CSSProperties = { fontSize: 12, fontWeight: 700, color: '#374151' }

/**
 * 간격은 **8의 배수**로만 고른다. 4 는 글자 사이처럼 아주 좁은 자리에만 쓴다.
 * (6·10·14 처럼 어중간한 값을 없애려고 둔다 — 줄을 맞춰 보면 바로 티가 난다)
 */
export const SPACE = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const
