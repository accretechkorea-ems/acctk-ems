-- 의뢰서 검색·페이지 함수 (아직 DB 에 적용하지 않았다 — 이 파일은 적용 전 마이그레이션이다).
--
-- 지금 목록 화면은 inquiries 를 통째로 읽어 브라우저에서 거른다. 건수가 늘면 PostgREST 기본
-- 상한(1,000행)에서 **조용히 잘리고**, 내용 기록·첨부 파일명은 아예 검색할 수 없다.
-- 한 페이지 분량만 서버에서 골라 주는 함수 둘을 둔다.
--
-- 선행 조건
--   · inquiries_schema.sql · inquiry_messages_schema.sql 이 적용되어 inquiries ·
--     inquiry_messages · inquiry_attachments 와 그 읽기 정책(RLS)이 있어야 한다.
--   · 이 파일은 표·정책·인덱스를 만들지 않는다. 함수만 만든다.
--
-- ┌─ 실행 순서 ────────────────────────────────────────────────────────────────┐
-- │ 1. 헬퍼 — inquiry_search_words(검색어 쪼개기) · inquiry_snippet(발췌)        │
-- │ 2. 공통 조건 — inquiry_search_base(종류 조건만 빼고 전부 여기 한 곳)         │
-- │ 3. search_inquiries(한 페이지 행)                                           │
-- │ 4. count_inquiries_by_type(종류별 건수)                                     │
-- │ 5. EXECUTE 권한 — public·anon 회수, authenticated 부여                      │
-- │ 2 가 3·4 보다 먼저여야 한다(둘 다 2 를 부른다).                              │
-- └────────────────────────────────────────────────────────────────────────────┘
--
-- ┌─ 롤백 SQL (역순) ──────────────────────────────────────────────────────────┐
-- │ drop function if exists public.count_inquiries_by_type(text, integer, text, integer); │
-- │ drop function if exists public.search_inquiries(text, text, integer, text, integer, integer, integer); │
-- │ drop function if exists public.inquiry_search_base(text, integer, text, integer);     │
-- │ drop function if exists public.inquiry_snippet(text, text);                 │
-- │ drop function if exists public.inquiry_search_words(text);                  │
-- │                                                                            │
-- │ ※ 함수만 지운다 — 데이터는 건드리지 않는다. 화면은 되돌리기 전까지 목록을    │
-- │   읽지 못하므로, 롤백한다면 app/inquiries/page.tsx 도 함께 되돌려야 한다.    │
-- └────────────────────────────────────────────────────────────────────────────┘
--
-- 왜 SECURITY INVOKER 인가
--   이 함수들은 브라우저가 직접 부른다(supabase.rpc). DEFINER 로 두면 RLS 를 건너뛰어
--   남의 의뢰서까지 보이게 된다. INVOKER 라 inquiries·inquiry_messages·inquiry_attachments 의
--   읽기 정책이 그대로 적용된다 — 지금 화면이 직접 select 할 때와 보이는 범위가 같다.
--
-- 왜 LIKE 가 아니라 strpos 인가
--   파일명·업체명에 % 나 _ 가 흔하다(예: '80%_도면.pdf'). LIKE 는 그 글자를 와일드카드로
--   읽어 엉뚱하게 맞고, escape 를 붙이면 역슬래시까지 다뤄야 한다.
--   strpos(lower(열), lower(단어)) > 0 은 **글자 그대로** 비교하므로 그 문제가 없다.


-- ════════════════════════════════════════════════════════════════
-- [1단계] 헬퍼
-- ════════════════════════════════════════════════════════════════

-- 검색어를 소문자 단어 배열로. 공백으로 나누고 빈 단어는 버리며 최대 5개만 쓴다.
-- 5개로 끊는 이유 — 단어마다 EXISTS 가 하나씩 늘어난다. 사람이 다섯 단어를 넘겨 넣는 일은
-- 드물고, 넘겨도 앞 다섯 개로 충분히 좁혀진다.
create or replace function public.inquiry_search_words(p_q text)
returns text[]
language sql
immutable
set search_path = public
as $$
  select coalesce(
    (select array_agg(w order by i) from (
       select lower(w) as w, i
       from unnest(regexp_split_to_array(btrim(coalesce(p_q, '')), '\s+')) with ordinality as t(w, i)
       where btrim(w) <> ''
       limit 5
     ) s),
    '{}'::text[]
  );
$$;

-- 본문에서 맞은 단어 주변을 잘라 낸다(앞 30자 + 단어 + 뒤 60자).
-- 줄바꿈·연속 공백을 한 칸으로 바꾼 **뒤에** 자리를 다시 찾는다 — 바꾸기 전 위치로 자르면
-- 글자 수가 달라져 엉뚱한 자리가 나온다.
create or replace function public.inquiry_snippet(p_body text, p_word text)
returns text
language sql
immutable
set search_path = public
as $$
  with norm as (
    select btrim(regexp_replace(coalesce(p_body, ''), '\s+', ' ', 'g')) as b
  ), hit as (
    select b,
           strpos(lower(b), lower(coalesce(p_word, ''))) as p,
           length(coalesce(p_word, '')) as wlen
    from norm
    where coalesce(p_word, '') <> ''
  ), cut as (
    select b, wlen,
           greatest(1, p - 30) as s,
           (p - greatest(1, p - 30)) + wlen + 60 as len
    from hit
    where p > 0
  )
  select case when s > 1 then '…' else '' end
      || substr(b, s, len)
      || case when s + len - 1 < length(b) then '…' else '' end
  from cut;
