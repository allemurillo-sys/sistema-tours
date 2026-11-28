-- =====================================================================
-- Mapa de propiedades (Reservas › Mapa de propiedades)
--  · Cada propiedad de Reservas puede tener su enlace de Google Maps y el
--    punto en el mapa (latitud/longitud).
--  · Se guarda en una tabla aparte para que la ubicación NO quede visible
--    en el formulario público de clientes.
--  · Solo lo ven y lo editan el Administrador y quien tenga el permiso
--    «Mapa de propiedades» (por defecto: Operaciones).
-- =====================================================================

insert into public.permisos_catalogo (clave, modulo, tipo, nombre, detalle, orden, solo_admin, bloqueado_hv, disponible) values
  ('mapa_propiedades', 'tours', 'permiso', 'Mapa de propiedades', 'Ver el mapa de propiedades, copiar el enlace de ubicación y editarlo.', 35, false, true, true)
on conflict (clave) do nothing;
insert into public.permisos_rol (rol, permiso, permitido) values ('operaciones', 'mapa_propiedades', true)
on conflict do nothing;

create table if not exists public.propiedades_ubicacion (
  propiedad_id    bigint primary key references public.propiedades(id) on delete cascade,
  enlace          text not null default '',
  latitud         double precision check (latitud between -90 and 90),
  longitud        double precision check (longitud between -180 and 180),
  actualizado_por uuid references public.perfiles(id),
  actualizado_en  timestamptz not null default now()
);
alter table public.propiedades_ubicacion enable row level security;

drop policy if exists mapa on public.propiedades_ubicacion;
create policy mapa on public.propiedades_ubicacion for all
  using (es_admin() or tiene_permiso('mapa_propiedades'))
  with check (es_admin() or tiene_permiso('mapa_propiedades'));

-- Quién y cuándo cambió la ubicación (lo pone la base de datos, no el navegador)
create or replace function public.propiedades_ubicacion_marca()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.actualizado_por := auth.uid();
  new.actualizado_en  := now();
  return new;
end $$;
drop trigger if exists propiedades_ubicacion_marca on public.propiedades_ubicacion;
create trigger propiedades_ubicacion_marca
  before insert or update on public.propiedades_ubicacion
  for each row execute function public.propiedades_ubicacion_marca();
