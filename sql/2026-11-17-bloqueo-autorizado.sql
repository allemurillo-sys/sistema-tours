-- 2026-11-17 · Reporte de Limpieza: al marcar "Bloqueada" es obligatorio
-- indicar la razón del bloqueo y la persona que lo autorizó.
alter table hv.ocupacion add column if not exists limpieza_autoriza uuid;  -- id del perfil que autorizó (hv.perfiles es una vista)
drop function if exists hv.ocupacion_limpieza(date, bigint, text, text);
CREATE OR REPLACE FUNCTION hv.ocupacion_limpieza(p_fecha date, p_propiedad bigint, p_estado text, p_nota text, p_autoriza uuid DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'hv', 'public'
AS $function$
declare v_old hv.ocupacion; v_new hv.ocupacion; v_prop text; v_actor text; v_n int; v_aut text;
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

  if p_estado = 'lista' and v_old.limpieza is distinct from 'lista' and v_new.entrada = 'ENTRA'
     and p_fecha = hv.ocupacion_hoy() then
    select nombre into v_actor from hv.perfiles where id = auth.uid();
    insert into hv.notificaciones (usuario_id, reporte_id, numero_caso, propiedad_nombre, mensaje, tipo, fecha_ref)
    select p.id, null, '✅ Lista para el ingreso', v_prop,
           v_prop || ' ya está lista para el ingreso de hoy (3:00 p. m.) — marcada por ' || coalesce(v_actor, '—')
           || ' a las ' || to_char(now() at time zone 'America/Costa_Rica', 'FMHH12:MI')
           || case when extract(hour from now() at time zone 'America/Costa_Rica') < 12 then ' a. m.' else ' p. m.' end,
           'ocupacion', p_fecha
      from hv.perfiles p
     where p.activo and p.id is distinct from auth.uid() and hv.permiso_de(p.id, 'aviso_ingreso_lista');
    get diagnostics v_n = row_count;
    if v_n > 0 then
      insert into hv.ocupacion_historial (fecha, propiedad_id, propiedad_nombre, tipo, detalle)
      values (p_fecha, p_propiedad, v_prop, 'aviso', 'Aviso a recepción: lista para el ingreso (' || v_n || ' persona(s))');
    end if;
  end if;
end $function$
;
grant execute on function hv.ocupacion_limpieza(date, bigint, text, text, uuid) to authenticated;
notify pgrst, 'reload schema';
