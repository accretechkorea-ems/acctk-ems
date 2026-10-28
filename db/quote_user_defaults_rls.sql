-- quote_user_defaults RLS 정책 (2026-10-28 작성). **아직 적용하지 않았다.**
--   표 자체는 이미 DB 에 있다(engineer_email·category·exchange_rate·tariff_rate·margin_rate·
--   updated_at, PK = engineer_email + category, RLS 켜짐 · **정책 0개**).
--   정책이 없으면 RLS 가 켜진 표는 authenticated 에게 **아무것도 허용하지 않는다** —
--   읽기도 쓰기도 전부 막힌다(오류가 아니라 0행으로 끝난다). 그래서 이 파일을 돌리기
--   전까지 「내 설정 기억」 기능은 조용히 아무 일도 하지 않는다. 화면은 그래도 멀쩡하다:
--   행이 없으면 지금까지의 기본값(오늘 환율 · 관세 1.13 · 분류별 이익률)으로 간다.
--
-- 무엇을 담는 표인가
--   견적 작성 화면에서 **그 사람이 그 분류로 마지막에 확정한** 환율·관세율·이익률이다.
--   다음에 같은 분류로 새 견적을 쓰면 그 값으로 시작한다(app/quote/page.tsx 의
--   changeCategory → lib/quoteUserDefaults.ts). 계정 × 분류마다 한 줄이다.
--
--   **견적 자체의 값이 아니다.** 저장된 견적의 환율·관세·이익률은 quotes·quote_items 에
--   그대로 남아 있고 이 표는 「다음 견적의 출발값」만 기억한다. 이 표를 비워도 지난 견적의
--   금액은 한 원도 바뀌지 않는다.
--
-- 왜 이 표만 클라이언트가 직접 쓰는가 — **이 저장소의 규칙은 「쓰기는 service role
-- 라우트에서만」이다.** 그 규칙의 뜻은 「누가 썼는지를 클라이언트가 고르게 두지 말라」인데,
-- 여기서는 그 칸(engineer_email)을 **DB 가 못 박는다**: 아래 정책이 with check 로
-- auth.jwt() ->> 'email' 과 같은 줄만 받는다. 남의 이메일로는 insert·update 가 거절된다.
-- 라우트를 하나 더 두는 것보다 이쪽이 검사 지점이 적다. (라우트로 옮기고 싶으면
-- /api/engineer-sales-scope 와 같은 모양으로 만들면 된다 — 그때 이 정책은 그대로 둬도 된다.)
--
-- 정책 모양은 **본인 행만 보는 기존 패턴을 따른다** — quotes_select·quotes_update 와 같이
-- JWT 이메일로 판정한다(quote_schema_snapshot.sql). 다만 여기서는 engineers 표를 거치지
-- 않는다: 이 표의 열이 이미 이메일이라 조인할 이유가 없다(정책이 단순할수록 빠르고,
-- 함수 호출이 없어 initplan 경고도 없다).
--
-- DELETE 정책은 두지 않는다. 지울 일이 없고(덮어쓰기로 끝난다), 없으면 막힌다.
-- 지워야 할 일이 생기면 그때 superadmin 용으로 따로 만든다.
--
-- 재실행에 안전하다 — drop policy if exists 뒤에 create 한다.


-- ════════════════════════════════════════════════════════════════
-- [1단계] 적용
-- ════════════════════════════════════════════════════════════════

alter table public.quote_user_defaults enable row level security;

-- ── 조회 — 본인 줄만 ────────────────────────────────────────────
drop policy if exists quote_user_defaults_select on public.quote_user_defaults;
create policy quote_user_defaults_select on public.quote_user_defaults
  for select to authenticated
  using (engineer_email = (auth.jwt() ->> 'email'));

-- ── 추가 — 본인 줄만 ────────────────────────────────────────────
drop policy if exists quote_user_defaults_insert on public.quote_user_defaults;
create policy quote_user_defaults_insert on public.quote_user_defaults
  for insert to authenticated
  with check (engineer_email = (auth.jwt() ->> 'email'));

-- ── 수정 — 본인 줄만. using 과 with check 둘 다 둔다 ────────────
--   using     : 어느 줄을 고칠 수 있는가(남의 줄은 보이지 않으므로 고칠 수도 없다)
--   with check: 고친 뒤의 줄도 본인 줄이어야 한다(engineer_email 을 남의 것으로
--               바꿔치기하는 update 를 막는다)
drop policy if exists quote_user_defaults_update on public.quote_user_defaults;
create policy quote_user_defaults_update on public.quote_user_defaults
  for update to authenticated
  using (engineer_email = (auth.jwt() ->> 'email'))
  with check (engineer_email = (auth.jwt() ->> 'email'));


-- ════════════════════════════════════════════════════════════════
-- [2단계] 확인 — 적용 뒤 이 두 줄을 돌려 본다
-- ════════════════════════════════════════════════════════════════
--
-- 정책 3개가 보여야 한다.
--   select policyname, cmd, qual, with_check
--     from pg_policies
--    where schemaname = 'public' and tablename = 'quote_user_defaults'
--    order by policyname;
--
-- 로그인한 브라우저에서(= authenticated) 본인 줄이 읽히고 남의 줄은 안 읽혀야 한다.
--   견적 작성 화면에서 분류를 고르면 환율 옆에 「내 설정 불러옴」이 뜬다(행이 있을 때).
--   한 번 확정하면 그 줄이 생기므로, 확정 → 새 견적 → 같은 분류 순서로 보면 된다.
