-- 견적 '반려' 상태 backfill (2026-10-08 작성). **아직 DB 에 적용하지 않았다.**
-- 이 파일은 적용 대기 상태다 — **한 문장씩 따로** 실행한다.
--
-- 무엇을 위한 것인가
--   견적서 결재가 **반려**로 끝난 견적은 지금까지 상신 직전 상태('견적중', 국내수리면 '수리중')로
--   되돌아갔다(lib/approval/quoteApproval.ts 의 onRevertQuote). 그래서
--     · 목록에서 반려된 견적이 새 견적과 구분되지 않고,
--     · 상태가 '견적중' 이라 **작성자가 결재 기록째로 바로 지울 수 있었다**
--       (lib/quoteDeletePolicy.ts 의 옛 isSelfDeletable).
--   코드는 이제 반려를 quotes.status = '반려' 로 남긴다. 이 파일은 **이미 반려된 옛 견적**을
--   그 상태로 맞춘다.
--
-- 순서
--   단계 1~3 은 **읽기만** 한다. 무엇이 바뀔지 먼저 눈으로 본다.
--   단계 4 가 유일한 쓰기다(한 문장). 단계 5 로 확인한다.
--   코드 배포와의 순서는 상관없다 — '반려' 는 코드가 쓰는 값이고 DB 에 CHECK 가 없다
--   (lib/quoteStatus.ts 머리말). 다만 **배포 전에 돌리면** 그 견적들은 배포 전까지
--   필터 칩에 없는 상태로 보인다(「전체」에서는 보인다). 배포 뒤에 돌리는 편이 자연스럽다.
--
-- 건드리지 않는 것
--   · 기존 견적의 다른 상태는 **하나도 바꾸지 않는다**(단계 4 의 where 가 세 조건을 모두 본다).
--   · 결재 문서·결재선·이력·감사 기록은 읽기만 한다.
--   · 금액·환율·조건(terms)·PDF 와 무관하다.
--
-- 되돌리기는 파일 맨 아래에 적어 두었다(summary.restore_status 기준).


-- ════════════════════════════════════════════════════════════════════════════
-- 단계 1 (읽기). 반려로 끝났는데 아직 '견적중'·'수리중' 인 견적
--   → 단계 4 가 '반려' 로 바꿀 대상이다. 건수를 먼저 본다.
-- ════════════════════════════════════════════════════════════════════════════
select count(*) as 대상_건수
from public.quotes q
where q.status in ('견적중', '수리중')
  and exists (
    select 1 from public.approval_documents d
    where d.doc_type = 'quote' and d.target_table = 'quotes'
      and d.target_id = q.quote_id and d.status = '반려'
  )
  -- 완료 문서가 함께 있으면 승인된 견적이다(지금 경로로는 생기지 않지만 안전하게 뺀다).
  and not exists (
    select 1 from public.approval_documents d
    where d.doc_type = 'quote' and d.target_table = 'quotes'
      and d.target_id = q.quote_id and d.status = '완료'
  );

-- 같은 조건의 목록 — 견적번호 · 문서번호 · 작성자.
select
  q.quote_id,
  q.quote_number                             as 견적번호,
  q.status                                   as 지금_상태,
  d.doc_no                                   as 문서번호,
  d.document_id,
  e.name                                     as 작성자,
  q.created_at                               as 견적_생성시각
from public.quotes q
join public.approval_documents d
  on d.doc_type = 'quote' and d.target_table = 'quotes'
 and d.target_id = q.quote_id and d.status = '반려'
left join public.engineers e on e.engineer_id = q.created_by
where q.status in ('견적중', '수리중')
  and not exists (
    select 1 from public.approval_documents x
    where x.doc_type = 'quote' and x.target_table = 'quotes'
      and x.target_id = q.quote_id and x.status = '완료'
  )
order by q.quote_id;


