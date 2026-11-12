-- Cambio definitivo: Ama de llaves pasa a THOT Sistema (2026-11-13)
-- Requisito previo: el esquema hv expuesto en Supabase (Data API → Exposed schemas).
-- Se ejecuta por partes, en orden. Cada parte indica qué verificar antes de seguir.

-- ── PARTE 0 · En el sistema VIEJO (proyecto ama-llaves): apagar tareas automáticas ──
-- update cron.job set active = false where jobname in
--   ('telegram-reloj','telegram-limpieza','ocupacion-alerta-1400','ocupacion-alerta-1430',
--    'ocupacion-alerta-1500','ocupacion-cierre-2015','respaldo-recordatorio');

-- ── PARTE 1 · THOT: pedir la exportación final ──
select net.http_post(
  url := 'https://wifgbjkcyhogwqhjjucg.supabase.co/functions/v1/exportar-a-thot',
  headers := '{"Content-Type":"application/json","x-secreto":"<secreto de exportación>"}'::jsonb,
  body := '{}'::jsonb, timeout_milliseconds := 120000);   -- devuelve el número de solicitud (N)

-- ── PARTE 2 · Guardar y cargar (esperar unos segundos a que llegue la respuesta N) ──
-- insert into hv._importaciones(datos)
--   select content::jsonb from net._http_response where id = N and status_code = 200 returning id;  -- (M)
-- select hv.importar_ama_llaves(M);

-- ── PARTE 3 · Copiar fotos ──
-- select net.http_post(
--   url := 'https://qbfjauehzzwqtlumxudn.supabase.co/functions/v1/copiar-fotos-hv',
--   headers := jsonb_build_object('Content-Type','application/json',
--     'x-reloj-secreto', (select webhook_secreto from hv.telegram_secretos where id = 1)),
--   body := jsonb_build_object('importacion_id', M), timeout_milliseconds := 140000);

-- ── PARTE 4 · Telegram apunta a THOT ──
update hv.telegram_config set app_url = 'https://allemurillo-sys.github.io/sistema-tours/limpieza/' where id = 1;
select net.http_post(
  url := 'https://api.telegram.org/bot' || (select bot_token from hv.telegram_secretos where id = 1) || '/setWebhook',
  headers := '{"Content-Type":"application/json"}'::jsonb,
  body := jsonb_build_object(
    'url', 'https://qbfjauehzzwqtlumxudn.supabase.co/functions/v1/telegram-webhook',
    'secret_token', (select webhook_secreto from hv.telegram_secretos where id = 1),
    'allowed_updates', jsonb_build_array('message','callback_query')));

-- ── PARTE 5 · Tareas automáticas en THOT ──
select cron.schedule('hv-telegram-reloj', '* * * * *', $$
  select net.http_post(
    url := 'https://qbfjauehzzwqtlumxudn.supabase.co/functions/v1/telegram-reloj',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-reloj-secreto', (select webhook_secreto from hv.telegram_secretos where id = 1)),
    body := '{}'::jsonb)
  where exists (select 1 from hv.telegram_config where id = 1 and activo);
$$);
select cron.schedule('hv-telegram-limpieza', '0 9 * * *',
  $$delete from hv.telegram_alertas where enviado_en < now() - interval '90 days'$$);
select cron.schedule('hv-ocupacion-alerta-1400', '0 20 * * *',  $$select hv.ocupacion_alerta_ingresos('14:00')$$);
select cron.schedule('hv-ocupacion-alerta-1430', '30 20 * * *', $$select hv.ocupacion_alerta_ingresos('14:30')$$);
select cron.schedule('hv-ocupacion-alerta-1500', '0 21 * * *',  $$select hv.ocupacion_alerta_ingresos('15:00')$$);
select cron.schedule('hv-ocupacion-cierre',      '15 2 * * *',  $$select hv.ocupacion_archivar()$$);
select cron.schedule('hv-respaldo-recordatorio', '5 14 * * *',  $$select hv.respaldo_recordar()$$);

-- ── PARTE 6 · Encender los permisos del módulo ──
update public.permisos_catalogo set disponible = true where modulo = 'ama_llaves' or clave like 'telegram%';

-- ── PARTE 7 · En el repositorio: config.js → moduloAmaLlaves: true (subir versión) ──
