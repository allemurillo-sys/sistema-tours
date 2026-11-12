set check_function_bodies = off;
CREATE OR REPLACE FUNCTION hv._completar_asignados(p_departamento text, p_asignados uuid[])
 RETURNS uuid[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'hv', 'public'
AS $function$
declare v uuid[];
begin
  v := array(select distinct x from unnest(coalesce(p_asignados, '{}'::uuid[])) x where x is not null order by 1);
  if cardinality(v) = 0
     and (select count(*) from hv.perfiles where rol = p_departamento and activo) = 1 then
    v := array(select id from hv.perfiles where rol = p_departamento and activo);
  end if;
  return v;
end $function$
;
CREATE OR REPLACE FUNCTION hv._validar_destino(p_departamento text, p_asignados uuid[])
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'hv', 'public'
AS $function$
declare v_validos int;
begin
  if p_departamento is null or p_departamento not in ('ama_llaves','supervisora','operaciones','mucama','admin') then
    raise exception 'Destino no válido';
  end if;
  if coalesce(cardinality(p_asignados), 0) = 0 then
    raise exception 'Seleccione al menos una persona de % a la que va dirigido el reporte', hv.destino_txt(p_departamento);
  end if;
  select count(*) into v_validos from hv.perfiles
   where id = any(p_asignados) and rol = p_departamento and activo;
  if v_validos <> (select count(distinct x) from unnest(p_asignados) x) then
    raise exception 'Alguna de las personas seleccionadas no pertenece a % o está inactiva', hv.destino_txt(p_departamento);
  end if;
end $function$
;
CREATE OR REPLACE FUNCTION hv.abrir_caso(p_id bigint)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'hv', 'public'
AS $function$
declare r hv.reportes;
begin
  select * into r from hv.reportes where id = p_id for update;
  if not found then raise exception 'El caso no existe'; end if;
  if not hv.es_destinatario(r) then
    raise exception 'Este caso no está dirigido a usted';
  end if;
  if r.abierto_en is null and r.estado = 'nuevo' then
    update hv.reportes
       set abierto_por = auth.uid(), abierto_en = now(), actualizado_en = now()
     where id = p_id;
    insert into hv.bitacora(reporte_id, usuario_id, accion, estado_anterior, estado_nuevo)
    values (p_id, auth.uid(), 'abierto', r.estado, r.estado);
    return auth.uid();
  end if;
  return r.abierto_por;
end $function$
;
CREATE OR REPLACE FUNCTION hv.agregar_nota(p_id bigint, p_texto text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'hv', 'public'
AS $function$
declare r hv.reportes;
begin
  select * into r from hv.reportes where id = p_id;
  if not found then raise exception 'El caso no existe'; end if;
  if hv.mi_rol() is null or not hv.puede_ver(r)
     or (not hv.tengo('agregar_notas') and not hv.puede_atender(r)) then
    raise exception 'No autorizado';
  end if;
  if coalesce(trim(p_texto), '') = '' then raise exception 'Escriba la nota'; end if;
  insert into hv.bitacora(reporte_id, usuario_id, accion, comentario)
  values (p_id, auth.uid(), 'nota', trim(p_texto));
  update hv.reportes set actualizado_en = now() where id = p_id;
end $function$
;
CREATE OR REPLACE FUNCTION hv.borrar_suscripcion(p_endpoint text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'hv', 'public'
AS $function$
  delete from hv.push_suscripciones where endpoint = p_endpoint and usuario_id = auth.uid();
$function$
;
CREATE OR REPLACE FUNCTION hv.cambiar_estado(p_id bigint, p_estado text, p_comentario text DEFAULT NULL::text, p_razon text DEFAULT NULL::text, p_solucion text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'hv', 'public'
AS $function$
declare r hv.reportes; v_todo boolean := hv.tengo('responder_todo');
begin
  select * into r from hv.reportes where id = p_id for update;
  if not found then raise exception 'El caso no existe'; end if;
  if not hv.puede_atender(r) then
    raise exception 'No está autorizado para atender este caso';
  end if;
  if r.estado = 'pendiente_admin' and not v_todo then
    raise exception 'Este caso está en Pendiente Admin: solo un administrador puede atenderlo';
  end if;
  if r.estado = 'listo' and not v_todo then
    raise exception 'El caso ya está finalizado. Solo un administrador puede reabrirlo';
  end if;
  if p_estado not in ('en_proceso','listo','revisado_pendiente','pendiente_admin') then
    raise exception 'Estado no válido';
  end if;
  if p_estado = r.estado then
    raise exception 'El caso ya está en ese estado';
  end if;
  if p_estado = 'listo' and coalesce(trim(p_comentario), '') = '' then
    raise exception 'Indique lo que se hizo para resolverlo';
  end if;
  if p_estado = 'revisado_pendiente'
     and (coalesce(trim(p_razon), '') = '' or coalesce(trim(p_solucion), '') = '') then
    raise exception 'Indique la razón y la posible solución';
  end if;
  if p_estado = 'pendiente_admin' and coalesce(trim(p_razon), '') = '' then
    raise exception 'Indique por qué no se pudo resolver';
  end if;
  update hv.reportes set
    estado         = p_estado,
    abierto_por    = coalesce(abierto_por, auth.uid()),
    abierto_en     = coalesce(abierto_en, now()),
    cerrado_por    = case when p_estado = 'listo' then auth.uid() else null end,
    cerrado_en     = case when p_estado = 'listo' then now() else null end,
    actualizado_en = now()
  where id = p_id;
  insert into hv.bitacora(reporte_id, usuario_id, accion, estado_anterior, estado_nuevo,
                              comentario, razon, posible_solucion)
  values (p_id, auth.uid(), 'cambio_estado', r.estado, p_estado,
          nullif(trim(p_comentario), ''), nullif(trim(p_razon), ''), nullif(trim(p_solucion), ''));
end $function$
;
CREATE OR REPLACE FUNCTION hv.claves_archivar(p_caja bigint, p_activa boolean, p_motivo text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'hv', 'public'
AS $function$
declare c hv.claves_cajas; v_max int := 2;
begin
  if not hv.tengo('claves_administrar') then
    raise exception 'Solo Operaciones, Ama de llaves y Administración pueden archivar cajas';
  end if;
  select * into c from hv.claves_cajas where id = p_caja for update;
  if not found then raise exception 'La caja no existe'; end if;
  if c.activa = p_activa then return; end if;
  if p_activa then
    perform 1 from hv.propiedades where id = c.propiedad_id for update;
    if (select count(*) from hv.claves_cajas where propiedad_id = c.propiedad_id and activa) >= v_max then
      raise exception 'Esta propiedad ya tiene % cajas activas. Archive una antes de restaurar esta', v_max;
    end if;
  end if;
  perform set_config('claves.motivo', left(coalesce(trim(p_motivo), ''), 200), true);
  update hv.claves_cajas set activa = p_activa, actualizado_en = now() where id = p_caja;
  perform set_config('claves.motivo', '', true);
end $function$
;
CREATE OR REPLACE FUNCTION hv.claves_archivar_propiedad(p_propiedad bigint, p_motivo text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'hv', 'public'
AS $function$
declare n int;
begin
  if not hv.tengo('claves_administrar') then
    raise exception 'Solo Operaciones, Ama de llaves y Administración pueden quitar propiedades de la sección';
  end if;
  perform set_config('claves.motivo', left(coalesce(trim(p_motivo), ''), 200), true);
  update hv.claves_cajas set activa = false, actualizado_en = now() where propiedad_id = p_propiedad and activa;
  get diagnostics n = row_count;
  perform set_config('claves.motivo', '', true);
  return n;
end $function$
;
CREATE OR REPLACE FUNCTION hv.claves_cambiar(p_caja bigint, p_clave text, p_motivo text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'hv', 'public'
AS $function$
declare c hv.claves_cajas;
begin
  if not hv.puede_claves() then raise exception 'Su usuario no puede cambiar claves de caja'; end if;
  p_clave := trim(coalesce(p_clave, ''));
  if p_clave !~ '^[0-9]{4}$' then raise exception 'La clave debe tener exactamente 4 números'; end if;
  select * into c from hv.claves_cajas where id = p_caja for update;
  if not found then raise exception 'La caja no existe'; end if;
  if not c.activa then raise exception 'Esta caja está archivada'; end if;
  if c.clave = p_clave then raise exception 'La clave nueva es igual a la actual'; end if;
  perform set_config('claves.motivo', left(coalesce(trim(p_motivo), ''), 200), true);
  update hv.claves_cajas
     set clave = p_clave, clave_cambiada_en = now(), clave_cambiada_por = auth.uid(), actualizado_en = now()
   where id = p_caja;
  perform set_config('claves.motivo', '', true);
end $function$
;
CREATE OR REPLACE FUNCTION hv.claves_foto(p_caja bigint, p_path text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'hv', 'public'
AS $function$
begin
  if not hv.tengo('claves_administrar') then
    raise exception 'Solo Operaciones, Ama de llaves y Administración pueden cambiar la foto';
  end if;
  p_path := nullif(trim(coalesce(p_path, '')), '');
  if p_path is not null and (p_path !~ '^cajas/[0-9]+/[A-Za-z0-9._-]+$'
      or not exists (select 1 from storage.objects where bucket_id = 'fotos-claves' and name = p_path)) then
    raise exception 'La foto no se subió correctamente. Intente de nuevo';
  end if;
  update hv.claves_cajas set foto = p_path, actualizado_en = now() where id = p_caja;
  if not found then raise exception 'La caja no existe'; end if;
end $function$
;
CREATE OR REPLACE FUNCTION hv.claves_guardar_caja(p_id bigint, p_propiedad bigint, p_nombre text, p_ubicacion text DEFAULT NULL::text, p_clave text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'hv', 'public'
AS $function$
declare v_id bigint; v_max int := 2; c hv.claves_cajas;
begin
  if not hv.tengo('claves_administrar') then
    raise exception 'Solo Operaciones, Ama de llaves y Administración pueden agregar o editar cajas';
  end if;
  p_nombre := trim(coalesce(p_nombre, ''));
  p_ubicacion := nullif(trim(coalesce(p_ubicacion, '')), '');
  if p_nombre = '' then raise exception 'Escriba el nombre o ubicación de la caja (por ejemplo: Entrada principal)'; end if;
  if length(p_nombre) > 60 then raise exception 'El nombre de la caja es muy largo (máximo 60 letras)'; end if;

  if p_id is null then
    if not exists (select 1 from hv.propiedades where id = p_propiedad) then
      raise exception 'Seleccione una propiedad válida';
    end if;
    p_clave := trim(coalesce(p_clave, ''));
    if p_clave !~ '^[0-9]{4}$' then raise exception 'La clave debe tener exactamente 4 números'; end if;
    perform 1 from hv.propiedades where id = p_propiedad for update;
    if (select count(*) from hv.claves_cajas where propiedad_id = p_propiedad and activa) >= v_max then
      raise exception 'Esta propiedad ya tiene % cajas activas', v_max;
    end if;
    if exists (select 1 from hv.claves_cajas where propiedad_id = p_propiedad and activa and lower(nombre) = lower(p_nombre)) then
      raise exception 'Esta propiedad ya tiene una caja con ese nombre';
    end if;
    insert into hv.claves_cajas(propiedad_id, nombre, ubicacion, clave, creado_por, clave_cambiada_por)
    values (p_propiedad, p_nombre, p_ubicacion, p_clave, auth.uid(), auth.uid())
    returning id into v_id;
    return v_id;
  end if;

  select * into c from hv.claves_cajas where id = p_id for update;
  if not found then raise exception 'La caja no existe'; end if;
  if exists (select 1 from hv.claves_cajas where propiedad_id = c.propiedad_id and activa and id <> p_id
             and lower(nombre) = lower(p_nombre)) then
    raise exception 'Esta propiedad ya tiene una caja con ese nombre';
  end if;
  update hv.claves_cajas set nombre = p_nombre, ubicacion = p_ubicacion, actualizado_en = now() where id = p_id;
  return p_id;
end $function$
;
CREATE OR REPLACE FUNCTION hv.destino_txt(d text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case d when 'ama_llaves' then 'Ama de llaves' when 'supervisora' then 'Supervisora'
                when 'operaciones' then 'Operaciones' when 'mucama' then 'Mucama'
                when 'admin' then 'Administración' else d end
$function$
;
CREATE OR REPLACE FUNCTION hv.destinos_permitidos(p_rol text)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case p_rol
    when 'admin'       then array['ama_llaves','supervisora','operaciones','mucama','admin']
    when 'ama_llaves'  then array['mucama','supervisora','operaciones','admin']
    when 'operaciones' then array['ama_llaves','operaciones','mucama','admin']
    when 'supervisora' then array['ama_llaves','operaciones','mucama','admin']
    when 'mucama'      then array['ama_llaves','supervisora','operaciones']
    else '{}'::text[] end
$function$
;
CREATE OR REPLACE FUNCTION hv.es_destinatario(p hv.reportes)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'hv', 'public'
AS $function$
  select case
    when hv.mi_rol() is null then false
    when coalesce(cardinality(hv.lista_destinatarios(p)), 0) > 0
      then auth.uid() = any(hv.lista_destinatarios(p))
    else hv.mi_rol() = p.departamento
  end
$function$
;
CREATE OR REPLACE FUNCTION hv.estado_txt(e text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case e when 'nuevo' then 'Nuevo' when 'en_proceso' then 'En proceso'
    when 'revisado_pendiente' then 'Revisado / Pendiente' when 'pendiente_admin' then 'Pendiente Admin'
    when 'listo' then 'Listo (finalizado)' else e end
$function$
;
CREATE OR REPLACE FUNCTION hv.guardar_suscripcion(p_endpoint text, p_p256dh text, p_auth text, p_dispositivo text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'hv', 'public'
AS $function$
begin
  if hv.mi_rol() is null then raise exception 'Usuario sin acceso'; end if;
  insert into hv.push_suscripciones(usuario_id, endpoint, p256dh, auth, dispositivo)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_dispositivo, 200))
  on conflict (endpoint) do update set usuario_id = auth.uid(), p256dh = excluded.p256dh,
    auth = excluded.auth, dispositivo = excluded.dispositivo, creado_en = now();
end $function$
;
CREATE OR REPLACE FUNCTION hv.hora_servidor()
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE
AS $function$ select now() $function$
;
CREATE OR REPLACE FUNCTION hv.lista_destinatarios(p hv.reportes)
 RETURNS uuid[]
 LANGUAGE sql
 STABLE
AS $function$
  select case when coalesce(cardinality(p.asignados), 0) > 0 then p.asignados
              when p.asignado_a is not null then array[p.asignado_a]
              else '{}'::uuid[] end
$function$
;
CREATE OR REPLACE FUNCTION hv.marcar_leidas(p_ids bigint[] DEFAULT NULL::bigint[])
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'hv', 'public'
AS $function$
  update hv.notificaciones set leida = true
   where usuario_id = auth.uid() and not leida
     and (p_ids is null or id = any(p_ids))
$function$
;
CREATE OR REPLACE FUNCTION hv.mi_departamento()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'hv', 'public'
AS $function$
  select case hv.mi_rol()
           when 'ama_llaves'  then 'ama_llaves'
           when 'supervisora' then 'ama_llaves'
           when 'operaciones' then 'operaciones'
         end
$function$
;
CREATE OR REPLACE FUNCTION hv.ocupacion_alerta_ingresos(p_hora text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'hv', 'public'
AS $function$
declare v_hoy date := hv.ocupacion_hoy(); v_lista text; v_cant int; v_msg text; v_tit text; v_n int; v_ya timestamptz;
begin
  if p_hora not in ('14:00','14:30','15:00') then raise exception 'Hora no válida'; end if;
  if auth.uid() is not null and coalesce(hv.mi_rol(), '') <> 'admin' then raise exception 'No autorizado'; end if;

  insert into hv.ocupacion_dia (fecha) values (v_hoy) on conflict (fecha) do nothing;
  select case p_hora when '14:00' then alerta_1400 when '14:30' then alerta_1430 else alerta_1500 end
    into v_ya from hv.ocupacion_dia where fecha = v_hoy;
  if v_ya is not null then return 0; end if;

  select count(*), string_agg(p.nombre || ' (' || coalesce(initcap(o.limpieza), 'sin marcar') || ')', ', ' order by p.orden nulls last, p.nombre)
    into v_cant, v_lista
    from hv.ocupacion o join hv.propiedades p on p.id = o.propiedad_id
   where o.fecha = v_hoy and o.entrada = 'ENTRA' and o.limpieza is distinct from 'lista';
  if v_cant = 0 then return 0; end if;

  v_tit := case p_hora when '14:00' then '⚠️ Ingresos: falta 1 hora'
                       when '14:30' then '⚠️ Ingresos: faltan 30 minutos'
                       else '🚨 Hora de ingreso (3:00 p. m.)' end;
  v_msg := v_cant || case when v_cant = 1 then ' propiedad entra hoy y aún no está lista: ' else ' propiedades entran hoy y aún no están listas: ' end || v_lista;

  insert into hv.notificaciones (usuario_id, reporte_id, numero_caso, propiedad_nombre, mensaje, tipo)
  select p.id, null, v_tit, null, left(v_msg, 900), 'ocupacion'
    from hv.perfiles p where p.activo and hv.permiso_de(p.id, 'alerta_ingresos');
  get diagnostics v_n = row_count;

  update hv.ocupacion_dia set
    alerta_1400 = case when p_hora = '14:00' then now() else alerta_1400 end,
    alerta_1430 = case when p_hora = '14:30' then now() else alerta_1430 end,
    alerta_1500 = case when p_hora = '15:00' then now() else alerta_1500 end
  where fecha = v_hoy;
  insert into hv.ocupacion_historial (fecha, tipo, detalle)
  values (v_hoy, 'alerta', 'Alerta de las ' || p_hora || ' enviada a ' || v_n || ' persona(s): ' || v_msg);
  return v_n;
end $function$
;
CREATE OR REPLACE FUNCTION hv.ocupacion_archivar()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'hv', 'public'
AS $function$
declare v_hoy date := hv.ocupacion_hoy(); r record;
begin
  if auth.uid() is not null then raise exception 'No autorizado'; end if;
  insert into hv.ocupacion_dia (fecha) values (v_hoy) on conflict (fecha) do nothing;
  for r in select d.fecha from hv.ocupacion_dia d where d.fecha <= v_hoy and d.archivado_en is null loop
    update hv.ocupacion_dia set archivado_en = now(), resumen = (
      select jsonb_build_object(
        'ocupadas',    count(*) filter (where estado = 'OCUPADA'),
        'entradas',    count(*) filter (where entrada = 'ENTRA'),
        'salidas',     count(*) filter (where estado = 'SALE'),
        'libres',      count(*) filter (where entrada = 'LIBRE'),
        'bloqueadas',  count(*) filter (where entrada = 'BLOQUEADA'),
        'pax',         coalesce(sum(pax), 0),
        'listas',      count(*) filter (where limpieza = 'lista'),
        'sucias',      count(*) filter (where limpieza = 'sucia'),
        'pendientes',  count(*) filter (where limpieza = 'pendiente'),
        'bloqueadas_limpieza', count(*) filter (where limpieza = 'bloqueada'),
        'ingresos_no_listos',  count(*) filter (where entrada = 'ENTRA' and limpieza is distinct from 'lista'))
      from hv.ocupacion where fecha = r.fecha)
    where fecha = r.fecha;
    insert into hv.ocupacion_historial (fecha, tipo, detalle)
    values (r.fecha, 'archivo', 'Tablero archivado (cierre de las 8:15 p. m.). Queda en solo lectura.');
  end loop;
end $function$
;
CREATE OR REPLACE FUNCTION hv.ocupacion_cerrada(p_fecha date)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'hv', 'public'
AS $function$
  select p_fecha < hv.ocupacion_hoy()
      or (p_fecha = hv.ocupacion_hoy() and (now() at time zone 'America/Costa_Rica')::time >= time '20:15')
      or exists (select 1 from hv.ocupacion_dia d where d.fecha = p_fecha and d.archivado_en is not null)
$function$
;
CREATE OR REPLACE FUNCTION hv.ocupacion_copiar(p_desde date, p_hasta date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'hv', 'public'
AS $function$
declare n integer;
begin
  if not hv.tengo('ocupacion_editar') then raise exception 'No tiene permiso para llenar el Reporte de Limpieza'; end if;
  if hv.ocupacion_cerrada(p_hasta) then raise exception 'Este reporte ya está archivado (se cierra a las 8:15 p. m.) y no se puede editar'; end if;
  perform hv.ocupacion_revisar_antelacion(p_hasta);
  insert into hv.ocupacion as o (fecha, propiedad_id, estado, entrada, noches, pax, actualizado_por, actualizado_en)
  select p_hasta, a.propiedad_id,
         case a.entrada when 'ENTRA' then 'OCUPADA' when 'OCUPADA' then 'OCUPADA' else 'LIBRE' end,
         case a.entrada when 'ENTRA' then 'OCUPADA' when 'OCUPADA' then 'OCUPADA' when 'BLOQUEADA' then 'BLOQUEADA' else null end,
         case when a.entrada in ('ENTRA','OCUPADA') then a.noches end,
         case when a.entrada in ('ENTRA','OCUPADA') then a.pax end,
         auth.uid(), now()
    from hv.ocupacion a
   where a.fecha = p_desde and a.entrada is not null
  on conflict (fecha, propiedad_id) do update set estado = excluded.estado, entrada = excluded.entrada, noches = excluded.noches,
    pax = excluded.pax, actualizado_por = excluded.actualizado_por, actualizado_en = excluded.actualizado_en;
  get diagnostics n = row_count;
  if n > 0 then perform hv.ocupacion_marcar_creador(p_hasta); end if;
  insert into hv.ocupacion_historial (fecha, usuario_id, tipo, detalle)
  values (p_hasta, auth.uid(), 'copia', 'Día armado desde el ' || to_char(p_desde, 'DD/MM/YYYY') || ': lo que ese día "Queda" pasó a "Amanece" (' || n || ' propiedades)');
  return n;
end $function$
;
CREATE OR REPLACE FUNCTION hv.ocupacion_guardar(p_fecha date, p_propiedad bigint, p_estado text, p_entrada text, p_noches integer, p_pax integer, p_nota text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'hv', 'public'
AS $function$
declare v_old hv.ocupacion; v_det text[] := '{}'; v_prop text;
begin
  if not hv.tengo('ocupacion_editar') then raise exception 'No tiene permiso para llenar el Reporte de Limpieza'; end if;
  if hv.ocupacion_cerrada(p_fecha) then raise exception 'Este reporte ya está archivado (se cierra a las 8:15 p. m.) y no se puede editar'; end if;
  perform hv.ocupacion_revisar_antelacion(p_fecha);
  p_estado := nullif(nullif(trim(coalesce(p_estado, '')), ''), '-');
  p_entrada := nullif(nullif(trim(coalesce(p_entrada, '')), ''), '-');
  if p_estado = 'OCUPADA' and p_entrada is distinct from 'OCUPADA' and p_entrada is not null then
    raise exception 'Si la propiedad amanece Ocupada, solo puede quedar Ocupada (el huésped sigue)';
  end if;
  if p_entrada = 'OCUPADA' and p_estado is distinct from 'OCUPADA' and p_estado is not null then
    raise exception '"Queda ocupada" solo aplica cuando la propiedad amanece Ocupada';
  end if;
  select nombre into v_prop from hv.propiedades where id = p_propiedad;
  if v_prop is null then raise exception 'La propiedad no existe'; end if;
  p_nota := nullif(trim(coalesce(p_nota, '')), '');
  select * into v_old from hv.ocupacion where fecha = p_fecha and propiedad_id = p_propiedad;

  if v_old.estado is distinct from p_estado then v_det := v_det || ('Amanece: ' || coalesce(initcap(v_old.estado), '—') || ' → ' || coalesce(initcap(p_estado), '—')); end if;
  if v_old.entrada is distinct from p_entrada then v_det := v_det || ('Queda: ' || coalesce(initcap(v_old.entrada), '—') || ' → ' || coalesce(initcap(p_entrada), '—')); end if;
  if v_old.noches is distinct from p_noches then v_det := v_det || ('Noches: ' || coalesce(v_old.noches::text, '—') || ' → ' || coalesce(p_noches::text, '—')); end if;
  if v_old.pax is distinct from p_pax then v_det := v_det || ('Pax: ' || coalesce(v_old.pax::text, '—') || ' → ' || coalesce(p_pax::text, '—')); end if;
  if v_old.nota is distinct from p_nota then v_det := v_det || ('Nota: ' || coalesce(p_nota, '(borrada)')); end if;
  if array_length(v_det, 1) is null then return; end if;

  perform hv.ocupacion_marcar_creador(p_fecha);
  insert into hv.ocupacion as o (fecha, propiedad_id, estado, entrada, noches, pax, nota, actualizado_por, actualizado_en)
  values (p_fecha, p_propiedad, p_estado, p_entrada, p_noches, p_pax, p_nota, auth.uid(), now())
  on conflict (fecha, propiedad_id) do update set estado = excluded.estado, entrada = excluded.entrada, noches = excluded.noches,
    pax = excluded.pax, nota = excluded.nota, actualizado_por = excluded.actualizado_por, actualizado_en = excluded.actualizado_en;

  insert into hv.ocupacion_historial (fecha, propiedad_id, propiedad_nombre, usuario_id, tipo, detalle)
  values (p_fecha, p_propiedad, v_prop, auth.uid(), 'tablero', array_to_string(v_det, ' · '));
end $function$
;
CREATE OR REPLACE FUNCTION hv.ocupacion_hoy()
 RETURNS date
 LANGUAGE sql
 STABLE
AS $function$ select (now() at time zone 'America/Costa_Rica')::date $function$
;
CREATE OR REPLACE FUNCTION hv.ocupacion_incompletas(p_fecha date)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'hv', 'public'
AS $function$
  select count(*)::int from hv.propiedades p
    left join hv.ocupacion o on o.propiedad_id = p.id and o.fecha = p_fecha
   where p.activa and p.en_ocupacion and (o.estado is null or o.entrada is null)
$function$
;
CREATE OR REPLACE FUNCTION hv.ocupacion_limpieza(p_fecha date, p_propiedad bigint, p_estado text, p_nota text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'hv', 'public'
AS $function$
declare v_old hv.ocupacion; v_new hv.ocupacion; v_prop text; v_actor text; v_n int;
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
  select * into v_old from hv.ocupacion where fecha = p_fecha and propiedad_id = p_propiedad;
  if v_old.limpieza is not distinct from p_estado and v_old.limpieza_nota is not distinct from p_nota then return; end if;

  insert into hv.ocupacion as o (fecha, propiedad_id, limpieza, limpieza_nota, limpieza_por, limpieza_en)
  values (p_fecha, p_propiedad, p_estado, p_nota, auth.uid(), now())
  on conflict (fecha, propiedad_id) do update set limpieza = excluded.limpieza, limpieza_nota = excluded.limpieza_nota,
    limpieza_por = excluded.limpieza_por, limpieza_en = excluded.limpieza_en
  returning * into v_new;

  insert into hv.ocupacion_historial (fecha, propiedad_id, propiedad_nombre, usuario_id, tipo, detalle)
  values (p_fecha, p_propiedad, v_prop, auth.uid(), 'limpieza',
          'Limpieza: ' || coalesce(initcap(v_old.limpieza), 'Sin marcar') || ' → ' || coalesce(initcap(p_estado), 'Sin marcar')
          || coalesce(' · ' || p_nota, ''));

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
CREATE OR REPLACE FUNCTION hv.ocupacion_marcar_creador(p_fecha date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'hv', 'public'
AS $function$
declare v_n int;
begin
  insert into hv.ocupacion_dia (fecha, creado_por, creado_en) values (p_fecha, auth.uid(), now())
  on conflict (fecha) do update set creado_por = excluded.creado_por, creado_en = excluded.creado_en
    where hv.ocupacion_dia.creado_por is null;
  get diagnostics v_n = row_count;
  if v_n > 0 then
    insert into hv.ocupacion_historial (fecha, usuario_id, tipo, detalle) values (p_fecha, auth.uid(), 'creado', 'Creó el tablero del día');
  end if;
end $function$
;
CREATE OR REPLACE FUNCTION hv.ocupacion_revisar_antelacion(p_fecha date)
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'hv', 'public'
AS $function$
begin
  if p_fecha > hv.ocupacion_hoy() + 2 then
    raise exception 'El tablero solo se puede crear con hasta 2 días de antelación (hasta el %)', to_char(hv.ocupacion_hoy() + 2, 'DD/MM/YYYY');
  end if;
end $function$
;
CREATE OR REPLACE FUNCTION hv.ocupacion_terminar(p_fecha date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'hv', 'public'
AS $function$
declare v_actor text; v_rol text; v_prev timestamptz; v_n int; v_fc text := to_char(p_fecha, 'DD/MM/YY'); v_act boolean;
begin
  if not hv.tengo('ocupacion_editar') then raise exception 'No tiene permiso para terminar el Reporte de Limpieza'; end if;
  if hv.ocupacion_cerrada(p_fecha) then raise exception 'Este reporte ya está archivado (se cierra a las 8:15 p. m.)'; end if;
  perform hv.ocupacion_revisar_antelacion(p_fecha);
  if not exists (select 1 from hv.ocupacion where fecha = p_fecha and (estado is not null or entrada is not null)) then
    raise exception 'El reporte está vacío: llene al menos una propiedad antes de terminarlo';
  end if;
  if hv.ocupacion_incompletas(p_fecha) > 0 then
    raise exception 'Falta completar "Amanece" y "Queda" en % propiedad(es) antes de terminar el reporte', hv.ocupacion_incompletas(p_fecha);
  end if;
  perform hv.ocupacion_marcar_creador(p_fecha);
  select terminado_en into v_prev from hv.ocupacion_dia where fecha = p_fecha;
  v_act := v_prev is not null;
  update hv.ocupacion_dia set terminado_por = auth.uid(), terminado_en = now(), avisos_terminado = avisos_terminado + 1 where fecha = p_fecha;

  select nombre, rol into v_actor, v_rol from hv.perfiles where id = auth.uid();
  insert into hv.notificaciones (usuario_id, reporte_id, numero_caso, propiedad_nombre, mensaje, tipo, fecha_ref)
  select p.id, null,
         case when v_act then '📋 Reporte de Limpieza actualizado' else '📋 Reporte de Limpieza listo' end,
         null,
         'El Reporte de Limpieza ' || v_fc || case when v_act then ' tiene cambios' else ' ya está listo para revisar' end
         || ' — ' || coalesce(v_actor, '—') || case v_rol when 'operaciones' then ' (Operaciones)' when 'admin' then ' (Administrador)' else '' end,
         'ocupacion', p_fecha
    from hv.perfiles p
   where p.activo and p.id is distinct from auth.uid() and hv.permiso_de(p.id, 'aviso_reporte_terminado');
  get diagnostics v_n = row_count;

  insert into hv.ocupacion_historial (fecha, usuario_id, tipo, detalle)
  values (p_fecha, auth.uid(), 'terminado',
          case when v_act then 'Avisó actualización del reporte' else 'Marcó el reporte como terminado' end || ' (aviso a ' || v_n || ' persona(s))');
  return v_n;
end $function$
;
CREATE OR REPLACE FUNCTION hv.ocupacion_ultima_limpieza(p_fecha date)
 RETURNS TABLE(propiedad_id bigint, fecha date, limpieza text, limpieza_por uuid, limpieza_en timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'hv', 'public'
AS $function$
  select distinct on (o.propiedad_id) o.propiedad_id, o.fecha, o.limpieza, o.limpieza_por, o.limpieza_en
  from hv.ocupacion o
  where hv.puede_ocupacion() and coalesce(hv.mi_rol(), '') not in ('mucama','supervisora')
    and o.fecha < p_fecha and o.fecha >= p_fecha - 30 and o.limpieza is not null
  order by o.propiedad_id, o.fecha desc
$function$
;
CREATE OR REPLACE FUNCTION hv.puede_atender(p hv.reportes)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'hv', 'public'
AS $function$
  select case
    when hv.mi_rol() is null then false
    when hv.tengo('responder_todo') then true
    when hv.es_destinatario(p) then true
    when hv.tengo('responder_mucamas') and p.departamento = 'mucama' then true
    when hv.tengo('responder_supervisoras') and p.departamento = 'supervisora' then true
    else false
  end
$function$
;
CREATE OR REPLACE FUNCTION hv.puede_claves()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'hv', 'public'
AS $function$
  select hv.tengo('claves_cambiar') or hv.tengo('claves_administrar')
$function$
;
CREATE OR REPLACE FUNCTION hv.puede_ocupacion()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'hv', 'public'
AS $function$
  select hv.tengo('ocupacion_ver') or hv.tengo('ocupacion_editar') or hv.tengo('ocupacion_limpieza')
$function$
;
CREATE OR REPLACE FUNCTION hv.puede_ver(p hv.reportes)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'hv', 'public'
AS $function$
  select case
    when hv.mi_rol() is null then false
    when hv.mi_rol() = 'admin' or hv.tengo('ver_todos') then true
    when p.creado_por = auth.uid() or hv.es_destinatario(p) then true
    when hv.tengo('ver_mismo_rol') and p.departamento = hv.mi_rol() then true
    when hv.tengo('ver_mucamas') and (p.departamento = 'mucama'
         or exists (select 1 from hv.perfiles c where c.id = p.creado_por and c.rol = 'mucama')) then true
    when hv.tengo('ver_supervisoras') and (p.departamento = 'supervisora'
         or exists (select 1 from hv.perfiles c where c.id = p.creado_por and c.rol = 'supervisora')) then true
    else false
  end
$function$
;
CREATE OR REPLACE FUNCTION hv.puede_ver_ocupacion_fecha(p_fecha date)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'hv', 'public'
AS $function$
  select hv.puede_ocupacion() and case
    when coalesce(hv.mi_rol(), '') in ('mucama','supervisora') then
         p_fecha = hv.ocupacion_hoy()
     and (now() at time zone 'America/Costa_Rica')::time >= time '08:00'
     and not hv.ocupacion_cerrada(p_fecha)
    else true end
$function$
;
CREATE OR REPLACE FUNCTION hv.reclasificar(p_id bigint, p_departamento text, p_prioridad text, p_motivo text, p_asignados uuid[] DEFAULT NULL::uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'hv', 'public'
AS $function$
declare r hv.reportes; v_cambia boolean; v_nombres text; v_antes uuid[];
begin
  select * into r from hv.reportes where id = p_id for update;
  if not found then raise exception 'El caso no existe'; end if;
  if not hv.puede_atender(r) then
    raise exception 'No está autorizado para reclasificar este caso';
  end if;
  if r.estado = 'listo' then raise exception 'El caso ya está finalizado'; end if;
  if p_prioridad not in ('alta','media','baja') then raise exception 'Prioridad no válida'; end if;
  p_asignados := hv._completar_asignados(p_departamento, p_asignados);
  perform hv._validar_destino(p_departamento, p_asignados);
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Indique el motivo'; end if;

  v_antes  := array(select x from unnest(hv.lista_destinatarios(r)) x order by 1);
  v_cambia := p_departamento <> r.departamento or p_asignados is distinct from v_antes;

  if v_cambia then
    update hv.reportes set departamento = p_departamento, asignados = p_asignados, asignado_a = null,
      prioridad = p_prioridad, estado = 'nuevo', abierto_por = null, abierto_en = null,
      actualizado_en = now()
    where id = p_id;
  else
    update hv.reportes set prioridad = p_prioridad, actualizado_en = now() where id = p_id;
  end if;

  select string_agg(nombre, ', ' order by nombre) into v_nombres
    from hv.perfiles where id = any(p_asignados);

  insert into hv.bitacora(reporte_id, usuario_id, accion, estado_anterior, estado_nuevo, comentario)
  values (p_id, auth.uid(), 'reclasificado', r.estado,
          case when v_cambia then 'nuevo' else r.estado end,
          trim(p_motivo) || '  [Dirigido a: ' || hv.destino_txt(p_departamento) || ': ' || coalesce(v_nombres, '')
          || ' · Prioridad: ' || p_prioridad || ']');
end $function$
;
CREATE OR REPLACE FUNCTION hv.registrar_visto(p_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'hv', 'public'
AS $function$
declare r hv.reportes;
begin
  if not hv.tengo('revisar_visto') then return; end if;
  perform pg_advisory_xact_lock(p_id);
  select * into r from hv.reportes where id = p_id;
  if not found or not hv.puede_ver(r) then return; end if;
  if exists (select 1 from hv.bitacora where reporte_id = p_id and usuario_id = auth.uid()) then return; end if;
  insert into hv.bitacora(reporte_id, usuario_id, accion, estado_anterior, estado_nuevo)
  values (p_id, auth.uid(), 'visto', r.estado, r.estado);
end $function$
;
CREATE OR REPLACE FUNCTION hv.respaldo_pendiente(p_meses integer DEFAULT 6)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'hv', 'public'
AS $function$
declare v jsonb;
begin
  if auth.uid() is not null and coalesce(hv.mi_rol(), '') <> 'admin' then raise exception 'Solo el Administrador puede hacer el respaldo'; end if;
  if p_meses is null or p_meses < 1 then raise exception 'Periodo no válido'; end if;
  select jsonb_build_object(
           'casos', count(distinct r.id),
           'fotos', count(o.name),
           'bytes', coalesce(sum((o.metadata->>'size')::bigint), 0),
           'ids',   coalesce(jsonb_agg(distinct r.id), '[]'::jsonb),
           'mas_viejo', min(r.cerrado_en))
    into v
    from hv.reportes r
    cross join lateral unnest(r.fotos) as p(path)
    join storage.objects o on o.bucket_id = 'fotos-reportes' and o.name = p.path
   where r.estado = 'listo' and r.cerrado_en < now() - make_interval(months => p_meses);
  return v;
end $function$
;
CREATE OR REPLACE FUNCTION hv.respaldo_recordar()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'hv', 'public'
AS $function$
declare v jsonb; v_n int; v_mb text;
begin
  if auth.uid() is not null then raise exception 'No autorizado'; end if;
  v := hv.respaldo_pendiente(6);
  if coalesce((v->>'fotos')::int, 0) = 0 then return 0; end if;
  if exists (select 1 from hv.notificaciones where tipo = 'respaldo' and creado_en > now() - interval '7 days') then return 0; end if;
  v_mb := to_char(greatest((v->>'bytes')::numeric / 1048576, 0.1), 'FM9990.0');
  insert into hv.notificaciones (usuario_id, reporte_id, numero_caso, propiedad_nombre, mensaje, tipo)
  select p.id, null, '📦 Respaldo pendiente', null,
         'Hay ' || (v->>'fotos') || ' fotos de ' || (v->>'casos') || ' casos finalizados hace más de 6 meses (' || v_mb
         || ' MB). Toque aquí y presione "Descargar respaldo" para guardarlas en la computadora y liberar espacio.',
         'respaldo'
    from hv.perfiles p where p.activo and p.rol = 'admin';
  get diagnostics v_n = row_count;
  return v_n;
end $function$
;
CREATE OR REPLACE FUNCTION hv.respaldo_registrar(p_ids bigint[], p_bytes bigint, p_archivo text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'hv', 'public'
AS $function$
declare v_fotos int := 0; v_casos int := 0; r record; v_quedan text[]; v_quitadas int;
begin
  if coalesce(hv.mi_rol(), '') <> 'admin' then raise exception 'Solo el Administrador puede hacer el respaldo'; end if;
  for r in select id, fotos from hv.reportes
            where id = any(p_ids) and estado = 'listo' and cardinality(fotos) > 0 for update loop
    v_quedan := array(select p from unnest(r.fotos) p
                       where exists (select 1 from storage.objects o where o.bucket_id = 'fotos-reportes' and o.name = p));
    v_quitadas := cardinality(r.fotos) - cardinality(v_quedan);
    if v_quitadas > 0 then
      update hv.reportes set fotos = v_quedan, fotos_archivadas = fotos_archivadas + v_quitadas,
             fotos_respaldo_en = now() where id = r.id;
      v_fotos := v_fotos + v_quitadas; v_casos := v_casos + 1;
    end if;
  end loop;
  if v_fotos > 0 then
    insert into hv.respaldos (usuario_id, casos, fotos, bytes, archivo)
    values (auth.uid(), v_casos, v_fotos, p_bytes, left(p_archivo, 200));
  end if;
  return v_fotos;
end $function$
;
CREATE OR REPLACE FUNCTION hv.telegram_activar(p_activo boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'hv', 'public'
AS $function$
begin
  if coalesce(hv.mi_rol(), '') <> 'admin' then raise exception 'Solo administradores'; end if;
  update hv.telegram_config
     set activo = p_activo,
         activado_en = case when p_activo and not activo then now() else activado_en end,
         actualizado_en = now(), actualizado_por = auth.uid()
   where id = 1;
end $function$
;
CREATE OR REPLACE FUNCTION hv.telegram_desvincular(p_usuario uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'hv', 'public'
AS $function$
declare v_id uuid := coalesce(p_usuario, auth.uid());
begin
  if v_id <> auth.uid() and coalesce(hv.mi_rol(), '') <> 'admin' then raise exception 'Solo administradores'; end if;
  update hv.telegram_vinculos
     set telegram_user_id = null, telegram_username = null, telegram_nombre = null,
         vinculado_en = null, bot_iniciado = null, codigo = null, codigo_expira = null, actualizado_en = now()
   where usuario_id = v_id;
end $function$
;
CREATE OR REPLACE FUNCTION hv.telegram_generar_codigo()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'hv', 'public', 'extensions'
AS $function$
declare v_codigo text;
begin
  if hv.mi_rol() is null then raise exception 'Usuario sin acceso'; end if;
  v_codigo := upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8));
  insert into hv.telegram_vinculos (usuario_id, codigo, codigo_expira, actualizado_en)
  values (auth.uid(), v_codigo, now() + interval '15 minutes', now())
  on conflict (usuario_id) do update set codigo = excluded.codigo, codigo_expira = excluded.codigo_expira, actualizado_en = now();
  return v_codigo;
end $function$
;
CREATE OR REPLACE FUNCTION hv.tg_bitacora_notificar()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'hv', 'public'
AS $function$
declare r hv.reportes; v_actor text; v_msg text; v_dest uuid[]; v_rol_creador text;
        v_de_mucama boolean; v_de_sup boolean;
begin
  if new.accion = 'visto' then return new; end if;
  select * into r from hv.reportes where id = new.reporte_id;
  select nombre into v_actor from hv.perfiles where id = new.usuario_id;
  v_msg := case new.accion
    when 'creado'        then 'Nuevo reporte asignado a usted'
    when 'abierto'       then 'El caso fue abierto y está siendo revisado'
    when 'nota'          then 'Nueva nota de seguimiento: ' || left(coalesce(new.comentario,''), 120)
    when 'reclasificado' then 'El caso fue reclasificado: ' || left(coalesce(new.comentario,''), 120)
    when 'cambio_estado' then 'Estado cambió a ' || hv.estado_txt(new.estado_nuevo)
                              || coalesce(': ' || left(coalesce(new.comentario, new.razon), 120), '')
    else new.accion end
    || ' — ' || coalesce(v_actor, 'Sistema');
  v_dest := array_remove(array[r.creado_por, r.asignado_a] || coalesce(r.asignados, '{}'::uuid[]), null);
  insert into hv.notificaciones(usuario_id, reporte_id, numero_caso, propiedad_nombre, mensaje)
  select distinct u, r.id, r.numero_caso, r.propiedad_nombre, v_msg
    from unnest(v_dest) as u
   where u is distinct from new.usuario_id;
  if new.accion in ('creado', 'cambio_estado') then
    select rol into v_rol_creador from hv.perfiles where id = r.creado_por;
    v_de_mucama := r.departamento = 'mucama' or v_rol_creador = 'mucama';
    v_de_sup    := r.departamento = 'supervisora' or v_rol_creador = 'supervisora';
    if v_de_mucama or v_de_sup then
      insert into hv.notificaciones(usuario_id, reporte_id, numero_caso, propiedad_nombre, mensaje)
      select p.id, r.id, r.numero_caso, r.propiedad_nombre,
             case when new.accion = 'creado'
                  then 'Nuevo reporte para ' || hv.destino_txt(r.departamento) || ' — ' || coalesce(v_actor, 'Sistema')
                  else v_msg end
        from hv.perfiles p
       where p.activo
         and ((v_de_mucama and hv.permiso_de(p.id, 'campana_mucamas'))
           or (v_de_sup    and hv.permiso_de(p.id, 'campana_supervisoras')))
         and p.id is distinct from new.usuario_id
         and not (p.id = any(v_dest));
    end if;
  end if;
  return new;
end $function$
;
CREATE OR REPLACE FUNCTION hv.tg_claves_historial()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'hv', 'public'
AS $function$
declare v_prop text; v_uid uuid := auth.uid();
        v_motivo text := nullif(trim(coalesce(current_setting('claves.motivo', true), '')), '');
begin
  if tg_op = 'DELETE' then
    v_prop := coalesce((select nombre from hv.propiedades where id = old.propiedad_id),
                       (select propiedad_nombre from hv.claves_historial where caja_id = old.id order by id desc limit 1));
    insert into hv.claves_historial(caja_id, propiedad_id, propiedad_nombre, caja_nombre, usuario_id, accion, valor_anterior)
    values (old.id, old.propiedad_id, v_prop, old.nombre, v_uid, 'caja_eliminada', old.clave);
    return old;
  end if;

  select nombre into v_prop from hv.propiedades where id = new.propiedad_id;

  if tg_op = 'INSERT' then
    insert into hv.claves_historial(caja_id, propiedad_id, propiedad_nombre, caja_nombre, usuario_id, accion, valor_nuevo, motivo)
    values (new.id, new.propiedad_id, v_prop, new.nombre, v_uid, 'caja_creada', new.clave, v_motivo);
    if new.foto is not null then
      insert into hv.claves_historial(caja_id, propiedad_id, propiedad_nombre, caja_nombre, usuario_id, accion, valor_nuevo)
      values (new.id, new.propiedad_id, v_prop, new.nombre, v_uid, 'foto_agregada', new.foto);
    end if;
    return new;
  end if;

  if new.clave is distinct from old.clave then
    insert into hv.claves_historial(caja_id, propiedad_id, propiedad_nombre, caja_nombre, usuario_id, accion, valor_anterior, valor_nuevo, motivo)
    values (new.id, new.propiedad_id, v_prop, new.nombre, v_uid, 'clave_cambiada', old.clave, new.clave, v_motivo);
  end if;
  if new.nombre is distinct from old.nombre or new.ubicacion is distinct from old.ubicacion then
    insert into hv.claves_historial(caja_id, propiedad_id, propiedad_nombre, caja_nombre, usuario_id, accion, valor_anterior, valor_nuevo)
    values (new.id, new.propiedad_id, v_prop, new.nombre, v_uid, 'caja_editada',
            old.nombre || coalesce(' · ' || old.ubicacion, ''), new.nombre || coalesce(' · ' || new.ubicacion, ''));
  end if;
  if new.foto is distinct from old.foto then
    insert into hv.claves_historial(caja_id, propiedad_id, propiedad_nombre, caja_nombre, usuario_id, accion, valor_anterior, valor_nuevo)
    values (new.id, new.propiedad_id, v_prop, new.nombre, v_uid,
            case when old.foto is null then 'foto_agregada' when new.foto is null then 'foto_quitada' else 'foto_cambiada' end,
            old.foto, new.foto);
  end if;
  if new.activa is distinct from old.activa then
    insert into hv.claves_historial(caja_id, propiedad_id, propiedad_nombre, caja_nombre, usuario_id, accion, motivo)
    values (new.id, new.propiedad_id, v_prop, new.nombre, v_uid,
            case when new.activa then 'caja_restaurada' else 'caja_archivada' end, v_motivo);
  end if;
  return new;
end $function$
;
CREATE OR REPLACE FUNCTION hv.tg_claves_notificar()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'hv', 'public'
AS $function$
declare v_actor text; v_msg text;
begin
  if new.accion not in ('clave_cambiada', 'caja_creada') then return new; end if;
  select nombre into v_actor from hv.perfiles where id = new.usuario_id;
  v_msg := case new.accion
             when 'clave_cambiada' then 'Se cambió la clave de ' || coalesce(new.caja_nombre, 'la caja')
             else 'Nueva caja de llaves: ' || coalesce(new.caja_nombre, '') end
           || coalesce(' (' || left(new.motivo, 100) || ')', '')
           || ' — ' || coalesce(v_actor, 'Sistema');
  insert into hv.notificaciones(usuario_id, reporte_id, numero_caso, propiedad_nombre, mensaje, tipo, caja_id)
  select p.id, null, 'Clave de caja', new.propiedad_nombre, v_msg, 'clave', new.caja_id
    from hv.perfiles p
   where p.activo
     and p.id is distinct from new.usuario_id
     and hv.permiso_de(p.id, 'campana_claves')
     and (hv.permiso_de(p.id, 'claves_cambiar') or hv.permiso_de(p.id, 'claves_administrar'));
  return new;
end $function$
;
CREATE OR REPLACE FUNCTION hv.tg_notificacion_push()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'hv', 'public'
AS $function$
declare v_secreto text;
begin
  if not exists (select 1 from hv.push_suscripciones where usuario_id = new.usuario_id) then
    return new;
  end if;
  select valor into v_secreto from hv.push_config where clave = 'secreto';
  perform net.http_post(
    url := 'https://qbfjauehzzwqtlumxudn.supabase.co/functions/v1/enviar-push',
    body := jsonb_build_object('notificacion_id', new.id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-secreto', v_secreto)
  );
  return new;
exception when others then
  return new;  -- un fallo del envío nunca debe impedir guardar la notificación
end $function$
;
CREATE OR REPLACE FUNCTION hv.tg_reporte_creado_bitacora()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'hv', 'public'
AS $function$
begin
  insert into hv.bitacora(reporte_id, usuario_id, accion, estado_nuevo)
  values (new.id, new.creado_por, 'creado', 'nuevo');
  return new;
end $function$
;
CREATE OR REPLACE FUNCTION hv.tg_reporte_nuevo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'hv', 'public'
AS $function$
declare v_rol text := hv.mi_rol();
begin
  if v_rol is null then
    raise exception 'Usuario sin acceso';
  end if;
  if not hv.tengo('crear_reportes') then
    raise exception 'Su usuario no tiene autorización para crear reportes';
  end if;
  if new.departamento is null or not hv.tengo('dest:' || new.departamento) then
    raise exception 'Su usuario no puede dirigir reportes a %', coalesce(hv.destino_txt(new.departamento), 'ese destino');
  end if;
  if coalesce(cardinality(new.asignados), 0) = 0 and new.asignado_a is not null then
    new.asignados := array[new.asignado_a];
  end if;
  new.asignados  := hv._completar_asignados(new.departamento, new.asignados);
  new.asignado_a := null;
  perform hv._validar_destino(new.departamento, new.asignados);
  new.creado_en      := now();
  new.creado_por     := auth.uid();
  new.estado         := 'nuevo';
  new.abierto_por    := null;  new.abierto_en := null;
  new.cerrado_por    := null;  new.cerrado_en := null;
  new.actualizado_en := now();
  new.numero_caso    := 'AL-' || to_char(now() at time zone 'America/Costa_Rica', 'YYYY')
                        || '-' || lpad(new.id::text, 5, '0');
  select nombre into new.propiedad_nombre
    from hv.propiedades where id = new.propiedad_id and activa;
  if new.propiedad_nombre is null then
    raise exception 'Seleccione una propiedad válida';
  end if;
  if coalesce(trim(new.descripcion), '') = '' then
    raise exception 'Escriba el detalle del reporte';
  end if;
  return new;
end $function$
;