-- ════════════════════════════════════════════════════════════════════════════
-- 단계 2 (읽기). 결재가 **완료**됐는데 상태가 '견적중'·'실패' 인 견적
--   → 삭제 구멍이 열려 있던 건이다. 옛 규칙에서는 작성자가 바로 지울 수 있었다
--     (완료 뒤 '견적중' 으로 돌아오고, isSelfDeletable('견적중') 이 참이었다).
--   **상태를 바꾸지 않는다.** 승인된 견적은 발주·계산서로 이어져야 하므로 '견적중' 이 맞다.
--   코드 쪽에서 막았다(selfDeleteVerdict 가 docs='completed' 를 409 로 돌려보낸다).
--   여기서는 「그동안 노출돼 있던 범위」를 눈으로 확인만 한다.
-- ════════════════════════════════════════════════════════════════════════════
select count(*) as 완료_건수
from public.quotes q
where q.status in ('견적중', '실패')
  and exists (
    select 1 from public.approval_documents d
    where d.doc_type = 'quote' and d.target_table = 'quotes'
      and d.target_id = q.quote_id and d.status = '완료'
  );

select
  q.quote_id,
  q.quote_number    as 견적번호,
  q.status          as 지금_상태,
  d.doc_no          as 문서번호,
  d.completed_at    as 결재_완료시각,
  e.name            as 작성자
from public.quotes q
join public.approval_documents d
  on d.doc_type = 'quote' and d.target_table = 'quotes'
 and d.target_id = q.quote_id and d.status = '완료'
left join public.engineers e on e.engineer_id = q.created_by
where q.status in ('견적중', '실패')
order by q.quote_id;


-- ════════════════════════════════════════════════════════════════════════════
-- 단계 3 (읽기). 결재 문서가 '회수' 또는 '폐기' 인 견적
--   → 새 규칙에서 **작성자가 견적과 결재 문서를 함께 지울 수 있는** 건이다
--     (견적 상태가 '견적중'·'수리중' 일 때. lib/quoteDeletePolicy.ts 의 selfDeleteVerdict).
--   상태를 바꾸지 않는다. 범위를 눈으로 확인만 한다.
-- ════════════════════════════════════════════════════════════════════════════
select
  q.quote_id,
  q.quote_number    as 견적번호,
  q.status          as 견적_상태,
  d.doc_no          as 문서번호,
  d.document_id,
  d.status          as 문서_상태,
  e.name            as 작성자,
  -- 삭제가 열리는 건인가 — 코드의 CLOSED_DELETABLE_STATUSES 와 같은 목록이다.
  (q.status in ('견적중', '수리중')) as 작성자_삭제_가능
from public.quotes q
join public.approval_documents d
  on d.doc_type = 'quote' and d.target_table = 'quotes'
 and d.target_id = q.quote_id and d.status in ('회수', '폐기')
left join public.engineers e on e.engineer_id = q.created_by
order by q.quote_id;


-- ════════════════════════════════════════════════════════════════════════════
-- 단계 4 (쓰기 — 이 파일의 유일한 쓰기). 단계 1 의 견적을 '반려' 로 바꾼다.
--
--   · 조건이 셋이다: 상태가 '견적중'·'수리중' · 반려 문서가 있다 · 완료 문서가 없다.
--     세 조건을 모두 만족하는 행만 바뀐다 — 다른 상태는 하나도 건드리지 않는다.
--   · 이전 상태를 함께 돌려준다(아래 returning 의 status_before) — 되돌릴 때 필요하다.
--     UPDATE … RETURNING 은 **바뀐 뒤** 값만 주므로, CTE 로 이전 값을 먼저 잡아 둔다.
--   · fail_reason·delete_reason 은 건드리지 않는다. 반려는 결재의 결과이고 미수주 사유·
--     삭제 사유와는 다른 칸이다.
--   · 결과를 **복사해 두어라.** 되돌리려면 이 목록이 있어야 한다(아래 되돌리기 ②).
-- ════════════════════════════════════════════════════════════════════════════
with target as (
  select q.quote_id, q.status as status_before
  from public.quotes q
  where q.status in ('견적중', '수리중')
    and exists (
      select 1 from public.approval_documents d
      where d.doc_type = 'quote' and d.target_table = 'quotes'
        and d.target_id = q.quote_id and d.status = '반려'
    )
    and not exists (
      select 1 from public.approval_documents d
      where d.doc_type = 'quote' and d.target_table = 'quotes'
        and d.target_id = q.quote_id and d.status = '완료'
    )
)
update public.quotes q
   set status = '반려'
  from target t
 where q.quote_id = t.quote_id
