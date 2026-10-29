// =====================================================
// PANEL DE RESERVAS - COLABORADORES
// =====================================================

const $ = (id) => document.getElementById(id);
const db = supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey);

const COLUMNAS = [
  { id: "cotizacion", nombre: "Cotizaciones", vacio: "No hay solicitudes nuevas." },
  { id: "proceso", nombre: "Proceso", vacio: "No hay cotizaciones en proceso." },
  { id: "reserva", nombre: "Reserva", vacio: "No hay reservas activas." },
  { id: "finalizado", nombre: "Finalizado", vacio: "No hay reservas finalizadas recientes." },
  { id: "cancelado", nombre: "Canceladas", vacio: "No hay cancelaciones recientes." }
];
const NOMBRE_ESTADO = { cotizacion: "Cotización", proceso: "Proceso", reserva: "Reserva", finalizado: "Finalizado", cancelado: "Cancelada" };
const MOTIVOS_CANCELACION = [
  "El cliente no respondió", "El cliente desistió", "Sin disponibilidad",
  "Precio", "Solicitud duplicada", "Otro"
];
const ROLES_AUTORIZADOS = ["administrador", "gerente", "jefatura"];
const METODOS_PAGO = ["Transferencia", "SINPE Móvil", "Tarjeta", "Efectivo", "Otro"];
const NOMBRE_IDIOMA = { es: "Español", en: "Inglés", fr: "Francés", de: "Alemán", it: "Italiano" };

// Mensajes que se envían al cliente, en su idioma
const MENSAJES = {
  es: {
    cot_asunto: (c) => `Tu cotización ${c.numero} | The House of Tours`,
    cot: (c, link) => `Hola ${c.nombre}, te enviamos tu cotización ${c.numero} de The House of Tours. Puedes revisarla y confirmarla aquí: ${link}`,
    res_asunto: (c) => `Confirmación de tu reserva ${c.numero} | The House of Tours`,
    res: (c, link, firma) =>
      `Hola ${c.nombre}:\n\nTu reserva ${c.numero} con The House of Tours está confirmada. ` +
      `En este enlace puedes ver tu itinerario completo, lo pagado y el saldo pendiente:\n\n${link}\n\n` +
      `Si necesitas cambiar algo, responde a este mensaje y con gusto te ayudamos.\n\nSaludos,\n${firma}\nThe House of Tours`
  },
  en: {
    cot_asunto: (c) => `Your quote ${c.numero} | The House of Tours`,
    cot: (c, link) => `Hi ${c.nombre}, here is your quote ${c.numero} from The House of Tours. You can review and confirm it here: ${link}`,
    res_asunto: (c) => `Your booking confirmation ${c.numero} | The House of Tours`,
    res: (c, link, firma) =>
      `Hi ${c.nombre},\n\nYour booking ${c.numero} with The House of Tours is confirmed. ` +
      `At this link you can see your full itinerary, the amount paid and the balance due:\n\n${link}\n\n` +
      `If you need to change anything, just reply to this message and we'll be happy to help.\n\nBest regards,\n${firma}\nThe House of Tours`
  },
  fr: {
    cot_asunto: (c) => `Votre devis ${c.numero} | The House of Tours`,
    cot: (c, link) => `Bonjour ${c.nombre}, voici votre devis ${c.numero} de The House of Tours. Vous pouvez le consulter et le confirmer ici : ${link}`,
    res_asunto: (c) => `Confirmation de votre réservation ${c.numero} | The House of Tours`,
    res: (c, link, firma) =>
      `Bonjour ${c.nombre},\n\nVotre réservation ${c.numero} avec The House of Tours est confirmée. ` +
      `Ce lien vous permet de consulter votre itinéraire complet, le montant payé et le solde restant :\n\n${link}\n\n` +
      `Si vous souhaitez modifier quelque chose, répondez simplement à ce message et nous vous aiderons avec plaisir.\n\nCordialement,\n${firma}\nThe House of Tours`
  },
  de: {
    cot_asunto: (c) => `Ihr Angebot ${c.numero} | The House of Tours`,
    cot: (c, link) => `Hallo ${c.nombre}, anbei Ihr Angebot ${c.numero} von The House of Tours. Hier können Sie es prüfen und bestätigen: ${link}`,
    res_asunto: (c) => `Bestätigung Ihrer Buchung ${c.numero} | The House of Tours`,
    res: (c, link, firma) =>
      `Hallo ${c.nombre},\n\nIhre Buchung ${c.numero} bei The House of Tours ist bestätigt. ` +
      `Unter diesem Link finden Sie Ihre vollständige Reiseroute, den bezahlten Betrag und den offenen Restbetrag:\n\n${link}\n\n` +
      `Wenn Sie etwas ändern möchten, antworten Sie einfach auf diese Nachricht – wir helfen Ihnen gerne.\n\nViele Grüße\n${firma}\nThe House of Tours`
  },
  it: {
    cot_asunto: (c) => `Il tuo preventivo ${c.numero} | The House of Tours`,
    cot: (c, link) => `Ciao ${c.nombre}, ecco il tuo preventivo ${c.numero} di The House of Tours. Puoi consultarlo e confermarlo qui: ${link}`,
    res_asunto: (c) => `Conferma della tua prenotazione ${c.numero} | The House of Tours`,
    res: (c, link, firma) =>
      `Ciao ${c.nombre},\n\nla tua prenotazione ${c.numero} con The House of Tours è confermata. ` +
      `A questo link puoi vedere il tuo itinerario completo, l'importo pagato e il saldo da versare:\n\n${link}\n\n` +
      `Se desideri modificare qualcosa, rispondi a questo messaggio e saremo felici di aiutarti.\n\nCordiali saluti,\n${firma}\nThe House of Tours`
  }
};
const mensajes = (c) => MENSAJES[c.idioma] || MENSAJES.es;
const MODOS_TRANSPORTE = {
  incluido: "Incluido en el servicio",
  opcional: "Opcional (se consulta al cliente)",
  sin_transporte: "Sin transporte"
};

