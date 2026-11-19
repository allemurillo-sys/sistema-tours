-- =====================================================
-- Desglose del IVA en los precios netos (18 nov 2026)
-- Cada fila de personas guarda el % de IVA que trae su neto (13 = incluido, 0 = sin IVA, vacío = no se sabe).
-- La solicitud al proveedor muestra: neto sin IVA + IVA = neto por persona, y los totales.
-- =====================================================

alter table actividad_participantes add column if not exists iva_pct numeric;

-- tarifas_actividades: cada opción dice si su neto trae IVA
do $$
declare d text; n text;
begin
  d := pg_get_functiondef('public.tarifas_actividades(jsonb)'::regprocedure);
  n := replace(d, $x$'categoria_id', x.categoria_id, 'opcion', x.opcion,$x$,
                  $x$'categoria_id', x.categoria_id, 'opcion', x.opcion, 'iva_pct', case when coalesce(x.iva, 1) <> 0 then v_iva else 0 end,$x$);
  if n = d then raise exception 'tarifas_actividades: no se encontró el texto a cambiar'; end if;
  execute n;
end $$;

-- Solicitud al proveedor: desglose por fila y en el total
create or replace function public.solicitud_contenido(p_actividad bigint)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with filas as (
    select k.orden, ap.opcion, k.nombre || case when ap.opcion <> '' then ' · ' || ap.opcion else '' end as categoria,
           ap.cantidad, coalesce(ap.neto_unitario, 0) as neto, nullif(ap.iva_pct, 0) as pct,
           round(ap.cantidad * coalesce(ap.neto_unitario, 0), 2) as subtotal
      from actividad_participantes ap join categorias_cliente k on k.id = ap.categoria_id
     where ap.actividad_id = p_actividad and ap.cantidad > 0
  ), filas2 as (
    select f.*, case when pct is not null then round(neto / (1 + pct / 100), 2) end as neto_sin_iva,
                case when pct is not null then round(subtotal / (1 + pct / 100), 2) end as subtotal_sin_iva
      from filas f
  )
  select jsonb_build_object(
    'cotizacion', c.numero,
    'codigo_reserva', case when a.codigo_reserva is not null then c.numero || '-' || a.codigo_reserva end,
    'titular', trim(c.nombre || ' ' || c.apellido),
    'servicio', s.nombre,
    'operador', o.nombre,
    'fecha', a.fecha,
    'hora_inicio', a.hora_inicio,
    'hora_fin', a.hora_fin,
    'transporte', (a.transporte_modo = 'incluido' or (a.transporte_modo = 'opcional' and a.transporte_respuesta is true)),
    'recogida', a.lugar_recogida,
    'hora_recogida', a.hora_recogida,
    'dejada', a.lugar_dejada,
    'participantes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'categoria', f.categoria, 'cantidad', f.cantidad, 'neto', f.neto, 'subtotal', f.subtotal,
               'iva_pct', f.pct, 'neto_sin_iva', f.neto_sin_iva, 'iva', case when f.pct is not null then f.neto - f.neto_sin_iva end,
               'subtotal_sin_iva', f.subtotal_sin_iva, 'subtotal_iva', case when f.pct is not null then f.subtotal - f.subtotal_sin_iva end)
             order by f.orden, f.opcion)
        from filas2 f), '[]'::jsonb),
    'transporte_neto', case when a.transporte_modo = 'incluido' or (a.transporte_modo = 'opcional' and a.transporte_respuesta is true)
                            then coalesce(a.transporte_neto, 0) else 0 end,
    'total', round(coalesce((select sum(subtotal) from filas), 0)
                   + case when a.transporte_modo = 'incluido' or (a.transporte_modo = 'opcional' and a.transporte_respuesta is true)
                          then coalesce(a.transporte_neto, 0) else 0 end, 2),
    -- IVA incluido en el total (solo de las filas con IVA) y el % (si todas usan el mismo)
    'total_iva', (select case when count(pct) > 0 then sum(subtotal - subtotal_sin_iva) filter (where pct is not null) end from filas2),
    'iva_pct', (select case when count(distinct pct) = 1 then max(pct) end from filas2),
    'notas', a.notas_proveedor
  )
  from actividades a
  join cotizaciones c on c.id = a.cotizacion_id
  left join servicios s on s.id = a.servicio_id
  left join operadores o on o.id = a.operador_id
  where a.id = p_actividad;
$function$;

-- Filas ya guardadas: se marca el IVA cuando su neto coincide con la tarifa del Tarifario
-- (con IVA → 13; sin IVA → 0). Las cotizaciones canceladas o finalizadas no se tocan.
with cand as (
  select distinct on (ap.id) ap.id,
         case when coalesce(t.iva, 1) <> 0
                   and abs(round(nu.neto_usd * (1 + aj.iva / 100), 2) - ap.neto_unitario) < 0.02 then aj.iva
              when abs(round(nu.neto_usd, 2) - ap.neto_unitario) < 0.02 then 0 end as pct
    from actividad_participantes ap
    join actividades a on a.id = ap.actividad_id
    join cotizaciones c on c.id = a.cotizacion_id and c.estado not in ('cancelado', 'finalizado')
    join tar_fichas f on f.servicio_id = a.servicio_id
    join tar_tarifas t on t.operador_id = f.operador_id and tar_norm(t.servicio) = f.clave and t.aprobada
                      and a.fecha between t.fecha_inicio and t.fecha_fin
    join tar_categorias m on m.clave = tar_norm(t.categoria) and m.categoria_id = ap.categoria_id
    cross join (select coalesce((select valor from tar_ajustes where clave = 'iva'), 13) as iva,
                       coalesce((select valor from tar_ajustes where clave = 'tipo_cambio'), 0) as tc) aj
    cross join lateral (select case when t.moneda = 'CRC' then case when aj.tc > 0 then t.neto / aj.tc end else t.neto end as neto_usd) nu
   where ap.iva_pct is null and ap.neto_unitario > 0
     and (ap.opcion = '' or tar_norm(t.categoria) = tar_norm(ap.opcion))
   order by ap.id, (t.fecha_fin - t.fecha_inicio), t.id desc
)
update actividad_participantes ap set iva_pct = cand.pct from cand where cand.id = ap.id and cand.pct is not null;

-- Solicitudes sin enviar: toman el desglose ya
update solicitudes_proveedor set contenido = solicitud_contenido(actividad_id) where estado = 'borrador' and actividad_id is not null;
