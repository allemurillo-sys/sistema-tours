-- =====================================================================
-- Reporte de Limpieza · Guardado por campo (corrige datos que se borraban)
-- Fecha: 2026-11-28
--
-- Problema: la app enviaba la fila completa (Amanece, Queda, Noches, Pax,
-- Nota) cada vez que se cambiaba un solo dato, tomando el resto de una copia
-- local que a veces estaba desactualizada (dos cambios seguidos, o una
-- recarga automática que llegaba tarde). El segundo guardado devolvía a
-- vacío lo que se acababa de escribir. Ej.: CH2 28/11 8:07 "Noches 3 → —".
--
-- Solución: esta función recibe SOLO los campos que la persona cambió y los
-- combina con lo que ya está guardado en la base de datos. Lo demás nunca se
-- toca. Devuelve la fila tal como quedó para que la app use datos reales.
-- =====================================================================
create or replace function hv.ocupacion_guardar_campos(p_fecha date, p_propiedad bigint, p_cambios jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'hv', 'public'
as $function$
declare v_old hv.ocupacion; v_new hv.ocupacion; v_det text[] := '{}'; v_prop text;
        v_estado text; v_entrada text; v_noches int; v_pax int; v_nota text;
        num_ok constant text := '^\s*\d{1,4}\s*$';
begin
  if not hv.tengo('ocupacion_editar') then raise exception 'No tiene permiso para llenar el Reporte de Limpieza'; end if;
  if hv.ocupacion_cerrada(p_fecha) then raise exception 'Este reporte ya está archivado (se cierra a las 8:15 p. m.) y no se puede editar'; end if;
  perform hv.ocupacion_revisar_antelacion(p_fecha);
  if p_cambios is null or jsonb_typeof(p_cambios) <> 'object' then raise exception 'No hay cambios para guardar'; end if;
  select nombre into v_prop from hv.propiedades where id = p_propiedad;
  if v_prop is null then raise exception 'La propiedad no existe'; end if;

  -- Se bloquea la fila mientras se guarda: dos cambios seguidos se aplican uno tras otro, sin pisarse
  select * into v_old from hv.ocupacion where fecha = p_fecha and propiedad_id = p_propiedad for update;

  -- Se parte de lo que ya está guardado y solo se cambia lo que vino
  v_estado := v_old.estado; v_entrada := v_old.entrada; v_noches := v_old.noches; v_pax := v_old.pax; v_nota := v_old.nota;
  if p_cambios ? 'estado'  then v_estado  := nullif(nullif(trim(coalesce(p_cambios->>'estado', '')), ''), '-'); end if;
  if p_cambios ? 'entrada' then v_entrada := nullif(nullif(trim(coalesce(p_cambios->>'entrada', '')), ''), '-'); end if;
  if p_cambios ? 'noches'  then
    v_noches := case when coalesce(p_cambios->>'noches', '') ~ num_ok then least(greatest((p_cambios->>'noches')::numeric, 0), 365)::int end;
  end if;
  if p_cambios ? 'pax' then
    v_pax := case when coalesce(p_cambios->>'pax', '') ~ num_ok then least(greatest((p_cambios->>'pax')::numeric, 0), 99)::int end;
  end if;
  if p_cambios ? 'nota' then v_nota := nullif(left(trim(coalesce(p_cambios->>'nota', '')), 200), ''); end if;

  -- Regla: si amanece Ocupada, queda Ocupada (el huésped sigue); si deja de amanecer Ocupada, "Queda Ocupada" se limpia
  if p_cambios ? 'estado' and not p_cambios ? 'entrada' then
    if v_estado = 'OCUPADA' then v_entrada := 'OCUPADA';
    elsif v_entrada = 'OCUPADA' then v_entrada := null; end if;
  end if;
  if v_estado = 'OCUPADA' and v_entrada is distinct from 'OCUPADA' and v_entrada is not null then
    raise exception 'Si la propiedad amanece Ocupada, solo puede quedar Ocupada (el huésped sigue)';
  end if;
  if v_entrada = 'OCUPADA' and v_estado is distinct from 'OCUPADA' and v_estado is not null then
    raise exception '"Queda ocupada" solo aplica cuando la propiedad amanece Ocupada';
  end if;

  if v_old.estado  is distinct from v_estado  then v_det := v_det || ('Amanece: ' || coalesce(initcap(v_old.estado), '—') || ' → ' || coalesce(initcap(v_estado), '—')); end if;
  if v_old.entrada is distinct from v_entrada then v_det := v_det || ('Queda: '   || coalesce(initcap(v_old.entrada), '—') || ' → ' || coalesce(initcap(v_entrada), '—')); end if;
  if v_old.noches  is distinct from v_noches  then v_det := v_det || ('Noches: '  || coalesce(v_old.noches::text, '—') || ' → ' || coalesce(v_noches::text, '—')); end if;
  if v_old.pax     is distinct from v_pax     then v_det := v_det || ('Pax: '     || coalesce(v_old.pax::text, '—') || ' → ' || coalesce(v_pax::text, '—')); end if;
  if v_old.nota    is distinct from v_nota    then v_det := v_det || ('Nota: '    || coalesce(v_nota, '(borrada)')); end if;
  if array_length(v_det, 1) is null then
    return to_jsonb(v_old);            -- nada cambió: se devuelve lo guardado (puede ser null si la fila no existe)
  end if;

  perform hv.ocupacion_marcar_creador(p_fecha);
  insert into hv.ocupacion as o (fecha, propiedad_id, estado, entrada, noches, pax, nota, actualizado_por, actualizado_en)
  values (p_fecha, p_propiedad, v_estado, v_entrada, v_noches, v_pax, v_nota, auth.uid(), now())
  on conflict (fecha, propiedad_id) do update set estado = excluded.estado, entrada = excluded.entrada, noches = excluded.noches,
    pax = excluded.pax, nota = excluded.nota, actualizado_por = excluded.actualizado_por, actualizado_en = excluded.actualizado_en
  returning * into v_new;

  insert into hv.ocupacion_historial (fecha, propiedad_id, propiedad_nombre, usuario_id, tipo, detalle)
  values (p_fecha, p_propiedad, v_prop, auth.uid(), 'tablero', array_to_string(v_det, ' · '));
  return to_jsonb(v_new);
end $function$;

revoke all on function hv.ocupacion_guardar_campos(date, bigint, jsonb) from public, anon;
grant execute on function hv.ocupacion_guardar_campos(date, bigint, jsonb) to authenticated, service_role;
