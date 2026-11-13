-- =====================================================================
-- Comisiones por ventas (Personal y planilla › Comisiones)
--  · Un reporte por mes. Las ventas vienen del Excel del sistema de ventas
--    o se agregan a mano. Todos los montos salen de una sola fórmula.
--  · Cash → se paga al vendedor en efectivo.
--    Cash facturado y TC → se pagan juntos por depósito.
--  · El IVA va incluido en el precio: IVA = total − total ÷ 1,13.
--  · Datáfono (solo TC): % sobre el monto cobrado.
--  · Vendedor: % de la ganancia (total sin impuestos − costo neto).
--  · Ventas "Not Paid" / "Cancelled" quedan POR REVISAR y no suman.
--  · Meses históricos (Excel 2026) conservan los montos ya calculados.
-- =====================================================================

insert into public.permisos_catalogo (clave, modulo, tipo, nombre, detalle, orden, solo_admin, bloqueado_hv, disponible) values
  ('comisiones', 'equipo', 'permiso', 'Comisiones: administrar', 'Importar ventas, revisar, cerrar el mes y registrar pagos. Ve la utilidad de la empresa.', 45, true, true, true),
  ('comisiones_propias', 'equipo', 'permiso', 'Comisiones: ver las propias', 'Cada vendedor ve sus ventas, sus comisiones y sus pagos, y confirma que los recibió.', 46, false, true, true)
on conflict (clave) do nothing;
insert into public.permisos_rol (rol, permiso, permitido) values ('operaciones', 'comisiones_propias', true)
on conflict do nothing;

create table if not exists public.com_ajustes (
  clave text primary key,
  valor jsonb not null
);
insert into public.com_ajustes values ('calculo', '{"iva": 13, "datafono": 2, "vendedor": 20}') on conflict do nothing;

create table if not exists public.com_meses (
  id bigint generated always as identity primary key,
  anio int not null,
  mes int not null check (mes between 1 and 12),
  estado text not null default 'abierto' check (estado in ('abierto', 'cerrado')),
  parametros jsonb not null,
  historico boolean not null default false,
  notas text,
  cerrado_por uuid references auth.users(id),
  cerrado_en timestamptz,
  creado_en timestamptz not null default now(),
  unique (anio, mes)
);

create table if not exists public.com_alias (
  texto text primary key,              -- nombre como viene en el Excel, normalizado
  persona_id bigint not null references public.staff_personas(id) on delete cascade
);

create table if not exists public.com_ventas (
  id bigint generated always as identity primary key,
  mes_id bigint not null references public.com_meses(id) on delete cascade,
  fecha date,
  proveedor text,
  actividad text,
  cliente text,
  vendedor_texto text,
  persona_id bigint references public.staff_personas(id),
  orden text,
  tipo text check (tipo in ('cash', 'cash_facturado', 'tc')),
  estado text not null default 'valida' check (estado in ('valida', 'revisar', 'no_pagar')),
  estado_original text,                -- lo que decía el Excel: Not Paid, Cancelled…
  pax numeric not null default 1,
  rack numeric not null default 0,     -- precio de venta por persona
  neto numeric not null default 0,     -- costo por persona
  com_vendedor_fijo numeric,           -- solo meses históricos
  com_empresa_fijo numeric,
  nota text,
  creado_por uuid references auth.users(id),
  creado_en timestamptz not null default now(),
  check (estado <> 'valida' or tipo is not null)
);
create index if not exists com_ventas_mes on public.com_ventas (mes_id);
create index if not exists com_ventas_persona on public.com_ventas (persona_id);

create table if not exists public.com_pagos (
  id bigint generated always as identity primary key,
  mes_id bigint not null references public.com_meses(id) on delete cascade,
  persona_id bigint not null references public.staff_personas(id),
  forma text not null check (forma in ('efectivo', 'deposito')),
  monto numeric not null,
  fecha date not null default current_date,
  banco text,
  referencia text,
  archivo text,
  nombre_archivo text,
  nota text,
  registrado_por uuid references auth.users(id) default auth.uid(),
  registrado_en timestamptz not null default now(),
  confirmado_en timestamptz,
  confirmado_por uuid references auth.users(id),
  unique (mes_id, persona_id, forma)
);

-- ---------- Cálculo (una sola fórmula para todo el sistema) ----------
create or replace view public.com_ventas_calc with (security_invoker = true) as
select v.*,
  c.total_rack, c.total_neto, c.iva, c.datafono, c.sin_iva, c.ganancia,
  case when v.estado <> 'valida' then 0 else coalesce(v.com_vendedor_fijo, round(c.ganancia * p.vendedor / 100, 2)) end as com_vendedor,
  case when v.estado <> 'valida' then 0 else coalesce(v.com_empresa_fijo, c.ganancia - round(c.ganancia * p.vendedor / 100, 2)) end as com_empresa,
  case when v.tipo = 'cash' then 'efectivo' when v.tipo in ('cash_facturado', 'tc') then 'deposito' end as forma
from public.com_ventas v
join public.com_meses m on m.id = v.mes_id
cross join lateral (select
  coalesce((m.parametros->>'iva')::numeric, 13) as iva,
  coalesce((m.parametros->>'datafono')::numeric, 2) as datafono,
  coalesce((m.parametros->>'vendedor')::numeric, 20) as vendedor) p
cross join lateral (select round(v.rack * v.pax, 2) as tr) t
cross join lateral (select
  t.tr as total_rack,
  round(v.neto * v.pax, 2) as total_neto,
  case when v.tipo in ('cash_facturado', 'tc') then round(t.tr - t.tr / (1 + p.iva / 100), 2) else 0 end as iva,
  case when v.tipo = 'tc' then round(t.tr * p.datafono / 100, 2) else 0 end as datafono) b
