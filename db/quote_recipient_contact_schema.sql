-- 견적 수신인 = 고객사 담당자 (2026-11-16 작성). **아직 적용하지 않았다 — 확인 뒤 돌린다.**
--
-- ════════════════════════════════════════════════════════════════
-- 왜 필요한가
-- ════════════════════════════════════════════════════════════════
--   지금 quotes.recipient 는 **자유 텍스트**다. 저장된 158건 중 145건이 채워져 있고
--   거의 전부 「김소희 과장님」 꼴이다 — 이름·직위·존칭이 한 덩어리로 들어 있다.
--   그래서 아래가 전부 막혀 있다.
--     · 같은 사람인데 「김강민 선임님」·「김강민 선임」처럼 다르게 적힌다(실제로 둘 다 있다).
--     · 담당자가 바뀌거나 직위가 오르면 지난 견적과 새 견적이 어긋난다.
--     · 그 사람에게 보낸 견적을 모아 볼 수 없다(글자 일치로만 찾아야 한다).
--   고객사 담당자는 이미 contacts 표에 1,414명이 있다(고객사 1,315곳, 평균 1.1명).
--   견적이 그 줄을 **가리키게** 한다.
--
-- ════════════════════════════════════════════════════════════════
-- 옛 글자는 지우지 않는다
-- ════════════════════════════════════════════════════════════════
--   recipient 열을 **그대로 둔다.** 지난 145건은 그 글자가 유일한 기록이고, 담당자 표로
--   옮길 근거가 없다(「박보경님」이 contacts 의 누구인지는 사람만 안다). 새 견적은
--   recipient_contact_id 를 채우고, 화면·PDF 는 **FK 가 있으면 담당자, 없으면 옛 글자**를 쓴다.
--   옛 견적을 다시쓰기 해도 FK 는 비어 있으므로 사람이 한 번 골라 주면 그때부터 이어진다.
--
-- ════════════════════════════════════════════════════════════════
-- 타입
-- ════════════════════════════════════════════════════════════════
--   contacts.contact_id 는 bigint 다(2026-11-16 PostgREST 스키마로 확인).
--   FK 는 참조 대상과 타입이 같아야 하므로 bigint 로 적는다.
--
-- ════════════════════════════════════════════════════════════════

alter table public.quotes
  add column if not exists recipient_contact_id bigint
  references public.contacts(contact_id);

comment on column public.quotes.recipient_contact_id is
  '수신인 담당자(contacts.contact_id). 2026-11-16 부터 새 견적이 채운다. '
  'null 이면 그 전 견적이라 recipient 의 자유 텍스트를 쓴다 — 두 칸은 함께 읽는다.';

-- ⚠ 아래 한 문장은 **적용 뒤에 문구만 고쳤다**(2026-11-16, 구현하면서). 칸·제약은 그대로이고
--    주석 글자만 다르다 — 맞추고 싶으면 이 comment 문장 하나만 다시 돌리면 된다.
comment on column public.quotes.recipient is
  '그 견적서에 **찍힌 수신인 글자**(「김소희 과장님」). 2026-11-16 부터는 '
  'recipient_contact_id 가 정본이고 이 칸은 그때 표기의 스냅샷이다 — 담당자 이름·직위가 '
  '나중에 바뀌어도 그때 보낸 문서의 글자가 남는다(quote_items.part_code 와 같은 규칙). '
  '그 전 견적에는 FK 가 없어 이 글자가 유일한 기록이다.';

-- 담당자로 견적을 거슬러 찾는 길(고객사 상세에서 「이 담당자에게 보낸 견적」).
create index if not exists quotes_recipient_contact_idx
  on public.quotes (recipient_contact_id)
  where recipient_contact_id is not null;

-- ── 확인용 읽기 ────────────────────────────────────────────────────────────
-- select count(*) filter (where recipient_contact_id is not null) as 새로운_방식,
--        count(*) filter (where recipient_contact_id is null and coalesce(recipient,'') <> '') as 옛_글자,
--        count(*) filter (where recipient_contact_id is null and coalesce(recipient,'') = '') as 둘_다_없음
--   from public.quotes;
