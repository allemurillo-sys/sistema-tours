-- =====================================================
-- Solicitudes a proveedores (18 nov 2026) — ya aplicado en Supabase
-- 1. Vista previa: los colaboradores pueden abrir la página del proveedor de una solicitud sin enviar
-- 2. Editar una solicitud: registro en el historial de la solicitud y en la bitácora de la reserva
-- =====================================================

-- 1. ver_solicitud: "(s.estado <> 'borrador' or s.version > 1)" pasa a
--    "(s.estado <> 'borrador' or s.version > 1 or es_colaborador())"   (migración ver_solicitud_vista_previa_agente)

-- 2. Tipo de evento "edicion"
alter table solicitud_eventos drop constraint solicitud_eventos_tipo_check;
alter table solicitud_eventos add constraint solicitud_eventos_tipo_check check (tipo = any (array[
  'creada', 'enviada', 'respuesta', 'registro_agente', 'verificacion', 'mensaje_agente', 'mensaje_proveedor',
  'nueva_version', 'modificacion', 'cancelacion', 'cancelacion_recibida', 'servicio_confirmado', 'confirmacion_final',
  'aviso_marcado', 'edicion']));

create or replace function public.registrar_edicion_solicitud(p_id bigint, p_cambios text, p_motivo text default null)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare s record;
begin
  if not es_colaborador() then raise exception 'No autorizado.'; end if;
  select id, codigo, cotizacion_id into s from solicitudes_proveedor where id = p_id;
  if s.id is null then raise exception 'No se encontró la solicitud.'; end if;
  insert into solicitud_eventos (solicitud_id, tipo, autor, detalle)
    values (s.id, 'edicion', auth.uid(), jsonb_build_object('cambios', p_cambios, 'motivo', nullif(trim(coalesce(p_motivo, '')), '')));
  insert into bitacora (cotizacion_id, accion, detalle)
    values (s.cotizacion_id, 'solicitud al proveedor editada',
            s.codigo || ': ' || p_cambios || coalesce(' · motivo: ' || nullif(trim(coalesce(p_motivo, '')), ''), ''));
end $function$;
revoke all on function public.registrar_edicion_solicitud(bigint, text, text) from public, anon;
grant execute on function public.registrar_edicion_solicitud(bigint, text, text) to authenticated;