cross join lateral (select b.total_rack, b.total_neto, b.iva, b.datafono,
  b.total_rack - b.iva - b.datafono as sin_iva,
  b.total_rack - b.iva - b.datafono - b.total_neto as ganancia) c;

-- ---------- Seguridad ----------
alter table public.com_ajustes enable row level security;
alter table public.com_meses enable row level security;
alter table public.com_alias enable row level security;
alter table public.com_ventas enable row level security;
alter table public.com_pagos enable row level security;

create policy com_ajustes_admin on public.com_ajustes for all to authenticated using (tiene_permiso('comisiones')) with check (tiene_permiso('comisiones'));
create policy com_meses_admin on public.com_meses for all to authenticated using (tiene_permiso('comisiones')) with check (tiene_permiso('comisiones'));
create policy com_alias_admin on public.com_alias for all to authenticated using (tiene_permiso('comisiones')) with check (tiene_permiso('comisiones'));
create policy com_ventas_admin on public.com_ventas for all to authenticated using (tiene_permiso('comisiones')) with check (tiene_permiso('comisiones'));
create policy com_pagos_admin on public.com_pagos for all to authenticated using (tiene_permiso('comisiones')) with check (tiene_permiso('comisiones'));
revoke all on public.com_ajustes, public.com_meses, public.com_alias, public.com_ventas, public.com_pagos, public.com_ventas_calc from anon;
grant select, insert, update, delete on public.com_ajustes, public.com_meses, public.com_alias, public.com_ventas, public.com_pagos to authenticated;
grant select on public.com_ventas_calc to authenticated;

-- Fichas del usuario que entra (para "mis comisiones")
create or replace function public.com_mis_personas() returns setof bigint
language sql stable security definer set search_path = public as $$
  select id from staff_personas where perfil_id = auth.uid();
$$;

-- Datos del vendedor: sin costos ni utilidad de la empresa
create or replace function public.com_mis_datos() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not tiene_permiso('comisiones_propias') and not tiene_permiso('comisiones') then
    return jsonb_build_object('meses', '[]'::jsonb, 'ventas', '[]'::jsonb, 'pagos', '[]'::jsonb);
  end if;
  select jsonb_build_object(
    'meses', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'anio', m.anio, 'mes', m.mes, 'estado', m.estado, 'historico', m.historico) order by m.anio desc, m.mes desc)
      from com_meses m where exists (select 1 from com_ventas v where v.mes_id = m.id and v.persona_id in (select com_mis_personas()))), '[]'::jsonb),
    'ventas', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'mes_id', v.mes_id, 'fecha', v.fecha, 'actividad', v.actividad, 'proveedor', v.proveedor,
        'cliente', v.cliente, 'orden', v.orden, 'tipo', v.tipo, 'estado', v.estado, 'pax', v.pax, 'total_rack', v.total_rack,
        'com_vendedor', v.com_vendedor, 'forma', v.forma) order by v.fecha, v.id)
      from com_ventas_calc v where v.persona_id in (select com_mis_personas())), '[]'::jsonb),
    'pagos', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'mes_id', p.mes_id, 'forma', p.forma, 'monto', p.monto, 'fecha', p.fecha,
        'banco', p.banco, 'referencia', p.referencia, 'archivo', p.archivo, 'nombre_archivo', p.nombre_archivo, 'confirmado_en', p.confirmado_en))
      from com_pagos p where p.persona_id in (select com_mis_personas())), '[]'::jsonb)
  ) into r;
  return r;
end $$;

-- El vendedor confirma que recibió un pago
create or replace function public.com_confirmar_pago(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  update com_pagos set confirmado_en = now(), confirmado_por = auth.uid()
   where id = p_id and confirmado_en is null and persona_id in (select com_mis_personas());
  if not found then raise exception 'No se pudo confirmar este pago.'; end if;
end $$;
revoke all on function public.com_mis_datos(), public.com_confirmar_pago(bigint), public.com_mis_personas() from public, anon;
grant execute on function public.com_mis_datos(), public.com_confirmar_pago(bigint) to authenticated;

-- Comprobantes de depósito: carpeta <mes>/<persona>/archivo
insert into storage.buckets (id, name, public) values ('comisiones-comprobantes', 'comisiones-comprobantes', false)
on conflict (id) do nothing;
create policy com_comprob_admin on storage.objects for all to authenticated
  using (bucket_id = 'comisiones-comprobantes' and public.tiene_permiso('comisiones'))
  with check (bucket_id = 'comisiones-comprobantes' and public.tiene_permiso('comisiones'));
create policy com_comprob_propio on storage.objects for select to authenticated
  using (bucket_id = 'comisiones-comprobantes'
         and (storage.foldername(name))[2] in (select id::text from public.staff_personas where perfil_id = auth.uid()));

-- ---------- Cambio: solo administradores (13-nov-2026) ----------
drop policy if exists com_comprob_propio on storage.objects;
drop function if exists public.com_confirmar_pago(bigint);
drop function if exists public.com_mis_datos();
drop function if exists public.com_mis_personas();
delete from public.permisos_usuario where permiso = 'comisiones_propias';
delete from public.permisos_rol where permiso = 'comisiones_propias';
delete from public.permisos_catalogo where clave = 'comisiones_propias';
update public.permisos_catalogo set nombre = 'Comisiones por ventas', detalle = 'Reporte mensual de ventas y comisiones, pagos a vendedores y utilidad de la empresa. Solo administradores.' where clave = 'comisiones';
alter table public.com_pagos drop column if exists confirmado_en, drop column if exists confirmado_por;
