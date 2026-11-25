-- 활동 종류에 **A/S** 를 더한다 (2026-11-26)
--
-- ── 왜 ───────────────────────────────────────────────────────────────────
--   20 수리의 **수리 완료**가 영업활동 한 줄을 자동으로 만든다(지시 B4).
--   그 줄의 종류가 'A/S' 인데, 활동 종류 목록에 없으면
--     · 활동 현황의 종류 거르개에 안 보이고
--     · 색 표(lib/categoryColors.ts)가 기본색으로 떨어진다.
--   그래서 목록에 한 줄을 더한다. **사람이 고르는 종류이기도 하다** — 활동을 손으로
--   적을 때도 A/S 를 고를 수 있다(is_active = true).
--
--   is_system = true 로 둔다 — 관리 화면에서 **지울 수 없는** 종류다(자동으로 만드는
--   줄이 있는데 종류가 사라지면 그 줄의 색·거르기가 깨진다. LEAD_REG 와 같은 뜻이다).
--
-- 재실행 안전 — 이미 있으면 아무 일도 하지 않는다.

insert into public.activity_types (code, label, sort_order, is_active, is_system, is_remote)
select 'AS', 'A/S', 50, true, true, false
where not exists (select 1 from public.activity_types where code = 'AS' or label = 'A/S');

-- 이미 있던 줄이 꺼져 있으면 켠다(지우지 않고 껐던 경우).
update public.activity_types
   set is_active = true, is_system = true
 where code = 'AS' and (is_active is distinct from true or is_system is distinct from true);

-- ── 확인 ─────────────────────────────────────────────────────────────────
--   select code, label, sort_order, is_active, is_system
--     from public.activity_types order by sort_order;        → 'AS' · 'A/S' 가 보인다
--   화면: 활동 현황의 종류 거르개에 「A/S」가 뜬다.

notify pgrst, 'reload schema';
