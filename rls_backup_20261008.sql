-- 2026-10-08 RLS 좁히기(rls_tighten_batch2.sql · rls_tighten_batch3.sql) 적용 직전의 정책 DDL 이다. 되돌리기에 쓴다 — 고치지 마라.

create policy download_logs_select on public.download_logs as PERMISSIVE for SELECT to authenticated using ((( SELECT current_engineer_id() AS current_engineer_id) IS NOT NULL));
create policy price_list_select_authenticated on public.price_list as PERMISSIVE for SELECT to authenticated using (true);
create policy authenticated_only on public.quote_sequence as PERMISSIVE for ALL to authenticated using (true) with check (true);
create policy sales_activities_delete on public.sales_activities as PERMISSIVE for DELETE to authenticated using ((( SELECT current_engineer_id() AS current_engineer_id) IS NOT NULL));
create policy sales_activities_insert on public.sales_activities as PERMISSIVE for INSERT to authenticated with check ((( SELECT current_engineer_id() AS current_engineer_id) IS NOT NULL));
create policy sales_activities_select on public.sales_activities as PERMISSIVE for SELECT to authenticated using ((( SELECT current_engineer_id() AS current_engineer_id) IS NOT NULL));
create policy sales_activities_update on public.sales_activities as PERMISSIVE for UPDATE to authenticated using ((( SELECT current_engineer_id() AS current_engineer_id) IS NOT NULL)) with check ((( SELECT current_engineer_id() AS current_engineer_id) IS NOT NULL));
create policy sales_opportunities_delete on public.sales_opportunities as PERMISSIVE for DELETE to authenticated using ((( SELECT current_engineer_id() AS current_engineer_id) IS NOT NULL));
create policy sales_opportunities_insert on public.sales_opportunities as PERMISSIVE for INSERT to authenticated with check ((( SELECT current_engineer_id() AS current_engineer_id) IS NOT NULL));
create policy sales_opportunities_select on public.sales_opportunities as PERMISSIVE for SELECT to authenticated using ((( SELECT current_engineer_id() AS current_engineer_id) IS NOT NULL));
create policy sales_opportunities_update on public.sales_opportunities as PERMISSIVE for UPDATE to authenticated using ((( SELECT current_engineer_id() AS current_engineer_id) IS NOT NULL)) with check ((( SELECT current_engineer_id() AS current_engineer_id) IS NOT NULL));
create policy sd_select on public.showroom_devices as PERMISSIVE for SELECT to authenticated using (true);
create policy ss_select on public.showroom_sites as PERMISSIVE for SELECT to authenticated using (true);
create policy su_select on public.showroom_usage as PERMISSIVE for SELECT to authenticated using ((deleted_at IS NULL));
create policy sue_select on public.showroom_usage_engineers as PERMISSIVE for SELECT to authenticated using (true);
create policy inventory_items_delete on public.inventory_items as PERMISSIVE for DELETE to authenticated using ((( SELECT current_engineer_id() AS current_engineer_id) IS NOT NULL));
create policy inventory_items_insert on public.inventory_items as PERMISSIVE for INSERT to authenticated with check ((( SELECT current_engineer_id() AS current_engineer_id) IS NOT NULL));
create policy inventory_items_select on public.inventory_items as PERMISSIVE for SELECT to authenticated using ((( SELECT current_engineer_id() AS current_engineer_id) IS NOT NULL));
create policy inventory_items_update on public.inventory_items as PERMISSIVE for UPDATE to authenticated using ((( SELECT current_engineer_id() AS current_engineer_id) IS NOT NULL)) with check ((( SELECT current_engineer_id() AS current_engineer_id) IS NOT NULL));
create policy inventory_logs_delete on public.inventory_logs as PERMISSIVE for DELETE to authenticated using ((( SELECT current_engineer_id() AS current_engineer_id) IS NOT NULL));
create policy inventory_logs_insert on public.inventory_logs as PERMISSIVE for INSERT to authenticated with check ((( SELECT current_engineer_id() AS current_engineer_id) IS NOT NULL));
create policy inventory_logs_select on public.inventory_logs as PERMISSIVE for SELECT to authenticated using ((( SELECT current_engineer_id() AS current_engineer_id) IS NOT NULL));
create policy inventory_logs_update on public.inventory_logs as PERMISSIVE for UPDATE to authenticated using ((( SELECT current_engineer_id() AS current_engineer_id) IS NOT NULL)) with check ((( SELECT current_engineer_id() AS current_engineer_id) IS NOT NULL));
create policy "allow all" on storage.objects as PERMISSIVE for ALL to public using ((bucket_id = 'device-images'::text)) with check ((bucket_id = 'device-images'::text));
create policy "authenticated can read packing lists" on storage.objects as PERMISSIVE for SELECT to authenticated using ((bucket_id = 'packing-lists'::text));
create policy "authenticated can upload packing lists" on storage.objects as PERMISSIVE for INSERT to authenticated with check ((bucket_id = 'packing-lists'::text));
create policy "authenticated users can read quote pdfs" on storage.objects as PERMISSIVE for SELECT to authenticated using ((bucket_id = 'quote-pdfs'::text));
create policy "authenticated users can upload quote pdfs" on storage.objects as PERMISSIVE for INSERT to authenticated with check ((bucket_id = 'quote-pdfs'::text));
create policy lead_cards_auth_select on storage.objects as PERMISSIVE for SELECT to authenticated using ((bucket_id = 'lead-cards'::text));
create policy "packing_lists authenticated delete" on storage.objects as PERMISSIVE for DELETE to authenticated using ((bucket_id = 'packing-lists'::text));
create policy "packing_lists authenticated insert" on storage.objects as PERMISSIVE for INSERT to authenticated with check ((bucket_id = 'packing-lists'::text));
create policy "packing_lists authenticated read" on storage.objects as PERMISSIVE for SELECT to authenticated using ((bucket_id = 'packing-lists'::text));
create policy "packing_lists authenticated update" on storage.objects as PERMISSIVE for UPDATE to authenticated using ((bucket_id = 'packing-lists'::text)) with check ((bucket_id = 'packing-lists'::text));
create policy "service_report authenticated delete" on storage.objects as PERMISSIVE for DELETE to authenticated using ((bucket_id = 'service-report'::text));
create policy "service_report authenticated insert" on storage.objects as PERMISSIVE for INSERT to authenticated with check ((bucket_id = 'service-report'::text));
create policy "service_report authenticated read" on storage.objects as PERMISSIVE for SELECT to authenticated using ((bucket_id = 'service-report'::text));
create policy "service_report authenticated update" on storage.objects as PERMISSIVE for UPDATE to authenticated using ((bucket_id = 'service-report'::text)) with check ((bucket_id = 'service-report'::text));

-- mark_log_restocked 원래 정의 (되돌리기용)
CREATE OR REPLACE FUNCTION public.mark_log_restocked(p_log_id integer)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  update public.inventory_logs set is_restocked = true where log_id = p_log_id;
$function$;
