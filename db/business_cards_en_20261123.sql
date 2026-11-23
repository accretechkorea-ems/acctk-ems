-- 명함 — **영문 칸 둘** (2026-11-23).
--
-- 까닭: 사진을 읽는 쪽(app/api/cards/ocr)이 명함의 영문 이름·영문 회사명을 함께 읽어
-- 온다. 담을 칸이 없어 화면이 버리고 있었다. 두 칸을 더해 그대로 담는다.
--
-- 두 칸 다 **선택**이다(nullable). 영문이 없는 명함이 더 많다.
--
-- 재실행 안전 — add column if not exists.
-- 적용 뒤 스키마 캐시를 깨워야 PostgREST 가 칸을 본다(파일 끝 notify).
--   · 깨우지 않으면 `42703 column business_cards.name_en does not exist` 가 난다.
--   · 화면은 칸이 없어도 멈추지 않는다 — 라우트가 **없는 칸을 빼고** 담는다
--     (app/api/business-card/route.ts 의 dropMissingColumns).

alter table public.business_cards
  add column if not exists name_en    text,
  add column if not exists company_en text;

comment on column public.business_cards.name_en is
  '영문 이름 — 명함 뒷면에서 읽거나 사람이 적는다. 선택.';
comment on column public.business_cards.company_en is
  '영문 회사명 — 명함 뒷면에서 읽거나 사람이 적는다. 선택.';

notify pgrst, 'reload schema';
