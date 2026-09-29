// =====================================================
// PANEL DE RESERVAS - COLABORADORES
// =====================================================

const $ = (id) => document.getElementById(id);
const db = supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey);

const COLUMNAS = [
  { id: "cotizacion", nombre: "Cotizaciones", vacio: "No hay solicitudes nuevas." },
  { id: "proceso", nombre: "Proceso", vacio: "No hay cotizaciones en proceso." },
  { id: "reserva", nombre: "Reserva", vacio: "No hay reservas activas." },
  { id: "finalizado", nombre: "Finalizado", vacio: "No hay reservas finalizadas recientes." }
];
const NOMBRE_ESTADO = { cotizacion: "Cotización", proceso: "Proceso", reserva: "Reserva", finalizado: "Finalizado" };
const ROLES_AUTORIZADOS = ["administrador", "gerente", "jefatura"];
const METODOS_PAGO = ["Transferencia", "SINPE Móvil", "Tarjeta", "Efectivo", "Otro"];
const MODOS_TRANSPORTE = {
  incluido: "Incluido en el servicio",
  opcional: "Opcional (se consulta al cliente)",
  sin_transporte: "Sin transporte"
};

const app = {
  yo: null,
  cotizaciones: [],
  servicios: [], propiedades: [], categorias: [], precios: [], perfiles: [], operadores: [],
  permisos: new Set(),
  actual: null,            // { cot, solicitudes, actividades, pagos, bitacora }
  editandoCliente: false,
  temporizador: null
};

