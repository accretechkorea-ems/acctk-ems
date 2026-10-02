-- 의뢰서 목록의 「내용」·「회신」 열 (아직 DB 에 적용하지 않았다 — 이 파일은 적용 전 마이그레이션이다).
--
-- 목록이 보여 주지 못하던 두 가지를 한 번의 호출로 가져온다.
--   · 내용 — 그 의뢰서의 가장 최근 내용 기록 한 줄(없으면 그 기록에 달린 첫 파일 이름)
--   · 회신 — direction = 'received' 인 내용 기록 수·첨부 수·가장 최근 회신 날짜
--
-- 왜 함수인가 — 목록은 한 페이지 50건이고, 이 값들은 inquiry_messages·inquiry_attachments 를
-- 의뢰서별로 집계해야 나온다. 화면에서 하려면 두 표를 통째로 읽어 브라우저에서 묶어야 하는데
-- (PostgREST 기본 1,000행 상한에 걸린다) 여기서는 50건의 id 만 넘기면 끝난다.
--
-- 선행 조건
--   · inquiries_schema.sql · inquiry_messages_schema.sql 이 적용되어 inquiries ·
--     inquiry_messages · inquiry_attachments 와 그 읽기 정책(RLS)이 있어야 한다.
--   · inquiry_messages.direction 이 있어야 한다. **NOT NULL 이 풀려 null 을 허용하는 상태**다
--     (값은 'sent'·'received' — 제약 inquiry_messages_direction_check). 방향을 쓰지 않던 동안
--     만들어진 기록은 null 이고, 이 함수는 그것을 발신으로도 회신으로도 세지 않는다.
--   · inquiries_search_function.sql(search_inquiries·count_inquiries_by_type)과 **무관하다.**
--     이 파일은 그 함수들을 읽지도 고치지도 않는다.
--
-- ┌─ 실행 순서 ────────────────────────────────────────────────────────────────┐
-- │ 1. inquiry_list_extras(uuid[]) 생성 — 이 파일에는 이 함수 하나뿐이다         │
-- │ 2. EXECUTE 권한 — public·anon 회수, authenticated 부여                      │
-- │                                                                            │
-- │ **순수 추가다.** drop·replace 가 없고 기존 함수·표·정책·인덱스를 건드리지      │
-- │ 않으므로, 다른 마이그레이션과의 적용 순서와 무관하게 안전하다. 두 번 돌려도    │
-- │ create or replace 라 같은 결과다.                                           │
-- └────────────────────────────────────────────────────────────────────────────┘
--
-- ┌─ 롤백 SQL ─────────────────────────────────────────────────────────────────┐
-- │ drop function if exists public.inquiry_list_extras(uuid[]);                │
-- │                                                                            │
-- │ ※ 함수만 지운다 — 데이터는 건드리지 않는다. 지워도 목록 화면은 그대로 동작한다 │
-- │   (호출이 실패하면 「내용」·「회신」 칸만 흐린 「-」로 남는다 —                │
-- │   app/inquiries/page.tsx 가 extras 없이도 그리도록 만들어져 있다).           │
-- └────────────────────────────────────────────────────────────────────────────┘
--
-- ┌─ 설계 결정 ────────────────────────────────────────────────────────────────┐
-- │ ① **없는 의뢰서는 행을 만들지 않는다.** 입력에 없는 id, 내용 기록이 전혀 없는  │
-- │    의뢰서는 결과에 나오지 않는다. 0/null 행을 만들어 주지 않는 이유는 화면이    │
-- │    어차피 「행이 없음」과 「전부 0」을 같게 처리해야 하기 때문이다 —            │
-- │    lib/inquirySearch.ts 의 replyView·contentPreview 가 undefined 를 받아      │
-- │    「-」로 떨어뜨린다. 한쪽만 만들어 주면 같은 뜻을 두 모양으로 들고 다닌다.    │
-- │ ② security invoker — RLS 는 **호출자 기준**이다. inquiry_messages ·           │
-- │    inquiry_attachments 에는 이미 읽기 정책이 있으므로(has_team_perm            │
-- │    ('customers')) 이 함수가 그 범위를 넓히지 않는다. definer 로 두면 정책을    │
-- │    우회하는 창이 생긴다.                                                     │
-- │ ③ 입력 id 는 **최대 200개**까지만 본다. 목록 한 페이지가 50건이라 평상시에는   │
-- │    닿지 않는 선이고, 주소를 손으로 만들어 수천 건을 한 번에 집계시키는 것을     │
-- │    막는다. 초과분은 조용히 버린다 — 에러를 던지면 목록 전체가 「-」가 되는데,   │
-- │    앞 200건이라도 보이는 편이 낫다(화면은 빠진 id 를 undefined 로 받는다).     │
-- │ ④ last_body 는 **본문이 공백이 아닌 가장 최근 기록**의 본문이다. 가장 최근     │
-- │    기록이 파일만 있는 건이어도 그 위의 글이 있는 기록을 보여 준다 — 목록에서    │
-- │    「무슨 이야기가 오갔나」를 알고 싶은 것이지 「마지막 줄이 비었나」가 아니다.  │
-- │    last_file_name 은 그와 달리 **가장 최근 기록**(본문 유무와 무관)의 첨부다.  │
-- │    둘의 기준이 다른 것은 의도다 — 화면은 last_body 가 있으면 그것만 쓴다.      │
-- └────────────────────────────────────────────────────────────────────────────┘


