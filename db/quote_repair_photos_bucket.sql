-- 수리 사진 버킷 (2026-11-16 작성). **아직 만들지 않았다 — 이 파일만 남았다.**
--
-- db/quote_repair_info_schema.sql 의 표 둘(quote_repair_info · quote_repair_photos)과 RLS 는
-- 2026-11-16 에 적용됐다. **버킷만 없다** — 같은 날 읽기로 확인했다(storage 버킷 12개 중 없음:
-- quote-pdfs · purchase_orders · profile-images · packing-lists · service-report · lead-cards ·
-- notices · showroom-approvals · service-attachments · suggestion-images · inquiry-attachments ·
-- device-images). 그래서 그 파일의 「4. 사진 버킷」 부분만 여기 따로 떼어 둔다.
--
-- ════════════════════════════════════════════════════════════════
-- 1단계 — 버킷 만들기 (둘 중 하나)
-- ════════════════════════════════════════════════════════════════
--   (가) 대시보드: Storage → New bucket → 이름 `quote-repair-photos`,
--        **Public bucket 체크 해제**(비공개). 이 저장소의 버킷 11개가 전부 비공개다.
--   (나) SQL 로 만들려면 아래 한 줄. 결과는 (가)와 같다.
--
-- insert into storage.buckets (id, name, public)
-- values ('quote-repair-photos', 'quote-repair-photos', false)
-- on conflict (id) do nothing;
--
-- ════════════════════════════════════════════════════════════════
-- 2단계 — 정책 (아래를 SQL Editor 에서 돌린다)
-- ════════════════════════════════════════════════════════════════
--   packing_lists_storage_policy.sql 과 같은 꼴이다 — 로그인한 사람만, 파일은 앱이 발급하는
--   1시간 서명 URL 로만 열린다. 올리고 지우는 일은 서비스 롤 라우트가 하므로 정책은
--   **읽기 길을 열어 두는 것**이 주된 목적이다(서명 URL 발급에 필요하다).
--
--   ⚠ 재실행하면 「policy already exists」로 멈춘다. 다시 돌릴 일이 있으면 앞에
--      drop policy if exists "…" on storage.objects; 를 붙인다.

create policy "quote_repair_photos authenticated read"
on storage.objects for select to authenticated
using (bucket_id = 'quote-repair-photos');

create policy "quote_repair_photos authenticated insert"
on storage.objects for insert to authenticated
with check (bucket_id = 'quote-repair-photos');

create policy "quote_repair_photos authenticated update"
on storage.objects for update to authenticated
using (bucket_id = 'quote-repair-photos')
with check (bucket_id = 'quote-repair-photos');

create policy "quote_repair_photos authenticated delete"
on storage.objects for delete to authenticated
using (bucket_id = 'quote-repair-photos');

-- ════════════════════════════════════════════════════════════════
-- 확인 (읽기)
-- ════════════════════════════════════════════════════════════════
-- select id, public from storage.buckets where id = 'quote-repair-photos';
-- select policyname, cmd from pg_policies
--  where schemaname = 'storage' and tablename = 'objects'
--    and policyname like 'quote_repair_photos%';   -- 4행이면 됐다
--
-- 파일 이름 규칙(라우트가 만든다): qr-{quote_id}-{밀리초}-{i}.jpg
-- DB 에는 **경로만** 담는다(quote_repair_photos.storage_path). 공개 주소를 담지 않는다.
