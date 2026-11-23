-- 사후 실적 입력 — **나중에 손으로 적어 넣은 실적**을 표시한다 (2026-11-23)
--
-- ── 왜 ───────────────────────────────────────────────────────────────────
-- EMS 밖에서 끝난 건이 있다. 옛 견적서로 나갔거나, 수기 품의로 처리했거나, 시스템을
-- 쓰기 전의 건이다. 그런 것이 실적에 잡히지 않아 담당자별 숫자가 실제와 어긋난다.
-- 그래서 **슈퍼관리자가 한 건씩 적어 넣는 길**을 둔다(/api/quote-backfill).
--
-- ── 왜 표시해야 하나 ─────────────────────────────────────────────────────
-- 적어 넣은 줄은 EMS 가 만든 줄과 **생김새가 같다**. 구분이 없으면 「이 숫자가 어디서
-- 왔는가」를 영영 알 수 없고, 잘못 적은 건을 찾아낼 길도 없다. 그래서 **언제 · 누가**
-- 적었는지를 그 줄에 남기고, 목록에 「사후 입력」 뱃지로 띄운다.
--
-- ⚠ 이 파일을 돌리기 전에는 사후 입력이 **503 으로 이 파일 이름을 알려 준다**.
--    기존 견적은 두 칸이 비어 있어 아무것도 달라지지 않는다.
--
-- 재실행 안전 — add column if not exists.

alter table public.quotes
  add column if not exists backfilled_at timestamptz,
  add column if not exists backfilled_by integer references public.engineers(engineer_id);

comment on column public.quotes.backfilled_at is
  '사후 실적 입력으로 만들어진 줄이면 적어 넣은 시각. EMS 가 만든 줄은 비어 있다(lib/quoteBackfill.ts).';
comment on column public.quotes.backfilled_by is
  '그 줄을 적어 넣은 사람(engineers.engineer_id). 세션에서 넣는다 — 화면이 보낸 값을 믿지 않는다.';

-- 목록이 뱃지를 붙이려고 이 칸을 본다. 적어 넣은 줄은 적으므로 부분 인덱스로 둔다.
create index if not exists quotes_backfilled_idx
  on public.quotes (backfilled_at)
  where backfilled_at is not null;

notify pgrst, 'reload schema';
