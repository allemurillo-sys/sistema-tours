-- =====================================================================
-- ACCESOS UNIFICADOS (etapa 1 de la integración con Ama de Llaves)
--  · Catálogo de permisos por módulo (Tours, Ama de llaves, Equipo, Configuración)
--  · 5 roles: mucama, supervisora, ama_llaves, operaciones, administrador
--  · Excepciones por persona (permisos_usuario)
--  · Bloqueo fijo: el personal de Ama de llaves nunca ve clientes, precios, pagos ni salarios
--  · El acceso a reservas pasa a depender del permiso «reservas_ver»
-- =====================================================================

-- 1) Catálogo ----------------------------------------------------------
create table if not exists public.permisos_catalogo (
  clave       text primary key,
  modulo      text not null check (modulo in ('tours','ama_llaves','equipo','configuracion')),
  tipo        text not null default 'permiso' check (tipo in ('permiso','aviso','destino')),
  nombre      text not null,
  detalle     text,
  orden       int  not null default 0,
  solo_admin  boolean not null default false,  -- fijo: solo el administrador
  bloqueado_hv boolean not null default false, -- fijo: nunca para mucama, supervisora ni ama de llaves
  disponible  boolean not null default true    -- false = se activa al integrar Ama de llaves
);
alter table public.permisos_catalogo enable row level security;
drop policy if exists leer on public.permisos_catalogo;
create policy leer on public.permisos_catalogo for select using (auth.uid() is not null);
drop policy if exists admin on public.permisos_catalogo;
create policy admin on public.permisos_catalogo for all using (es_admin()) with check (es_admin());

