-- =====================================================
-- Reservas ↔ Tarifario final: conexión fluida (18 nov 2026)
-- 1. Cada fila de personas puede llevar la OPCIÓN del Tarifario (Sencillo, Doble, 1 - 6 Pax…).
-- 2. tarifas_actividades devuelve un precio por opción, con su rango de personas,
--    y cuando dos temporadas se cruzan gana la más corta (temporada alta).
-- 3. precios_cliente (formulario): misma regla de temporada; si hay varias opciones, la más barata ("desde").
-- 4. ver_cotizacion y solicitud_contenido muestran la opción.
-- =====================================================

alter table actividad_participantes add column if not exists opcion text not null default '';
alter table actividad_participantes drop constraint if exists actividad_participantes_actividad_id_categoria_id_key;
alter table actividad_participantes
  add constraint actividad_participantes_actividad_categoria_opcion_key unique (actividad_id, categoria_id, opcion);

create or replace function public.tarifas_actividades(p_items jsonb)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  it jsonb; v_serv bigint; v_fecha date; v_op bigint; v_clave text; v_grupo text;
  v_tc numeric := coalesce((select valor from tar_ajustes where clave = 'tipo_cambio'), 0);
  v_iva numeric := coalesce((select valor from tar_ajustes where clave = 'iva'), 13);
  v_precios jsonb; v_alt jsonb; v_res jsonb := '[]'::jsonb;
begin
  if not es_colaborador() then raise exception 'No autorizado.'; end if;
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_serv := (it->>'servicio_id')::bigint;
    v_fecha := (it->>'fecha')::date;
    v_op := null; v_clave := null; v_grupo := null;
    select f.operador_id, f.clave, tar_norm(coalesce(nullif(f.comparar, ''), f.servicio))
      into v_op, v_clave, v_grupo
      from tar_fichas f where f.servicio_id = v_serv limit 1;

    v_precios := '[]'::jsonb; v_alt := '[]'::jsonb;
    if v_op is not null and v_fecha is not null then
      select coalesce(jsonb_agg(jsonb_build_object(
               'categoria_id', x.categoria_id, 'opcion', x.opcion, 'min', x.pmin, 'max', x.pmax,
               'temporada', x.temporada, 'colones', x.moneda = 'CRC',
               'tc', case when x.tc > 0 then (case when x.moneda = 'CRC' then case when v_tc > 0 then round(x.tc / v_tc, 2) end else x.tc end) end,
               'cash', case when x.cash > 0 then (case when x.moneda = 'CRC' then case when v_tc > 0 then round(x.cash / v_tc, 2) end else x.cash end) end,
               'neto', round((case when x.moneda = 'CRC' then case when v_tc > 0 then x.neto / v_tc end else x.neto end)
                             * (case when coalesce(x.iva, 1) <> 0 then 1 + v_iva / 100 else 1 end), 2)
             ) order by x.orden, x.pmin nulls last, x.tc, x.opcion), '[]'::jsonb)
        into v_precios
        from (
          select k.id as categoria_id, k.orden, t.categoria as opcion, t.temporada, t.moneda, t.tc, t.cash, t.neto, t.iva,
                 (regexp_match(t.categoria, '(\d+)\s*-\s*(\d+)'))[1]::int as pmin,
                 (regexp_match(t.categoria, '(\d+)\s*-\s*(\d+)'))[2]::int as pmax,
                 row_number() over (partition by k.id, tar_norm(t.categoria)
                                    order by (t.fecha_fin - t.fecha_inicio), t.id desc) as rn
            from tar_tarifas t
            join tar_categorias m on m.clave = tar_norm(t.categoria)
            join categorias_cliente k on k.id = m.categoria_id
           where t.operador_id = v_op and tar_norm(t.servicio) = v_clave and t.aprobada
             and v_fecha between t.fecha_inicio and t.fecha_fin
        ) x where x.rn = 1;

      select coalesce(jsonb_agg(jsonb_build_object('servicio_id', s.id, 'nombre', s.nombre, 'operador', o.nombre, 'visible', s.activo)
               order by s.activo desc, o.nombre), '[]'::jsonb)
        into v_alt
        from tar_fichas f
        join servicios s on s.id = f.servicio_id
        join tar_operadores o on o.id = f.operador_id
       where tar_norm(coalesce(nullif(f.comparar, ''), f.servicio)) = v_grupo and f.servicio_id <> v_serv;
    end if;

    v_res := v_res || jsonb_build_array(jsonb_build_object(
      'servicio_id', v_serv, 'fecha', v_fecha, 'tarifario', v_op is not null, 'precios', v_precios, 'alternativas', v_alt));
  end loop;
  return v_res;
