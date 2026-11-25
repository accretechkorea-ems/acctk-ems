-- 고객사 **담당자 칸을 명함과 같게** (2026-11-25)
--
-- 담당자는 이름·부서·직급·전화·이메일 다섯 칸뿐이었다. 명함을 사진으로 읽어 담당자를
-- 만들면 **읽은 값을 담을 칸이 모자란다**. 명함과 같은 칸을 갖춘다.
--
--   name_en  — 영문 이름
--   mobile   — 휴대폰. 지금의 phone 은 **회사 전화**로 둔다(명함과 같은 가름).
--   fax      — 팩스
--   memo     — 메모(만난 자리·특이사항)
--
-- 회사·주소·홈페이지는 넣지 않는다 — 사업장이 들고 있는 값이다(지시).
--
-- 그리고 명함 쪽 한 줄: 담당자에서 복사해 만든 명함을 **어떻게 들어왔는지**로 가른다.
--   business_cards.input_method 에 'contact' 를 허용한다.
--
-- 재실행 안전 — add column if not exists · 제약은 drop 후 add.

alter table public.contacts
  add column if not exists name_en text,
  add column if not exists mobile  text,
  add column if not exists fax     text,
  add column if not exists memo    text;

comment on column public.contacts.name_en is '영문 이름 — 명함에서 읽거나 사람이 적는다. 선택.';
comment on column public.contacts.mobile  is '휴대폰. phone 은 회사 전화다(명함과 같은 가름).';
comment on column public.contacts.fax     is '팩스. 선택.';
comment on column public.contacts.memo    is '만난 자리·특이사항. 선택.';

-- ── 명함의 담은 방식에 'contact' ─────────────────────────────────────────
-- 담당자를 등록하면서 「명함첩에도 등록할까요?」에 예를 고르면 이 방식으로 담긴다.
alter table public.business_cards
  drop constraint if exists business_cards_input_chk;

alter table public.business_cards
  add constraint business_cards_input_chk
  check (input_method in ('camera', 'upload', 'manual', 'bulk', 'contact'));

comment on column public.business_cards.input_method is
  'camera · upload · manual · bulk(여러 장 한꺼번에) · contact(고객사 담당자에서 복사).';

notify pgrst, 'reload schema';

-- 확인용(읽기만) —
--   select column_name from information_schema.columns
--    where table_name = 'contacts' order by ordinal_position;
--   기대: name_en · mobile · fax · memo 가 있다.

-- ── 되돌리기 ──────────────────────────────────────────────────────────────
--   alter table public.contacts
--     drop column if exists name_en, drop column if exists mobile,
--     drop column if exists fax,     drop column if exists memo;
--   alter table public.business_cards drop constraint if exists business_cards_input_chk;
--   alter table public.business_cards add constraint business_cards_input_chk
--     check (input_method in ('camera','upload','manual','bulk'));