insert into public.permisos_catalogo (clave, modulo, tipo, nombre, detalle, orden, solo_admin, bloqueado_hv, disponible) values
 -- Tours
 ('reservas_ver','tours','permiso','Ver y atender reservas','Cotizaciones, reservas, calendario y solicitudes a proveedores.',10,false,true,true),
 ('registrar_pagos','tours','permiso','Registrar pagos','Definir el prepago, registrar y eliminar pagos de las reservas.',20,false,true,true),
 ('editar_catalogo','tours','permiso','Hospedajes del formulario','Agregar, renombrar, ocultar y eliminar los hospedajes que ve el cliente en el formulario.',30,false,true,true),
 ('ver_tarifario','tours','permiso','Consultar el tarifario final','Ver, buscar, imprimir y descargar las tarifas aprobadas, sin editarlas.',40,false,true,true),
 ('ver_utilidad','tours','permiso','Ver netos y utilidad','Muestra el neto y la utilidad en cotizaciones, servicios y reportes.',50,false,true,true),
 ('cancelar_reservas','tours','permiso','Cancelar reservas confirmadas','Cancelar o reactivar reservas que el cliente ya confirmó.',60,false,true,true),
 ('reabrir_finalizadas','tours','permiso','Reabrir reservas finalizadas','Devolver una reserva finalizada a la columna Reserva.',70,false,true,true),
 ('ver_reportes','tours','permiso','Ventas y cuentas por pagar','Reportes de ventas por colaborador y cuentas por pagar a operadores.',80,false,true,true),
 ('tarifario_editar','tours','permiso','Procesar y aprobar tarifas','Importar, procesar, aprobar y revertir tarifas del Tarifario.',90,true,true,true),
 -- Equipo
 ('chat','equipo','permiso','Chat interno','Conversaciones y tareas internas (personal con acceso a reservas).',10,false,true,true),
 ('ver_perfiles_staff','equipo','permiso','Ver perfiles de colaboradores','Consultar las fichas del personal, sin editarlas ni ver salarios.',20,false,false,true),
 ('gestionar_horarios','equipo','permiso','Crear y editar todos los horarios','Armar, modificar y publicar horarios de cualquier departamento. La ama de llaves y la supervisora ya editan los de su departamento sin este permiso.',30,false,false,true),
 ('planilla','equipo','permiso','Planilla y salarios',null,40,true,true,true),
 ('vencimientos','equipo','permiso','Vencimientos','Permisos y documentos con fecha de vencimiento.',50,true,true,true),
 -- Configuración
 ('usuarios','configuracion','permiso','Usuarios y accesos',null,10,true,true,true),
 ('empresa_correo','configuracion','permiso','Datos de la empresa y correo',null,20,true,true,true),
 ('telegram','configuracion','permiso','Telegram',null,30,true,true,false),
 -- Ama de llaves: reportes
 ('crear_reportes','ama_llaves','permiso','Crear reportes',null,10,false,false,false),
 ('panel','ama_llaves','permiso','Panel de seguimiento','Sin este permiso la persona ve «Estado de mis casos».',20,false,false,false),
 ('ver_todos','ama_llaves','permiso','Ver todos los reportes',null,30,false,false,false),
 ('ver_mismo_rol','ama_llaves','permiso','Ver los reportes dirigidos a su mismo rol',null,40,false,false,false),
 ('ver_mucamas','ama_llaves','permiso','Ver los reportes de mucamas',null,50,false,false,false),
 ('ver_supervisoras','ama_llaves','permiso','Ver los reportes de supervisoras',null,60,false,false,false),
 ('responder_mucamas','ama_llaves','permiso','Responder casos de mucamas','Si la mucama no puede.',70,false,false,false),
 ('responder_supervisoras','ama_llaves','permiso','Responder casos de supervisoras','Si la supervisora no puede.',80,false,false,false),
 ('responder_todo','ama_llaves','permiso','Responder cualquier caso y reabrir',null,90,false,false,false),
 ('revisar_visto','ama_llaves','permiso','Revisar un caso sin responder («Visto»)',null,100,false,false,false),
 ('agregar_notas','ama_llaves','permiso','Agregar notas a los casos',null,110,false,false,false),
 ('buscar_casos','ama_llaves','permiso','Buscar casos resueltos',null,120,false,false,false),
 -- Ama de llaves: limpieza, claves y casas
 ('ocupacion_ver','ama_llaves','permiso','Limpieza: ver el reporte del día',null,200,false,false,false),
 ('ocupacion_editar','ama_llaves','permiso','Limpieza: crear y llenar el reporte','Estado, entrada, noches y pax.',210,false,false,false),
 ('ocupacion_limpieza','ama_llaves','permiso','Limpieza: marcar el estado de limpieza','Lista, sucia, pendiente o bloqueada.',220,false,false,false),
 ('claves_cambiar','ama_llaves','permiso','Claves de caja: ver y cambiar',null,230,false,false,false),
 ('claves_administrar','ama_llaves','permiso','Claves de caja: administrar','Agregar, editar y archivar cajas y fotos.',240,false,false,false),
 ('casas_editar','ama_llaves','permiso','Casas: crear y modificar',null,250,false,false,false),
 ('casas_eliminar','ama_llaves','permiso','Casas: eliminar',null,260,false,false,false),
 ('respaldo_excel','ama_llaves','permiso','Descargar respaldo en Excel',null,270,false,false,false),
 -- Ama de llaves: a quién puede dirigir un reporte
 ('dest:ama_llaves','ama_llaves','destino','Dirigir reportes a: Ama de llaves',null,300,false,false,false),
 ('dest:supervisora','ama_llaves','destino','Dirigir reportes a: Supervisora',null,310,false,false,false),
 ('dest:operaciones','ama_llaves','destino','Dirigir reportes a: Operaciones',null,320,false,false,false),
 ('dest:mucama','ama_llaves','destino','Dirigir reportes a: Mucama',null,330,false,false,false),
 ('dest:admin','ama_llaves','destino','Dirigir reportes a: Administración',null,340,false,false,false),
 -- Avisos
 ('alerta_obligatoria','ama_llaves','aviso','Alerta obligatoria de los reportes dirigidos a la persona','Se repite hasta que responda.',400,false,false,false),
 ('recordatorio_hora','ama_llaves','aviso','Recordatorio cada hora de los reportes dirigidos',null,410,false,false,false),
 ('aviso_todos','ama_llaves','aviso','Aviso de todos los reportes nuevos','Sin obligación de responder.',420,false,false,false),
 ('campana_mucamas','ama_llaves','aviso','Campana: casos de mucamas',null,430,false,false,false),
 ('campana_supervisoras','ama_llaves','aviso','Campana: casos de supervisoras',null,440,false,false,false),
 ('campana_claves','ama_llaves','aviso','Campana: cambio de una clave de caja',null,450,false,false,false),
 ('aviso_reporte_terminado','ama_llaves','aviso','Limpieza: reporte del día terminado',null,460,false,false,false),
 ('aviso_ingreso_lista','ama_llaves','aviso','Limpieza: casa que entra hoy quedó Lista',null,470,false,false,false),
 ('alerta_ingresos','ama_llaves','aviso','Limpieza: alertas 2:00, 2:30 y 3:00 p. m. de ingresos no listos',null,480,false,false,false)
