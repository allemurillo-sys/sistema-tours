-- Ama de llaves · Reporte de Limpieza
-- Orden manual de las propiedades: SOLO el Administrador puede cambiarlo.
--   · hv.propiedades_ordenar(ids): guarda el orden completo de una vez (10, 20, 30…).
--   · Guardia: nadie que no sea administrador puede cambiar la columna "orden"
--     (aunque tenga permiso de editar propiedades). Las propiedades nuevas
--     sin orden se agregan al final de la lista.
-- Fecha: 2026-11-23 · proyecto cotizador-tours (esquema hv)

create or replace function hv.propiedades_ordenar(p_ids bigint[])
returns void
language plpgsql
security definer
set search_path to 'hv', 'public'
as $$
begin
  if hv.mi_rol() is distinct from 'admin' then
    raise exception 'Solo un administrador puede ordenar las propiedades';
  end if;
  update hv.propiedades p
     set orden = (x.pos * 10)::int
    from unnest(p_ids) with ordinality as x(id, pos)
   where p.id = x.id
     and p.orden is distinct from (x.pos * 10)::int;
end $$;

revoke all on function hv.propiedades_ordenar(bigint[]) from public, anon;
grant execute on function hv.propiedades_ordenar(bigint[]) to authenticated;

create or replace function hv.propiedades_orden_guardia()
returns trigger
language plpgsql
security definer
set search_path to 'hv', 'public'
as $$
begin
  -- auth.uid() nulo = cambios hechos desde Supabase (SQL), se permiten
  if tg_op = 'UPDATE' and new.orden is distinct from old.orden
     and auth.uid() is not null and hv.mi_rol() is distinct from 'admin' then
    raise exception 'Solo un administrador puede cambiar el orden de las propiedades';
  end if;
  if tg_op = 'INSERT' and (new.orden is null or (auth.uid() is not null and hv.mi_rol() is distinct from 'admin')) then
    new.orden := (select coalesce(max(orden), 0) + 10 from hv.propiedades);
  end if;
  return new;
end $$;

drop trigger if exists propiedades_orden_guardia on hv.propiedades;
create trigger propiedades_orden_guardia
  before insert or update on hv.propiedades
  for each row execute function hv.propiedades_orden_guardia();