const app = {
  yo: null,
  cotizaciones: [],
  servicios: [], tipos: [], propiedades: [], categorias: [], perfiles: [], operadores: [],
  permisos: new Set(),
  verCanceladas: false,
  actualizando: false,
  actual: null,            // { cot, solicitudes, actividades, pagos, bitacora }
  tarifas: new Map(),      // "servicio|fecha" → tarifa de la temporada (TC, Cash y neto por tipo de cliente) y otros proveedores
  codigos: [],             // códigos de reserva (R00001…) para buscar en el tablero
  codigosP: [],            // solicitudes al proveedor (P00001…) para buscar en el tablero
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

// Lista de servicios agrupada por tipo de actividad (para los <select>)
function opcionesServicios(seleccionado) {
  const opcion = (s) => `<option value="${s.id}" ${s.id === seleccionado ? "selected" : ""}>${escapar(s.nombre)}</option>`;
  const usables = app.servicios.filter((s) => s.activo || s.id === seleccionado);
  const grupos = app.tipos
    .map((tp) => ({ tp, lista: usables.filter((s) => s.tipo_id === tp.id) }))
    .filter((g) => g.lista.length)
    .map((g) => `<optgroup label="${escapar(`${g.tp.icono ? g.tp.icono + " " : ""}${g.tp.nombre}`)}">${g.lista.map(opcion).join("")}</optgroup>`);
  const sinTipo = usables.filter((s) => !app.tipos.some((tp) => tp.id === s.tipo_id));
  if (sinTipo.length) grupos.push(grupos.length ? `<optgroup label="Sin tipo">${sinTipo.map(opcion).join("")}</optgroup>` : sinTipo.map(opcion).join(""));
  return grupos.join("");
}

// Los precios salen solo del Tarifario (tarifa de la temporada). Sin tarifa, el precio empieza en 0
// y el agente lo escribe (tarifa Manual).
const precioBase = () => 0;
const netoBase = () => 0;
// =====================================================
// TARIFAS DEL TARIFARIO SEGÚN LA FECHA DE LA ACTIVIDAD
// Precio TC o Cash de la temporada que cubre la fecha, neto del operador con IVA (en dólares)
// y los otros proveedores de la misma actividad. Si no hay tarifa: "tarifa pendiente".
// =====================================================
const TARIFA_TIPOS = { tc: "TC", cash: "Cash", manual: "Manual", pendiente: "Tarifa pendiente" };
const claveTarifa = (servicioId, f) => `${Number(servicioId)}|${f}`;
const tarifaDe = (a) => (a?.servicio_id && a.fecha ? app.tarifas.get(claveTarifa(a.servicio_id, a.fecha)) : null);
const tienePrecios = (t) => !!t?.precios?.some((p) => p.tc != null);
const tieneCash = (t) => !!t?.precios?.some((p) => p.cash != null);
const precioTarifa = (t, categoriaId, tipo) => {
  const p = t?.precios?.find((x) => x.categoria_id === Number(categoriaId));
  return p ? (tipo === "cash" ? p.cash : p.tc) ?? null : null;
};
const netoTarifa = (t, categoriaId) => t?.precios?.find((x) => x.categoria_id === Number(categoriaId))?.neto ?? null;

async function cargarTarifas(lista) {
  const faltan = new Map();
  lista.forEach((x) => {
    const k = x.servicio_id && x.fecha ? claveTarifa(x.servicio_id, x.fecha) : null;
    if (k && !app.tarifas.has(k)) faltan.set(k, { servicio_id: Number(x.servicio_id), fecha: x.fecha });
  });
  if (!faltan.size) return;
  const { data, error } = await db.rpc("tarifas_actividades", { p_items: [...faltan.values()] });
  if (error) { console.error("Tarifas:", error); return; }   // sin tarifas se trabaja con precios manuales
  (data || []).forEach((t) => app.tarifas.set(claveTarifa(t.servicio_id, t.fecha), t));
}

// Pone en la actividad los precios de la temporada según el tipo de tarifa (TC, Cash o Manual).
// El neto siempre viene del tarifario. Sin tarifa para esa fecha queda como "tarifa pendiente".
function aplicarTarifa(a, tipo = a.tarifa_tipo) {
  const t = tarifaDe(a);
  if (!tienePrecios(t)) {
    if (tipo !== "manual") {
      a.tarifa_tipo = "pendiente";
      a.participantes.forEach((p) => { p.precio_unitario = 0; p.neto_unitario = 0; });
    }
    return a;
  }
  if (tipo === "pendiente") tipo = "tc";
  if (tipo === "cash" && !tieneCash(t)) tipo = "tc";
  a.tarifa_tipo = tipo;
  a.participantes.forEach((p) => {
    const neto = netoTarifa(t, p.categoria_id);
    if (neto != null) p.neto_unitario = neto;
    if (tipo !== "manual") {
      const precio = precioTarifa(t, p.categoria_id, tipo);
      p.precio_unitario = precio ?? 0;
    }
  });
  return a;
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

// Vuelve a leer el usuario y sus permisos (por si un administrador los cambió)
async function recargarPerfil() {
  const { data: { user } } = await db.auth.getUser();
  if (!user) { mostrarLogin(); return false; }

  const { data: perfil } = await db.from("perfiles").select("*").eq("id", user.id).maybeSingle();
  if (!perfil || !perfil.activo) {
    await db.auth.signOut();
    mostrarLogin("Tu usuario no tiene acceso al panel. Si crees que es un error, habla con un administrador.");
    return false;
  }

  const { data: permisos } = await db.from("permisos_rol").select("permiso, permitido").eq("rol", perfil.rol);
  app.yo = perfil;
  app.permisos = new Set((permisos || []).filter((p) => p.permitido).map((p) => p.permiso));
  $("usuarioNombre").textContent = `${perfil.nombre} (${perfil.rol})`;
  return true;
}

// Actualiza todo: usuario y permisos, reservas vencidas, catálogo y tablero.
// "silencioso" = actualización automática: no redibuja las secciones Servicios
// ni Mantenimiento, para no borrar un formulario que alguien esté llenando.
async function actualizarTodo(silencioso = false) {
  if (app.actualizando) return;
  app.actualizando = true;
  try {
    if (!(await recargarPerfil())) return;
    await db.rpc("finalizar_vencidas");
    await cargarCatalogos();
    await cargarTablero();
    document.dispatchEvent(new Event("tablero-actualizado"));
    if (!silencioso) document.dispatchEvent(new Event("datos-actualizados"));
  } finally {
    app.actualizando = false;
  }
}

async function entrar() {
  if (!(await recargarPerfil())) return;
  $("vistaLogin").hidden = true;
  $("vistaApp").hidden = false;

  await db.rpc("finalizar_vencidas");
  await cargarCatalogos();
  await cargarTablero();

  // Actualización automática cada minuto
  clearInterval(app.temporizador);
  app.temporizador = setInterval(() => actualizarTodo(true), 60000);
}

// Al volver a la pestaña del panel después de un rato, se actualiza de inmediato
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && app.yo && !$("vistaApp").hidden) actualizarTodo(true);
});

$("btnSalir").addEventListener("click", async () => {
  await db.auth.signOut();
  mostrarLogin();
});

// =====================================================
// CATÁLOGOS Y TABLERO
// =====================================================
async function cargarCatalogos() {
  const [s, p, c, pf, op, tp] = await Promise.all([
    db.from("servicios").select("*").order("nombre"),
    db.from("propiedades").select("*").order("nombre"),
    db.from("categorias_cliente").select("*").order("orden"),
    db.from("perfiles").select("id, nombre, rol"),
    db.from("operadores").select("*").order("nombre"),
    db.from("tipos_servicio").select("*").order("orden").order("nombre")
  ]);
  const error = s.error || p.error || c.error || pf.error || op.error || tp.error;
  if (error) return fallo(error, "No se pudieron cargar los catálogos.");
  app.operadores = op.data;
  app.tipos = tp.data;
  app.servicios = s.data;
  app.propiedades = p.data;
  app.categorias = c.data;
  app.perfiles = pf.data;
}

async function cargarTablero() {
  const d = new Date();
  d.setDate(d.getDate() - 90);

  const { data, error } = await db.from("resumen_cotizaciones")
    .select("id, numero, estado, nombre, apellido, fecha_inicio, fecha_fin, creado_en, colaborador_id, cambios_pendientes, enviada_en, total, balance, idioma, alerta_proveedor")
    .or(`and(estado.neq.finalizado,estado.neq.cancelado),fecha_fin.gte.${aTexto(d)}`)
    .order("creado_en", { ascending: true });

  if (error) return fallo(error, "No se pudo cargar el tablero.");
  app.cotizaciones = data;
  const limite = new Date(); limite.setDate(limite.getDate() + 3);
  const [cods, sols, prox] = await Promise.all([
    db.from("actividades").select("cotizacion_id, codigo_reserva").not("codigo_reserva", "is", null),
    db.from("solicitudes_proveedor").select("cotizacion_id, codigo, estado, aviso"),
    db.from("actividades").select("cotizacion_id, fecha, estado_servicio").lte("fecha", aTexto(limite)).gte("fecha", aTexto(new Date()))
  ]);
  app.codigos = cods.error ? [] : cods.data;
  app.codigosP = sols.error ? [] : sols.data;   // solicitudes al proveedor (P00001…)
  app.proximosSinConfirmar = prox.error ? [] : prox.data.filter((a) => !["confirmado", "cancelado"].includes(a.estado_servicio || "por_solicitar"));
  pintarTablero();
  $("ultimaActualizacion").textContent =
    `Actualizado a las ${new Date().toLocaleTimeString("es-CR", { hour: "2-digit", minute: "2-digit" })}`;
}