-- ── [1단계] 함수 ────────────────────────────────────────────────────────────

create or replace function public.inquiry_list_extras(p_ids uuid[])
returns table (
  inquiry_id      uuid,
  last_body       text,
  last_file_name  text,
  reply_count     integer,
  reply_file_count integer,
  last_reply_date date
)
language sql
stable
security invoker
set search_path = public
as $$
  -- 처리할 id — 중복을 접고 앞에서 200개까지만. (③)
  with ids as (
    select x.id
    from (
      select distinct u.id
      from unnest(coalesce(p_ids, '{}'::uuid[])) as u(id)
      where u.id is not null
      order by u.id
      limit 200
    ) as x
  ),

  -- 그 의뢰서들의 내용 기록. 아래 세 갈래가 모두 이 한 벌을 본다.
  msg as (
    select m.id, m.inquiry_id, m.entry_date, m.body, m.direction
    from public.inquiry_messages m
    join ids on ids.id = m.inquiry_id
  ),

  -- ④ 본문이 공백이 아닌 가장 최근 기록 한 건.
  --   btrim(body, E' \t\r\n') 로 공백·줄바꿈만 있는 본문을 빈 것으로 본다.
  last_text as (
    select distinct on (t.inquiry_id)
      t.inquiry_id,
      t.body
    from msg t
    where btrim(coalesce(t.body, ''), E' \t\r\n') <> ''
    order by t.inquiry_id, t.entry_date desc, t.id desc
  ),

  -- ④ 가장 최근 기록 한 건(본문 유무와 무관) — 그 기록의 첨부를 찾기 위한 것.
  last_msg as (
    select distinct on (t.inquiry_id)
      t.inquiry_id,
      t.id as message_id
    from msg t
    order by t.inquiry_id, t.entry_date desc, t.id desc
  ),

  -- 그 기록에 달린 첨부 중 첫 번째 파일 이름.
  last_file as (
    select distinct on (lm.inquiry_id)
      lm.inquiry_id,
      a.file_name
    from last_msg lm
    join public.inquiry_attachments a on a.message_id = lm.message_id
    order by lm.inquiry_id, a.sort_order, a.created_at, a.id
  ),

  -- 회신 집계 — direction = 'received' 인 기록만. null 과 'sent' 는 세지 않는다.
  reply as (
    select
      r.inquiry_id,
      count(*)::integer                       as reply_count,
      max(r.entry_date)                       as last_reply_date,
      coalesce(sum(r.file_n), 0)::integer     as reply_file_count
    from (
      select
        t.inquiry_id,
        t.entry_date,
        (select count(*) from public.inquiry_attachments a where a.message_id = t.id) as file_n
      from msg t
      where t.direction = 'received'
    ) r
    group by r.inquiry_id
  )

  select
    ids.id as inquiry_id,
    -- 줄바꿈·연속 공백을 한 칸으로 접고 앞 120자까지. 잘렸으면 끝에 …
    case
      when lt.body is null then null
      when char_length(btrim(regexp_replace(lt.body, E'[\\s]+', ' ', 'g'))) > 120
        then left(btrim(regexp_replace(lt.body, E'[\\s]+', ' ', 'g')), 120) || '…'
      else btrim(regexp_replace(lt.body, E'[\\s]+', ' ', 'g'))
    end                                   as last_body,
    lf.file_name                          as last_file_name,
    coalesce(rp.reply_count, 0)           as reply_count,
    coalesce(rp.reply_file_count, 0)      as reply_file_count,
    rp.last_reply_date                    as last_reply_date
  from ids
  left join last_text lt on lt.inquiry_id = ids.id
  left join last_file lf on lf.inquiry_id = ids.id
  left join reply     rp on rp.inquiry_id = ids.id
  -- ① 내용 기록이 전혀 없는 의뢰서는 행을 만들지 않는다.
  where exists (select 1 from msg where msg.inquiry_id = ids.id);
$$;