end $function$;

create or replace function public.precios_cliente(p_servicio bigint, p_fecha date)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with ficha as (
    select f.operador_id, f.clave
      from tar_fichas f join servicios s on s.id = f.servicio_id
     where f.servicio_id = p_servicio and (s.activo or es_colaborador())
     limit 1
  ), cambio as (
    select coalesce((select valor from tar_ajustes where clave = 'tipo_cambio'), 0) as tc
  ), temp as (
    -- por opción, la temporada más corta que cubre la fecha (temporada alta sobre la regular)
    select k.id as categoria_id, k.nombre, k.traducciones, k.por_grupo, k.orden, t.moneda, t.tc,
           row_number() over (partition by k.id, tar_norm(t.categoria) order by (t.fecha_fin - t.fecha_inicio), t.id desc) as rt
      from tar_tarifas t
      join ficha on t.operador_id = ficha.operador_id and tar_norm(t.servicio) = ficha.clave
      join tar_categorias m on m.clave = tar_norm(t.categoria)
      join categorias_cliente k on k.id = m.categoria_id
     where t.aprobada and t.tc > 0 and p_fecha between t.fecha_inicio and t.fecha_fin
  ), cand as (
    -- varias opciones en un mismo tipo de cliente: se muestra la más barata
    select temp.*, row_number() over (partition by categoria_id
             order by case when moneda = 'CRC' then tc / nullif((select tc from cambio), 0) else tc end) as rn
      from temp where rt = 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'categoria_id', c.categoria_id, 'categoria', c.nombre, 'traducciones', c.traducciones,
           'por_grupo', c.por_grupo,
           'precio', case when c.moneda = 'CRC' then round(c.tc / cambio.tc, 2) else c.tc end,
           'colones', c.moneda = 'CRC',
           'precio_colones', case when c.moneda = 'CRC' then c.tc end
         ) order by c.orden, c.nombre), '[]'::jsonb)
    from cand c, cambio
   where c.rn = 1 and (c.moneda = 'USD' or cambio.tc > 0);
$function$;

-- La opción se agrega a lo que ve el cliente y a la solicitud al proveedor
do $$
declare d text; n text;
begin
  d := pg_get_functiondef('public.ver_cotizacion(text, uuid)'::regprocedure);
  n := replace(d, $x$'cantidad', ap.cantidad, 'precio', ap.precio_unitario$x$,
                  $x$'cantidad', ap.cantidad, 'precio', ap.precio_unitario, 'opcion', ap.opcion$x$);
  if n = d then raise exception 'ver_cotizacion: no se encontró el texto a cambiar'; end if;
  execute n;

  d := pg_get_functiondef('public.solicitud_contenido(bigint)'::regprocedure);
  n := replace(d, $x$'categoria', k.nombre, 'cantidad', ap.cantidad$x$,
                  $x$'categoria', k.nombre || case when ap.opcion <> '' then ' · ' || ap.opcion else '' end, 'cantidad', ap.cantidad$x$);
  if n = d then raise exception 'solicitud_contenido: no se encontró el texto a cambiar'; end if;
  execute n;
end $$;