on conflict (clave) do update set modulo = excluded.modulo, tipo = excluded.tipo, nombre = excluded.nombre,
  detalle = excluded.detalle, orden = excluded.orden, solo_admin = excluded.solo_admin, bloqueado_hv = excluded.bloqueado_hv;

-- 2) Roles nuevos -------------------------------------------------------
alter table public.perfiles drop constraint if exists perfiles_rol_check;
alter table public.permisos_rol drop constraint if exists permisos_rol_rol_check;
alter table public.permisos_rol drop constraint if exists permisos_rol_permiso_check;

update public.perfiles set rol = case rol
  when 'colaborador' then 'operaciones' when 'jefatura' then 'operaciones' when 'gerente' then 'operaciones'
  when 'personal' then coalesce((select case s.nivel_staff when 'ama_llaves' then 'ama_llaves' when 'supervisora' then 'supervisora'
                                   when 'recepcion' then 'operaciones' else 'mucama' end
                                 from public.staff_personas s where s.perfil_id = perfiles.id limit 1), 'mucama')
  else rol end
 where rol in ('colaborador','jefatura','gerente','personal');

alter table public.perfiles add constraint perfiles_rol_check
  check (rol in ('mucama','supervisora','ama_llaves','operaciones','administrador'));

delete from public.permisos_rol where rol in ('jefatura','gerente','personal');
update public.permisos_rol set rol = 'operaciones' where rol = 'colaborador';
alter table public.permisos_rol add constraint permisos_rol_rol_check
  check (rol in ('mucama','supervisora','ama_llaves','operaciones','administrador'));
alter table public.permisos_rol drop constraint if exists permisos_rol_permiso_fk;
alter table public.permisos_rol add constraint permisos_rol_permiso_fk
  foreign key (permiso) references public.permisos_catalogo(clave) on update cascade on delete cascade;

