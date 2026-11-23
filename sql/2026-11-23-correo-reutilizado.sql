-- Aplicada en Supabase como migración reasignar_correo_usuario_inactivo (23 nov 2026)
alter table public.perfiles
  add column if not exists correo_reasignado_a uuid references public.perfiles(id) on delete set null,
  add column if not exists correo_reasignado_en timestamptz;

create or replace function public.t_perfil_correo_cedido()
returns trigger language plpgsql as $$
begin
  if new.activo and new.correo_reasignado_a is not null then
    raise exception 'Este usuario cedió su correo a otra persona y no se puede reactivar. Crea un usuario nuevo con otro correo.';
  end if;
  if old.correo_reasignado_a is not null and new.correo_reasignado_a is distinct from old.correo_reasignado_a
     and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'La reasignación del correo no se puede modificar.';
  end if;
  return new;
end $$;

drop trigger if exists perfil_correo_cedido on public.perfiles;
create trigger perfil_correo_cedido before update on public.perfiles
  for each row execute function public.t_perfil_correo_cedido();