$$;


-- ════════════════════════════════════════════════════════════════
-- [2단계] 공통 조건 — 종류 말고 전부 여기 한 곳
-- ════════════════════════════════════════════════════════════════
--
-- 종류(p_type)는 받지 않는다. 레일에 6종 건수를 **모두** 보여 주려면 건수 함수가 종류로
-- 거르면 안 되기 때문이다. 종류 조건은 search_inquiries 만 덧붙인다.
--
-- 검색은 단어끼리 AND 다: 모든 단어가 각각 (번호 · 업체명 · 어느 내용 기록 본문 ·
-- 어느 첨부 파일명) 중 **하나에라도** 들어 있어야 한다.
-- 「맞지 않는 단어가 하나도 없다(not exists … where not …)」로 뒤집어 쓴 이유는
-- 단어 수가 가변이라 AND 를 늘어놓을 수 없기 때문이다.
create or replace function public.inquiry_search_base(
  p_q text,
  p_year integer,
  p_status text,
  p_owner integer
)
returns setof public.inquiries
language sql
stable
security invoker
set search_path = public
as $$
  select i.*
  from public.inquiries i
  cross join lateral (select public.inquiry_search_words(p_q) as words) w
  where (p_year is null
         or (i.issued_date >= make_date(p_year, 1, 1)
             and i.issued_date < make_date(p_year + 1, 1, 1)))
    and (p_status is null or i.status = p_status)
    and (p_owner is null or i.created_by = p_owner)
    and (
      cardinality(w.words) = 0
      or not exists (
        select 1
        from unnest(w.words) as word
        where not (
          strpos(lower(i.inquiry_no), word) > 0
          or strpos(lower(coalesce(i.title, '')), word) > 0
          or exists (
            select 1 from public.inquiry_messages m
            where m.inquiry_id = i.id
              and strpos(lower(coalesce(m.body, '')), word) > 0
          )
          or exists (
            select 1 from public.inquiry_attachments a
            where a.inquiry_id = i.id
              and strpos(lower(a.file_name), word) > 0
          )
        )
      )
    );
$$;