// =====================================================
// UTILIDADES
// =====================================================
const pad = (n) => String(n).padStart(2, "0");
const aTexto = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function escapar(texto) {
  return String(texto ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function dinero(n) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(n) || 0);
}
function fecha(t, opciones = { day: "numeric", month: "short" }) {
  if (!t) return "";
  return new Date(t.slice(0, 10) + "T12:00:00").toLocaleDateString("es-CR", opciones);
}
const fechaLarga = (t) => fecha(t, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const fechaHora = (ts) => new Date(ts).toLocaleString("es-CR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const hora = (h) => (h ? String(h).slice(0, 5) : "");

function sumarMinutos(h, minutos) {
  if (!h || !minutos) return "";
  const [a, b] = h.split(":").map(Number);
  const t = (a * 60 + b + minutos) % (24 * 60);
  return `${pad(Math.floor(t / 60))}:${pad(t % 60)}`;
}

const puede = (permiso) => app.yo?.rol === "administrador" || app.permisos.has(permiso);
const esAutorizado = () => puede("reabrir_finalizadas");
const servicioPorId = (id) => app.servicios.find((s) => s.id === Number(id));
const categoriaPorId = (id) => app.categorias.find((c) => c.id === Number(id));
const categoriaPorNombre = (n) => app.categorias.find((c) => c.nombre === n);
const nombreCompleto = (c) => `${c.nombre} ${c.apellido}`;
const nombrePerfil = (id) => app.perfiles.find((p) => p.id === id)?.nombre ?? "";
const subtotalPersonas = (a) => a.participantes.reduce((s, p) => s + p.cantidad * p.precio_unitario, 0);
const transporteCobrado = (a) =>
  a.transporte_modo === "opcional" && a.transporte_respuesta === "si" ? Number(a.transporte_costo) || 0 : 0;
const transportePendiente = (a) => a.transporte_modo === "opcional" && !a.transporte_respuesta;
const subtotal = (a) => subtotalPersonas(a) + transporteCobrado(a);
const transporteNetoAplicado = (a) =>
  a.transporte_modo === "incluido" || (a.transporte_modo === "opcional" && a.transporte_respuesta === "si")
    ? Number(a.transporte_neto) || 0 : 0;
const costoNeto = (a) =>
  a.participantes.reduce((s, p) => s + p.cantidad * (p.neto_unitario || 0), 0) + transporteNetoAplicado(a);
const nombreOperador = (id) => app.operadores.find((o) => o.id === Number(id))?.nombre ?? "";
const ordenActividad = (x, y) => (x.fecha + (x.hora_inicio || "")).localeCompare(y.fecha + (y.hora_inicio || ""));

function precioBase(servicioId, categoriaId) {
  const p = app.precios.find((x) => x.servicio_id === Number(servicioId) && x.categoria_id === Number(categoriaId));
  return p ? Number(p.precio) : 0;
}
function netoBase(servicioId, categoriaId) {
  const p = app.precios.find((x) => x.servicio_id === Number(servicioId) && x.categoria_id === Number(categoriaId));
  return p ? Number(p.neto) || 0 : 0;
}
function nombrePropiedad(c) {
  if (c.propiedad_id) return app.propiedades.find((p) => p.id === c.propiedad_id)?.nombre ?? "";
  return c.propiedad_otro || "";
}
function personas(c) {
  const partes = [`${c.adultos} ${c.adultos === 1 ? "adulto" : "adultos"}`];
  if (c.ninos) partes.push(`${c.ninos} ${c.ninos === 1 ? "niño" : "niños"}`);
  if (c.menores) partes.push(`${c.menores} ${c.menores === 1 ? "menor" : "menores"} de 6 años`);
  return partes.join(", ");
}

function avisar(texto, tipo = "ok") {
  const t = $("aviso");
  t.textContent = texto;
  t.className = `toast ${tipo}`;
  t.hidden = false;
  clearTimeout(avisar.t);
  avisar.t = setTimeout(() => (t.hidden = true), 5000);
}
function fallo(error, texto = "No se pudo guardar.") {
  console.error(error);
  avisar(`${texto} ${error?.message ?? ""}`.trim(), "error");
}
async function conBoton(btn, fn) {
  btn.disabled = true;
  try { await fn(); } finally { if (btn.isConnected) btn.disabled = false; }
}
async function registrar(cotizacionId, accion, detalle = null) {
  await db.from("bitacora").insert({ cotizacion_id: cotizacionId, accion, detalle });
}

// =====================================================
// INICIO DE SESIÓN
// =====================================================
function mostrarLogin(mensaje = "") {
  $("vistaApp").hidden = true;
  $("detalle").hidden = true;
  $("vistaLogin").hidden = false;
  $("loginMensaje").hidden = !mensaje;
  $("loginMensaje").textContent = mensaje;
  clearInterval(app.temporizador);
}

$("formLogin").addEventListener("submit", async (e) => {
  e.preventDefault();
  const correo = $("loginCorreo").value.trim();
  const clave = $("loginClave").value;
  if (!correo || !clave) return mostrarLogin("Escribe tu correo y tu clave.");

  await conBoton($("btnEntrar"), async () => {
    const { error } = await db.auth.signInWithPassword({ email: correo, password: clave });
    if (error) return mostrarLogin("El correo o la clave no son correctos.");
    $("loginClave").value = "";
    await entrar();
  });
});

async function entrar() {
  const { data: { user } } = await db.auth.getUser();
  if (!user) return mostrarLogin();

  const { data: perfil } = await db.from("perfiles").select("*").eq("id", user.id).maybeSingle();
  if (!perfil || !perfil.activo) {
    await db.auth.signOut();
    return mostrarLogin("Tu usuario no tiene acceso al panel. Pide a un administrador que te lo active.");
  }

  app.yo = perfil;
  const { data: permisos } = await db.from("permisos_rol").select("permiso, permitido").eq("rol", perfil.rol);
  app.permisos = new Set((permisos || []).filter((p) => p.permitido).map((p) => p.permiso));
  $("usuarioNombre").textContent = `${perfil.nombre} (${perfil.rol})`;
  $("vistaLogin").hidden = true;
  $("vistaApp").hidden = false;

  await cargarCatalogos();
  await db.rpc("finalizar_vencidas");
  await cargarTablero();

  clearInterval(app.temporizador);
  app.temporizador = setInterval(cargarTablero, 60000);
}

$("btnSalir").addEventListener("click", async () => {
  await db.auth.signOut();
  mostrarLogin();
});

// =====================================================
// CATÁLOGOS Y TABLERO
// =====================================================
async function cargarCatalogos() {
  const [s, p, c, pr, pf, op] = await Promise.all([
    db.from("servicios").select("*").order("nombre"),
    db.from("propiedades").select("*").order("nombre"),
    db.from("categorias_cliente").select("*").order("orden"),
    db.from("servicio_precios").select("*"),
    db.from("perfiles").select("id, nombre, rol"),
    db.from("operadores").select("*").order("nombre")
  ]);
  const error = s.error || p.error || c.error || pr.error || pf.error || op.error;
  if (error) return fallo(error, "No se pudieron cargar los catálogos.");
  app.operadores = op.data;
  app.servicios = s.data;
  app.propiedades = p.data;
  app.categorias = c.data;
  app.precios = pr.data;
  app.perfiles = pf.data;
}

async function cargarTablero() {
  const d = new Date();
  d.setDate(d.getDate() - 90);

  const { data, error } = await db.from("resumen_cotizaciones")
    .select("id, numero, estado, nombre, apellido, fecha_inicio, fecha_fin, creado_en, colaborador_id, cambios_pendientes, enviada_en, total, balance")
    .or(`estado.neq.finalizado,fecha_fin.gte.${aTexto(d)}`)
    .order("creado_en", { ascending: true });

  if (error) return fallo(error, "No se pudo cargar el tablero.");
  app.cotizaciones = data;
  pintarTablero();
  $("ultimaActualizacion").textContent =
    `Actualizado a las ${new Date().toLocaleTimeString("es-CR", { hour: "2-digit", minute: "2-digit" })}`;
}

function pintarTablero() {
  const q = $("buscar").value.trim().toLowerCase();
  const lista = app.cotizaciones.filter((c) =>
    !q || nombreCompleto(c).toLowerCase().includes(q) || c.numero.toLowerCase().includes(q));

  $("tablero").innerHTML = COLUMNAS.map((col) => {
    let items = lista.filter((c) => c.estado === col.id);
    if (col.id === "finalizado") items = items.sort((a, b) => b.fecha_fin.localeCompare(a.fecha_fin));

    return `
      <section class="columna col-${col.id}" aria-labelledby="t-${col.id}">
        <h2 id="t-${col.id}" class="col-titulo"><span>${col.nombre}</span><span class="col-cuenta">${items.length}</span></h2>
        ${items.length ? `<ul class="col-lista">${items.map(htmlItem).join("")}</ul>` : `<p class="col-vacia">${col.vacio}</p>`}
        ${col.id === "finalizado" ? `<p class="col-nota">Se muestran las de los últimos 90 días.</p>` : ""}
      </section>`;
  }).join("");
}

function htmlItem(c) {
  const extra = [];
  if (c.cambios_pendientes) extra.push(`<span class="etiqueta alerta">Pidió cambios</span>`);
  if (c.estado === "proceso") extra.push(`<span class="etiqueta">${c.enviada_en ? "Enviada" : "Sin enviar"}</span>`);
  if (c.estado === "reserva" && Number(c.total) > 0) {
    extra.push(`<span class="etiqueta">${Number(c.balance) > 0 ? "Balance " + dinero(c.balance) : "Pagada"}</span>`);
  }
  const atiende = c.colaborador_id ? `<span>${escapar(nombrePerfil(c.colaborador_id))}</span>` : "";

  return `
    <li>
      <button type="button" class="item" data-id="${c.id}">
        <span class="item-nombre">${escapar(nombreCompleto(c))}</span>
        <span class="item-meta"><span>${c.numero}</span><span>${fecha(c.fecha_inicio)} al ${fecha(c.fecha_fin)}</span>${atiende}</span>
        ${extra.length ? `<span class="item-extra">${extra.join("")}</span>` : ""}
      </button>
    </li>`;
}

$("tablero").addEventListener("click", (e) => {
  const item = e.target.closest(".item");
  if (item) abrirDetalle(Number(item.dataset.id));
});
$("buscar").addEventListener("input", pintarTablero);
$("btnActualizar").addEventListener("click", (e) => conBoton(e.currentTarget, async () => {
  await db.rpc("finalizar_vencidas");
  await cargarCatalogos();
  await cargarTablero();
  document.dispatchEvent(new Event("datos-actualizados"));
  avisar("Datos actualizados.");
}));

// ---------- Menú de secciones ----------
const VISTAS = { reservas: "vistaReservas", servicios: "vistaServicios", mantenimiento: "vistaMantenimiento" };
function mostrarVista(nombre) {
  Object.entries(VISTAS).forEach(([k, id]) => ($(id).hidden = k !== nombre));
  document.querySelectorAll(".menu-btn[data-vista]").forEach((b) => {
    if (b.dataset.vista === nombre) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  document.dispatchEvent(new CustomEvent("vista-abierta", { detail: nombre }));
}
document.querySelectorAll(".menu-btn[data-vista]").forEach((b) =>
  b.addEventListener("click", () => mostrarVista(b.dataset.vista)));
$("btnImprimirTablero").addEventListener("click", () => window.print());

// =====================================================
// DETALLE: CARGA
// =====================================================
function normalizarActividad(a) {
  return {
    id: a.id,
    servicio_id: a.servicio_id,
    fecha: a.fecha,
    hora_inicio: hora(a.hora_inicio),
    hora_fin: hora(a.hora_fin),
    lugar_recogida: a.lugar_recogida ?? "",
    lugar_dejada: a.lugar_dejada ?? "",
    hora_recogida: hora(a.hora_recogida),
    transporte_modo: a.transporte_modo || "opcional",
    transporte_costo: Number(a.transporte_costo) || 0,
    transporte_respuesta: a.transporte_respuesta === true ? "si" : a.transporte_respuesta === false ? "no" : "",
    transporte_neto: Number(a.transporte_neto) || 0,
    operador_id: a.operador_id,
    notas: a.notas ?? "",
    participantes: (a.actividad_participantes || [])
      .map((p) => ({
        categoria_id: p.categoria_id,
        cantidad: p.cantidad,
        precio_unitario: Number(p.precio_unitario),
        neto_unitario: Number(p.neto_unitario) || 0
      }))
      .sort((x, y) => (categoriaPorId(x.categoria_id)?.orden ?? 0) - (categoriaPorId(y.categoria_id)?.orden ?? 0)),
    _pendiente: false
  };
}

async function cargarDetalle(id) {
  const [c, s, a, p, b] = await Promise.all([
    db.from("resumen_cotizaciones").select("*").eq("id", id).single(),
    db.from("solicitudes").select("*").eq("cotizacion_id", id).order("fecha"),
    db.from("actividades").select("*, actividad_participantes(*)").eq("cotizacion_id", id).order("fecha").order("hora_inicio"),
    db.from("pagos").select("*").eq("cotizacion_id", id).order("fecha"),
    db.from("bitacora").select("*").eq("cotizacion_id", id).order("creado_en", { ascending: false })
  ]);
  const error = c.error || s.error || a.error || p.error || b.error;
  if (error) { fallo(error, "No se pudo abrir la cotización."); return false; }

  app.actual = {
    cot: c.data,
    solicitudes: s.data,
    actividades: a.data.map(normalizarActividad),
    pagos: p.data,
    bitacora: b.data
  };
  return true;
}

async function abrirDetalle(id) {
  app.editandoCliente = false;
  if (!(await cargarDetalle(id))) return;
  $("detalle").hidden = false;
  document.body.classList.add("detalle-abierto");
  pintarDetalle();
  $("detalleTitulo")?.focus();
}

async function recargarDetalle(mantenerCambios = true) {
  let actividades = null;
  if (mantenerCambios) { sincronizar(); actividades = app.actual.actividades; }
  if (!(await cargarDetalle(app.actual.cot.id))) return;
  if (mantenerCambios && actividades.some((a) => a._pendiente)) app.actual.actividades = actividades;
  pintarDetalle();
}

function hayPendientes() {
  sincronizar();
  return app.actual.actividades.some((a) => a._pendiente);
}

function cerrarDetalle() {
  if (app.actual && hayPendientes() &&
      !confirm("Hay cambios sin guardar en el itinerario. ¿Cerrar de todos modos?")) return;
  $("detalle").hidden = true;
  document.body.classList.remove("detalle-abierto");
  app.actual = null;
}

$("detalle").addEventListener("click", (e) => { if (e.target === $("detalle")) cerrarDetalle(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("detalle").hidden) cerrarDetalle(); });

// =====================================================
// DETALLE: DIBUJO
// =====================================================
function pintarDetalle() {
  const { cot: c, solicitudes, bitacora } = app.actual;
  const editable = ["proceso", "reserva"].includes(c.estado);

  let h = `
    <div class="det-cabeza estado-${c.estado}">
      <div>
        <p class="det-numero">
          <span>${c.numero}</span>
          <span class="chip">${NOMBRE_ESTADO[c.estado]}</span>
          ${c.reabierta ? `<span class="chip claro">Reabierta</span>` : ""}
        </p>
        <h2 id="detalleTitulo" tabindex="-1">${escapar(nombreCompleto(c))}</h2>
      </div>
      <div class="det-acciones">
        <button type="button" class="btn" data-accion="imprimir">Imprimir</button>
        <button type="button" class="btn" data-accion="cerrar">Cerrar</button>
      </div>
    </div>`;

  h += htmlCambiosCliente(c, bitacora);
  h += htmlCliente(c);
  h += htmlSolicitud(solicitudes);

  if (c.estado === "cotizacion") {
    h += `
      <section class="det-seccion">
        <div class="llamado">
          <p>Esta solicitud todavía no tiene un colaborador asignado.</p>
          <button type="button" class="btn primario" data-accion="atender">Empezar a atender</button>
        </div>
      </section>`;
  }
  if (editable) h += htmlEditorActividades();
  if (c.estado === "finalizado") h += htmlActividadesLectura();
  if (c.estado !== "cotizacion") h += `<section class="det-seccion"><h3>Totales</h3><div id="totales"></div></section>`;
  if (c.estado === "proceso") h += htmlEnvio(c);
  if (c.estado === "reserva" || c.estado === "finalizado") h += htmlPagos(c, c.estado === "reserva" && puede("registrar_pagos"));
  if (c.estado === "finalizado") h += htmlReabrir();
  h += htmlNotas(c, c.estado !== "finalizado");
  h += htmlHistorial(bitacora);

  $("detalleContenido").innerHTML = h;
  pintarTotales();
}

function htmlCambiosCliente(c, bitacora) {
  if (!c.cambios_pendientes) return "";
  const ultimo = bitacora.find((b) => b.accion === "comentario del cliente");
  return `
    <section class="det-seccion cambios">
      <h3>El cliente pidió cambios</h3>
      ${ultimo ? `<p class="cita">${escapar(ultimo.detalle)}</p><p class="nota">Recibido el ${fechaHora(ultimo.creado_en)}</p>` : ""}
      <button type="button" class="btn" data-accion="revisado">Marcar como revisado</button>
    </section>`;
}

function htmlCliente(c) {
  const bloqueado = c.estado === "finalizado";

  if (app.editandoCliente) {
    const opciones = app.propiedades.map((p) =>
      `<option value="${p.id}" ${p.id === c.propiedad_id ? "selected" : ""}>${escapar(p.nombre)}</option>`).join("");
    return `
      <section class="det-seccion">
        <h3>Datos del cliente</h3>
        <div class="fila">
          <label>Nombre <input id="cliNombre" value="${escapar(c.nombre)}"></label>
          <label>Apellido <input id="cliApellido" value="${escapar(c.apellido)}"></label>
        </div>
        <div class="fila">
          <label>Correo <input id="cliCorreo" type="email" value="${escapar(c.correo)}"></label>
          <label>Teléfono <input id="cliTelefono" value="${escapar(c.telefono)}"></label>
        </div>
        <div class="fila">
          <label>Desde <input id="cliInicio" type="date" value="${c.fecha_inicio}"></label>
          <label>Hasta <input id="cliFin" type="date" value="${c.fecha_fin}"></label>
        </div>
        <div class="fila">
          <label>Hospedaje
            <select id="cliPropiedad">
              ${opciones}
              <option value="otro" ${c.propiedad_id ? "" : "selected"}>Otro lugar</option>
            </select>
          </label>
          <label>Otro lugar (si aplica) <input id="cliOtro" value="${escapar(c.propiedad_otro ?? "")}"></label>
        </div>
        <div class="fila">
          <label>Adultos <input id="cliAdultos" type="number" min="1" value="${c.adultos}"></label>
          <label>Niños (6 a 11) <input id="cliNinos" type="number" min="0" value="${c.ninos}"></label>
          <label>Menores de 6 <input id="cliMenores" type="number" min="0" value="${c.menores}"></label>
        </div>
        <div class="sec-botones">
          <button type="button" class="btn primario" data-accion="guardar-cliente">Guardar datos</button>
          <button type="button" class="btn" data-accion="cancelar-cliente">Cancelar</button>
        </div>
      </section>`;
  }

  return `
    <section class="det-seccion">
      <div class="sec-cabeza">
        <h3>Datos del cliente</h3>
        ${bloqueado ? "" : `<button type="button" class="enlace" data-accion="editar-cliente">Editar datos</button>`}
      </div>
      <dl class="datos-cliente">
        <div><dt>Correo</dt><dd><a href="mailto:${escapar(c.correo)}">${escapar(c.correo)}</a></dd></div>
        <div><dt>Teléfono</dt><dd>${escapar(c.telefono)}</dd></div>
        <div><dt>Hospedaje</dt><dd>${escapar(nombrePropiedad(c)) || "Sin indicar"}${c.propiedad_id ? "" : " (otro lugar)"}</dd></div>
        <div><dt>Fechas del viaje</dt><dd>${fecha(c.fecha_inicio)} al ${fecha(c.fecha_fin, { day: "numeric", month: "short", year: "numeric" })}</dd></div>
        <div><dt>Personas</dt><dd>${personas(c)}</dd></div>
        <div><dt>Solicitud recibida</dt><dd>${fechaHora(c.creado_en)}</dd></div>
        <div><dt>Atiende</dt><dd>${escapar(nombrePerfil(c.colaborador_id)) || "Sin asignar"}</dd></div>
      </dl>
    </section>`;
}

function htmlSolicitud(solicitudes) {
  if (!solicitudes.length) return "";
  const porDia = {};
  solicitudes.forEach((s) => (porDia[s.fecha] ||= []).push(servicioPorId(s.servicio_id)?.nombre ?? "Servicio"));
  return `
    <section class="det-seccion">
      <h3>Lo que pidió el cliente</h3>
      ${Object.keys(porDia).sort().map((f) => `
        <div class="solicitud-dia">
          <span class="nota">${escapar(fecha(f, { weekday: "long", day: "numeric", month: "long" }))}</span>
          <span>${porDia[f].map(escapar).join(", ")}</span>
        </div>`).join("")}
    </section>`;
}

function htmlEditorActividades() {
  const { actividades, solicitudes } = app.actual;
  return `
    <section class="det-seccion">
      <div class="sec-cabeza">
        <h3>Itinerario y precios</h3>
        <div class="sec-botones">
          ${solicitudes.length ? `<button type="button" class="btn" data-accion="cargar-solicitud">Cargar lo que pidió el cliente</button>` : ""}
          <button type="button" class="btn" data-accion="agregar-actividad">Agregar actividad</button>
        </div>
      </div>
      ${actividades.length ? "" : `<p class="nota">Todavía no hay actividades. Usa "Cargar lo que pidió el cliente" para empezar con su solicitud, o agrégalas una por una.</p>`}
      <div id="listaActividades">${actividades.map(htmlActividad).join("")}</div>
      <div class="barra-guardar">
        <button type="button" class="btn primario" data-accion="guardar-todo">Guardar cambios</button>
      </div>
    </section>`;
}

function htmlActividad(a, idx) {
  const verNeto = puede("ver_utilidad");
  const serv = servicioPorId(a.servicio_id);
  const servicios = app.servicios
    .filter((s) => s.activo || s.id === a.servicio_id)
    .map((s) => `<option value="${s.id}" ${s.id === a.servicio_id ? "selected" : ""}>${escapar(s.nombre)}</option>`)
    .join("");
  const horarios = (serv?.horarios || []).map(hora);

  const filas = a.participantes.map((p) => `
    <tr data-cat="${p.categoria_id}">
      <th scope="row">${escapar(categoriaPorId(p.categoria_id)?.nombre ?? "")}</th>
      <td><input data-p="cantidad" type="number" min="0" value="${p.cantidad}" aria-label="Cantidad"></td>
      <td><input data-p="precio" type="number" min="0" step="0.01" value="${p.precio_unitario}" aria-label="Precio rack por persona"></td>
      ${verNeto ? `<td><input data-p="neto" type="number" min="0" step="0.01" value="${p.neto_unitario || 0}" aria-label="Neto por persona"></td>` : ""}
      <td class="num celda-subtotal">${dinero(p.cantidad * p.precio_unitario)}</td>
      <td><button type="button" class="enlace" data-accion="quitar-cat" data-cat="${p.categoria_id}">Quitar</button></td>
    </tr>`).join("");

  const faltantes = app.categorias.filter((c) => !a.participantes.some((p) => p.categoria_id === c.id));

  return `
    <article class="actividad${a._pendiente ? " pendiente" : ""}" data-idx="${idx}">
      <div class="act-cabeza">
        <p class="act-titulo">${escapar(serv?.nombre ?? "Actividad nueva")}</p>
        <span class="act-estado">${a._pendiente ? "Cambios sin guardar" : ""}</span>
        <button type="button" class="enlace peligro" data-accion="eliminar-act">Eliminar</button>
      </div>
      <div class="act-campos">
        <label>Servicio
          <select data-campo="servicio_id"><option value="">Elige un servicio</option>${servicios}</select>
        </label>
        <label>Fecha <input data-campo="fecha" type="date" value="${a.fecha}"></label>
        <label>Hora de inicio
          <input data-campo="hora_inicio" type="time" value="${a.hora_inicio}" list="horarios-${idx}">
          <datalist id="horarios-${idx}">${horarios.map((x) => `<option value="${x}">`).join("")}</datalist>
          ${horarios.length ? `<span class="horarios-nota">Habituales: ${horarios.join(", ")}</span>` : ""}
        </label>
        <label>Hora de fin <input data-campo="hora_fin" type="time" value="${a.hora_fin}"></label>
        <label class="ancho">Operador <span class="interno">interno</span>
          <select data-campo="operador_id">
            <option value="">Sin operador</option>
            ${app.operadores.filter((o) => o.activo || o.id === a.operador_id)
              .map((o) => `<option value="${o.id}" ${o.id === a.operador_id ? "selected" : ""}>${escapar(o.nombre)}</option>`).join("")}
          </select>
        </label>
      </div>
      ${htmlTransporte(a)}
      <div class="tabla-scroll">
        <table class="participantes">
          <thead><tr><th>Tipo de cliente</th><th>Cantidad</th><th>Rack c/u</th>${verNeto ? `<th>Neto c/u <span class="interno">interno</span></th>` : ""}<th class="num">Subtotal</th><th></th></tr></thead>
          <tbody>${filas}</tbody>
          <tfoot>
            <tr>
              <td colspan="${verNeto ? 4 : 3}">
                <select data-accion="agregar-cat" aria-label="Agregar tipo de cliente">
                  <option value="">+ Agregar tipo de cliente</option>
                  ${faltantes.map((c) => `<option value="${c.id}">${escapar(c.nombre)}</option>`).join("")}
                  <option value="nueva">Crear un tipo nuevo…</option>
                </select>
              </td>
              <td class="num act-subtotal">${dinero(subtotal(a))}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <label>Notas de la actividad <input data-campo="notas" type="text" value="${escapar(a.notas)}"></label>
    </article>`;
}

function htmlTransporte(a) {
  const modo = a.transporte_modo;
  const opciones = Object.entries(MODOS_TRANSPORTE)
    .map(([k, v]) => `<option value="${k}" ${k === modo ? "selected" : ""}>${v}</option>`).join("");

  let campos = "";
  if (modo !== "sin_transporte") {
    campos += `
      <div class="trans-campos">
        <label class="ancho">Pick up (lugar de recogida) <input data-campo="lugar_recogida" type="text" value="${escapar(a.lugar_recogida)}"></label>
        <label>Hora de pick up <input data-campo="hora_recogida" type="time" value="${a.hora_recogida}"></label>
        <label class="ancho">Drop off (lugar de dejada) <input data-campo="lugar_dejada" type="text" value="${escapar(a.lugar_dejada)}"></label>
      </div>
      ${puede("ver_utilidad") ? `
      <div class="trans-campos">
        <label>Costo neto del transporte <span class="interno">interno</span>
          <input data-campo="transporte_neto" type="number" min="0" step="0.01" value="${a.transporte_neto || 0}">
        </label>
      </div>` : ""}`;
  }
  if (modo === "opcional") {
    campos += `
      <div class="trans-campos">
        <label>Costo del transporte (total) <input data-campo="transporte_costo" type="number" min="0" step="0.01" value="${a.transporte_costo}"></label>
        <label class="ancho">Respuesta del cliente
          <select data-campo="transporte_respuesta">
            <option value="" ${!a.transporte_respuesta ? "selected" : ""}>Pendiente de respuesta</option>
            <option value="si" ${a.transporte_respuesta === "si" ? "selected" : ""}>Sí requiere transporte</option>
            <option value="no" ${a.transporte_respuesta === "no" ? "selected" : ""}>No requiere transporte</option>
          </select>
        </label>
      </div>
      <p class="horarios-nota">Deja el costo en 0 si el transporte no tiene costo. El cliente lo elige en el enlace de su cotización; si te responde por otro medio, anótalo aquí.</p>`;
  }

  return `
    <fieldset class="transporte">
      <legend>Transporte</legend>
      <label class="trans-modo">Tipo de transporte <select data-campo="transporte_modo">${opciones}</select></label>
      ${campos}
    </fieldset>`;
}

function htmlActividadesLectura() {
  const acts = [...app.actual.actividades].sort(ordenActividad);
  if (!acts.length) return `<section class="det-seccion"><h3>Itinerario</h3><p class="nota">Sin actividades registradas.</p></section>`;
  return `
    <section class="det-seccion">
      <h3>Itinerario</h3>
      <div class="tabla-scroll">${tablaItinerario(acts)}</div>
    </section>`;
}

function textoTransporte(a) {
  if (a.transporte_modo === "sin_transporte") return "Sin transporte";
  if (a.transporte_modo === "opcional" && a.transporte_respuesta === "no") return "Transporte: no requerido";
  const partes = [];
  if (a.transporte_modo === "opcional") {
    const costo = Number(a.transporte_costo) ? dinero(a.transporte_costo) : "sin costo";
    partes.push(a.transporte_respuesta === "si" ? `Transporte: sí (${costo})` : `Transporte opcional (${costo}), pendiente de respuesta`);
  } else {
    partes.push("Transporte incluido");
  }
  if (a.lugar_recogida) partes.push(`Pick up: ${escapar(a.lugar_recogida)}${a.hora_recogida ? " a las " + hora(a.hora_recogida) : ""}`);
  if (a.lugar_dejada) partes.push(`Drop off: ${escapar(a.lugar_dejada)}`);
  return partes.join("<br>");
}

function tablaItinerario(acts) {
  const filas = acts.map((a) => {
    const serv = servicioPorId(a.servicio_id);
    const part = a.participantes.filter((p) => p.cantidad > 0).map((p) =>
      `${p.cantidad} ${escapar(categoriaPorId(p.categoria_id)?.nombre ?? "")} × ${dinero(p.precio_unitario)}`).join("<br>");
    const lugares = textoTransporte(a);
    return `
      <tr>
        <td>${fecha(a.fecha, { weekday: "short", day: "numeric", month: "short" })}</td>
        <td>${hora(a.hora_inicio)}${a.hora_fin ? " a " + hora(a.hora_fin) : ""}</td>
        <td><strong>${escapar(serv?.nombre ?? "")}</strong>${lugares ? `<br><small>${lugares}</small>` : ""}</td>
        <td>${part}</td>
        <td class="num">${dinero(subtotal(a))}</td>
      </tr>`;
  }).join("");
  return `
    <table class="tabla">
      <thead><tr><th>Fecha</th><th>Horario</th><th>Servicio</th><th>Participantes</th><th class="num">Subtotal</th></tr></thead>
      <tbody>${filas}</tbody>
    </table>`;
}

function pintarTotales() {
  const cont = $("totales");
  if (!cont) return;
  const { cot: c, actividades, pagos } = app.actual;
  const total = actividades.reduce((s, a) => s + subtotal(a), 0);
  const pagado = pagos.reduce((s, p) => s + Number(p.monto), 0);
  const prepago = Number(c.prepago_solicitado) || 0;

  let h = `<div class="totales-caja"><div class="fila-total grande"><span>Total</span><strong>${dinero(total)}</strong></div>`;
  if (c.estado === "reserva" || c.estado === "finalizado") {
    h += `
      <div class="fila-total"><span>Prepago solicitado</span><span>${dinero(prepago)}</span></div>
      <div class="fila-total"><span>Pagado</span><span>${dinero(pagado)}</span></div>
      <div class="fila-total balance"><span>Balance</span><strong>${dinero(total - pagado)}</strong></div>`;
    if (prepago > pagado) h += `<p class="nota">Falta recibir ${dinero(prepago - pagado)} del prepago.</p>`;
  }
  const neto = actividades.reduce((s, a) => s + costoNeto(a), 0);
  if (puede("ver_utilidad")) h += `
    <div class="interno-caja">
      <p class="interno-titulo">Solo uso interno</p>
      <div class="fila-total"><span>Costo neto</span><span>${dinero(neto)}</span></div>
      <div class="fila-total"><span>Utilidad</span><strong>${dinero(total - neto)}</strong></div>
    </div>`;
  const pendientesTrans = actividades.filter(transportePendiente);
  if (pendientesTrans.length) {
    const monto = pendientesTrans.reduce((s, a) => s + (Number(a.transporte_costo) || 0), 0);
    h += `<p class="nota">${pendientesTrans.length} ${pendientesTrans.length === 1 ? "actividad tiene" : "actividades tienen"} transporte opcional sin respuesta del cliente${monto ? ` (hasta ${dinero(monto)} más)` : ""}.</p>`;
  }
  if (actividades.some((a) => a._pendiente)) h += `<p class="nota">Hay cambios sin guardar; el total ya los incluye.</p>`;
  cont.innerHTML = h + "</div>";
}

function enlaceCliente(c) {
  return new URL(`cotizacion.html?n=${encodeURIComponent(c.numero)}&t=${c.token}`, location.href).href;
}

function htmlEnvio(c) {
  let compartir = "";
  if (c.enviada_en) {
    const link = enlaceCliente(c);
    const texto = `Hola ${c.nombre}, te enviamos tu cotización ${c.numero} de The House of Tours. Puedes revisarla y confirmarla aquí: ${link}`;
    const wa = `https://wa.me/${c.telefono.replace(/\D/g, "")}?text=${encodeURIComponent(texto)}`;
    const mail = `mailto:${encodeURIComponent(c.correo)}?subject=${encodeURIComponent("Tu cotización " + c.numero + " | The House of Tours")}&body=${encodeURIComponent(texto)}`;
    compartir = `
      <div class="enlace-cliente">
        <input type="text" readonly value="${escapar(link)}" aria-label="Enlace para el cliente">
        <button type="button" class="btn" data-accion="copiar-enlace">Copiar enlace</button>
        <a class="btn" href="${wa}" target="_blank" rel="noopener">Enviar por WhatsApp</a>
        <a class="btn" href="${mail}">Enviar por correo</a>
      </div>`;
  }

  return `
    <section class="det-seccion">
      <h3>Enviar al cliente</h3>
      <p>${c.enviada_en
        ? `Lista para el cliente desde el ${fechaHora(c.enviada_en)}. El enlace siempre muestra la versión guardada más reciente; si hiciste cambios importantes, vuelve a avisarle.`
        : "Cuando el itinerario y los precios estén listos y guardados, prepárala para el cliente. Obtendrás un enlace donde él puede revisarla y marcar CONFIRMAR."}</p>
      <button type="button" class="btn primario" data-accion="enviar">${c.enviada_en ? "Actualizar envío" : "Preparar para el cliente"}</button>
      ${compartir}
      <div class="confirmar-manual">
        <p>Si el cliente aceptó por teléfono o WhatsApp, puedes confirmarla en su nombre.</p>
        <button type="button" class="btn" data-accion="confirmar-cliente">Confirmar en nombre del cliente</button>
      </div>
    </section>`;
}

function htmlPagos(c, editable) {
  const pagos = app.actual.pagos;
  const filas = pagos.map((p) => `
    <tr>
      <td>${fecha(p.fecha, { day: "numeric", month: "short", year: "numeric" })}</td>
      <td>${escapar(p.metodo ?? "")}</td>
      <td>${escapar(p.referencia ?? "")}</td>
      <td class="num">${dinero(p.monto)}</td>
      ${editable ? `<td><button type="button" class="enlace peligro" data-accion="eliminar-pago" data-id="${p.id}">Eliminar</button></td>` : ""}
    </tr>`).join("");

  return `
    <section class="det-seccion">
      <h3>Pagos</h3>
      ${editable ? `
        <div class="fila-form">
          <label>Prepago a solicitar <input id="prepago" type="number" min="0" step="0.01" value="${Number(c.prepago_solicitado) || 0}"></label>
          <button type="button" class="btn" data-accion="guardar-prepago">Guardar monto</button>
        </div>` : ""}
      ${pagos.length ? `
        <div class="tabla-scroll">
          <table class="tabla">
            <thead><tr><th>Fecha</th><th>Método</th><th>Referencia</th><th class="num">Monto</th>${editable ? "<th></th>" : ""}</tr></thead>
            <tbody>${filas}</tbody>
          </table>
        </div>` : `<p class="nota">Todavía no hay pagos registrados.</p>`}
      ${editable ? `
        <h4>Registrar un pago</h4>
        <div class="fila-form">
          <label>Monto <input id="pagoMonto" type="number" min="0" step="0.01"></label>
          <label>Fecha <input id="pagoFecha" type="date" value="${aTexto(new Date())}"></label>
          <label>Método
            <select id="pagoMetodo">${METODOS_PAGO.map((m) => `<option>${m}</option>`).join("")}</select>
          </label>
          <label>Referencia <input id="pagoReferencia" type="text" placeholder="Número de comprobante"></label>
          <button type="button" class="btn primario" data-accion="registrar-pago">Registrar pago</button>
        </div>` : ""}
    </section>`;
}

function htmlReabrir() {
  return `
    <section class="det-seccion">
      <h3>Reserva finalizada</h3>
      ${esAutorizado()
        ? `<p>Puedes reabrirla para hacer revisiones. Volverá a la columna Reserva y quedará registrado en el historial.</p>
           <button type="button" class="btn" data-accion="reabrir">Reabrir reserva</button>`
        : `<p class="nota">Tu usuario no tiene autorización para reabrir reservas finalizadas.</p>`}
    </section>`;
}

function htmlNotas(c, editable) {
  return `
    <section class="det-seccion">
      <h3>Notas internas</h3>
      <p class="nota">El cliente no ve estas notas.</p>
      <textarea id="notasInternas" ${editable ? "" : "readonly"}>${escapar(c.notas ?? "")}</textarea>
      ${editable ? `<div class="sec-botones"><button type="button" class="btn" data-accion="guardar-notas">Guardar notas</button></div>` : ""}
    </section>`;
}

function htmlHistorial(bitacora) {
  if (!bitacora.length) return "";
  return `
    <section class="det-seccion">
      <h3>Historial</h3>
      <ul class="historial">
        ${bitacora.map((b) => `
          <li>
            <time>${fechaHora(b.creado_en)}</time>
            <strong>${escapar(b.accion)}</strong>${b.detalle ? `: ${escapar(b.detalle)}` : ""}
            ${b.usuario_id ? `<span class="nota">(${escapar(nombrePerfil(b.usuario_id))})</span>` : ""}
          </li>`).join("")}
      </ul>
    </section>`;
}

// =====================================================
// DETALLE: EDICIÓN DE ACTIVIDADES
// =====================================================
function leerTarjeta(card) {
  const previa = app.actual.actividades[Number(card.dataset.idx)];
  const v = (campo) => {
    const el = card.querySelector(`[data-campo="${campo}"]`);
    return el ? el.value : (previa[campo] ?? "");
  };
  return {
    ...previa,
    servicio_id: v("servicio_id") ? Number(v("servicio_id")) : null,
    fecha: v("fecha"),
    hora_inicio: v("hora_inicio"),
    hora_fin: v("hora_fin"),
    lugar_recogida: v("lugar_recogida"),
    lugar_dejada: v("lugar_dejada"),
    hora_recogida: v("hora_recogida"),
    transporte_modo: v("transporte_modo") || "opcional",
    transporte_costo: Math.max(0, parseFloat(v("transporte_costo")) || 0),
    transporte_respuesta: v("transporte_respuesta"),
    transporte_neto: Math.max(0, parseFloat(v("transporte_neto")) || 0),
    operador_id: v("operador_id") ? Number(v("operador_id")) : null,
    notas: v("notas"),
    participantes: [...card.querySelectorAll("tr[data-cat]")].map((tr) => ({
      categoria_id: Number(tr.dataset.cat),
      cantidad: Math.max(0, parseInt(tr.querySelector('[data-p="cantidad"]').value, 10) || 0),
      precio_unitario: Math.max(0, parseFloat(tr.querySelector('[data-p="precio"]').value) || 0),
      neto_unitario: tr.querySelector('[data-p="neto"]')
        ? Math.max(0, parseFloat(tr.querySelector('[data-p="neto"]').value) || 0)
        : (previa.participantes.find((p) => p.categoria_id === Number(tr.dataset.cat))?.neto_unitario ?? 0)
    }))
  };
}

function sincronizar() {
  if (!app.actual) return;
  document.querySelectorAll(".actividad[data-idx]").forEach((card) => {
    app.actual.actividades[Number(card.dataset.idx)] = leerTarjeta(card);
  });
}

function repintarTarjeta(idx) {
  const card = document.querySelector(`.actividad[data-idx="${idx}"]`);
  if (card) card.outerHTML = htmlActividad(app.actual.actividades[idx], idx);
}

function marcarPendiente(card) {
  const idx = Number(card.dataset.idx);
  const a = leerTarjeta(card);
  a._pendiente = true;
  app.actual.actividades[idx] = a;
  card.classList.add("pendiente");
  card.querySelector(".act-estado").textContent = "Cambios sin guardar";
  card.querySelectorAll("tr[data-cat]").forEach((tr, i) => {
    const p = a.participantes[i];
    tr.querySelector(".celda-subtotal").textContent = dinero(p.cantidad * p.precio_unitario);
  });
  card.querySelector(".act-subtotal").textContent = dinero(subtotal(a));
  pintarTotales();
}

function nuevaActividad(servicioId = null, fechaActividad = "") {
  const c = app.actual.cot;
  const serv = servicioPorId(servicioId);
  const participantes = [];
  const agregar = (nombre, cantidad) => {
    const cat = categoriaPorNombre(nombre);
    if (cat && cantidad > 0) {
      participantes.push({
        categoria_id: cat.id,
        cantidad,
        precio_unitario: servicioId ? precioBase(servicioId, cat.id) : 0,
        neto_unitario: servicioId ? netoBase(servicioId, cat.id) : 0
      });
    }
  };
  agregar("Adulto", c.adultos);
  agregar("Niño", c.ninos);
  agregar("Menor de 6 años", c.menores);

  const inicio = serv?.horarios?.length ? hora(serv.horarios[0]) : "";
  return {
    id: null,
    servicio_id: servicioId,
    fecha: fechaActividad || c.fecha_inicio,
    hora_inicio: inicio,
    hora_fin: sumarMinutos(inicio, serv?.duracion_min),
    lugar_recogida: nombrePropiedad(c),
    lugar_dejada: nombrePropiedad(c),
    hora_recogida: "",
    transporte_modo: serv?.transporte || "opcional",
    transporte_costo: 0,
    transporte_respuesta: "",
    transporte_neto: 0,
    operador_id: serv?.operador_id ?? null,
    notas: "",
    participantes,
    _pendiente: true
  };
}

async function guardarTodo(btn) {
  sincronizar();
  const pendientes = app.actual.actividades.filter((a) => a._pendiente);
  if (!pendientes.length) return avisar("No hay cambios por guardar.");
  if (pendientes.some((a) => !a.servicio_id || !a.fecha)) {
    return avisar("Cada actividad necesita un servicio y una fecha.", "error");
  }

  const c = app.actual.cot;
  await conBoton(btn, async () => {
    try {
      for (const a of pendientes) {
        const fila = {
          cotizacion_id: c.id,
          servicio_id: a.servicio_id,
          fecha: a.fecha,
          hora_inicio: a.hora_inicio || null,
          hora_fin: a.hora_fin || null,
          lugar_recogida: a.lugar_recogida || null,
          lugar_dejada: a.lugar_dejada || null,
          hora_recogida: a.hora_recogida || null,
          transporte_modo: a.transporte_modo,
          transporte_costo: a.transporte_modo === "opcional" ? a.transporte_costo : 0,
          transporte_respuesta: a.transporte_respuesta === "si" ? true : a.transporte_respuesta === "no" ? false : null,
          transporte_neto: a.transporte_modo === "sin_transporte" ? 0 : a.transporte_neto,
          operador_id: a.operador_id || null,
          notas: a.notas || null
        };
        if (a.id) {
          const { error } = await db.from("actividades").update(fila).eq("id", a.id);
          if (error) throw error;
        } else {
          const { data, error } = await db.from("actividades").insert(fila).select("id").single();
          if (error) throw error;
          a.id = data.id;
        }

        let r = await db.from("actividad_participantes").delete().eq("actividad_id", a.id);
        if (r.error) throw r.error;
        const filas = a.participantes.filter((p) => p.cantidad > 0).map((p) => ({
          actividad_id: a.id, categoria_id: p.categoria_id, cantidad: p.cantidad,
          precio_unitario: p.precio_unitario, neto_unitario: p.neto_unitario || 0
        }));
        if (filas.length) {
          r = await db.from("actividad_participantes").insert(filas);
          if (r.error) throw r.error;
        }
        a._pendiente = false;
      }
      avisar("Cambios guardados.");
      await recargarDetalle(false);
      cargarTablero();
    } catch (error) {
      fallo(error);
      pintarDetalle();
    }
  });
}

// ---------- Eventos dentro de las tarjetas ----------
$("detalleContenido").addEventListener("input", (e) => {
  const card = e.target.closest(".actividad");
  if (!card || e.target.dataset.accion === "agregar-cat") return;

  if (e.target.dataset.campo === "hora_inicio") {
    const serv = servicioPorId(card.querySelector('[data-campo="servicio_id"]').value);
    if (serv?.duracion_min && e.target.value) {
      card.querySelector('[data-campo="hora_fin"]').value = sumarMinutos(e.target.value, serv.duracion_min);
    }
  }
  marcarPendiente(card);
});

$("detalleContenido").addEventListener("change", async (e) => {
  const card = e.target.closest(".actividad");
  if (!card) return;
  const idx = Number(card.dataset.idx);

  if (e.target.dataset.campo === "servicio_id") {
    const a = leerTarjeta(card);
    a._pendiente = true;
    const serv = servicioPorId(a.servicio_id);
    if (serv) {
      a.participantes.forEach((p) => {
        const base = precioBase(serv.id, p.categoria_id);
        if (base) p.precio_unitario = base;
        p.neto_unitario = netoBase(serv.id, p.categoria_id);
      });
      a.operador_id = serv.operador_id ?? null;
      if (serv.horarios?.length) a.hora_inicio = hora(serv.horarios[0]);
      if (a.hora_inicio && serv.duracion_min) a.hora_fin = sumarMinutos(a.hora_inicio, serv.duracion_min);
      if (serv.transporte) a.transporte_modo = serv.transporte;
    }
    app.actual.actividades[idx] = a;
    repintarTarjeta(idx);
    pintarTotales();
  }

  if (e.target.dataset.campo === "transporte_modo") {
    const a = leerTarjeta(card);
    a._pendiente = true;
    app.actual.actividades[idx] = a;
    repintarTarjeta(idx);
    pintarTotales();
    return;
  }

  if (e.target.dataset.accion === "agregar-cat") {
    const valor = e.target.value;
    if (!valor) return;
    const a = leerTarjeta(card);
    let categoriaId = Number(valor);

    if (valor === "nueva") {
      const nombre = prompt("Nombre del nuevo tipo de cliente (por ejemplo: Estudiante con carné):")?.trim();
      if (!nombre) { e.target.value = ""; return; }
      const orden = Math.max(0, ...app.categorias.map((c) => c.orden)) + 1;
      const { data, error } = await db.from("categorias_cliente").insert({ nombre, orden }).select().single();
      if (error) { e.target.value = ""; return fallo(error, "No se pudo crear el tipo de cliente."); }
      app.categorias.push(data);
      categoriaId = data.id;
    }

    a.participantes.push({
      categoria_id: categoriaId,
      cantidad: 1,
      precio_unitario: a.servicio_id ? precioBase(a.servicio_id, categoriaId) : 0,
      neto_unitario: a.servicio_id ? netoBase(a.servicio_id, categoriaId) : 0
    });
    a._pendiente = true;
    app.actual.actividades[idx] = a;
    repintarTarjeta(idx);
    pintarTotales();
  }
});

// ---------- Botones del detalle ----------
$("detalleContenido").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-accion]");
  if (!btn || btn.tagName === "SELECT") return;
  const c = app.actual.cot;
  const card = btn.closest(".actividad");

  switch (btn.dataset.accion) {
    case "cerrar":
      cerrarDetalle();
      break;

    case "imprimir":
      imprimirDetalle();
      break;

    case "atender":
      await conBoton(btn, async () => {
        const { error } = await db.from("cotizaciones").update({ estado: "proceso", colaborador_id: app.yo.id }).eq("id", c.id);
        if (error) return fallo(error);
        await registrar(c.id, "pasó a proceso", `Atendida por ${app.yo.nombre}`);
        await recargarDetalle(false);
        cargarTablero();
      });
      break;

    case "agregar-actividad":
      sincronizar();
      app.actual.actividades.push(nuevaActividad());
      pintarDetalle();
      document.querySelector(".actividad:last-of-type")?.scrollIntoView({ behavior: "smooth", block: "center" });
      break;

    case "cargar-solicitud": {
      sincronizar();
      const acts = app.actual.actividades;
      const nuevas = app.actual.solicitudes.filter((s) =>
        !acts.some((a) => a.servicio_id === s.servicio_id && a.fecha === s.fecha));
      if (!nuevas.length) return avisar("Todo lo que pidió el cliente ya está en el itinerario.");
      nuevas.forEach((s) => acts.push(nuevaActividad(s.servicio_id, s.fecha)));
      acts.sort(ordenActividad);
      pintarDetalle();
      avisar(`Se agregaron ${nuevas.length} actividades. Revisa horarios y precios, y presiona Guardar cambios.`);
      break;
    }

    case "quitar-cat": {
      const idx = Number(card.dataset.idx);
      const a = leerTarjeta(card);
      a.participantes = a.participantes.filter((p) => p.categoria_id !== Number(btn.dataset.cat));
      a._pendiente = true;
      app.actual.actividades[idx] = a;
      repintarTarjeta(idx);
      pintarTotales();
      break;
    }

    case "eliminar-act": {
      sincronizar();
      const idx = Number(card.dataset.idx);
      const a = app.actual.actividades[idx];
      if (!confirm("¿Eliminar esta actividad del itinerario?")) return;
      if (a.id) {
        const { error } = await db.from("actividades").delete().eq("id", a.id);
        if (error) return fallo(error, "No se pudo eliminar.");
      }
      app.actual.actividades.splice(idx, 1);
      pintarDetalle();
      cargarTablero();
      break;
    }

    case "guardar-todo":
      await guardarTodo(btn);
      break;

    case "enviar":
      if (hayPendientes()) return avisar("Guarda los cambios del itinerario antes de enviarlo.", "error");
      if (!app.actual.actividades.some((a) => a.id)) return avisar("Agrega y guarda al menos una actividad.", "error");
      await conBoton(btn, async () => {
        const { error } = await db.from("cotizaciones")
          .update({ enviada_en: new Date().toISOString(), cambios_pendientes: false }).eq("id", c.id);
        if (error) return fallo(error);
        await registrar(c.id, "preparada para el cliente");
        await recargarDetalle(false);
        cargarTablero();
        avisar("Lista. Comparte el enlace por WhatsApp o correo.");
      });
      break;

    case "copiar-enlace":
      try {
        await navigator.clipboard.writeText(enlaceCliente(c));
        avisar("Enlace copiado.");
      } catch {
        avisar("No se pudo copiar automáticamente. Selecciona el enlace y cópialo.", "error");
      }
      break;

    case "confirmar-cliente":
      if (hayPendientes()) return avisar("Guarda los cambios del itinerario antes de confirmar.", "error");
      if (!app.actual.actividades.length) return avisar("La cotización no tiene actividades.", "error");
      if (app.actual.actividades.some(transportePendiente)) {
        return avisar("Falta la respuesta del cliente sobre el transporte en alguna actividad. Anótala en la sección Transporte y guarda.", "error");
      }
      if (!confirm("¿Confirmar esta cotización en nombre del cliente? Pasará a Reserva.")) return;
      await conBoton(btn, async () => {
        const { error } = await db.from("cotizaciones")
          .update({ estado: "reserva", confirmada_en: new Date().toISOString() }).eq("id", c.id);
        if (error) return fallo(error);
        await registrar(c.id, "confirmada", `Confirmada por ${app.yo.nombre} en nombre del cliente`);
        await recargarDetalle(false);
        cargarTablero();
      });
      break;

    case "revisado":
      await conBoton(btn, async () => {
        const { error } = await db.from("cotizaciones").update({ cambios_pendientes: false }).eq("id", c.id);
        if (error) return fallo(error);
        await recargarDetalle();
        cargarTablero();
      });
      break;

    case "guardar-prepago": {
      const monto = Math.max(0, parseFloat($("prepago").value) || 0);
      await conBoton(btn, async () => {
        const { error } = await db.from("cotizaciones").update({ prepago_solicitado: monto }).eq("id", c.id);
        if (error) return fallo(error);
        await registrar(c.id, "prepago solicitado", dinero(monto));
        await recargarDetalle();
        avisar("Monto del prepago guardado.");
      });
      break;
    }

    case "registrar-pago": {
      const monto = parseFloat($("pagoMonto").value);
      if (!(monto > 0)) return avisar("Escribe un monto mayor que cero.", "error");
      await conBoton(btn, async () => {
        const { error } = await db.from("pagos").insert({
          cotizacion_id: c.id,
          monto,
          fecha: $("pagoFecha").value || aTexto(new Date()),
          metodo: $("pagoMetodo").value,
          referencia: $("pagoReferencia").value.trim() || null
        });
        if (error) return fallo(error);
        await registrar(c.id, "pago registrado", `${dinero(monto)} (${$("pagoMetodo").value})`);
        await recargarDetalle();
        cargarTablero();
        avisar("Pago registrado.");
      });
      break;
    }

    case "eliminar-pago":
      if (!confirm("¿Eliminar este pago?")) return;
      await conBoton(btn, async () => {
        const { error } = await db.from("pagos").delete().eq("id", Number(btn.dataset.id));
        if (error) return fallo(error);
        await registrar(c.id, "pago eliminado");
        await recargarDetalle();
        cargarTablero();
      });
      break;

    case "reabrir":
      if (!confirm("¿Reabrir esta reserva? Volverá a la columna Reserva.")) return;
      await conBoton(btn, async () => {
        const { error } = await db.from("cotizaciones").update({ estado: "reserva" }).eq("id", c.id);
        if (error) return fallo(error, "No se pudo reabrir.");
        await recargarDetalle(false);
        cargarTablero();
      });
      break;

    case "editar-cliente":
      sincronizar();
      app.editandoCliente = true;
      pintarDetalle();
      break;

    case "cancelar-cliente":
      sincronizar();
      app.editandoCliente = false;
      pintarDetalle();
      break;

    case "guardar-cliente": {
      const prop = $("cliPropiedad").value;
      const datos = {
        nombre: $("cliNombre").value.trim(),
        apellido: $("cliApellido").value.trim(),
        correo: $("cliCorreo").value.trim().toLowerCase(),
        telefono: $("cliTelefono").value.trim(),
        fecha_inicio: $("cliInicio").value,
        fecha_fin: $("cliFin").value,
        propiedad_id: prop === "otro" ? null : Number(prop),
        propiedad_otro: prop === "otro" ? $("cliOtro").value.trim() : null,
        adultos: Math.max(1, parseInt($("cliAdultos").value, 10) || 1),
        ninos: Math.max(0, parseInt($("cliNinos").value, 10) || 0),
        menores: Math.max(0, parseInt($("cliMenores").value, 10) || 0)
      };
      if (!datos.nombre || !datos.apellido || !datos.correo || !datos.telefono) {
        return avisar("Nombre, apellido, correo y teléfono son obligatorios.", "error");
      }
      if (!datos.fecha_inicio || !datos.fecha_fin || datos.fecha_fin < datos.fecha_inicio) {
        return avisar("Revisa las fechas del viaje.", "error");
      }
      if (prop === "otro" && !datos.propiedad_otro) return avisar("Escribe el lugar de hospedaje.", "error");

      await conBoton(btn, async () => {
        const { error } = await db.from("cotizaciones").update(datos).eq("id", c.id);
        if (error) return fallo(error);
        await registrar(c.id, "datos del cliente modificados");
        app.editandoCliente = false;
        await recargarDetalle();
        cargarTablero();
        avisar("Datos del cliente guardados.");
      });
      break;
    }

    case "guardar-notas":
      await conBoton(btn, async () => {
        const { error } = await db.from("cotizaciones").update({ notas: $("notasInternas").value.trim() || null }).eq("id", c.id);
        if (error) return fallo(error);
        await recargarDetalle();
        avisar("Notas guardadas.");
      });
      break;
  }
});

// =====================================================
// IMPRESIÓN (TAMAÑO CARTA)
// =====================================================
function imprimirDetalle() {
  sincronizar();
  const { cot: c, actividades, pagos, solicitudes } = app.actual;
  const acts = [...actividades].sort(ordenActividad);
  const total = acts.reduce((s, a) => s + subtotal(a), 0);
  const pagado = pagos.reduce((s, p) => s + Number(p.monto), 0);
  const esReserva = c.estado === "reserva" || c.estado === "finalizado";

  let cuerpo;
  if (acts.length) {
    cuerpo = tablaItinerario(acts) + `
      <div class="imp-totales">
        <p><span>Total</span><strong>${dinero(total)}</strong></p>
        ${esReserva ? `
          <p><span>Prepago solicitado</span><span>${dinero(c.prepago_solicitado)}</span></p>
          <p><span>Pagado</span><span>${dinero(pagado)}</span></p>
          <p><span>Balance</span><strong>${dinero(total - pagado)}</strong></p>` : ""}
      </div>`;
  } else {
    const porDia = {};
    solicitudes.forEach((s) => (porDia[s.fecha] ||= []).push(servicioPorId(s.servicio_id)?.nombre ?? ""));
    cuerpo = `<h3>Servicios solicitados</h3>` + Object.keys(porDia).sort().map((f) =>
      `<p><strong>${escapar(fechaLarga(f))}:</strong> ${porDia[f].map(escapar).join(", ")}</p>`).join("");
  }

  $("impresion").innerHTML = `
    <div class="imp-cabeza">
      <p class="imp-marca">The House of Tours</p>
      <p class="imp-titulo">${esReserva ? "Reserva" : "Cotización"} ${c.numero}</p>
    </div>
    <dl class="imp-datos">
      <div><dt>Cliente</dt><dd>${escapar(nombreCompleto(c))}</dd></div>
      <div><dt>Correo</dt><dd>${escapar(c.correo)}</dd></div>
      <div><dt>Teléfono</dt><dd>${escapar(c.telefono)}</dd></div>
      <div><dt>Hospedaje</dt><dd>${escapar(nombrePropiedad(c))}</dd></div>
      <div><dt>Fechas</dt><dd>${fecha(c.fecha_inicio)} al ${fecha(c.fecha_fin, { day: "numeric", month: "short", year: "numeric" })}</dd></div>
      <div><dt>Personas</dt><dd>${personas(c)}</dd></div>
    </dl>
    ${cuerpo}
    <p class="imp-pie">Impreso el ${fechaHora(new Date())} por ${escapar(app.yo.nombre)}</p>`;

  document.body.classList.add("imprimiendo");
  window.print();
}
window.addEventListener("afterprint", () => document.body.classList.remove("imprimiendo"));

// =====================================================
// ARRANQUE
// =====================================================
db.auth.onAuthStateChange((evento) => {
  if (evento === "SIGNED_OUT") mostrarLogin();
});

(async () => {
  const { data } = await db.auth.getSession();
  if (data.session) await entrar();
  else mostrarLogin();
})();
