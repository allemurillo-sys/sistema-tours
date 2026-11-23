-- =====================================================
-- Opciones de "Origen" de las reservas manuales (23 nov 2026)
-- Antes estaban fijas en el código y en una regla (check) de cotizaciones.
-- Ahora viven en la tabla origenes_reserva y el administrador las crea,
-- modifica, ordena, desactiva o elimina desde la reserva manual.
-- "Formulario web" es fija (la usa el formulario del cliente) y no se edita.
-- Una opción ya usada en reservas no se puede borrar (la protege la llave
-- foránea): se desactiva y deja de aparecer en reservas nuevas.
-- =====================================================

create table if not exists public.origenes_reserva (
  clave text primary key check (clave ~ '^[a-z0-9_]{1,40}$'),
  nombre text not null check (length(btrim(nombre)) between 1 and 60),
  corto text check (corto is null or length(btrim(corto)) between 1 and 20),
  orden integer not null default 100,
  activo boolean not null default true,
  fijo boolean not null default false,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz,
  actualizado_por uuid references public.perfiles(id) on delete set null
);

create unique index if not exists origenes_reserva_nombre_unico
  on public.origenes_reserva (lower(btrim(nombre)));

insert into public.origenes_reserva (clave, nombre, corto, orden, fijo) values
  ('web',      'Formulario web',        'Web',      0, true),
  ('oficina',  'Oficina (en persona)',  'Oficina',  1, false),
  ('telefono', 'Llamada telefónica',    'Teléfono', 2, false),
  ('whatsapp', 'WhatsApp',              'WhatsApp', 3, false),
  ('correo',   'Correo electrónico',    'Correo',   4, false),
  ('otro',     'Otro',                  'Manual',   5, false)
on conflict (clave) do nothing;

-- Quién y cuándo modificó (la clave no cambia nunca: las reservas la guardan)
create or replace function public.origenes_reserva_tocar()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.clave <> old.clave then
    raise exception 'La clave de un origen no se puede cambiar';
  end if;
  new.actualizado_en := now();
  new.actualizado_por := auth.uid();
  return new;
end $$;

drop trigger if exists origenes_reserva_tocar on public.origenes_reserva;
create trigger origenes_reserva_tocar before insert or update on public.origenes_reserva
  for each row execute function public.origenes_reserva_tocar();

-- La regla fija se reemplaza por la llave foránea a la tabla
alter table public.cotizaciones drop constraint if exists cotizaciones_origen_check;
alter table public.cotizaciones drop constraint if exists cotizaciones_origen_fk;
alter table public.cotizaciones add constraint cotizaciones_origen_fk
  foreign key (origen) references public.origenes_reserva (clave);

-- Permisos: todos los usuarios del panel la leen; solo el administrador la cambia
alter table public.origenes_reserva enable row level security;

drop policy if exists "origenes leer" on public.origenes_reserva;
create policy "origenes leer" on public.origenes_reserva
  for select to authenticated using (true);

drop policy if exists "origenes crear" on public.origenes_reserva;
create policy "origenes crear" on public.origenes_reserva
  for insert to authenticated with check (public.es_admin() and not fijo);

drop policy if exists "origenes editar" on public.origenes_reserva;
create policy "origenes editar" on public.origenes_reserva
  for update to authenticated using (public.es_admin() and not fijo) with check (public.es_admin() and not fijo);

drop policy if exists "origenes eliminar" on public.origenes_reserva;
create policy "origenes eliminar" on public.origenes_reserva
  for delete to authenticated using (public.es_admin() and not fijo);

revoke all on public.origenes_reserva from anon;
grant select, insert, update, delete on public.origenes_reserva to authenticated;