-- ════════════════════════════════════════════════════════════════
-- [3단계] 한 페이지 분량
-- ════════════════════════════════════════════════════════════════
--
-- 총건수는 돌려주지 않는다 — 4단계의 종류별 건수를 합치면 나오고, 그 값은 레일에도 써야 해서
-- 어차피 같이 부른다. 두 번 세지 않으려는 것이다.
--
-- 정렬은 지금 화면과 같다: 발행일 내림차순, 같은 날이면 순번 내림차순.
create or replace function public.search_inquiries(
  p_q text,
  p_type text,
  p_year integer,
  p_status text,
  p_owner integer,
  p_limit integer,
  p_offset integer
)
returns table (
  id uuid,
  inquiry_no text,
  title text,
  status text,
  inquiry_type text,
  seq integer,
  issued_date date,
  created_by integer,
  owner_name text,
  owner_position text,
  snippet text,
  match_files text[]
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    i.id, i.inquiry_no, i.title, i.status, i.inquiry_type, i.seq, i.issued_date, i.created_by,
    e.name     as owner_name,
    e.position as owner_position,
    snip.snippet,
    coalesce(mf.files, '{}'::text[]) as match_files
  from public.inquiry_search_base(p_q, p_year, p_status, p_owner) i
  cross join lateral (select public.inquiry_search_words(p_q) as words) w
  left join public.engineers e on e.engineer_id = i.created_by
  -- 발췌 — 본문에서 걸린 가장 최근 내용 기록 하나에서만 만든다.
  left join lateral (
    select public.inquiry_snippet(m.body, hw.word) as snippet
    from public.inquiry_messages m
    cross join lateral (
      -- 그 본문에서 가장 앞서 맞은 단어. 여러 단어가 맞으면 먼저 나오는 쪽을 쓴다.
      select word
      from unnest(w.words) as word
      where strpos(lower(coalesce(m.body, '')), word) > 0
      order by strpos(lower(coalesce(m.body, '')), word)
      limit 1
    ) hw
    where m.inquiry_id = i.id
    order by m.entry_date desc, m.id desc
    limit 1
  ) snip on true
  -- 맞은 첨부 파일명 최대 3개.
  left join lateral (
    select array_agg(fn order by fn) as files
    from (
      select distinct a.file_name as fn
      from public.inquiry_attachments a
      where a.inquiry_id = i.id
        and exists (select 1 from unnest(w.words) as word
                    where strpos(lower(a.file_name), word) > 0)
      order by 1
      limit 3
    ) t
  ) mf on true
  where (p_type is null or i.inquiry_type = p_type)
  order by i.issued_date desc, i.seq desc
  limit greatest(coalesce(p_limit, 50), 1)
  offset greatest(coalesce(p_offset, 0), 0);
$$;


-- ════════════════════════════════════════════════════════════════
-- [4단계] 종류별 건수
-- ════════════════════════════════════════════════════════════════
--
-- 종류 조건을 **받지 않는다**. 레일은 「지금 조건에서 각 종류가 몇 건인가」를 보여 주는 자리라,
-- 종류로 거르면 고른 종류만 남아 나머지가 0 으로 보인다.
-- 전체 건수와 페이지 수는 이 결과의 합(종류를 고른 경우 그 종류의 n)으로 화면이 구한다.
create or replace function public.count_inquiries_by_type(
  p_q text,
  p_year integer,
  p_status text,
  p_owner integer
)
returns table (inquiry_type text, n bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select i.inquiry_type, count(*) as n
  from public.inquiry_search_base(p_q, p_year, p_status, p_owner) i
  group by i.inquiry_type;
$$;


-- ════════════════════════════════════════════════════════════════
-- [5단계] EXECUTE 권한
-- ════════════════════════════════════════════════════════════════
--
-- 브라우저가 직접 부르므로 authenticated 에 준다. anon(로그인 전)과 public 에서는 회수한다 —
-- 로그인하지 않은 쪽이 번호 체계를 훑어볼 길을 두지 않는다.
-- (SECURITY INVOKER 라 설령 불러도 RLS 가 다시 막지만, 입구도 함께 닫아 둔다.)
revoke execute on function public.inquiry_search_words(text) from public, anon;
revoke execute on function public.inquiry_snippet(text, text) from public, anon;
revoke execute on function public.inquiry_search_base(text, integer, text, integer) from public, anon;
revoke execute on function public.search_inquiries(text, text, integer, text, integer, integer, integer) from public, anon;
revoke execute on function public.count_inquiries_by_type(text, integer, text, integer) from public, anon;

grant execute on function public.inquiry_search_words(text) to authenticated;
grant execute on function public.inquiry_snippet(text, text) to authenticated;
grant execute on function public.inquiry_search_base(text, integer, text, integer) to authenticated;
grant execute on function public.search_inquiries(text, text, integer, text, integer, integer, integer) to authenticated;
grant execute on function public.count_inquiries_by_type(text, integer, text, integer) to authenticated;


-- ════════════════════════════════════════════════════════════════
-- [적용 후 확인] SQL Editor 에서 하나씩 돌려 본다
-- ════════════════════════════════════════════════════════════════
--
-- ※ SQL Editor 는 service_role 이라 RLS 를 건너뛴다. 「보이는 범위」는 앱에서 확인해야 한다.
--   여기서 보는 것은 조건·발췌·건수가 의도대로 나오는가다.
--
-- ① 검색어 없음 — 올해 1페이지(50건)
-- select inquiry_no, title, status, issued_date, owner_name, owner_position, snippet, match_files
-- from public.search_inquiries(null, null, extract(year from now() at time zone 'Asia/Seoul')::int, null, null, 50, 0);
--
-- ② 업체명 검색 — '가온' 이 번호·업체명·내용·파일명 어디든 들어간 건
-- select inquiry_no, title, snippet, match_files
-- from public.search_inquiries('가온', null, null, null, null, 50, 0);
--
-- ③ 파일명 검색 — match_files 에 맞은 파일이 보여야 한다
-- select inquiry_no, title, match_files
-- from public.search_inquiries('도면', null, null, null, null, 50, 0);
--
-- ④ 내용 검색 — snippet 에 앞뒤 「…」와 함께 발췌가 보여야 한다
-- select inquiry_no, snippet
-- from public.search_inquiries('견적', null, null, null, null, 50, 0)
-- where snippet is not null;
--
-- ⑤ 두 단어 AND — 둘 다 들어간 건만
-- select inquiry_no, title from public.search_inquiries('가온 도면', null, null, null, null, 50, 0);
--
-- ⑥ 연도·상태 필터 — 2026년 완료 건
-- select inquiry_no, status, issued_date
-- from public.search_inquiries(null, null, 2026, 'done', null, 50, 0);
--
-- ⑦ 담당자 필터 — engineer_id 를 넣어 본다
-- select inquiry_no, owner_name, owner_position
-- from public.search_inquiries(null, null, null, null, 1, 50, 0);
--
-- ⑧ 종류별 건수 — 종류 조건이 없으므로 6종이 다 나온다(0건인 종류는 행이 없다)
-- select * from public.count_inquiries_by_type(null, 2026, null, null) order by inquiry_type;
--
-- ⑨ 페이지 — 2페이지(51~100번째)
-- select inquiry_no from public.search_inquiries(null, null, null, null, null, 50, 50);
--
-- ⑩ 와일드카드가 글자 그대로 비교되는지 — '%' 를 넣어도 전부 걸리지 않아야 한다
-- select count(*) from public.search_inquiries('%', null, null, null, null, 50, 0);
