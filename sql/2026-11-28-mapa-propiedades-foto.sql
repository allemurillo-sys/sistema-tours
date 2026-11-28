-- =====================================================================
-- Foto de la casa en Reservas › Mapa de propiedades
--  · Una foto por propiedad (ruta en propiedades_ubicacion.foto).
--  · El navegador la estandariza antes de subirla: máx. 1600 px por lado,
--    JPG de ≈300–450 KB. El depósito acepta como máximo 3 MB (JPG/WebP).
--  · Depósito privado: solo Administrador y permiso «mapa_propiedades».
-- =====================================================================
alter table public.propiedades_ubicacion add column if not exists foto text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('propiedades-fotos', 'propiedades-fotos', false, 3145728, array['image/jpeg','image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "propiedades-fotos mapa" on storage.objects;
create policy "propiedades-fotos mapa" on storage.objects for all
  using (bucket_id = 'propiedades-fotos' and (public.es_admin() or public.tiene_permiso('mapa_propiedades')))
  with check (bucket_id = 'propiedades-fotos' and (public.es_admin() or public.tiene_permiso('mapa_propiedades')));
