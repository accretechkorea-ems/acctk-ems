// 견적 **수신인** — 고객사 담당자 한 사람을 가리킨다.
//
// ── 왜 글자가 아니라 사람인가 ───────────────────────────────────────────────
//   2026-11-16 까지 quotes.recipient 는 자유 입력이었다. 저장된 158건 중 145건이
//   「김소희 과장님」 꼴로 들어 있고, 같은 사람이 「김강민 선임님」·「김강민 선임」 두 가지로
//   적힌 건도 있다. 담당자는 이미 contacts 표에 있으므로 견적이 그 줄을 가리키게 했다
//   (quotes.recipient_contact_id — db/quote_recipient_contact_schema.sql).
//
// ── 옛 글자는 그대로 읽는다 ─────────────────────────────────────────────────
//   지난 145건에는 FK 가 없다. 그 글자가 유일한 기록이라 **FK 가 없으면 옛 글자**를 쓴다
//   (displayRecipient). 담당자 표의 누구인지는 사람만 알 수 있어 옮기지 않았다.
//
// 순수 함수만 둔다 — 하네스가 그대로 돌린다(scripts/quote-recipient-check.js).

/** 판정에 쓰는 담당자의 모양. contacts 의 한 줄이면 그대로 들어맞는다. */
export type RecipientContactLike = {
  name?: string | null
  position?: string | null
}

/**
 * 직위에서 **끝의 존칭을 뗀다.**
 *
 * contacts.position 에는 「팀장님」처럼 존칭이 이미 붙은 값이 섞여 있다(실제 데이터다).
 * 그대로 두고 「님」을 붙이면 「팀장님님」이 된다. 공백만 든 값(" ")도 있어 함께 턴다.
 */
export function cleanPosition(position: string | null | undefined): string {
  return (position ?? '').trim().replace(/님+$/, '').trim()
}

/**
 * 고르는 자리에 보이는 이름 — 「김소희 과장」. **존칭을 붙이지 않는다**(목록이라서).
 * 직위가 없으면 이름만.
 */
export function contactOptionLabel(c: RecipientContactLike | null | undefined): string {
  const name = (c?.name ?? '').trim()
  const position = cleanPosition(c?.position)
  if (!name) return position
  return position ? `${name} ${position}` : name
}

/**
 * 문서에 찍히는 수신인 — 「김소희 과장님」. 직위가 없으면 「김소희님」.
 * 이름이 비면 빈 글자다(찍을 것이 없다 — 부르는 쪽이 옛 글자로 떨어진다).
 */
export function recipientLabel(c: RecipientContactLike | null | undefined): string {
  const name = (c?.name ?? '').trim()
  if (!name) return ''
  const position = cleanPosition(c?.position)
  return position ? `${name} ${position}님` : `${name}님`
}

/**
 * 화면·PDF·검토표·엑셀이 함께 쓰는 **한 가지 규칙**.
 *   담당자가 연결돼 있으면 그 이름으로 짓고(위 recipientLabel),
 *   없으면 옛 견적의 글자를 그대로 쓴다.
 * 둘 다 없으면 빈 글자다.
 */
export function displayRecipient(
  contact: RecipientContactLike | null | undefined,
  legacyText: string | null | undefined,
): string {
  return recipientLabel(contact) || (legacyText ?? '').trim()
}
