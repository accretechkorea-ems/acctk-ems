-- 의뢰서 취소 함수 (2026-10-02 DB 적용 확인). 기록용, 다시 실행하지 마라.
--
-- inquiries_schema.sql 을 먼저 적용한 뒤에 돌린다. 그 파일이 만든 inquiries·inquiry_sequence 가
-- 없으면 이 함수는 만들어지기만 하고 부를 때 실패한다.
--
-- ┌─ 실행 순서 ────────────────────────────────────────────────────────────────┐
-- │ 0. (선행) inquiries_schema.sql 적용 — inquiries · inquiry_sequence 가 있어야 한다 │
-- │ 1. cancel_inquiry 함수 생성                                                 │
-- │ 2. EXECUTE 권한 회수 + service_role 부여                                    │
-- └────────────────────────────────────────────────────────────────────────────┘
--
-- ┌─ 롤백 SQL ─────────────────────────────────────────────────────────────────┐
-- │ drop function if exists public.cancel_inquiry(uuid);                       │
-- │                                                                            │
-- │ ※ 되돌려도 이미 취소된 행은 그대로 남는다(status='cancelled'). 반환된 번호도  │
-- │   되살아나지 않는다 — 함수를 지우는 것이지 지난 처리를 무르는 것이 아니다.     │
-- └────────────────────────────────────────────────────────────────────────────┘
--
-- 왜 DB 함수인가
--   「마지막 번호인지」를 보고, 그에 따라 행을 지우고 카운터를 되돌리는 일은 한 덩어리여야 한다.
--   라우트에서 조회 → 판정 → 삭제 → 카운터 수정으로 나누면 그 사이에 다른 사람이 새 번호를
--   받아 가면서 카운터가 어긋난다. 한 함수 안에서 잠그고 끝낸다.


-- ── 1. 취소 함수 ────────────────────────────────────────────────────────────
--
-- 돌려주는 값 네 가지
--   'not_found'         — 그 id 의 의뢰서가 없다(이미 반환되어 지워졌을 수도 있다).
--   'already_cancelled' — 이미 취소된 건.
--   'released'          — 번호를 반환했다. 행을 지우고 카운터를 1 되돌렸다.
--                         다음 새 작성이 같은 번호를 다시 받는다.
--   'abandoned'         — 번호를 버렸다. 행은 status='cancelled' 로 남고 번호는 재사용하지 않는다.
--
-- 반환과 버림을 가르는 기준은 하나다 — 이 번호가 그 (종류, 기간)에서 **마지막으로 발급된**
-- 번호인가(inquiries.seq = inquiry_sequence.seq). 마지막이 아니면 가운데를 비울 수 없으므로 버린다.
--
-- ※ 소급 등록(is_backfill=true)은 마지막 번호처럼 보여도 반환하지 않는다.
--   종이로 이미 나간 번호를 나중에 시스템에 넣은 것이라, 그 번호는 바깥에서 이미 쓰이고 있다.
--   반환해 다음 사람에게 다시 내주면 같은 번호의 서류가 둘이 된다. 그래서 항상 버림이다.
--
-- ※ 잠그는 순서를 claim_inquiry_seq 와 맞춘다(inquiry_sequence 먼저 → inquiries 나중).
--   claim 쪽은 insert … on conflict do update 로 inquiry_sequence 행을 먼저 잠그고,
--   그 뒤 inquiries 에 insert 한다. 이 함수가 반대로 잡으면 두 흐름이 서로를 기다려 교착한다.
create or replace function public.cancel_inquiry(p_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type    text;
  v_period  text;
  v_seq     integer;
  v_backfill boolean;
  v_status  text;
  v_counter integer;
begin
  -- a) 어느 카운터를 잠가야 하는지 알아낸다. 여기서는 아직 잠그지 않는다 —
  --    잠금 순서를 지키려면 inquiry_sequence 를 먼저 잡아야 하기 때문이다.
  select i.inquiry_type, i.period_key, i.seq
    into v_type, v_period, v_seq
  from public.inquiries i
  where i.id = p_id;

  if not found then
    return 'not_found';
  end if;

  -- b) 카운터 행을 먼저 잠근다. 이 줄이 끝나면 그 (종류, 기간)의 새 발급은 우리 뒤에 줄을 선다.
  select s.seq into v_counter
  from public.inquiry_sequence s
  where s.type_code = v_type and s.period_key = v_period
  for update;

  -- 카운터 행이 없는 경우 — 스키마의 초기 insert 가 만들지 않은 (종류, 기간)이다.
  -- 되돌릴 카운터가 없으니 반환할 수 없다. 버림으로 처리한다.
  if not found then
    v_counter := null;
  end if;

  --    그다음 의뢰서 행을 잠그고 상태를 다시 읽는다. 위에서 읽은 뒤 누가 먼저 취소했을 수 있다.
  select i.status, i.seq, i.is_backfill
    into v_status, v_seq, v_backfill
  from public.inquiries i
  where i.id = p_id
  for update;

  if not found then
    -- 그 사이에 누가 먼저 반환해 행이 사라졌다.
    return 'not_found';
  end if;

  -- c) 이미 취소된 건은 아무것도 하지 않는다. 두 번 눌러도 카운터가 두 번 내려가면 안 된다.
  if v_status = 'cancelled' then
    return 'already_cancelled';
  end if;

  -- d) 버림 — 소급 등록이거나, 이 번호 뒤로 이미 다른 번호가 나갔다.
  if v_backfill or v_counter is null or v_seq <> v_counter then
    update public.inquiries
    set status = 'cancelled', cancelled_at = now(), updated_at = now()
    where id = p_id;
    return 'abandoned';
  end if;

  -- e) 반환 — 마지막으로 발급된 번호다. 행을 지우고 카운터를 하나 되돌린다.
  --    inquiry_attachments 는 ON DELETE CASCADE 로 함께 지워진다(스토리지 파일은 아니다 —
  --    라우트가 이 함수를 부르기 전에 먼저 지운다).
  delete from public.inquiries where id = p_id;

  update public.inquiry_sequence
  set seq = seq - 1
  where type_code = v_type and period_key = v_period;

  return 'released';
end;
$$;


-- ── 2. 실행 권한 ────────────────────────────────────────────────────────────
-- 서버(service role)에서만 부른다. 브라우저에서 rpc 로 부를 수 있으면 남의 의뢰서를 지울 수 있다.
-- claim_inquiry_seq · bump_inquiry_seq 와 같은 방식이다.
revoke execute on function public.cancel_inquiry(uuid) from public, anon, authenticated;
grant  execute on function public.cancel_inquiry(uuid) to service_role;