returning q.quote_id, q.quote_number, t.status_before, q.status as status_after;


-- ════════════════════════════════════════════════════════════════════════════
-- 단계 5 (확인)
-- ════════════════════════════════════════════════════════════════════════════
-- ① 단계 1 의 대상이 0건으로 비었는가(전부 옮겨졌다)
-- select count(*) as 남은_대상
-- from public.quotes q
-- where q.status in ('견적중', '수리중')
--   and exists (select 1 from public.approval_documents d
--               where d.doc_type = 'quote' and d.target_table = 'quotes'
--                 and d.target_id = q.quote_id and d.status = '반려')
--   and not exists (select 1 from public.approval_documents d
--               where d.doc_type = 'quote' and d.target_table = 'quotes'
--                 and d.target_id = q.quote_id and d.status = '완료');

-- ② '반려' 견적은 전부 반려 문서를 갖고 있는가(0건이어야 한다 — 엉뚱한 행이 바뀌지 않았다)
-- select q.quote_id, q.quote_number, q.status
-- from public.quotes q
-- where q.status = '반려'
--   and not exists (select 1 from public.approval_documents d
--               where d.doc_type = 'quote' and d.target_table = 'quotes'
--                 and d.target_id = q.quote_id and d.status = '반려');

-- ③ 상태 분포 — 다른 상태의 건수가 그대로인지 적용 전후로 비교한다(적용 전에도 한 번 돌려 둔다)
-- select status, count(*) as 건수
-- from public.quotes
-- group by status
-- order by 건수 desc;

-- ④ 바뀐 견적의 지금 모습
-- select q.quote_id, q.quote_number, q.status, q.fail_reason, q.delete_reason, d.doc_no
-- from public.quotes q
-- join public.approval_documents d
--   on d.doc_type = 'quote' and d.target_table = 'quotes'
--  and d.target_id = q.quote_id and d.status = '반려'
-- where q.status = '반려'
-- order by q.quote_id desc
-- limit 50;


-- ════════════════════════════════════════════════════════════════════════════
-- 되돌리기
--
--   ① 코드를 되돌릴 필요는 없다 — '반려' 상태를 모르는 옛 코드도 그 값을 그냥 상태 문자열로
--      보여 준다(색 표만 회색 기본값으로 떨어진다. getCategoryColor 의 FALLBACK_COLOR).
--      다만 필터 칩에 '반려' 가 없어 「전체」에서만 보인다.
--
--   ② 상태를 되돌린다 — **summary.restore_status 가 정본이다.** 상신 때 담아 둔 상신 직전
--      상태이고(lib/approval/quoteApproval.ts 의 buildQuoteSummary), 단계 4 가 바꾼 값과 같다
--      ('수리중' 또는 '견적중'). 값이 비었거나 깨져 있으면 '견적중' 으로 떨어뜨린다
--      — 코드의 restoreStatusOf 와 같은 규칙이다.
--
-- update public.quotes q
--    set status = case when d.summary->>'restore_status' = '수리중' then '수리중' else '견적중' end
--   from public.approval_documents d
--  where d.doc_type = 'quote' and d.target_table = 'quotes'
--    and d.target_id = q.quote_id and d.status = '반려'
--    and q.status = '반려'
-- returning q.quote_id, q.quote_number, q.status;
--
--   ※ 단계 4 의 returning 결과를 복사해 두었다면 그 status_before 가 더 정확하다
--      (summary 가 없는 옛 문서까지 정확히 되돌린다). 그때는 위 대신 quote_id 목록으로 직접 쓴다.