comment on function public.inquiry_list_extras(uuid[]) is
  '의뢰서 목록의 「내용」·「회신」 열. 한 페이지(50건)의 id 를 넘기면 최근 본문 한 줄과 회신 집계를 돌려준다. 최대 200건.';


-- ── [2단계] EXECUTE 권한 ────────────────────────────────────────────────────
-- 로그인한 사용자만 부를 수 있게 한다. 함수가 security invoker 라 보이는 범위는
-- 그 사용자의 RLS 그대로다(기존 함수들과 같은 규칙 — inquiries_search_function.sql).

revoke execute on function public.inquiry_list_extras(uuid[]) from public, anon;
grant  execute on function public.inquiry_list_extras(uuid[]) to authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- 적용 후 확인 (SQL Editor 에서 사람이 돌려 본다. 읽기 전용이다)
-- ════════════════════════════════════════════════════════════════════════════
--
-- ※ SQL Editor 는 service_role 이라 RLS 를 건너뛴다. 「보이는 범위」는 앱에서 확인해야 한다.
--   여기서 보는 것은 집계가 의도대로 나오는가다.
--
-- ① 함수가 생겼는지 — 1행이 나와야 한다(인자 uuid[], 반환 record, stable, invoker)
-- select p.proname,
--        pg_get_function_identity_arguments(p.oid) as args,
--        p.provolatile,                      -- 's' = stable
--        p.prosecdef                         -- false = security invoker
--   from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public' and p.proname = 'inquiry_list_extras';
--
-- ② 권한 — authenticated 에만 EXECUTE 가 있어야 한다(public·anon 은 나오지 않는다)
-- select grantee, privilege_type
--   from information_schema.routine_privileges
--  where routine_schema = 'public' and routine_name = 'inquiry_list_extras';
--
-- ③ 실제 의뢰서 3개로 호출 — 먼저 id 를 뽑고, 그 배열을 그대로 넣는다
-- select id, inquiry_no from public.inquiries order by created_at desc limit 3;
--
-- select * from public.inquiry_list_extras(
--   array[
--     '00000000-0000-0000-0000-000000000000',   -- ← 위에서 뽑은 id 로 바꾼다
--     '00000000-0000-0000-0000-000000000000',
--     '00000000-0000-0000-0000-000000000000'
--   ]::uuid[]
-- );
--
--   기대 — **회신이 있는 의뢰서**: reply_count ≥ 1, last_reply_date 가 그 회신 기록의
--          가장 늦은 entry_date, reply_file_count 는 그 회신들에 달린 첨부 수(없으면 0).
--          last_body 는 본문이 있는 가장 최근 기록의 본문(한 줄로 접히고 120자 + …).
--        — **회신이 없는 의뢰서**(발신만, 또는 direction 이 전부 null): reply_count = 0,
--          reply_file_count = 0, last_reply_date = null. last_body·last_file_name 은
--          내용 기록이 있으면 채워진다. 화면은 reply_count 0 을 「-」로 그린다.
--        — **내용 기록이 전혀 없는 의뢰서**: 아예 행이 나오지 않는다(①). 화면도 「-」다.
--
-- ④ 본문 접기·자르기 — 줄바꿈이 한 칸으로 바뀌고 120자에서 끊기는지
-- select inquiry_id, char_length(last_body) as len, last_body
--   from public.inquiry_list_extras(
--     (select array_agg(id) from (select id from public.inquiries limit 50) s)
--   )
--  where last_body is not null
--  order by len desc
--  limit 5;
--   기대 — len 은 121 이하다(120자 + '…' 한 글자). last_body 에 줄바꿈이 없다.
--
-- ⑤ 200건 상한 — 300건을 넣어도 200행 이하만 돌아온다
-- select count(*) from public.inquiry_list_extras(
--   (select array_agg(id) from (select id from public.inquiries limit 300) s)
-- );
--   기대 — 200 이하(내용 기록이 없는 의뢰서는 행이 빠지므로 그보다 적을 수 있다).
--
-- ⑥ null·빈 배열 — 에러 없이 0행
-- select count(*) from public.inquiry_list_extras(null);
-- select count(*) from public.inquiry_list_extras('{}'::uuid[]);
--
-- ⑦ direction null 이 섞여 있어도 회신으로 세지 않는지 — 방향별 기록 수를 직접 세어 비교한다
-- select m.inquiry_id,
--        count(*) filter (where m.direction = 'received') as received,
--        count(*) filter (where m.direction = 'sent')     as sent,
--        count(*) filter (where m.direction is null)      as unset
--   from public.inquiry_messages m
--  group by m.inquiry_id
--  order by unset desc
--  limit 5;
--   기대 — 위 행들의 received 가 ③ 결과의 reply_count 와 같다(unset 은 어디에도 안 들어간다).
