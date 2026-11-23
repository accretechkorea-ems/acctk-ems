-- db/lead_recall_20261123.sql
--
-- **리드 회수** — 지우는 대신 번호만 반납한다 (2026-11-23).
--
-- ── 왜 ────────────────────────────────────────────────────────────────────
--   잘못 들어온 리드를 지우면 「어디서(파트너사) 들어온 무엇을 왜 지웠는지」가 남지 않는다.
--   그래서 하드 삭제는 이미 막아 두었는데(/api/lead-delete 의 DISABLED), 그러다 보니
--   **번호가 영영 묶였다** — LD-26-027 을 잘못 발급하면 그 번호는 아무도 못 쓴다.
--   회수는 둘을 함께 푼다: 행과 내용은 그대로 두고 **번호만 돌려받아 다음 리드가 쓴다**.
--
-- ── 어떻게 ────────────────────────────────────────────────────────────────
--   회수하면  lead_no → null,  recalled_no ← 원래 번호,  사유·누가·언제를 적는다.
--   **반납 목록은 따로 두지 않는다** — 「lead_no 가 비어 있고 recalled_no 가 있는 줄」이
--   곧 반납된 번호다. 표를 하나 더 두면 두 곳이 어긋날 수 있다(그 사고는 이미 겪었다).
--   되돌리기는 그 번호를 아직 아무도 쓰지 않았을 때만 된다(부분 유니크 인덱스가 최종 방어선).
--
-- ── 「배정불가」와 다르다 ──────────────────────────────────────────────────
--   배정불가는 **상태**다 — 번호를 그대로 쓴다(그 리드는 들어왔고, 안 하기로 했다).
--   회수는 **없던 일로 되돌리는 것**이다(중복 등록·시험 등록처럼 애초에 번호를 줄 일이 아니었던 것).
--
-- 적용 뒤 **반드시**:  notify pgrst, 'reload schema';  (이 파일 끝에 들어 있다)

alter table public.leads
  add column if not exists recalled_no   text,
  add column if not exists recalled_at   timestamptz,
  add column if not exists recalled_by   integer references public.engineers(engineer_id),
  add column if not exists recall_reason text;

comment on column public.leads.recalled_no is
  '회수된 리드의 원래 번호. lead_no 가 비고 이 값이 있으면 그 번호는 반납 목록에 있다(다음 리드가 재사용).';
comment on column public.leads.recall_reason is '회수 사유(필수). 화면과 사건 기록이 함께 쓴다.';

-- 같은 번호를 두 리드가 동시에 들지 못하게 한다. **살아 있는 번호만** 본다
-- (회수된 줄은 lead_no 가 null 이라 이 인덱스에 들어오지 않는다).
create unique index if not exists leads_lead_no_live_uidx
  on public.leads (lead_no)
  where lead_no is not null;

notify pgrst, 'reload schema';