-- Plantilla de cada rol (no pisa lo que ya estaba marcado para Operaciones)
with v(rol, permiso, permitido) as (values
  -- Operaciones (antes Colaborador en THOT + Operaciones en Ama de Llaves)
  ('operaciones','reservas_ver',true),('operaciones','chat',true),
  ('operaciones','crear_reportes',true),('operaciones','panel',true),('operaciones','ver_todos',true),('operaciones','ver_mismo_rol',true),
  ('operaciones','ver_mucamas',true),('operaciones','ver_supervisoras',true),('operaciones','responder_mucamas',false),('operaciones','responder_supervisoras',false),
  ('operaciones','responder_todo',false),('operaciones','revisar_visto',true),('operaciones','agregar_notas',true),('operaciones','buscar_casos',true),
  ('operaciones','ocupacion_ver',true),('operaciones','ocupacion_editar',true),('operaciones','ocupacion_limpieza',false),
  ('operaciones','claves_cambiar',true),('operaciones','claves_administrar',true),('operaciones','casas_editar',false),('operaciones','casas_eliminar',false),
  ('operaciones','respaldo_excel',false),
  ('operaciones','dest:ama_llaves',true),('operaciones','dest:supervisora',true),('operaciones','dest:operaciones',true),('operaciones','dest:mucama',true),('operaciones','dest:admin',true),
  ('operaciones','alerta_obligatoria',true),('operaciones','recordatorio_hora',false),('operaciones','aviso_todos',false),('operaciones','campana_mucamas',false),
  ('operaciones','campana_supervisoras',false),('operaciones','campana_claves',true),('operaciones','aviso_reporte_terminado',false),
  ('operaciones','aviso_ingreso_lista',true),('operaciones','alerta_ingresos',true),
  -- Ama de llaves (jefatura)
  ('ama_llaves','crear_reportes',true),('ama_llaves','panel',true),('ama_llaves','ver_todos',false),('ama_llaves','ver_mismo_rol',true),
  ('ama_llaves','ver_mucamas',true),('ama_llaves','ver_supervisoras',true),('ama_llaves','responder_mucamas',true),('ama_llaves','responder_supervisoras',true),
  ('ama_llaves','responder_todo',false),('ama_llaves','revisar_visto',true),('ama_llaves','agregar_notas',true),('ama_llaves','buscar_casos',true),
  ('ama_llaves','ocupacion_ver',true),('ama_llaves','ocupacion_editar',false),('ama_llaves','ocupacion_limpieza',true),
  ('ama_llaves','claves_cambiar',true),('ama_llaves','claves_administrar',true),('ama_llaves','casas_editar',true),('ama_llaves','casas_eliminar',false),
  ('ama_llaves','respaldo_excel',false),
  ('ama_llaves','dest:ama_llaves',false),('ama_llaves','dest:supervisora',true),('ama_llaves','dest:operaciones',true),('ama_llaves','dest:mucama',true),('ama_llaves','dest:admin',true),
  ('ama_llaves','alerta_obligatoria',true),('ama_llaves','recordatorio_hora',false),('ama_llaves','aviso_todos',false),('ama_llaves','campana_mucamas',true),
  ('ama_llaves','campana_supervisoras',true),('ama_llaves','campana_claves',true),('ama_llaves','aviso_reporte_terminado',true),
  ('ama_llaves','aviso_ingreso_lista',false),('ama_llaves','alerta_ingresos',true),
  -- Supervisora
  ('supervisora','crear_reportes',true),('supervisora','panel',true),('supervisora','ver_todos',false),('supervisora','ver_mismo_rol',true),
  ('supervisora','ver_mucamas',true),('supervisora','ver_supervisoras',true),('supervisora','responder_mucamas',true),('supervisora','responder_supervisoras',false),
  ('supervisora','responder_todo',false),('supervisora','revisar_visto',true),('supervisora','agregar_notas',true),('supervisora','buscar_casos',true),
  ('supervisora','ocupacion_ver',true),('supervisora','ocupacion_editar',false),('supervisora','ocupacion_limpieza',true),
  ('supervisora','claves_cambiar',true),('supervisora','claves_administrar',false),('supervisora','casas_editar',false),('supervisora','casas_eliminar',false),
  ('supervisora','respaldo_excel',false),
  ('supervisora','dest:ama_llaves',true),('supervisora','dest:supervisora',false),('supervisora','dest:operaciones',true),('supervisora','dest:mucama',true),('supervisora','dest:admin',true),
  ('supervisora','alerta_obligatoria',true),('supervisora','recordatorio_hora',false),('supervisora','aviso_todos',false),('supervisora','campana_mucamas',true),
  ('supervisora','campana_supervisoras',false),('supervisora','campana_claves',true),('supervisora','aviso_reporte_terminado',true),
  ('supervisora','aviso_ingreso_lista',false),('supervisora','alerta_ingresos',true),
  -- Mucama
  ('mucama','crear_reportes',true),('mucama','panel',false),('mucama','ver_todos',false),('mucama','ver_mismo_rol',false),
  ('mucama','ver_mucamas',false),('mucama','ver_supervisoras',false),('mucama','responder_mucamas',false),('mucama','responder_supervisoras',false),
  ('mucama','responder_todo',false),('mucama','revisar_visto',true),('mucama','agregar_notas',false),('mucama','buscar_casos',false),
  ('mucama','ocupacion_ver',true),('mucama','ocupacion_editar',false),('mucama','ocupacion_limpieza',true),
  ('mucama','claves_cambiar',true),('mucama','claves_administrar',false),('mucama','casas_editar',false),('mucama','casas_eliminar',false),
  ('mucama','respaldo_excel',false),
  ('mucama','dest:ama_llaves',true),('mucama','dest:supervisora',true),('mucama','dest:operaciones',true),('mucama','dest:mucama',false),('mucama','dest:admin',false),
  ('mucama','alerta_obligatoria',true),('mucama','recordatorio_hora',false),('mucama','aviso_todos',false),('mucama','campana_mucamas',false),
  ('mucama','campana_supervisoras',false),('mucama','campana_claves',true),('mucama','aviso_reporte_terminado',true),
  ('mucama','aviso_ingreso_lista',false),('mucama','alerta_ingresos',true)
)
insert into public.permisos_rol (rol, permiso, permitido)
select rol, permiso, permitido from v
on conflict (rol, permiso) do nothing;

