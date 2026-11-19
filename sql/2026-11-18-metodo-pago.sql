-- =====================================================
-- Método de pago del cliente y proveedores que aceptan Cash (18 nov 2026)
--  · tar_operadores.acepta_cash: true = acepta Cash sin factura · false = factura todo · null = sin definir
--  · actividades.pago_cliente: 'tc' | 'cash' (lo elige el agente)
--  · actividades.tipo_cobro (interno, no se muestra): 'tc' | 'cash_facturado' | 'cash', calculado al guardar
--  · Solicitud al proveedor: no_facturar = Cash con un proveedor que acepta Cash
--  · No se puede solicitar sin método de pago ni a un proveedor sin definir
-- =====================================================

alter table tar_operadores add column if not exists acepta_cash boolean;
alter table actividades add column if not exists pago_cliente text check (pago_cliente in ('tc', 'cash'));
alter table actividades add column if not exists tipo_cobro text check (tipo_cobro in ('tc', 'cash_facturado', 'cash'));

-- ¿El proveedor (operador del catálogo) acepta Cash? null = sin definir o sin ficha en el Tarifario
create or replace function public.operador_acepta_cash(p_operador bigint)
 returns boolean language sql stable security definer set search_path to 'public'
as $f$ select t.acepta_cash from tar_operadores t where t.operador_id = p_operador order by t.id limit 1 $f$;

-- Tipo interno de cobro (para comisiones y cuentas por pagar)
create or replace function public.calcular_tipo_cobro()
 returns trigger language plpgsql security definer set search_path to 'public'
as $f$
declare v_acepta boolean;
begin
  if new.pago_cliente = 'tc' then new.tipo_cobro := 'tc';
  elsif new.pago_cliente = 'cash' then
    v_acepta := operador_acepta_cash(new.operador_id);
    new.tipo_cobro := case when v_acepta is true then 'cash' when v_acepta is false then 'cash_facturado' end;
  else new.tipo_cobro := null;
  end if;
  return new;
end $f$;
drop trigger if exists t_tipo_cobro on actividades;
create trigger t_tipo_cobro before insert or update of pago_cliente, operador_id on actividades
  for each row execute function calcular_tipo_cobro();

-- Si se define o cambia la respuesta del proveedor, sus servicios abiertos recalculan el tipo interno
create or replace function public.recalcular_tipo_cobro_operador()
 returns trigger language plpgsql security definer set search_path to 'public'
as $f$
begin
  if new.acepta_cash is distinct from old.acepta_cash and new.operador_id is not null then
    update actividades a set tipo_cobro = case when a.pago_cliente = 'tc' then 'tc'
                                               when a.pago_cliente = 'cash' and new.acepta_cash is true then 'cash'
                                               when a.pago_cliente = 'cash' and new.acepta_cash is false then 'cash_facturado' end
      from cotizaciones c
     where a.operador_id = new.operador_id and c.id = a.cotizacion_id and c.estado not in ('cancelado', 'finalizado')
       and a.pago_cliente is not null;
  end if;
  return new;
end $f$;
drop trigger if exists t_operador_acepta_cash on tar_operadores;
create trigger t_operador_acepta_cash after update of acepta_cash on tar_operadores
  for each row execute function recalcular_tipo_cobro_operador();

-- contactos_proveedores: también dice si acepta Cash
drop function if exists public.contactos_proveedores();
create function public.contactos_proveedores()
 returns table(operador_id bigint, nombre text, correo_reservas text, whatsapp text, medio_preferido text, acepta_cash boolean)
 language sql stable security definer set search_path to 'public'
as $f$
  select t.operador_id, t.nombre, t.correo_reservas, t.whatsapp, t.medio_preferido, t.acepta_cash
    from tar_operadores t
   where t.operador_id is not null and es_colaborador();
$f$;
grant execute on function public.contactos_proveedores() to authenticated;

-- tarifas_actividades: cada servicio dice si su proveedor acepta Cash
do $$
declare d text; n text;
begin
  d := pg_get_functiondef('public.tarifas_actividades(jsonb)'::regprocedure);
  n := replace(d, $x$'tarifario', v_op is not null, 'precios', v_precios,$x$,
                  $x$'tarifario', v_op is not null, 'acepta_cash', (select acepta_cash from tar_operadores where id = v_op), 'precios', v_precios,$x$);
  if n = d then raise exception 'tarifas_actividades: no se encontró el texto a cambiar'; end if;
  execute n;

  -- solicitud_contenido: nota NO FACTURAR (Cash con proveedor que acepta Cash)
  d := pg_get_functiondef('public.solicitud_contenido(bigint)'::regprocedure);
  n := replace(d, $x$'notas', a.notas_proveedor$x$,
                  $x$'no_facturar', (a.pago_cliente = 'cash' and coalesce(operador_acepta_cash(a.operador_id), false)),
    'notas', a.notas_proveedor$x$);
  if n = d then raise exception 'solicitud_contenido: no se encontró el texto a cambiar'; end if;
  execute n;

  -- crear_solicitudes: método de pago obligatorio y proveedor definido
  d := pg_get_functiondef('public.crear_solicitudes(bigint[])'::regprocedure);
  n := replace(d, $x$    if a.operador_id is null then raise exception 'Una de las actividades no tiene operador asignado.'; end if;$x$,
                  $x$    if a.operador_id is null then raise exception 'Una de las actividades no tiene operador asignado.'; end if;
    if a.pago_cliente is null then raise exception 'Falta elegir el método de pago (TC o Cash) en uno de los servicios.'; end if;
    if operador_acepta_cash(a.operador_id) is null then
      raise exception 'El proveedor de uno de los servicios todavía no indica si acepta pagos en Cash (Tarifario › Operadores).';
    end if;$x$);
  if n = d then raise exception 'crear_solicitudes: no se encontró el texto a cambiar'; end if;
  execute n;
end $$;

-- Los servicios que ya existen quedan sin método de pago: lo elige el agente.