function pintarTablero() {
  const q = $("buscar").value.trim().toLowerCase();
  const lista = app.cotizaciones.filter((c) =>
    !q || nombreCompleto(c).toLowerCase().includes(q) || c.numero.toLowerCase().includes(q)
    || app.codigos.some((x) => x.cotizacion_id === c.id
      && (x.codigo_reserva.toLowerCase().includes(q) || `${c.numero}-${x.codigo_reserva}`.toLowerCase().includes(q)))
    || (app.codigosP || []).some((x) => x.cotizacion_id === c.id && x.codigo.toLowerCase().includes(q)));

  const columnas = COLUMNAS.filter((col) => col.id !== "cancelado" || app.verCanceladas);
  $("tablero").classList.toggle("con-canceladas", app.verCanceladas);

  $("tablero").innerHTML = columnas.map((col) => {
    let items = lista.filter((c) => c.estado === col.id);
    if (col.id === "finalizado" || col.id === "cancelado") items = items.sort((a, b) => b.fecha_fin.localeCompare(a.fecha_fin));

    return `
      <section class="columna col-${col.id}" aria-labelledby="t-${col.id}">
        <h2 id="t-${col.id}" class="col-titulo"><span>${col.nombre}</span><span class="col-cuenta">${items.length}</span></h2>
        ${items.length ? `<ul class="col-lista">${items.map(htmlItem).join("")}</ul>` : `<p class="col-vacia">${col.vacio}</p>`}
        ${col.id === "finalizado" || col.id === "cancelado" ? `<p class="col-nota">Se muestran las de los últimos 90 días.</p>` : ""}
      </section>`;
  }).join("");
}

function htmlItem(c) {
  const extra = [];
  if (c.idioma && c.idioma !== "es") extra.push(`<span class="etiqueta idioma" title="Idioma del cliente: ${NOMBRE_IDIOMA[c.idioma]}">${c.idioma.toUpperCase()}</span>`);
  if (c.cambios_pendientes) extra.push(`<span class="etiqueta alerta">Pidió cambios</span>`);
  if (c.alerta_proveedor === "urgente") extra.push(`<span class="etiqueta urgente">Proveedor: urgente</span>`);
  else if (c.alerta_proveedor) extra.push(`<span class="etiqueta alerta">Respuesta del proveedor</span>`);
  if (c.estado === "reserva") {
    const avisos = (app.codigosP || []).filter((x) => x.cotizacion_id === c.id && (x.aviso || x.estado === "borrador")).length;
    if (avisos) extra.push(`<span class="etiqueta alerta">${avisos} ${avisos === 1 ? "aviso pendiente" : "avisos pendientes"} a proveedores</span>`);
    if ((app.proximosSinConfirmar || []).some((a) => a.cotizacion_id === c.id)) extra.push(`<span class="etiqueta urgente">Servicio próximo sin confirmar</span>`);
  }
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
$("verCanceladas").addEventListener("change", (e) => {
  app.verCanceladas = e.target.checked;
  pintarTablero();
});
$("btnActualizar").addEventListener("click", (e) => conBoton(e.currentTarget, async () => {
  // Si hay una actualización automática en curso, espera a que termine
  while (app.actualizando) await new Promise((r) => setTimeout(r, 200));
  await actualizarTodo(false);
  if (app.yo && !$("vistaApp").hidden) avisar("Datos actualizados.");
}));

// ---------- Menú de secciones ----------
const VISTAS = { reservas: "vistaReservas", calendario: "vistaCalendario", servicios: "vistaServicios", mantenimiento: "vistaMantenimiento" };
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
    tarifa_tipo: a.tarifa_tipo || "manual",
    operador_confirmado: !!a.operador_confirmado,
    operador_confirmacion: a.operador_confirmacion ?? "",
    operador_confirmado_en: a.operador_confirmado_en ?? null,
    codigo_reserva: a.codigo_reserva ?? null,
    voucher_habilitado: !!a.voucher_habilitado,
    voucher_habilitado_en: a.voucher_habilitado_en ?? null,
    notas_proveedor: a.notas_proveedor ?? "",
    estado_servicio: a.estado_servicio || "por_solicitar",
    forma_pago: a.forma_pago || "prepago",
    pago_limite: a.pago_limite ?? "",
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
  const [c, s, a, p, b, m, sp] = await Promise.all([
    db.from("resumen_cotizaciones").select("*").eq("id", id).single(),
    db.from("solicitudes").select("*").eq("cotizacion_id", id).order("fecha"),
    db.from("actividades").select("*, actividad_participantes(*)").eq("cotizacion_id", id).order("fecha").order("hora_inicio"),
    db.from("pagos").select("*").eq("cotizacion_id", id).order("fecha"),
    db.from("bitacora").select("*").eq("cotizacion_id", id).order("creado_en", { ascending: false }),
    db.from("mensajes").select("*").eq("cotizacion_id", id).order("id"),
    db.from("solicitudes_proveedor").select("*").eq("cotizacion_id", id).order("id")
  ]);
  const error = c.error || s.error || a.error || p.error || b.error;
  if (error) { fallo(error, "No se pudo abrir la cotización."); return false; }

  app.actual = {
    cot: c.data,
    solicitudes: s.data,
    actividades: a.data.map(normalizarActividad),
    pagos: p.data,
    bitacora: b.data,
    mensajes: m.error ? [] : m.data,   // correos y preguntas al cliente (etapa 6)
    solicitudesP: sp.error ? [] : sp.data, // solicitudes al proveedor P00001… (etapa 8)
    eventosP: []
  };
  app.actual.aplicaciones = [];
  if (p.data.length) {
    const ap = await db.from("pago_aplicaciones").select("*").in("pago_id", p.data.map((x) => x.id));
    app.actual.aplicaciones = ap.error ? [] : ap.data;
  }
  if (app.actual.solicitudesP.length) {
    const ev = await db.from("solicitud_eventos").select("*").in("solicitud_id", app.actual.solicitudesP.map((x) => x.id)).order("id");
    app.actual.eventosP = ev.error ? [] : ev.data;
  }
  return true;
}

async function abrirDetalle(id) {
  app.editandoCliente = false;
  if (!(await cargarDetalle(id))) return;
  if (["cotizacion", "proceso", "reserva"].includes(app.actual.cot.estado)) {
    await cargarTarifas([...app.actual.actividades, ...app.actual.solicitudes]);
  }
  $("detalle").hidden = false;
  document.body.classList.add("detalle-abierto");
  pintarDetalle();
  $("detalleTitulo")?.focus();
  document.dispatchEvent(new Event("detalle-abierto"));
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
  document.dispatchEvent(new Event("detalle-cerrado"));
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
  if (c.alerta_proveedor && typeof htmlAlertaProveedor === "function") h += htmlAlertaProveedor(c);
  if (c.estado === "cancelado") h += htmlCancelada(c);
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
  if (c.estado === "finalizado" || c.estado === "cancelado") h += htmlActividadesLectura();
  if (c.estado !== "cotizacion") h += `<section class="det-seccion"><h3>Totales</h3><div id="totales"></div></section>`;
  if (c.estado === "proceso") h += htmlEnvio(c);
  if (c.estado === "reserva" && typeof htmlSolicitudes === "function") h += htmlSolicitudes(c);
  if (c.estado === "reserva") h += typeof htmlAvanceReserva === "function" ? htmlAvanceReserva(c) : htmlConfirmarReserva(c);
  if (c.estado === "reserva" && c.reserva_confirmada_en) h += htmlTiquetes(c);
  if (c.estado === "reserva") h += htmlCompartirReserva(c);
  if (["proceso", "reserva", "finalizado"].includes(c.estado) && typeof htmlCorreo === "function") h += htmlCorreo(c);
  if (c.estado === "reserva" || c.estado === "finalizado" || (c.estado === "cancelado" && app.actual.pagos.length)) {
    h += htmlPagos(c, c.estado === "reserva" && puede("registrar_pagos"));
  }
  if (c.estado === "finalizado") h += htmlReabrir();
  if (["cotizacion", "proceso", "reserva"].includes(c.estado)) h += htmlCancelar(c);
  h += htmlNotas(c, c.estado !== "finalizado");
  h += htmlHistorial(bitacora);

  $("detalleContenido").innerHTML = h;
  pintarTotales();
}