-- 3) Excepciones por persona -------------------------------------------
create table if not exists public.permisos_usuario (
  perfil_id uuid not null references public.perfiles(id) on delete cascade,
  permiso   text not null references public.permisos_catalogo(clave) on update cascade on delete cascade,
  permitido boolean not null,
  primary key (perfil_id, permiso)
);
alter table public.permisos_usuario enable row level security;
drop policy if exists leer on public.permisos_usuario;
create policy leer on public.permisos_usuario for select using (perfil_id = auth.uid() or es_admin());
drop policy if exists admin on public.permisos_usuario;
create policy admin on public.permisos_usuario for all using (es_admin()) with check (es_admin());

-- 4) Funciones de acceso ------------------------------------------------
create or replace function public.rol_hv(r text) returns boolean
language sql immutable as $f$ select r in ('mucama','supervisora','ama_llaves') $f$;

create or replace function public.tiene_permiso(p text)
returns boolean language sql stable security definer set search_path to 'public' as $f$
  select coalesce((
    select case
      when pf.rol = 'administrador' then true
      when coalesce(c.solo_admin, false) then false
      when rol_hv(pf.rol) and coalesce(c.bloqueado_hv, true) then false
      else coalesce(pu.permitido, pr.permitido, false) end
    from perfiles pf
    left join permisos_catalogo c on c.clave = p
    left join permisos_usuario pu on pu.perfil_id = pf.id and pu.permiso = p
    left join permisos_rol pr on pr.rol = pf.rol and pr.permiso = p
    where pf.id = auth.uid() and pf.activo
  ), false);
$f$;

-- Permisos efectivos de quien inició sesión (lo usa el panel)
create or replace function public.mis_permisos()
returns text[] language sql stable security definer set search_path to 'public' as $f$
  select coalesce(array_agg(c.clave order by c.clave), '{}') from permisos_catalogo c where tiene_permiso(c.clave);
$f$;

-- Acceso a reservas, clientes y precios: ahora por permiso
create or replace function public.es_colaborador()
returns boolean language sql stable security definer set search_path to 'public' as $f$
  select tiene_permiso('reservas_ver');
$f$;

-- Chat interno: solo personal con acceso a reservas
create or replace function public.chat_yo_activo()
returns boolean language sql stable security definer set search_path to 'public' as $f$
  select tiene_permiso('chat') and tiene_permiso('reservas_ver');
$f$;

create or replace function public.tar_puede_consultar()
returns boolean language sql stable security definer set search_path to 'public' as $f$
  select tiene_permiso('ver_tarifario');
$f$;

-- Nivel dentro de Staff: sale del rol (y, si no, de la ficha como antes)
create or replace function public.staff_mi_nivel()
returns text language sql stable security definer set search_path to 'public' as $f$
  select coalesce(
    (select case rol when 'mucama' then 'mucama' when 'supervisora' then 'supervisora'
                     when 'ama_llaves' then 'ama_llaves' when 'operaciones' then 'recepcion' end
       from perfiles where id = auth.uid() and activo),
    (select nivel_staff from staff_personas where perfil_id = auth.uid() and activo limit 1));
$f$;

-- 5) Departamento «Recepción» pasa a «Operaciones» ------------------------
alter table public.staff_horarios drop constraint if exists staff_horarios_departamento_check;
update public.staff_personas set departamento = 'Operaciones' where departamento = 'Recepción';
update public.staff_horarios set departamento = 'Operaciones' where departamento = 'Recepción';
alter table public.staff_horarios add constraint staff_horarios_departamento_check
  check (departamento in ('Operaciones','Ama de llaves'));

create or replace function public.staff_deps_visibles()
returns text[] language sql stable security definer set search_path to 'public' as $f$
  select case staff_mi_nivel()
    when 'ama_llaves' then array['Ama de llaves','Operaciones']
    when 'recepcion' then array['Operaciones','Ama de llaves']
    when 'supervisora' then array['Ama de llaves']
    when 'mucama' then array['Ama de llaves']
    else array[]::text[] end;
$f$;
