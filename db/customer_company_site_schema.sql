-- 업체 등록 구조 변경 1/3 — 칸 추가와 접두 백필.
--
-- 모델: 회사는 **지금의 부모 줄**(customers.is_parent = true)이고, 사업장은 그 자식 줄이다.
--       자식 줄에 사업장명(site_name)을, 회사 줄에 분류(industry)를 더한다.
--
-- 이관은 **덧붙이기만** 한다 — company_name 의 뜻은 바꾸지 않는다. 화면·문서·엑셀이
-- 아직 그 칸 하나만 읽기 때문이다(2단계에서 lib/customerLabel.ts 로 옮긴다).
-- 그래서 새로 등록·수정하는 줄의 company_name 에는 「회사명 사업장명」을 합쳐 넣는다.
--
-- 적용 차례: ① → (표 확인) → ② 까지가 1단계다. ③ 은 할 일이 없고, ④⑤ 는 3단계다.

-- ───────────────────────────────────────────────────────────────────────────
-- ① 칸 추가
-- ───────────────────────────────────────────────────────────────────────────
alter table customers add column if not exists site_name text;
alter table customers add column if not exists industry  text;

comment on column customers.site_name is
  '사업장명(선택). 비면 회사명만으로 부른다. 회사명은 parent_customer_id 가 가리키는 줄에 있다.';
comment on column customers.industry is
  '분류(산업군). is_parent = true 인 회사 줄에만 쓴다. 값 목록은 lib/leadOptions.ts 의 INDUSTRIES.';

-- ───────────────────────────────────────────────────────────────────────────
-- ② 백필 — 「회사명 + 접미」로 적혀 있던 사업장에서 접미를 떼어 사업장명으로
--
--    현대위아 창원2공장  (회사: 현대위아)  →  site_name = '창원2공장'
--
--    · 앞뒤 괄호는 벗긴다 — 「현대트랜시스(성연공장)」의 「(성연공장)」 → 「성연공장」.
--    · 법인격만 남는 줄은 건너뛴다 — 「한국대풍㈜」 − 「한국대풍」 = 「㈜」는 사업장이 아니다.
--    · company_name 은 그대로 둔다(덧붙이기만 한다).
-- ───────────────────────────────────────────────────────────────────────────
update customers c
   set site_name = s.cut
  from (
    select ch.customer_id,
           btrim(btrim(substr(ch.company_name, length(p.company_name) + 1)), ' ()（）') as cut
      from customers ch
      join customers p on p.customer_id = ch.parent_customer_id
     where ch.deleted_at is null
       and ch.company_name is distinct from p.company_name
       and ch.company_name like p.company_name || '%'
  ) s
 where c.customer_id = s.customer_id
   and s.cut <> ''
   and s.cut !~ '^(㈜|\(주\)|주식회사)$';

-- 확인 — 채워진 줄
-- select customer_id, company_name, site_name from customers where site_name is not null order by customer_id;

-- ───────────────────────────────────────────────────────────────────────────
-- ③ 이름이 회사명과 같은 자식 줄(716줄) — **할 일 없음**
--    site_name 을 비워 두는 것이 맞다(사업장 이름이 따로 없는 줄이다).
--    화면에서는 회사명만 나오고, 같은 이름이 여럿인 곳은 주소로 가린다.
-- ───────────────────────────────────────────────────────────────────────────

-- ───────────────────────────────────────────────────────────────────────────
-- ④ 회사 연결이 없는 사업장 591곳 → 같은 이름의 회사 줄을 만들어 잇는다  ← 3단계
-- ⑤ 회사 필수 제약                                                      ← 3단계
--    alter table customers add constraint customers_parent_required
--      check (is_parent or parent_customer_id is not null) not valid;
-- ───────────────────────────────────────────────────────────────────────────