function htmlCambiosCliente(c, bitacora) {
  if (!c.cambios_pendientes) return "";
  const ultimo = bitacora.find((b) => b.accion === "comentario del cliente" || b.accion === "respuesta del cliente");
  return `
    <section class="det-seccion cambios">
      <h3>El cliente pidió cambios</h3>
      ${ultimo ? `${ultimo.accion === "respuesta del cliente" ? `<p class="nota">Respondió una pregunta:</p>` : ""}<p class="cita">${escapar(ultimo.detalle)}</p><p class="nota">Recibido el ${fechaHora(ultimo.creado_en)}</p>` : ""}
      <button type="button" class="btn" data-accion="revisado">Marcar como revisado</button>
    </section>`;
}

function htmlCliente(c) {
  const bloqueado = c.estado === "finalizado" || c.estado === "cancelado";

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
        <div><dt>Idioma del cliente</dt><dd>${bloqueado
          ? NOMBRE_IDIOMA[c.idioma] ?? "Español"
          : `<select id="cliIdioma" class="select-chico" aria-label="Idioma del cliente">
              ${Object.entries(NOMBRE_IDIOMA).map(([k, v]) => `<option value="${k}" ${k === (c.idioma || "es") ? "selected" : ""}>${v}</option>`).join("")}
            </select>`}</dd></div>
        <div><dt>Solicitud recibida</dt><dd>${fechaHora(c.creado_en)}</dd></div>
        <div><dt>Atiende</dt><dd>${escapar(nombrePerfil(c.colaborador_id)) || "Sin asignar"}</dd></div>
      </dl>
      ${bloqueado ? "" : `<p class="nota">El enlace del cliente y los mensajes de WhatsApp y correo salen en el idioma del cliente. Puedes cambiarlo si te conviene.</p>`}
    </section>`;
}

function htmlSolicitud(solicitudes) {
  if (!solicitudes.length) return "";
  const porDia = {};
  solicitudes.forEach((s) => {
    const t = tarifaDe(s);
    const pendiente = t && !tienePrecios(t);
    (porDia[s.fecha] ||= []).push(escapar(servicioPorId(s.servicio_id)?.nombre ?? "Servicio") + (pendiente ? ` <span class="act-sin-tarifa">tarifa pendiente</span>` : ""));
  });
  return `
    <section class="det-seccion">
      <h3>Lo que pidió el cliente</h3>
      ${Object.keys(porDia).sort().map((f) => `
        <div class="solicitud-dia">
          <span class="nota">${escapar(fecha(f, { weekday: "long", day: "numeric", month: "long" }))}</span>
          <span>${porDia[f].join(", ")}</span>
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
  const servicios = opcionesServicios(a.servicio_id);
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
  const cot = app.actual.cot;

  return `
    <article class="actividad${a._pendiente ? " pendiente" : ""}" data-idx="${idx}">
      <div class="act-cabeza">
        <p class="act-titulo">${escapar(serv?.nombre ?? "Actividad nueva")}
          ${a.codigo_reserva ? `<span class="act-codigo" title="Código de reserva">${escapar(cot.numero)}-${escapar(a.codigo_reserva)}</span>` : ""}
          ${a.operador_confirmado ? `<span class="act-confirmada">Confirmada con el operador</span>` : ""}
          ${a.tarifa_tipo === "pendiente" ? `<span class="act-sin-tarifa">Tarifa pendiente</span>` : ""}</p>
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
      ${htmlTarifa(a)}
      ${cot.estado === "reserva" ? htmlConfirmacionOperador(a) : ""}
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
      <label>Notas para el cliente (aparecen en el tiquete) <input data-campo="notas" type="text" value="${escapar(a.notas)}" placeholder="Ej.: llevar ropa cómoda, bloqueador y repelente"></label>
      <label>Notas para el proveedor (aparecen en la solicitud P) <input data-campo="notas_proveedor" type="text" value="${escapar(a.notas_proveedor)}" placeholder="Ej.: cliente vegetariano, llegan en carro propio"></label>
      <div class="fila-form act-pago">
        <label>Forma de pago acordada
          <select data-campo="forma_pago">
            <option value="prepago" ${a.forma_pago !== "oficina" ? "selected" : ""}>Prepago</option>
            <option value="oficina" ${a.forma_pago === "oficina" ? "selected" : ""}>Pago en oficina antes del tour</option>
          </select></label>
        <label>Fecha límite de pago (opcional) <input data-campo="pago_limite" type="date" value="${escapar(a.pago_limite || "")}"></label>
        ${a.id && (cot.estado === "reserva" || cot.estado === "finalizado") ? `<span class="nota">Pagado ${dinero(pagadoServicio(a))} · saldo ${dinero(Math.max(0, saldoServicio(a)))}</span>` : ""}
      </div>
    </article>`;
}

// Tarifa de la temporada: TC, Cash o Manual, y los otros proveedores de la misma actividad
function htmlTarifa(a) {
  if (!a.servicio_id) return "";
  const t = tarifaDe(a);
  const conPrecios = tienePrecios(t);
  const cash = tieneCash(t);
  const tipo = a.tarifa_tipo || "manual";
  const opciones = [
    ["tc", "TC (tarjeta)", !conPrecios],
    ["cash", cash ? "Cash" : "Cash (no la ofrece)", !conPrecios || !cash],
    ["manual", "Manual", false]
  ].map(([v, txt, off]) => `<option value="${v}" ${v === tipo ? "selected" : ""} ${off && v !== tipo ? "disabled" : ""}>${txt}</option>`).join("")
    + (tipo === "pendiente" ? `<option value="pendiente" selected>Tarifa pendiente</option>` : "");

  let info;
  if (!t) info = `<span class="nota">Consultando la tarifa…</span>`;
  else if (!t.tarifario) info = `<span class="act-aviso">Este servicio no viene del Tarifario: no tiene tarifa. Escribe el precio y deja la tarifa en Manual.</span>`;
  else if (!conPrecios) info = `<span class="act-aviso">No hay tarifa aprobada para el ${escapar(fecha(a.fecha, { day: "numeric", month: "long", year: "numeric" }))}: <strong>tarifa pendiente</strong>. Consulta el precio con el operador, escríbelo y elige Manual.</span>`;
  else {
    const temporadas = [...new Set(t.precios.map((p) => p.temporada).filter(Boolean))].join(", ");
    const lista = t.precios.map((p) => `${escapar(categoriaPorId(p.categoria_id)?.nombre ?? "")}: TC ${dinero(p.tc)}${p.cash != null ? ` · Cash ${dinero(p.cash)}` : ""}${puede("ver_utilidad") ? ` <span class="interno">neto ${dinero(p.neto)}</span>` : ""}`).join("<br>");
    info = `<span class="nota">Temporada ${escapar(temporadas)}${t.precios.some((p) => p.colones) ? " · tarifa en colones convertida a dólares" : ""}</span><br>${lista}`;
  }
  const alt = t?.alternativas || [];
  return `
    <div class="act-tarifa${tipo === "pendiente" ? " sin-tarifa" : ""}">
      <label>Tarifa <select data-campo="tarifa_tipo">${opciones}</select></label>
      <p class="act-tarifa-info">${info}</p>
      ${alt.length ? `
        <label>Cambiar de proveedor <span class="interno">interno</span>
          <select data-accion="cambiar-proveedor">
            <option value="">${escapar(nombreOperador(a.operador_id)) || "Proveedor actual"} (actual)</option>
            ${alt.map((x) => `<option value="${x.servicio_id}">${escapar(x.operador)} · ${escapar(x.nombre)}${x.visible ? "" : " (oculto para clientes)"}</option>`).join("")}
          </select>
        </label>` : ""}
    </div>`;
}

// Confirmación de la actividad con el operador (solo en Reserva; el número es de uso interno)
// La confirmación del operador la registra la solicitud al proveedor (P): solo se muestra
function htmlConfirmacionOperador(a) {
  const sol = typeof solicitudDeActividad === "function" ? solicitudDeActividad(a.id) : null;
  return `
    <div class="act-confirmacion">
      ${a.operador_confirmado
        ? `<span class="act-confirmada">Confirmada con el operador${a.operador_confirmacion ? ` · N.º ${escapar(a.operador_confirmacion)}` : ""}</span>`
        : `<span class="act-sin-tarifa">Sin confirmar con el operador</span>`}
      ${sol ? `<span class="etiqueta">${escapar(sol.codigo)}</span>` : ""}
      <span class="nota">Se registra en "Solicitudes a proveedores".</span>
    </div>`;
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
        <td><strong>${escapar(serv?.nombre ?? "")}</strong>${a.codigo_reserva && app.actual ? `<br><small>Reserva ${escapar(app.actual.cot.numero)}-${escapar(a.codigo_reserva)}</small>` : ""}${lugares ? `<br><small>${lugares}</small>` : ""}</td>
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
    const m = mensajes(c);
    const texto = m.cot(c, link);
    const wa = `https://wa.me/${c.telefono.replace(/\D/g, "")}?text=${encodeURIComponent(texto)}`;
    const mail = `mailto:${encodeURIComponent(c.correo)}?subject=${encodeURIComponent(m.cot_asunto(c))}&body=${encodeURIComponent(texto)}`;
    compartir = `
      <div class="enlace-cliente">
        <input type="text" readonly value="${escapar(link)}" aria-label="Enlace para el cliente">
        <button type="button" class="btn" data-accion="copiar-enlace">Copiar enlace</button>
        <a class="btn" href="${wa}" target="_blank" rel="noopener">Enviar por WhatsApp</a>
        <a class="btn" href="${mail}">Enviar por correo</a>
      </div>
      <p class="nota">Los mensajes salen en ${NOMBRE_IDIOMA[c.idioma]?.toLowerCase() ?? "español"}.</p>`;
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
      ${htmlPagosPorServicio()}
      ${editable ? `
        <h4>Registrar un pago</h4>
        ${htmlAplicarPago()}
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

// Total, pagado y saldo de cada servicio
function htmlPagosPorServicio() {
  const acts = app.actual.actividades.filter((a) => a.id && a.servicio_id && a.estado_servicio !== "cancelado").slice().sort(ordenActividad);
  if (!acts.length) return "";
  const aplicado = (app.actual.aplicaciones || []).reduce((s, x) => s + Number(x.monto), 0);
  const pagado = app.actual.pagos.reduce((s, p) => s + Number(p.monto), 0);
  const sinAsignar = Math.round((pagado - aplicado) * 100) / 100;
  return `
    <h4>Pagos por servicio</h4>
    <div class="tabla-scroll">
      <table class="tabla">
        <thead><tr><th>Servicio</th><th>Forma de pago</th><th class="num">Total</th><th class="num">Pagado</th><th class="num">Saldo</th></tr></thead>
        <tbody>${acts.map((a) => {
          const saldo = saldoServicio(a);
          return `
          <tr>
            <td><strong>${escapar(servicioPorId(a.servicio_id)?.nombre ?? "")}</strong><br><small>${fecha(a.fecha, { weekday: "short", day: "numeric", month: "short" })}${a.codigo_reserva && a.estado_servicio === "confirmado" ? ` · ${escapar(app.actual.cot.numero)}-${escapar(a.codigo_reserva)}` : ""}</small></td>
            <td>${escapar(textoFormaPago(a))}</td>
            <td class="num">${dinero(subtotal(a))}</td>
            <td class="num">${dinero(pagadoServicio(a))}</td>
            <td class="num">${saldo > 0.005 ? `<strong>${dinero(saldo)}</strong>` : `<span class="act-confirmada">Pagado</span>`}</td>
          </tr>`; }).join("")}</tbody>
      </table>
    </div>
    ${sinAsignar > 0.005 ? `<p class="nota">Pago sin asignar a un servicio: ${dinero(sinAsignar)} (el pago supera lo que se debía en los servicios elegidos).</p>` : ""}`;
}

// Casillas para elegir a qué servicios se aplica el pago (sin marcar = automático)
function htmlAplicarPago() {
  const acts = app.actual.actividades.filter((a) => a.id && a.servicio_id && a.estado_servicio !== "cancelado" && saldoServicio(a) > 0.005).slice().sort(ordenActividad);
  if (!acts.length) return "";
  return `
    <fieldset class="aplicar-pago">
      <legend>Aplicar a los servicios (si no marcas ninguno, se aplica del más próximo al más lejano)</legend>
      ${acts.map((a) => `
        <label class="check-linea chico"><input type="checkbox" data-aplicar="${a.id}">
          ${escapar(servicioPorId(a.servicio_id)?.nombre ?? "")} · ${fecha(a.fecha, { day: "numeric", month: "short" })} · saldo ${dinero(saldoServicio(a))}</label>`).join("")}
    </fieldset>`;
}

// "Confirmar reserva": genera el código de reserva (R00001…) de cada servicio
function htmlConfirmarReserva(c) {
  const acts = [...app.actual.actividades].sort(ordenActividad);
  if (c.reserva_confirmada_en) {
    return `
      <section class="det-seccion">
        <h3>Reserva confirmada</h3>
        <p class="nota">Confirmada el ${fechaHora(c.reserva_confirmada_en)}${c.reserva_confirmada_por ? ` por ${escapar(nombrePerfil(c.reserva_confirmada_por))}` : ""}. Si agregas otro servicio, recibe su código al guardarlo.</p>
        <ul class="codigos-reserva">${acts.map((a) => `
          <li><strong>${a.codigo_reserva ? `${escapar(c.numero)}-${escapar(a.codigo_reserva)}` : "Sin código (guarda los cambios)"}</strong>
            <span>${escapar(servicioPorId(a.servicio_id)?.nombre ?? "")} · ${fecha(a.fecha, { weekday: "short", day: "numeric", month: "short" })}</span>
            ${a.operador_confirmado ? `<span class="act-confirmada">Confirmada con el operador</span>` : `<span class="act-sin-tarifa">Sin confirmar con el operador</span>`}</li>`).join("")}</ul>
      </section>`;
  }
  const sinConfirmar = acts.filter((a) => !a.operador_confirmado);
  return `
    <section class="det-seccion">
      <h3>Confirmar reserva</h3>
      <p>Cuando todo esté coordinado, confirma la reserva: cada servicio recibe su código de reserva (por ejemplo ${escapar(c.numero)}-R00001).</p>
      ${sinConfirmar.length
        ? `<p class="aviso">${sinConfirmar.length} de ${acts.length} servicio(s) todavía no están confirmados con el operador: ${sinConfirmar.map((a) => escapar(servicioPorId(a.servicio_id)?.nombre ?? "Actividad")).join(", ")}. Envía la solicitud a cada proveedor en "Solicitudes a proveedores" y espera su confirmación, o confirma de todos modos (quedará anotado en el historial).</p>`
        : `<p class="nota">Todos los servicios están confirmados con su operador.</p>`}
      <button type="button" class="btn primario" data-accion="confirmar-reserva">Confirmar reserva</button>
    </section>`;
}

// "Mis vouchers": el agente habilita el tiquete de cada servicio para que el cliente lo vea
function saldoActual() {
  const { actividades, pagos } = app.actual;
  const total = actividades.reduce((s, a) => s + subtotal(a), 0);
  const pagado = pagos.reduce((s, p) => s + Number(p.monto), 0);
  return Math.round((total - pagado) * 100) / 100;
}

// Pagos por servicio (etapa 10): cada pago se reparte entre servicios (tabla pago_aplicaciones)
const pagadoServicio = (a) => (app.actual?.aplicaciones || []).filter((x) => x.actividad_id === a.id).reduce((s, x) => s + Number(x.monto), 0);
const saldoServicio = (a) => Math.round((subtotal(a) - pagadoServicio(a)) * 100) / 100;
function textoFormaPago(a) {
  if (a.forma_pago === "oficina") return a.pago_limite ? `pagar en oficina antes del ${fecha(a.pago_limite, { day: "numeric", month: "short" })}` : "pagar en oficina antes del tour";
  return "prepago";
}

function htmlTiquetes(c) {
  const acts = [...app.actual.actividades].sort(ordenActividad);
  const saldo = saldoActual();
  const habilitados = acts.filter((a) => a.voucher_habilitado).length;
  return `
    <section class="det-seccion" id="secTiquetes">
      <h3>Tiquetes del cliente ("Mis vouchers")</h3>
      <p>Marca los servicios cuyo tiquete puede ver el cliente en su página. La sección "Mis vouchers" no aparece hasta que habilites al menos uno. Los tiquetes muestran el nombre del operador y las "Notas para el cliente" de cada actividad; no muestran precios.</p>
      ${saldo > 0 ? `<p class="aviso">Esta reserva tiene un saldo pendiente de ${dinero(saldo)}. Puedes habilitar los tiquetes; si el servicio tiene saldo, quedará anotado en el historial y su tiquete dirá "Saldo pendiente".</p>` : ""}
      <ul class="codigos-reserva tiquetes-lista">${acts.map((a) => `
        <li>
          <label class="check-linea chico">
            <input type="checkbox" data-voucher="${a.id ?? ""}" ${a.voucher_habilitado ? "checked" : ""} ${a.id && a.codigo_reserva && a.estado_servicio === "confirmado" ? "" : "disabled"}>
            <strong>${a.codigo_reserva && a.estado_servicio === "confirmado" ? `${escapar(c.numero)}-${escapar(a.codigo_reserva)}` : "Servicio sin confirmar"}</strong>
          </label>
          <span>${escapar(servicioPorId(a.servicio_id)?.nombre ?? "")} · ${fecha(a.fecha, { weekday: "short", day: "numeric", month: "short" })}</span>
          ${a.id && a.estado_servicio === "confirmado" ? (saldoServicio(a) > 0.005 ? `<span class="act-sin-tarifa">Saldo ${dinero(saldoServicio(a))}</span>` : `<span class="act-confirmada">Pagado</span>`) : ""}
          ${a.voucher_habilitado ? `<span class="act-confirmada">Visible para el cliente</span>` : ""}
        </li>`).join("")}</ul>
      <div class="sec-botones">
        <button type="button" class="btn primario" data-accion="guardar-tiquetes">Guardar tiquetes</button>
        ${habilitados && c.enviada_en ? `<a class="btn" href="${escapar(enlaceCliente(c))}#vouchers" target="_blank" rel="noopener">Ver los tiquetes como el cliente</a>` : ""}
      </div>
      ${habilitados && !c.enviada_en ? `<p class="nota">Activa el enlace del cliente (abajo) para que pueda verlos.</p>` : ""}
    </section>`;
}

function htmlCompartirReserva(c) {
  if (!c.enviada_en) {
    return `
      <section class="det-seccion">
        <h3>Compartir la reserva con el cliente</h3>
        <p>Esta reserva se confirmó sin enviarle antes el enlace al cliente. Actívalo para poder compartírselo.</p>
        <button type="button" class="btn primario" data-accion="activar-enlace">Activar enlace del cliente</button>
      </section>`;
  }

  const link = enlaceCliente(c);
  const mensaje = mensajes(c).res(c, link, app.yo.nombre);
  const asunto = mensajes(c).res_asunto(c);
  const correo = `mailto:${encodeURIComponent(c.correo)}?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(mensaje)}`;
  const whatsapp = `https://wa.me/${c.telefono.replace(/\D/g, "")}?text=${encodeURIComponent(mensaje)}`;

  return `
    <section class="det-seccion">
      <h3>Compartir la reserva con el cliente</h3>
      <p>Envíale al cliente el enlace de su reserva. Siempre muestra la información actualizada, así que puedes reenviarlo cuando registres un pago o hagas un cambio.</p>
      <div class="enlace-cliente">
        <input type="text" readonly value="${escapar(link)}" aria-label="Enlace de la reserva">
        <button type="button" class="btn" data-accion="copiar-enlace">Copiar enlace</button>
        <button type="button" class="btn" data-accion="copiar-mensaje">Copiar mensaje completo</button>
      </div>
      <div class="sec-botones">
        <a class="btn" href="${correo}">Enviar por correo</a>
        <a class="btn" href="${whatsapp}" target="_blank" rel="noopener">Enviar por WhatsApp</a>
      </div>
      <p class="nota">Los mensajes salen en ${NOMBRE_IDIOMA[c.idioma]?.toLowerCase() ?? "español"}. "Copiar mensaje completo" copia el saludo, el enlace y la despedida para pegarlos en Outlook u otro programa. "Enviar por correo" abre tu programa de correo predeterminado.</p>
    </section>`;
}

function htmlCancelar(c) {
  const esReserva = c.estado === "reserva";
  if (esReserva && !puede("cancelar_reservas")) {
    return `
      <section class="det-seccion">
        <h3>Cancelar reserva</h3>
        <p class="nota">Tu usuario no tiene autorización para cancelar reservas confirmadas.</p>
      </section>`;
  }
  const conPagos = esReserva && app.actual.pagos.length;
  return `
    <section class="det-seccion zona-cancelar">
      <h3>${esReserva ? "Cancelar reserva" : "Cancelar cotización"}</h3>
      <p class="nota">Úsalo cuando el cliente no respondió, desistió o la solicitud no se va a concretar. Saldrá del tablero y podrás consultarla marcando "Ver canceladas".</p>
      ${conPagos ? `<p class="aviso">Esta reserva tiene pagos registrados. Si corresponde una devolución, anótala en las notas internas antes de cancelar.</p>` : ""}
      <div class="fila-form">
        <label>Motivo
          <select id="motivoCancelacion">${MOTIVOS_CANCELACION.map((m) => `<option>${m}</option>`).join("")}</select>
        </label>
        <label>Detalle (opcional) <input id="detalleCancelacion" type="text" maxlength="300"></label>
        <button type="button" class="btn peligro" data-accion="cancelar">${esReserva ? "Cancelar reserva" : "Cancelar cotización"}</button>
      </div>
    </section>`;
}

function htmlCancelada(c) {
  const puedeReactivar = c.estado_previo !== "reserva" || puede("cancelar_reservas");
  return `
    <section class="det-seccion cancelada-info">
      <h3>Cotización cancelada</h3>
      <p><strong>Motivo:</strong> ${escapar(c.motivo_cancelacion ?? "Sin motivo indicado")}</p>
      <p class="nota">Cancelada el ${c.cancelada_en ? fechaHora(c.cancelada_en) : ""}. Antes estaba en: ${NOMBRE_ESTADO[c.estado_previo] ?? "Cotización"}.</p>
      ${puedeReactivar
        ? `<button type="button" class="btn" data-accion="reactivar">Reactivar y volver a ${NOMBRE_ESTADO[c.estado_previo] ?? "Cotización"}</button>`
        : `<p class="nota">Tu usuario no tiene autorización para reactivar reservas confirmadas.</p>`}
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
    notas_proveedor: v("notas_proveedor"),
    forma_pago: v("forma_pago") || "prepago",
    pago_limite: v("pago_limite"),
    tarifa_tipo: v("tarifa_tipo") || previa.tarifa_tipo || "manual",
    operador_confirmado: card.querySelector('[data-campo="operador_confirmado"]')
      ? card.querySelector('[data-campo="operador_confirmado"]').checked : !!previa.operador_confirmado,
    operador_confirmacion: v("operador_confirmacion"),
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
    tarifa_tipo: "tc",
    operador_confirmado: false,
    operador_confirmacion: "",
    operador_confirmado_en: null,
    codigo_reserva: null,
    voucher_habilitado: false,
    voucher_habilitado_en: null,
    notas_proveedor: "",
    estado_servicio: "por_solicitar",
    forma_pago: "prepago",
    pago_limite: "",
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
          notas: a.notas || null,
          notas_proveedor: a.notas_proveedor?.trim() || null,
          forma_pago: a.forma_pago || "prepago",
          pago_limite: a.forma_pago === "oficina" && a.pago_limite ? a.pago_limite : null,
          tarifa_tipo: a.tarifa_tipo || "manual"
          // La confirmación del operador ya no se escribe aquí: la registra la solicitud al proveedor (etapa 8)
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
        if (a.voucher_habilitado && a.codigo_reserva) {
          await registrar(c.id, "tiquete actualizado", `${c.numero}-${a.codigo_reserva}: el cliente ve el tiquete con los cambios.`);
        }
      }
      avisar("Cambios guardados.");
      // Etapa 9: si cambió un servicio ya solicitado al proveedor, se prepara la MODIFICACIÓN (o la cancelación si cambió el proveedor)
      if (c.estado === "reserva" && typeof revisarCambiosSolicitudes === "function") await revisarCambiosSolicitudes(c);
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

  if (e.target.dataset.p === "precio") {
    const sel = card.querySelector('[data-campo="tarifa_tipo"]');
    if (sel && sel.value !== "manual") { sel.value = "manual"; }
  }
  if (e.target.dataset.campo === "hora_inicio") {
    const serv = servicioPorId(card.querySelector('[data-campo="servicio_id"]').value);
    if (serv?.duracion_min && e.target.value) {
      card.querySelector('[data-campo="hora_fin"]').value = sumarMinutos(e.target.value, serv.duracion_min);
    }
  }
  marcarPendiente(card);
});

$("detalleContenido").addEventListener("change", async (e) => {
  if (e.target.id === "cliIdioma") return cambiarIdiomaCliente(e.target);
  const card = e.target.closest(".actividad");
  if (!card) return;
  const idx = Number(card.dataset.idx);

  const proveedor = e.target.dataset.accion === "cambiar-proveedor" ? Number(e.target.value) : null;
  if (e.target.dataset.campo === "servicio_id" || proveedor) {
    const a = leerTarjeta(card);
    if (proveedor) a.servicio_id = proveedor;
    a._pendiente = true;
    const serv = servicioPorId(a.servicio_id);
    if (serv) {
      a.participantes.forEach((p) => {
        p.precio_unitario = precioBase(serv.id, p.categoria_id);
        p.neto_unitario = netoBase(serv.id, p.categoria_id);
      });
      a.operador_id = serv.operador_id ?? null;
      if (!proveedor) {
        if (serv.horarios?.length) a.hora_inicio = hora(serv.horarios[0]);
        if (a.hora_inicio && serv.duracion_min) a.hora_fin = sumarMinutos(a.hora_inicio, serv.duracion_min);
        if (serv.transporte) a.transporte_modo = serv.transporte;
      }
      await cargarTarifas([a]);
      aplicarTarifa(a, a.tarifa_tipo === "cash" ? "cash" : "tc");
    }
    app.actual.actividades[idx] = a;
    repintarTarjeta(idx);
    pintarTotales();
    if (proveedor) avisar(`Proveedor cambiado a ${nombreOperador(a.operador_id) || "otro proveedor"}. Revisa los precios.`);
    return;
  }

  // Otra fecha → la tarifa de la temporada de esa fecha. Otro tipo de tarifa → sus precios.
  if (e.target.dataset.campo === "fecha" || e.target.dataset.campo === "tarifa_tipo") {
    const a = leerTarjeta(card);
    a._pendiente = true;
    if (a.servicio_id && a.fecha) {
      await cargarTarifas([a]);
      aplicarTarifa(a, a.tarifa_tipo);
    }
    app.actual.actividades[idx] = a;
    repintarTarjeta(idx);
    pintarTotales();
    if (e.target.dataset.campo === "fecha" && a.tarifa_tipo === "pendiente") avisar("No hay tarifa aprobada para esa fecha: quedó como tarifa pendiente.", "error");
    return;
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

    const t = tarifaDe(a);
    a.participantes.push({
      categoria_id: categoriaId,
      cantidad: 1,
      precio_unitario: ["tc", "cash"].includes(a.tarifa_tipo) ? precioTarifa(t, categoriaId, a.tarifa_tipo) ?? 0
        : a.servicio_id && a.tarifa_tipo === "manual" ? precioBase(a.servicio_id, categoriaId) : 0,
      neto_unitario: netoTarifa(t, categoriaId) ?? (a.servicio_id ? netoBase(a.servicio_id, categoriaId) : 0)
    });
    a._pendiente = true;
    app.actual.actividades[idx] = a;
    repintarTarjeta(idx);
    pintarTotales();
  }
});

async function cambiarIdiomaCliente(sel) {
  const c = app.actual.cot;
  const anterior = c.idioma || "es";
  const nuevo = sel.value;
  if (nuevo === anterior) return;
  sel.disabled = true;
  const { error } = await db.from("cotizaciones").update({ idioma: nuevo }).eq("id", c.id);
  if (error) { sel.value = anterior; sel.disabled = false; return fallo(error, "No se pudo cambiar el idioma."); }
  await registrar(c.id, "idioma cambiado", `${NOMBRE_IDIOMA[anterior]} → ${NOMBRE_IDIOMA[nuevo]}`);
  await recargarDetalle();
  const item = app.cotizaciones.find((x) => x.id === c.id);
  if (item) { item.idioma = nuevo; pintarTablero(); }
  avisar(`Idioma del cliente: ${NOMBRE_IDIOMA[nuevo]}.`);
}

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
      const creadas = nuevas.map((s) => nuevaActividad(s.servicio_id, s.fecha));
      await cargarTarifas(creadas);
      creadas.forEach((a) => { aplicarTarifa(a, "tc"); acts.push(a); });
      acts.sort(ordenActividad);
      pintarDetalle();
      const sinTarifa = creadas.filter((a) => a.tarifa_tipo === "pendiente").length;
      avisar(`Se agregaron ${nuevas.length} actividades con la tarifa TC de su temporada.${sinTarifa ? ` ${sinTarifa} quedaron con tarifa pendiente.` : ""} Revisa horarios y precios, y presiona Guardar cambios.`);
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
        if (a.codigo_reserva) {
          await registrar(app.actual.cot.id, "servicio eliminado",
            `${app.actual.cot.numero}-${a.codigo_reserva} (${servicioPorId(a.servicio_id)?.nombre ?? "actividad"})${a.voucher_habilitado ? "; su tiquete ya no aparece para el cliente" : ""}.`);
        }
      }
      app.actual.actividades.splice(idx, 1);
      if (typeof recargarSoloSolicitudes === "function") await recargarSoloSolicitudes();
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

    case "confirmar-reserva": {
      if (hayPendientes()) return avisar("Guarda los cambios del itinerario antes de confirmar la reserva.", "error");
      const acts = app.actual.actividades;
      if (!acts.length) return avisar("La reserva no tiene actividades.", "error");
      const sinConfirmar = acts.filter((a) => !a.operador_confirmado);
      const nombres = sinConfirmar.map((a) => servicioPorId(a.servicio_id)?.nombre ?? "Actividad");
      const texto = sinConfirmar.length
        ? `Atención: ${sinConfirmar.length} servicio(s) todavía no están confirmados con el operador:\n\n${nombres.map((n) => "· " + n).join("\n")}\n\n¿Confirmar la reserva de todos modos? Quedará anotado en el historial.`
        : `¿Confirmar la reserva? Cada servicio recibirá su código de reserva.`;
      if (!confirm(texto)) return;
      const nota = sinConfirmar.length ? `Advertencia mostrada: ${sinConfirmar.length} servicio(s) sin confirmar con el operador (${nombres.join(", ")}); se confirmó de todos modos.` : null;
      await conBoton(btn, async () => {
        const { data, error } = await db.rpc("confirmar_reserva", { p_cotizacion: c.id, p_nota: nota });
        if (error) return fallo(error, "No se pudo confirmar la reserva.");
        await recargarDetalle(false);
        cargarTablero();
        avisar(`Reserva confirmada: ${data?.codigos ?? 0} código(s) de reserva generados.`);
      });
      break;
    }

    case "guardar-tiquetes": {
      if (hayPendientes()) return avisar("Guarda los cambios del itinerario antes de habilitar tiquetes.", "error");
      const cambios = [...document.querySelectorAll("#secTiquetes [data-voucher]")]
        .filter((el) => el.dataset.voucher)
        .map((el) => ({ a: app.actual.actividades.find((x) => String(x.id) === el.dataset.voucher), on: el.checked }))
        .filter((x) => x.a && x.a.voucher_habilitado !== x.on);
      if (!cambios.length) return avisar("No hay cambios en los tiquetes.");
      const nuevos = cambios.filter((x) => x.on);
      const conSaldo = nuevos.filter((x) => saldoServicio(x.a) > 0.005);
      const saldo = Math.round(conSaldo.reduce((s, x) => s + saldoServicio(x.a), 0) * 100) / 100;
      const detalleSaldo = conSaldo.map((x) => `${servicioPorId(x.a.servicio_id)?.nombre ?? ""}: ${dinero(saldoServicio(x.a))} (${textoFormaPago(x.a)})`);
      if (conSaldo.length && !confirm(
        `Atención: ${conSaldo.length === 1 ? "este servicio tiene" : "estos servicios tienen"} saldo pendiente:\n\n${detalleSaldo.map((t) => "· " + t).join("\n")}\n\nHabilitar tiquetes con saldo pendiente puede causar un inconveniente operativo (por ejemplo, que el cliente se presente sin haber pagado). Quedará anotado en el historial.\n\n¿Habilitar de todos modos?`)) return;
      const codigo = (a) => `${c.numero}-${a.codigo_reserva}`;
      await conBoton(btn, async () => {
        const ahora = new Date().toISOString();
        for (const { a, on } of cambios) {
          const { error } = await db.from("actividades")
            .update({ voucher_habilitado: on, voucher_habilitado_en: on ? ahora : null }).eq("id", a.id);
          if (error) return fallo(error, "No se pudieron guardar los tiquetes.");
        }
        const quitados = cambios.filter((x) => !x.on);
        if (nuevos.length) {
          await registrar(c.id, "tiquetes habilitados", nuevos.map((x) => codigo(x.a)).join(", ") +
            (saldo > 0 ? `. Advertencia mostrada: saldo pendiente de ${dinero(saldo)} (${detalleSaldo.join("; ")}); se habilitó de todos modos.` : "."));
        }
        if (quitados.length) await registrar(c.id, "tiquetes ocultados", quitados.map((x) => codigo(x.a)).join(", ") + ".");
        await recargarDetalle(false);
        avisar("Tiquetes guardados.");
      });
      break;
    }

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
        const marcados = [...document.querySelectorAll("[data-aplicar]:checked")].map((x) => Number(x.dataset.aplicar));
        const { data: pago, error } = await db.from("pagos").insert({
          cotizacion_id: c.id,
          monto,
          fecha: $("pagoFecha").value || aTexto(new Date()),
          metodo: $("pagoMetodo").value,
          referencia: $("pagoReferencia").value.trim() || null
        }).select("id").single();
        if (error) return fallo(error);
        const { data: rep, error: e2 } = await db.rpc("aplicar_pago", { p_pago: pago.id, p_actividades: marcados.length ? marcados : null });
        if (e2) fallo(e2, "El pago se registró, pero no se pudo repartir entre los servicios.");
        const nombres = marcados.map((id) => servicioPorId(app.actual.actividades.find((a) => a.id === id)?.servicio_id)?.nombre).filter(Boolean);
        await registrar(c.id, "pago registrado", `${dinero(monto)} (${$("pagoMetodo").value})${nombres.length ? " · aplicado a: " + nombres.join(", ") : " · aplicado del servicio más próximo al más lejano"}`);
        await recargarDetalle();
        cargarTablero();
        const sinAsignar = Number(rep?.sin_asignar) || 0;
        avisar(sinAsignar > 0.005 ? `Pago registrado. ${dinero(sinAsignar)} quedó sin asignar (supera lo que se debía).` : "Pago registrado.");
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

    case "activar-enlace":
      await conBoton(btn, async () => {
        const { error } = await db.from("cotizaciones").update({ enviada_en: new Date().toISOString() }).eq("id", c.id);
        if (error) return fallo(error);
        await registrar(c.id, "enlace del cliente activado");
        await recargarDetalle();
        avisar("Enlace activado. Ya puedes compartirlo con el cliente.");
      });
      break;

    case "copiar-mensaje": {
      const texto = mensajes(c).res(c, enlaceCliente(c), app.yo.nombre);
      try {
        await navigator.clipboard.writeText(texto);
        avisar("Mensaje copiado. Pégalo en un correo nuevo de Outlook con Ctrl + V.");
      } catch {
        avisar("No se pudo copiar automáticamente. Usa Copiar enlace.", "error");
      }
      break;
    }

    case "cancelar": {
      const motivo = $("motivoCancelacion").value;
      const detalle = $("detalleCancelacion").value.trim();
      if (hayPendientes() && !confirm("Hay cambios sin guardar en el itinerario y se perderán. ¿Continuar?")) return;
      const que = c.estado === "reserva" ? "esta reserva" : "esta cotización";
      if (!confirm(`¿Cancelar ${que}? Motivo: ${motivo}.`)) return;
      await conBoton(btn, async () => {
        const { error } = await db.from("cotizaciones")
          .update({ estado: "cancelado", motivo_cancelacion: detalle ? `${motivo}: ${detalle}` : motivo })
          .eq("id", c.id);
        if (error) return fallo(error, "No se pudo cancelar.");
        await recargarDetalle(false);
        cargarTablero();
        avisar("Cancelada. Puedes verla marcando \"Ver canceladas\" en el tablero.");
      });
      break;
    }

    case "reactivar": {
      const destino = c.estado_previo || "cotizacion";
      if (!confirm(`¿Reactivar y devolver a ${NOMBRE_ESTADO[destino]}?`)) return;
      await conBoton(btn, async () => {
        const { error } = await db.from("cotizaciones").update({ estado: destino }).eq("id", c.id);
        if (error) return fallo(error, "No se pudo reactivar.");
        await recargarDetalle(false);
        cargarTablero();
        avisar("Reactivada.");
      });
      break;
    }

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
      <p class="imp-titulo">${c.estado === "cancelado" ? "Cotización cancelada" : esReserva ? "Reserva" : "Cotización"} ${c.numero}</p>
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
