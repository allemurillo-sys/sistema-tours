-- =====================================================================
-- THOT Sistema · Ama de llaves (esquema hv)
-- Cambio: aviso a TODOS cuando se marca el estado de limpieza de una propiedad
--   · Lista, Sucia, Pendiente o Bloqueada → notificación a todos los usuarios activos
--     (menos quien la marcó). Llega a la campana de Ama de llaves, a la campana
--     del panel de THOT y al celular (push), porque todo sale de hv.notificaciones.
--   · Solo cuando el estado cambia (editar solo la nota no avisa).
--   · Si la casa entra hoy y queda Lista, el título es "✅ Lista para el ingreso"
--     (reemplaza el aviso que antes iba solo a recepción, para no duplicarlo).
--   · Bloqueada incluye la razón y quién autorizó.
-- Fecha: 2026-11-24 · YA APLICADO en el proyecto cotizador-tours.
-- =====================================================================
create or replace function hv.ocupacion_limpieza(p_fecha date, p_propiedad bigint, p_estado text, p_nota text, p_autoriza uuid default null)
returns void language plpgsql security definer set search_path to 'hv', 'public' as $function$
declare v_old hv.ocupacion; v_new hv.ocupacion; v_prop text; v_actor text; v_n int; v_aut text;
        v_tit text; v_msg text; v_hora text; v_entra boolean;
begin
  if not hv.tengo('ocupacion_limpieza') then raise exception 'No tiene permiso para marcar el estado de limpieza'; end if;
  if hv.ocupacion_cerrada(p_fecha) then raise exception 'Este reporte ya está archivado (se cierra a las 8:15 p. m.) y no se puede editar'; end if;
  if p_fecha <> hv.ocupacion_hoy() or (now() at time zone 'America/Costa_Rica')::time < time '08:00' then
    raise exception 'El estado de limpieza solo se puede marcar el día del reporte, de 8:00 a. m. a 8:15 p. m.';
  end if;
  if hv.ocupacion_incompletas(p_fecha) > 0 then
    raise exception 'Todavía no se puede marcar la limpieza: Operaciones debe completar "Amanece" y "Queda" en todas las propiedades (faltan %)', hv.ocupacion_incompletas(p_fecha);
  end if;
  select nombre into v_prop from hv.propiedades where id = p_propiedad;
  if v_prop is null then raise exception 'La propiedad no existe'; end if;
  p_nota := nullif(trim(coalesce(p_nota, '')), '');
  -- Bloqueada: la razón y la persona que autorizó son obligatorias
  if p_estado = 'bloqueada' then
    if p_nota is null or length(p_nota) < 5 then raise exception 'Para marcar Bloqueada debe escribir la razón del bloqueo'; end if;
    if p_autoriza is null then raise exception 'Para marcar Bloqueada debe indicar la persona que autorizó el bloqueo'; end if;
    select nombre into v_aut from hv.perfiles where id = p_autoriza and activo
       and rol in ('admin', 'operaciones', 'supervisora', 'ama_llaves');
    if v_aut is null then raise exception 'La persona que autorizó debe ser de Administración, Operaciones, Supervisión o Ama de llaves'; end if;
  else
    p_autoriza := null;
  end if;
  select * into v_old from hv.ocupacion where fecha = p_fecha and propiedad_id = p_propiedad;
  if v_old.limpieza is not distinct from p_estado and v_old.limpieza_nota is not distinct from p_nota
     and v_old.limpieza_autoriza is not distinct from p_autoriza then return; end if;

  insert into hv.ocupacion as o (fecha, propiedad_id, limpieza, limpieza_nota, limpieza_autoriza, limpieza_por, limpieza_en)
  values (p_fecha, p_propiedad, p_estado, p_nota, p_autoriza, auth.uid(), now())
  on conflict (fecha, propiedad_id) do update set limpieza = excluded.limpieza, limpieza_nota = excluded.limpieza_nota, limpieza_autoriza = excluded.limpieza_autoriza,
    limpieza_por = excluded.limpieza_por, limpieza_en = excluded.limpieza_en
  returning * into v_new;

  insert into hv.ocupacion_historial (fecha, propiedad_id, propiedad_nombre, usuario_id, tipo, detalle)
  values (p_fecha, p_propiedad, v_prop, auth.uid(), 'limpieza',
          'Limpieza: ' || coalesce(initcap(v_old.limpieza), 'Sin marcar') || ' → ' || coalesce(initcap(p_estado), 'Sin marcar')
          || coalesce(' · ' || p_nota, '') || coalesce(' · Autorizó: ' || v_aut, ''));

  -- Aviso a todos: el estado cambió a Lista, Sucia, Pendiente o Bloqueada
  if p_estado in ('lista', 'sucia', 'pendiente', 'bloqueada') and v_old.limpieza is distinct from p_estado then
    select nombre into v_actor from public.perfiles where id = auth.uid();
    v_entra := v_new.entrada = 'ENTRA';
    v_hora := to_char(now() at time zone 'America/Costa_Rica', 'FMHH12:MI')
           || case when extract(hour from now() at time zone 'America/Costa_Rica') < 12 then ' a. m.' else ' p. m.' end;
    v_tit := case
      when p_estado = 'lista' and v_entra then '✅ Lista para el ingreso'
      when p_estado = 'lista'     then '✅ Limpieza: Lista'
      when p_estado = 'sucia'     then '🟠 Limpieza: Sucia'
      when p_estado = 'pendiente' then '⏳ Limpieza: Pendiente'
      else '⛔ Limpieza: Bloqueada' end;
    v_msg := v_prop || ' quedó ' || upper(p_estado)
          || case when v_entra then ' (entra hoy, 3:00 p. m.)' else '' end
          || ' — marcada por ' || coalesce(v_actor, '—') || ' a las ' || v_hora
          || case when p_estado = 'bloqueada' then ' · Razón: ' || p_nota || coalesce(' · Autorizó: ' || v_aut, '')
                  when p_nota is not null then ' · Nota: ' || p_nota else '' end;

    insert into hv.notificaciones (usuario_id, reporte_id, numero_caso, propiedad_nombre, mensaje, tipo, fecha_ref)
    select p.id, null, v_tit, v_prop, left(v_msg, 900), 'ocupacion', p_fecha
      from public.perfiles p
     where p.activo and p.id is distinct from auth.uid();
    get diagnostics v_n = row_count;
    if v_n > 0 then
      insert into hv.ocupacion_historial (fecha, propiedad_id, propiedad_nombre, tipo, detalle)
      values (p_fecha, p_propiedad, v_prop, 'aviso', 'Aviso a todos: ' || initcap(p_estado) || ' (' || v_n || ' persona(s))');
    end if;
  end if;
end $function$;
