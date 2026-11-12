// =====================================================
// CHAT INTERNO (solo colaboradores del panel)
// Foto con burbuja de mensajes, conversaciones privadas,
// grupos momentáneos y fijos, mensajes normales, importantes
// y tareas, archivos y tarjetas de reservas.
// (usa las utilidades y datos de panel.js)
// =====================================================

VISTAS.chat = "vistaChat";

const CHAT_BUCKET = "chat-archivos";
const CHAT_FOTOS = "perfiles-fotos";
const CHAT_MAX_MB = 10;
const CHAT_PLAN_BYTES = 1024 ** 3;          // plan gratuito de Supabase: 1 GB de archivos
const CHAT_EDITAR_MIN = 15;
const CHAT_TIPOS_ARCHIVO = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp",
  pdf: "application/pdf",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  csv: "text/csv", txt: "text/plain"
};
const CHAT_COLORES = ["#2F6E4F", "#2D5D9F", "#8A3B12", "#6B4FA0", "#B0602A", "#1F7A7A", "#9C3D5B", "#5B6B72"];

const chat = {
  iniciado: false,
  perfiles: [],
  resumen: { conversaciones: [], tareas_pendientes: 0 },
  primeraCarga: true,
  pestana: "conversaciones",          // conversaciones | tareas
  filtro: "",
  verArchivados: false,
  actual: null,                       // id de la conversación abierta
  mensajes: [],
  hayMas: false,
  importantes: [],
  tareas: [],
  separadorDesde: null,               // id desde el que se marca "Mensajes nuevos"
  tipoMsj: "normal",
  adjuntos: [],                       // archivos por enviar
  editando: null,
  cumpliendo: null,
  enviando: false,
  canal: null, presencia: null,
  conectados: new Set(),
  escribiendo: new Map(),             // conv → Map(perfil → hasta)
  ultimoEscribiendo: 0,
  urls: new Map(),                    // ruta → { url, vence }
  timerResumen: null,
  audio: null,
  almacenamiento: null,
  prefs: { sonido: true, notificaciones: false }
};

// ---------- Utilidades ----------
const chatSoyAdmin = () => app.yo?.rol === "administrador";
const chatPerfil = (id) => chat.perfiles.find((p) => p.id === id) || app.perfiles.find((p) => p.id === id);
const chatNombre = (id) => chatPerfil(id)?.nombre ?? "Usuario";
const chatPrimerNombre = (id) => chatNombre(id).split(" ")[0];
const chatConv = (id = chat.actual) => chat.resumen.conversaciones.find((c) => c.id === id);
const chatOtro = (c) => c?.tipo === "privado" ? (c.miembros || []).map((m) => m.perfil_id).find((id) => id !== app.yo.id) : null;
const chatTitulo = (c) => c.tipo === "privado" ? chatNombre(chatOtro(c)) : c.nombre;
const chatPuedeAdministrar = (c) => c && ((c.tipo === "fijo" && chatSoyAdmin()) || (c.tipo === "grupo" && (c.creado_por === app.yo.id || chatSoyAdmin())));
const chatHoraCorta = (ts) => new Date(ts).toLocaleTimeString("es-CR", { hour: "numeric", minute: "2-digit" });
const chatTamano = (b) => b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`;
const chatHoyTexto = () => aTexto(new Date());

function chatIniciales(nombre) {
  const p = String(nombre || "?").trim().split(/\s+/);
  return ((p[0]?.[0] || "?") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
}
function chatColor(clave) {
  let h = 0;
  for (const ch of String(clave)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return CHAT_COLORES[h % CHAT_COLORES.length];
}
function chatAvatar(id, clase = "") {
  const p = chatPerfil(id);
  const punto = chat.conectados.has(id) && id !== app.yo?.id ? `<span class="av-punto" title="Conectado"></span>` : "";
  const cuerpo = p?.foto_url
    ? `<img src="${escapar(p.foto_url)}" alt="">`
    : `<span style="--av:${chatColor(id)}">${escapar(chatIniciales(p?.nombre))}</span>`;
  return `<span class="avatar ${clase}" data-av="${escapar(id)}">${cuerpo}${punto}</span>`;
}
function chatAvatarConv(c, clase = "") {
  if (c.tipo === "privado") return chatAvatar(chatOtro(c), clase);
  return `<span class="avatar grupo ${clase}"><span style="--av:${chatColor("g" + c.id)}">${escapar(chatIniciales(c.nombre))}</span></span>`;
}
function chatDia(ts) {
  const d = aTexto(new Date(ts));
  const ayer = new Date(); ayer.setDate(ayer.getDate() - 1);
  if (d === chatHoyTexto()) return "Hoy";
  if (d === aTexto(ayer)) return "Ayer";
  return new Date(ts).toLocaleDateString("es-CR", { weekday: "long", day: "numeric", month: "long" });
}
function chatCuandoLista(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  if (aTexto(d) === chatHoyTexto()) return chatHoraCorta(ts);
  return d.toLocaleDateString("es-CR", { day: "numeric", month: "short" });
}

// Texto del mensaje: se escapa y luego los enlaces y códigos del sistema se vuelven botones
const CHAT_RE_CODIGO = /\b(S\d{2}-\d{5}(?:-R\d{5})?|R\d{5}|P\d{5})\b/g;
function chatFormatear(texto) {
  let h = escapar(texto);
  h = h.replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
  h = h.replace(CHAT_RE_CODIGO, (c) => `<button type="button" class="chat-codigo" data-chat-codigo="${c}">${c}</button>`);
  return h.replace(/\n/g, "<br>");
}

// ---------- Preferencias (por usuario, en este navegador) ----------
function chatCargarPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(`chat-prefs-${app.yo.id}`) || "{}");
    chat.prefs = { sonido: p.sonido !== false, notificaciones: !!p.notificaciones };
  } catch { chat.prefs = { sonido: true, notificaciones: false }; }
}
function chatGuardarPrefs() {
  try { localStorage.setItem(`chat-prefs-${app.yo.id}`, JSON.stringify(chat.prefs)); } catch { /* sin almacenamiento */ }
}

// ---------- Sonido y notificaciones ----------
document.addEventListener("pointerdown", () => {
  try {
    if (!chat.audio) chat.audio = new (window.AudioContext || window.webkitAudioContext)();
    if (chat.audio.state === "suspended") chat.audio.resume();
  } catch { /* sin audio */ }
}, { passive: true });

function chatSonar(importante) {
  if (!chat.prefs.sonido || !chat.audio) return;
  try {
    const t0 = chat.audio.currentTime;
    const tonos = importante ? [[988, 0], [988, .22], [1319, .44]] : [[784, 0], [1047, .12]];
    tonos.forEach(([f, d]) => {
      const o = chat.audio.createOscillator(), g = chat.audio.createGain();
      o.frequency.value = f; o.type = "sine";
      g.gain.setValueAtTime(.0001, t0 + d);
      g.gain.exponentialRampToValueAtTime(importante ? .25 : .15, t0 + d + .02);
      g.gain.exponentialRampToValueAtTime(.0001, t0 + d + .18);
      o.connect(g).connect(chat.audio.destination);
      o.start(t0 + d); o.stop(t0 + d + .2);
    });
  } catch { /* sin audio */ }
}

function chatNotificar(m) {
  if (!chat.prefs.notificaciones || !("Notification" in window) || Notification.permission !== "granted") return;
  const c = chatConv(m.conversacion_id);
  if (!c) return;
  const quien = m.tipo === "sistema" ? "" : `${chatPrimerNombre(m.autor_id)}: `;
  const prefijo = m.tipo === "importante" ? "⚠ Importante · " : m.tipo === "tarea" ? "Tarea · " : "";
  try {
    const n = new Notification(`${prefijo}${chatTitulo(c)}`, {
      body: `${c.tipo === "privado" ? "" : quien}${m.texto || (m.adjuntos?.length ? "📎 Archivo" : m.tarjeta ? "Reserva compartida" : "")}`.slice(0, 180),
      tag: `chat-${m.conversacion_id}`
    });
    n.onclick = () => { window.focus(); chatAbrirConversacion(m.conversacion_id); n.close(); };
  } catch { /* el navegador no lo permite */ }
}

// =====================================================
// ARRANQUE Y CIERRE
// =====================================================
async function chatIniciar() {
  if (chat.iniciado || !app.yo || app.soloHorario || !puede("chat")) return;
  chat.iniciado = true;
  chat.primeraCarga = true;
  chatCargarPrefs();
  await chatCargarPerfiles();
  chatPintarAvatarPropio();
  await chatCargarResumen();
  chatConectar();
}

function chatDetener() {
  if (chat.canal) db.removeChannel(chat.canal);
  if (chat.presencia) db.removeChannel(chat.presencia);
  Object.assign(chat, {
    iniciado: false, canal: null, presencia: null, actual: null, mensajes: [], importantes: [],
    resumen: { conversaciones: [], tareas_pendientes: 0 }, conectados: new Set(), adjuntos: [], urls: new Map()
  });
  $("chatBurbuja").hidden = true;
  document.title = document.title.replace(/^\(\d+\)\s*/, "");
}

// El panel cambia el nombre del usuario al entrar: ahí arranca el chat
new MutationObserver(() => {
  if (app.yo && !$("vistaApp").hidden) chatIniciar();
  else if (app.yo) chatPintarAvatarPropio();
}).observe($("usuarioNombre"), { childList: true, characterData: true, subtree: true });
new MutationObserver(() => { if (app.yo && !$("vistaApp").hidden) chatIniciar(); })
  .observe($("vistaApp"), { attributes: true, attributeFilter: ["hidden"] });
db.auth.onAuthStateChange((evento) => { if (evento === "SIGNED_OUT") chatDetener(); });

// Respaldo por si se pierde la conexión en tiempo real: el panel se actualiza cada minuto
document.addEventListener("tablero-actualizado", async () => {
  if (!chat.iniciado) return chatIniciar();
  await chatCargarPerfiles();
  chatPintarAvatarPropio();
  await chatCargarResumen();
  if (!$("vistaChat").hidden && chat.actual && chat.pestana === "conversaciones") await chatRecargarMensajes();
});

document.addEventListener("vista-abierta", (e) => {
  if (e.detail !== "chat") return;
  chatAjustarAlto();
  chatPintarVista();
  if (chatSoyAdmin()) chatRevisarAlmacenamiento();
  if (chat.actual) chatMarcarLeido();
});
document.addEventListener("visibilitychange", () => { if (!document.hidden) chatMarcarLeido(); });

function chatAjustarAlto() {
  const barra = document.querySelector(".barra-panel");
  document.documentElement.style.setProperty("--alto-barra", `${barra ? barra.offsetHeight : 90}px`);
}
window.addEventListener("resize", chatAjustarAlto);

// ---------- Carga de datos ----------
async function chatCargarPerfiles() {
  const { data, error } = await db.from("perfiles").select("id, nombre, rol, activo, foto_url").order("nombre");
  if (!error && data) chat.perfiles = data;
}

async function chatCargarResumen() {
  const { data, error } = await db.rpc("chat_resumen");
  if (error) { console.error("Chat:", error); return; }
  const antes = new Map(chat.resumen.conversaciones.map((c) => [c.id, c]));
  chat.resumen = data || { conversaciones: [], tareas_pendientes: 0 };
  chatPintarBurbuja();
  if (chat.primeraCarga) {
    chat.primeraCarga = false;
    const total = chatTotalNoLeidos();
    if (total) avisar(`Tienes ${total} ${total === 1 ? "mensaje sin leer" : "mensajes sin leer"} en el chat.`);
  }
  // si me sacaron de la conversación abierta, se cierra
  if (chat.actual && !chatConv(chat.actual)) {
    chat.actual = null;
    if (!$("vistaChat").hidden) chatPintarVista();
    return;
  }
  if (!$("vistaChat").hidden) {
    chatPintarLista();
    if (chat.actual) {
      const c = chatConv(), a = antes.get(chat.actual);
      if (!a || a.cerrado_en !== c.cerrado_en || a.nombre !== c.nombre || a.silenciado !== c.silenciado
          || (a.miembros || []).length !== (c.miembros || []).length) chatPintarCabecera();
      chatPintarEstadosLectura();
      chatPintarComposerEstado();
    }
    if (chat.pestana === "tareas") chatCargarTareas();
  }
}
function chatProgramarResumen() {
  clearTimeout(chat.timerResumen);
  chat.timerResumen = setTimeout(chatCargarResumen, 350);
}
const chatTotalNoLeidos = () => chat.resumen.conversaciones.reduce((s, c) => s + (c.no_leidos || 0), 0);
const chatTotalImportantes = () => chat.resumen.conversaciones.reduce((s, c) => s + (c.importantes || 0), 0);

// =====================================================
// FOTO CON BURBUJA (barra superior) Y MENÚ
// =====================================================
function chatPintarAvatarPropio() {
  if (!app.yo) return;
  $("chatAvatar").innerHTML = chatAvatar(app.yo.id, "propio");
}

function chatPintarBurbuja() {
  const total = chatTotalNoLeidos(), imp = chatTotalImportantes();
  const b = $("chatBurbuja");
  b.hidden = !total && !imp;
  b.textContent = imp ? `${total || ""}!` : (total > 99 ? "99+" : String(total));
  b.classList.toggle("importante", imp > 0);
  $("chatAvatarBtn").setAttribute("aria-label",
    `Mi perfil y mensajes${total ? `: ${total} sin leer` : ""}${imp ? `, ${imp} importantes por atender` : ""}`);
  const cuenta = $("chatMenuCuenta");
  if (cuenta) { cuenta.hidden = !total; cuenta.textContent = total > 99 ? "99+" : total; }
  document.title = (total ? `(${total}) ` : "") + document.title.replace(/^\(\d+\)\s*/, "");
}

$("chatAvatarBtn").addEventListener("click", (e) => {
  e.stopPropagation();
  const menu = $("chatMenuPerfil");
  if (!menu.hidden) return (menu.hidden = true);
  const total = chatTotalNoLeidos(), imp = chatTotalImportantes(), tareas = chat.resumen.tareas_pendientes || 0;
  menu.innerHTML = `
    <div class="mp-cabeza">${chatAvatar(app.yo.id, "grande")}<div><strong>${escapar(app.yo.nombre)}</strong><span class="nota">${escapar(app.yo.rol)}</span></div></div>
    <button type="button" class="mp-opcion" data-mp="chat">Mensajes ${total ? `<span class="mp-cuenta">${total}</span>` : `<span class="nota">al día</span>`}</button>
    ${imp ? `<button type="button" class="mp-opcion importante" data-mp="chat">⚠ ${imp} ${imp === 1 ? "importante por atender" : "importantes por atender"}</button>` : ""}
    <button type="button" class="mp-opcion" data-mp="tareas">Mis tareas ${tareas ? `<span class="mp-cuenta tarea">${tareas}</span>` : ""}</button>
    <button type="button" class="mp-opcion" data-mp="perfil">Mi perfil</button>`;
  menu.hidden = false;
});
$("chatMenuPerfil").addEventListener("click", (e) => {
  const op = e.target.closest("[data-mp]");
  if (!op) return;
  $("chatMenuPerfil").hidden = true;
  if (op.dataset.mp === "perfil") return chatModalPerfil();
  chat.pestana = op.dataset.mp === "tareas" ? "tareas" : "conversaciones";
  if (chat.pestana === "conversaciones" && !chat.actual) {
    const primera = chat.resumen.conversaciones.find((c) => c.importantes) || chat.resumen.conversaciones.find((c) => c.no_leidos);
    if (primera) chat.actual = primera.id;
  }
  mostrarVista("chat");
});
document.addEventListener("click", (e) => {
  if (!$("chatMenuPerfil").hidden && !e.target.closest("#chatMenuPerfil")) $("chatMenuPerfil").hidden = true;
});

// =====================================================
// VISTA DEL CHAT
// =====================================================
function chatPintarVista() {
  $("vistaChat").innerHTML = `
    <div class="chat ${chat.actual || chat.pestana === "tareas" ? "con-panel" : ""}">
      <aside class="chat-lado" aria-label="Conversaciones">
        <div class="chat-lado-cabeza">
          <div class="chat-pestanas" role="tablist">
            <button type="button" role="tab" class="pestana ${chat.pestana === "conversaciones" ? "activa" : ""}" data-chat="pestana" data-valor="conversaciones">Conversaciones</button>
            <button type="button" role="tab" class="pestana ${chat.pestana === "tareas" ? "activa" : ""}" data-chat="pestana" data-valor="tareas">Mis tareas <span id="chatCuentaTareas" class="mp-cuenta tarea" ${chat.resumen.tareas_pendientes ? "" : "hidden"}>${chat.resumen.tareas_pendientes}</span></button>
          </div>
          <div class="chat-nuevo">
            <button type="button" class="btn chico primario" data-chat="nuevo-privado">+ Nuevo chat</button>
            <button type="button" class="btn chico" data-chat="nuevo-grupo">+ Nuevo grupo</button>
          </div>
          <input id="chatBuscar" type="search" placeholder="Buscar conversación" aria-label="Buscar conversación" value="${escapar(chat.filtro)}">
          <p id="chatAlmacenamiento" class="aviso chico" hidden></p>
        </div>
        <div id="chatLista" class="chat-lista"></div>
      </aside>
      <section id="chatPanel" class="chat-panel" aria-live="polite"></section>
    </div>`;
  chatPintarLista();
  chatPintarAlmacenamiento();
  if (chat.pestana === "tareas") return chatPintarTareas(true);
  if (chat.actual) return chatAbrirConversacion(chat.actual, true);
  chatPintarBienvenida();
}

function chatPintarBienvenida() {
  const p = $("chatPanel");
  if (!p) return;
  p.innerHTML = `
    <div class="chat-vacio">
      <svg viewBox="0 0 48 48" aria-hidden="true"><path d="M8 10h32a4 4 0 0 1 4 4v16a4 4 0 0 1-4 4H22l-9 7v-7H8a4 4 0 0 1-4-4V14a4 4 0 0 1 4-4z" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/></svg>
      <h2>Chat del equipo</h2>
      <p>Elige una conversación o empieza una nueva. Puedes enviar mensajes normales, <strong>importantes</strong> (piden respuesta pronta) o <strong>tareas</strong> con responsable y fecha.</p>
      <p class="nota">Escribe un código como S26-00001, R00001 o P00001 y se convierte en un enlace a la reserva.</p>
    </div>`;
}

function chatPintarLista() {
  const lista = $("chatLista");
  if (!lista) return;
  const cuentaT = $("chatCuentaTareas");
  if (cuentaT) { cuentaT.hidden = !chat.resumen.tareas_pendientes; cuentaT.textContent = chat.resumen.tareas_pendientes; }
  const q = chat.filtro.trim().toLowerCase();
  const convs = chat.resumen.conversaciones.filter((c) => !q || chatTitulo(c).toLowerCase().includes(q));
  const abiertas = convs.filter((c) => !c.cerrado_en), archivadas = convs.filter((c) => c.cerrado_en);

  const item = (c) => {
    const u = c.ultimo;
    let previa = "Sin mensajes todavía";
    if (u) {
      const quien = u.tipo === "sistema" ? "" : u.autor_id === app.yo.id ? "Tú: " : c.tipo === "privado" ? "" : `${chatPrimerNombre(u.autor_id)}: `;
      const cuerpo = u.eliminado ? "Mensaje eliminado"
        : u.texto ? u.texto : u.adjuntos ? "📎 Archivo" : u.tarjeta ? "📋 Reserva compartida" : "";
      const marca = u.tipo === "importante" ? "⚠ " : u.tipo === "tarea" ? "☑ " : "";
      previa = `${quien}${marca}${cuerpo}`;
    }
    const etiqueta = c.tipo === "fijo" ? `<span class="chat-tipo">Fijo</span>` : c.tipo === "grupo" ? `<span class="chat-tipo">Grupo</span>` : "";
    return `
      <button type="button" class="chat-item ${c.id === chat.actual && chat.pestana === "conversaciones" ? "activo" : ""} ${c.no_leidos ? "sin-leer" : ""}" data-chat="abrir" data-id="${c.id}">
        ${chatAvatarConv(c)}
        <span class="ci-textos">
          <span class="ci-fila"><span class="ci-nombre">${escapar(chatTitulo(c))}</span>${etiqueta}<time>${chatCuandoLista(u?.creado_en || c.ultimo_mensaje_en)}</time></span>
          <span class="ci-fila"><span class="ci-previa">${escapar(previa)}</span>
            ${c.silenciado ? `<span class="ci-silencio" title="Silenciada">🔕</span>` : ""}
            ${c.importantes ? `<span class="ci-imp" title="Importante por atender">!</span>` : ""}
            ${c.no_leidos ? `<span class="ci-cuenta">${c.no_leidos}</span>` : ""}</span>
        </span>
      </button>`;
  };

  let h = abiertas.map(item).join("");
  if (!chat.resumen.conversaciones.length) h = `<p class="nota chat-lista-vacia">Todavía no tienes conversaciones. Empieza con “Nuevo chat”.</p>`;
  else if (!convs.length) h = `<p class="nota chat-lista-vacia">Ninguna conversación coincide.</p>`;
  if (archivadas.length) {
    h += `<button type="button" class="chat-archivados" data-chat="archivados">${chat.verArchivados ? "▾" : "▸"} Grupos cerrados (${archivadas.length})</button>`;
    if (chat.verArchivados) h += archivadas.map(item).join("");
  }
  lista.innerHTML = h;
}

function chatPintarAlmacenamiento() {
  const el = $("chatAlmacenamiento");
  if (!el || chat.almacenamiento == null) return;
  const pct = Math.round((chat.almacenamiento / CHAT_PLAN_BYTES) * 100);
  el.hidden = pct < 80;
  el.textContent = `Almacenamiento de archivos al ${pct} % de 1 GB (incluye las fotos del catálogo). Conviene revisar o pasar al plan Pro de Supabase.`;
}
async function chatRevisarAlmacenamiento() {
  const { data, error } = await db.rpc("chat_almacenamiento");
  if (!error && data != null) { chat.almacenamiento = Number(data); chatPintarAlmacenamiento(); }
}

// =====================================================
// CONVERSACIÓN ABIERTA
// =====================================================
async function chatAbrirConversacion(id, desdeVista = false) {
  if ($("vistaChat").hidden) { chat.actual = id; chat.pestana = "conversaciones"; return mostrarVista("chat"); }
  if (!desdeVista && chat.actual === id && chat.pestana === "conversaciones" && $("chatMensajes")) return;
  const c = chatConv(id);
  if (!c) { chat.actual = null; return chatPintarBienvenida(); }
  chat.actual = id;
  chat.pestana = "conversaciones";
  chat.tipoMsj = "normal";
  chat.adjuntos = [];
  chat.editando = null; chat.cumpliendo = null;
  chat.separadorDesde = c.no_leidos ? c.ultimo_leido_id : null;
  document.querySelector(".chat")?.classList.add("con-panel");
  document.querySelectorAll(".chat-pestanas .pestana").forEach((b) => b.classList.toggle("activa", b.dataset.valor === "conversaciones"));

  $("chatPanel").innerHTML = `
    <header id="chatCabecera" class="chat-cabecera"></header>
    <div id="chatFijos" class="chat-fijos" hidden></div>
    <div id="chatMensajes" class="chat-mensajes"><p class="nota chat-cargando">Cargando…</p></div>
    <div id="chatEscribiendo" class="chat-escribiendo" aria-live="polite"></div>
    <form id="chatComposer" class="chat-composer" autocomplete="off"></form>`;
  chatPintarCabecera();
  chatPintarComposer();
  chatPintarLista();

  const [msj, imp] = await Promise.all([
    db.rpc("chat_mensajes_de", { p_conv: id, p_antes: null, p_limite: 50 }),
    db.rpc("chat_importantes", { p_conv: id })
  ]);
  if (chat.actual !== id) return;
  if (msj.error) return fallo(msj.error, "No se pudieron cargar los mensajes.");
  chat.mensajes = msj.data || [];
  chat.hayMas = chat.mensajes.length >= 50;
  chat.importantes = imp.error ? [] : imp.data || [];
  chatPintarMensajes(true);
  chatPintarFijos();
  chatMarcarLeido();
  if (!matchMedia("(max-width: 800px)").matches) $("chatTexto")?.focus();
}

// Vuelve a leer los mensajes recientes (respaldo del tiempo real y después de acciones)
async function chatRecargarMensajes() {
  const id = chat.actual;
  if (!id || !$("chatMensajes")) return;
  const [msj, imp] = await Promise.all([
    db.rpc("chat_mensajes_de", { p_conv: id, p_antes: null, p_limite: Math.min(200, Math.max(50, chat.mensajes.length)) }),
    db.rpc("chat_importantes", { p_conv: id })
  ]);
  if (chat.actual !== id || msj.error) return;
  const recientes = msj.data || [];
  const desde = recientes[0]?.id ?? Infinity;
  const viejos = chat.mensajes.filter((m) => m.id < desde);
  const cambio = JSON.stringify(recientes) !== JSON.stringify(chat.mensajes.filter((m) => m.id >= desde));
  chat.mensajes = [...viejos, ...recientes];
  chat.importantes = imp.error ? chat.importantes : imp.data || [];
  if (cambio && !chat.editando && !chat.cumpliendo) chatPintarMensajes(chatCercaDelFinal());
  chatPintarFijos();
  chatMarcarLeido();
}

async function chatMarcarLeido() {
  const c = chatConv();
  if (!c || $("vistaChat").hidden || document.hidden || chat.pestana !== "conversaciones" || !chat.mensajes.length) return;
  const ultimo = chat.mensajes[chat.mensajes.length - 1].id;
  if (ultimo <= c.ultimo_leido_id) return;
  c.ultimo_leido_id = ultimo; c.no_leidos = 0;
  chatPintarBurbuja(); chatPintarLista();
  const { error } = await db.rpc("chat_leer", { p_conv: c.id, p_hasta: ultimo });
  if (error) console.error("Chat (leer):", error);
}

function chatPintarCabecera() {
  const c = chatConv(), el = $("chatCabecera");
  if (!c || !el) return;
  const miembros = (c.miembros || []).map((m) => m.perfil_id);
  let sub;
  if (c.tipo === "privado") {
    const otro = chatOtro(c);
    sub = chat.conectados.has(otro) ? `<span class="en-linea">Conectado</span>` : chatPerfil(otro)?.activo === false ? "Usuario desactivado" : "Desconectado";
  } else {
    const nombres = miembros.map((id) => id === app.yo.id ? "Tú" : chatPrimerNombre(id));
    sub = `${c.tipo === "fijo" ? "Grupo fijo" : "Grupo"} · ${miembros.length} integrantes: ${escapar(nombres.join(", "))}`;
  }
  const admin = chatPuedeAdministrar(c);
  const opciones = [
    `<button type="button" class="mp-opcion" data-chat="silenciar">${c.silenciado ? "🔔 Activar avisos" : "🔕 Silenciar"}</button>`,
    admin && !c.cerrado_en ? `<button type="button" class="mp-opcion" data-chat="editar-grupo">Editar grupo e integrantes</button>` : "",
    admin && c.tipo === "grupo" ? `<button type="button" class="mp-opcion" data-chat="cerrar-grupo">${c.cerrado_en ? "Volver a abrir el grupo" : "Cerrar grupo (archivar)"}</button>` : "",
    c.tipo === "grupo" ? `<button type="button" class="mp-opcion peligro" data-chat="salir">Salir del grupo</button>` : ""
  ].join("");
  el.innerHTML = `
    <button type="button" class="btn-icono chat-volver" data-chat="volver" aria-label="Volver a la lista">←</button>
    ${chatAvatarConv(c)}
    <div class="cc-textos">
      <h2>${escapar(chatTitulo(c))} ${c.cerrado_en ? `<span class="chat-tipo cerrado">Cerrado</span>` : ""}</h2>
      <p class="nota">${sub}</p>
    </div>
    <div class="cc-acciones">
      <button type="button" class="btn-icono" data-chat="menu-conv" aria-label="Opciones de la conversación" aria-haspopup="true">⋯</button>
      <div id="chatMenuConv" class="menu-flotante" hidden>${opciones}</div>
    </div>`;
}

function chatPintarFijos() {
  const el = $("chatFijos");
  if (!el) return;
  el.hidden = !chat.importantes.length;
  el.innerHTML = chat.importantes.map((m) => `
    <div class="fijo-imp">
      <span class="fijo-marca">⚠ Importante</span>
      <span class="fijo-texto"><strong>${escapar(chatPrimerNombre(m.autor_id))}:</strong> ${chatFormatear(m.texto || (m.adjuntos.length ? "📎 Archivo" : "Reserva compartida"))}</span>
      <button type="button" class="btn chico" data-chat="ir" data-id="${m.id}">Ver</button>
      <button type="button" class="btn chico primario" data-chat="atender" data-id="${m.id}">Atendido</button>
    </div>`).join("");
}

// ---------- Mensajes ----------
function chatCercaDelFinal() {
  const el = $("chatMensajes");
  return !el || el.scrollHeight - el.scrollTop - el.clientHeight < 120;
}

function chatPintarMensajes(alFinal = false) {
  const el = $("chatMensajes");
  if (!el) return;
  const arriba = el.scrollTop;
  let h = chat.hayMas ? `<div class="chat-mas"><button type="button" class="btn chico" data-chat="anteriores">Ver mensajes anteriores</button></div>` : "";
  if (!chat.mensajes.length) h += `<p class="nota chat-sin-msj">Todavía no hay mensajes. ¡Escribe el primero!</p>`;
  let dia = null, anterior = null, separador = false;
  chat.mensajes.forEach((m) => {
    const d = aTexto(new Date(m.creado_en));
    if (d !== dia) { h += `<div class="chat-dia"><span>${chatDia(m.creado_en)}</span></div>`; dia = d; anterior = null; }
    if (!separador && chat.separadorDesde != null && m.id > chat.separadorDesde && m.autor_id !== app.yo.id) {
      h += `<div class="chat-nuevos"><span>Mensajes nuevos</span></div>`; separador = true; anterior = null;
    }
    h += chatHtmlMensaje(m, anterior);
    anterior = m;
  });
  el.innerHTML = h;
  chatResolverArchivos(el);
  if (alFinal) {
    const sep = el.querySelector(".chat-nuevos");
    if (sep && chat.separadorDesde != null) sep.scrollIntoView({ block: "center" });
    else el.scrollTop = el.scrollHeight;
  } else {
    el.scrollTop = arriba;
  }
}

function chatEditable(m) {
  return m.autor_id === app.yo.id && m.tipo !== "sistema" && !m.eliminado_en && !chatConv()?.cerrado_en
    && Date.now() - new Date(m.creado_en).getTime() < CHAT_EDITAR_MIN * 60000;
}

function chatEstadoLectura(m) {
  const c = chatConv();
  if (!c || m.autor_id !== app.yo.id || m.tipo === "sistema") return "";
  const otros = (c.miembros || []).filter((x) => x.perfil_id !== app.yo.id);
  if (!otros.length) return "";
  const vieron = otros.filter((x) => x.ultimo_leido_id >= m.id);
  const todos = vieron.length === otros.length;
  const titulo = todos ? (c.tipo === "privado" ? "Visto" : "Visto por todos")
    : vieron.length ? `Visto por ${vieron.map((x) => chatPrimerNombre(x.perfil_id)).join(", ")}` : "Enviado";
  return `<span class="msj-visto ${todos ? "todos" : ""}" data-visto="${m.id}" title="${escapar(titulo)}">${todos || vieron.length ? "✓✓" : "✓"}</span>`;
}
function chatPintarEstadosLectura() {
  document.querySelectorAll("[data-visto]").forEach((s) => {
    const m = chat.mensajes.find((x) => x.id === Number(s.dataset.visto));
    if (m) s.outerHTML = chatEstadoLectura(m);
  });
}

function chatHtmlTarjeta(t) {
  if (!t || t.clase !== "reserva") return "";
  const vivo = app.cotizaciones.find((x) => x.id === t.cotizacion_id);
  const estado = vivo?.estado || t.estado;
  const balance = vivo && vivo.estado === "reserva" && Number(vivo.total) > 0
    ? (Number(vivo.balance) > 0 ? `Saldo ${dinero(vivo.balance)}` : "Pagada") : "";
  return `
    <div class="msj-tarjeta estado-${escapar(estado)}">
      <div class="mt-cabeza"><span class="mt-numero">${escapar(t.numero)}</span><span class="chip">${escapar(NOMBRE_ESTADO[estado] || estado)}</span></div>
      <p class="mt-cliente">${escapar(vivo ? nombreCompleto(vivo) : t.cliente)}</p>
      <p class="nota">${fecha(vivo?.fecha_inicio || t.fecha_inicio)} al ${fecha(vivo?.fecha_fin || t.fecha_fin)}${balance ? ` · ${balance}` : ""}</p>
      <button type="button" class="btn chico" data-chat="abrir-reserva" data-id="${t.cotizacion_id}">Abrir reserva</button>
    </div>`;
}

function chatHtmlAdjuntos(m) {
  if (!m.adjuntos?.length) return "";
  return `<div class="msj-adjuntos">${m.adjuntos.map((a) => a.tipo?.startsWith("image/")
    ? `<button type="button" class="adj-foto" data-chat="archivo" data-ruta="${escapar(a.ruta)}" data-nombre="${escapar(a.nombre)}" title="${escapar(a.nombre)}"><img data-ruta-img="${escapar(a.ruta)}" alt="${escapar(a.nombre)}"></button>`
    : `<button type="button" class="adj-archivo" data-chat="archivo" data-ruta="${escapar(a.ruta)}" data-nombre="${escapar(a.nombre)}">
         <span class="adj-ext">${escapar((a.nombre.split(".").pop() || "").slice(0, 4).toUpperCase())}</span>
         <span class="adj-nombre">${escapar(a.nombre)}</span><span class="nota">${a.tamano ? chatTamano(a.tamano) : ""}</span></button>`).join("")}</div>`;
}

function chatHtmlImportante(m, mio) {
  const c = chatConv();
  if (mio) {
    const destinatarios = (c?.miembros || []).map((x) => x.perfil_id).filter((id) => id !== app.yo.id);
    const atendidos = m.atenciones.map((a) => a.perfil_id);
    const faltan = destinatarios.filter((id) => !atendidos.includes(id));
    return `<div class="msj-atencion">
      ${m.atenciones.map((a) => `<span class="aten-ok">✓ Atendido por ${escapar(chatPrimerNombre(a.perfil_id))} · ${chatHoraCorta(a.atendido_en)}</span>`).join("")}
      ${faltan.length ? `<span class="aten-pend">Pendiente: ${escapar(faltan.map(chatPrimerNombre).join(", "))}</span>` : ""}
    </div>`;
  }
  const yaLo = m.atenciones.some((a) => a.perfil_id === app.yo.id);
  return yaLo
    ? `<div class="msj-atencion"><span class="aten-ok">✓ Lo atendiste · ${chatHoraCorta(m.atenciones.find((a) => a.perfil_id === app.yo.id).atendido_en)}</span></div>`
    : `<div class="msj-atencion"><button type="button" class="btn chico primario" data-chat="atender" data-id="${m.id}">Atendido</button></div>`;
}

function chatHtmlTarea(m) {
  const cumplida = !!m.tarea_cumplida_en;
  const vencida = !cumplida && m.tarea_limite && m.tarea_limite < chatHoyTexto();
  const soyResp = m.tarea_responsable === app.yo.id;
  const puedeReabrir = cumplida && (soyResp || m.autor_id === app.yo.id);
  let acciones = "";
  if (!cumplida && soyResp) {
    acciones = chat.cumpliendo === m.id
      ? `<div class="tarea-cumplir">
           <label>Comentario (opcional)<textarea id="chatComentario" rows="2" maxlength="1000" placeholder="Ej.: Ya le envié la cotización"></textarea></label>
           <div class="sec-botones"><button type="button" class="btn chico primario" data-chat="cumplir-ok" data-id="${m.id}">Confirmar cumplida</button>
           <button type="button" class="btn chico" data-chat="cumplir-cancelar">Cancelar</button></div>
         </div>`
      : `<button type="button" class="btn chico primario" data-chat="cumplir" data-id="${m.id}">Marcar cumplida</button>`;
  }
  if (puedeReabrir) acciones += `<button type="button" class="enlace" data-chat="reabrir" data-id="${m.id}">Reabrir</button>`;
  return `
    <div class="msj-tarea ${cumplida ? "cumplida" : vencida ? "vencida" : ""}">
      <p class="tarea-titulo">${chatFormatear(m.texto)}</p>
      <p class="tarea-datos">
        <span>Responsable: <strong>${m.tarea_responsable === app.yo.id ? "Tú" : escapar(chatNombre(m.tarea_responsable))}</strong></span>
        ${m.tarea_limite ? `<span>Fecha límite: <strong>${fecha(m.tarea_limite, { weekday: "short", day: "numeric", month: "short" })}</strong></span>` : ""}
        <span class="tarea-estado">${cumplida ? "✓ Cumplida" : vencida ? "Vencida" : "Pendiente"}</span>
      </p>
      ${cumplida ? `<p class="tarea-hecha">Cumplida por ${escapar(chatPrimerNombre(m.tarea_cumplida_por))} · ${fechaHora(m.tarea_cumplida_en)}${m.tarea_comentario ? `<br>“${escapar(m.tarea_comentario)}”` : ""}</p>` : ""}
      ${acciones ? `<div class="tarea-acciones">${acciones}</div>` : ""}
    </div>`;
}

function chatHtmlMensaje(m, anterior) {
  if (m.tipo === "sistema") {
    const ver = m.tarjeta?.clase === "tarea" ? ` <button type="button" class="enlace" data-chat="ir" data-id="${m.tarjeta.mensaje_id}">Ver tarea</button>` : "";
    return `<div class="msj-sistema" id="msj-${m.id}"><span>${escapar(m.texto)}${ver} · ${chatHoraCorta(m.creado_en)}</span></div>`;
  }
  const mio = m.autor_id === app.yo.id;
  const seguido = anterior && anterior.tipo !== "sistema" && anterior.autor_id === m.autor_id
    && new Date(m.creado_en) - new Date(anterior.creado_en) < 5 * 60000 && m.tipo === "normal" && anterior.tipo === "normal";
  const c = chatConv();

  let cuerpo;
  if (m.eliminado_en) cuerpo = `<p class="msj-eliminado">Mensaje eliminado</p>`;
  else if (chat.editando === m.id) {
    cuerpo = `
      <div class="msj-editar">
        <textarea id="chatEditarTexto" rows="3" maxlength="4000">${escapar(m.texto)}</textarea>
        <div class="sec-botones"><button type="button" class="btn chico primario" data-chat="editar-ok" data-id="${m.id}">Guardar</button>
        <button type="button" class="btn chico" data-chat="editar-cancelar">Cancelar</button></div>
      </div>`;
  } else if (m.tipo === "tarea") cuerpo = chatHtmlTarea(m) + chatHtmlAdjuntos(m);
  else cuerpo = (m.texto ? `<p class="msj-texto">${chatFormatear(m.texto)}</p>` : "") + chatHtmlTarjeta(m.tarjeta) + chatHtmlAdjuntos(m);

  const etiqueta = m.eliminado_en ? "" : m.tipo === "importante" ? `<span class="msj-etiqueta imp">⚠ Importante</span>` : m.tipo === "tarea" ? `<span class="msj-etiqueta tarea">☑ Tarea</span>` : "";
  const acciones = chatEditable(m) && chat.editando !== m.id
    ? `<span class="msj-acciones"><button type="button" class="enlace" data-chat="editar" data-id="${m.id}">Editar</button><button type="button" class="enlace peligro" data-chat="borrar" data-id="${m.id}">Borrar</button></span>` : "";

  return `
    <div class="msj ${mio ? "mio" : ""} ${seguido ? "seguido" : ""} tipo-${m.tipo}" id="msj-${m.id}">
      ${!mio ? (seguido ? `<span class="msj-av-espacio"></span>` : chatAvatar(m.autor_id, "chico")) : ""}
      <div class="msj-burbuja">
        ${!seguido && !mio && c?.tipo !== "privado" ? `<p class="msj-autor" style="color:${chatColor(m.autor_id)}">${escapar(chatNombre(m.autor_id))}</p>` : ""}
        ${etiqueta}
        ${cuerpo}
        ${m.tipo === "importante" && !m.eliminado_en ? chatHtmlImportante(m, mio) : ""}
        <p class="msj-pie">${acciones}${m.editado_en && !m.eliminado_en ? `<span class="nota">editado</span>` : ""}<time title="${fechaHora(m.creado_en)}">${chatHoraCorta(m.creado_en)}</time>${chatEstadoLectura(m)}</p>
      </div>
    </div>`;
}

// Las fotos y archivos se leen con enlaces temporales (la carpeta es privada)
async function chatUrlArchivo(ruta, descargar = null) {
  if (!descargar) {
    const cache = chat.urls.get(ruta);
    if (cache && cache.vence > Date.now()) return cache.url;
  }
  const { data, error } = await db.storage.from(CHAT_BUCKET).createSignedUrl(ruta, 3600, descargar ? { download: descargar } : undefined);
  if (error) throw error;
  if (!descargar) chat.urls.set(ruta, { url: data.signedUrl, vence: Date.now() + 50 * 60000 });
  return data.signedUrl;
}
async function chatResolverArchivos(raiz) {
  const imgs = [...raiz.querySelectorAll("img[data-ruta-img]")];
  const faltan = [...new Set(imgs.map((i) => i.dataset.rutaImg).filter((r) => !(chat.urls.get(r)?.vence > Date.now())))];
  if (faltan.length) {
    const { data, error } = await db.storage.from(CHAT_BUCKET).createSignedUrls(faltan, 3600);
    if (!error) (data || []).forEach((d) => d.signedUrl && chat.urls.set(d.path, { url: d.signedUrl, vence: Date.now() + 50 * 60000 }));
  }
  imgs.forEach((i) => {
    const u = chat.urls.get(i.dataset.rutaImg);
    if (u) i.src = u.url; else i.closest(".adj-foto")?.classList.add("sin-foto");
  });
}

// ---------- Escribir ----------
function chatPintarComposer() {
  const f = $("chatComposer"), c = chatConv();
  if (!f || !c) return;
  if (c.cerrado_en) {
    f.innerHTML = `<p class="chat-cerrado">Este grupo está cerrado: queda archivado solo para consulta.
      ${chatPuedeAdministrar(c) ? `<button type="button" class="enlace" data-chat="cerrar-grupo">Volver a abrirlo</button>` : ""}</p>`;
    return;
  }
  const miembros = (c.miembros || []).map((m) => m.perfil_id).filter((id) => chatPerfil(id)?.activo !== false);
  const respDefecto = c.tipo === "privado" ? chatOtro(c) : miembros.find((id) => id !== app.yo.id);
  f.innerHTML = `
    <div class="cmp-tipos" role="radiogroup" aria-label="Tipo de mensaje">
      <button type="button" role="radio" class="cmp-tipo" data-chat="tipo" data-valor="normal">Normal</button>
      <button type="button" role="radio" class="cmp-tipo imp" data-chat="tipo" data-valor="importante" title="Para algo que necesita respuesta pronta: queda fijo hasta que lo marquen como atendido">⚠ Importante</button>
      <button type="button" role="radio" class="cmp-tipo tarea" data-chat="tipo" data-valor="tarea" title="Con responsable y fecha límite; el responsable la marca como cumplida">☑ Tarea</button>
    </div>
    <div id="chatTareaCampos" class="cmp-tarea" hidden>
      <label>Responsable
        <select id="chatResponsable">${miembros.map((id) => `<option value="${id}" ${id === respDefecto ? "selected" : ""}>${id === app.yo.id ? "Yo" : escapar(chatNombre(id))}</option>`).join("")}</select>
      </label>
      <label>Fecha límite (opcional) <input id="chatLimite" type="date" min="${chatHoyTexto()}"></label>
    </div>
    <div id="chatAdjuntos" class="cmp-adjuntos" hidden></div>
    <div class="cmp-fila">
      <button type="button" class="btn-icono cmp-clip" data-chat="adjuntar" aria-label="Adjuntar archivos" title="Adjuntar fotos, PDF, Excel o Word (máx. ${CHAT_MAX_MB} MB)">📎</button>
      <input id="chatArchivo" type="file" multiple hidden accept="${Object.keys(CHAT_TIPOS_ARCHIVO).map((e) => "." + e).join(",")}">
      <textarea id="chatTexto" rows="1" maxlength="4000" placeholder="Escribe un mensaje…" aria-label="Mensaje"></textarea>
      <button type="submit" id="chatEnviar" class="btn primario">Enviar</button>
    </div>
    <p class="nota cmp-ayuda">Enter envía · Shift + Enter hace un salto de línea · también puedes arrastrar archivos o pegar una captura.</p>`;
  chatPintarTipo();
}

function chatPintarComposerEstado() {
  const c = chatConv(), f = $("chatComposer");
  if (!c || !f) return;
  const estaCerrado = !!f.querySelector(".chat-cerrado");
  if (!!c.cerrado_en !== estaCerrado) chatPintarComposer();
}

function chatPintarTipo() {
  document.querySelectorAll(".cmp-tipo").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.valor === chat.tipoMsj)));
  const campos = $("chatTareaCampos");
  if (campos) campos.hidden = chat.tipoMsj !== "tarea";
  const f = $("chatComposer");
  if (f) f.dataset.tipo = chat.tipoMsj;
  const t = $("chatTexto");
  if (t) t.placeholder = chat.tipoMsj === "tarea" ? "¿Qué hay que hacer?" : chat.tipoMsj === "importante" ? "Mensaje importante: se queda fijo hasta que lo atiendan…" : "Escribe un mensaje…";
}

function chatPintarAdjuntos() {
  const el = $("chatAdjuntos");
  if (!el) return;
  el.hidden = !chat.adjuntos.length;
  el.innerHTML = chat.adjuntos.map((a, i) => `
    <span class="cmp-adj">${a.vista ? `<img src="${a.vista}" alt="">` : `<span class="adj-ext">${escapar(a.nombre.split(".").pop().slice(0, 4).toUpperCase())}</span>`}
      <span class="adj-nombre">${escapar(a.nombre)}</span><span class="nota">${chatTamano(a.blob.size)}</span>
      <button type="button" class="enlace" data-chat="quitar-adj" data-i="${i}" aria-label="Quitar ${escapar(a.nombre)}">✕</button></span>`).join("");
}

// Fotos grandes se reducen a 1600 px (JPEG) antes de subirlas
async function chatPrepararArchivo(archivo) {
  const ext = (archivo.name.split(".").pop() || "").toLowerCase();
  let tipo = archivo.type || CHAT_TIPOS_ARCHIVO[ext];
  if (!Object.values(CHAT_TIPOS_ARCHIVO).includes(tipo)) tipo = CHAT_TIPOS_ARCHIVO[ext];
  if (!tipo) throw new Error(`“${archivo.name}”: ese tipo de archivo no se puede enviar. Usa fotos, PDF, Excel, Word, PowerPoint, CSV o texto.`);
  let blob = archivo, nombre = archivo.name || `captura-${Date.now()}.png`;
  if (["image/jpeg", "image/png", "image/webp"].includes(tipo)) {
    try {
      const img = await createImageBitmap(archivo);
      const escala = Math.min(1, 1600 / Math.max(img.width, img.height));
      if (escala < 1 || archivo.size > 1.5 * 1024 * 1024) {
        const lienzo = document.createElement("canvas");
        lienzo.width = Math.round(img.width * escala); lienzo.height = Math.round(img.height * escala);
        const ctx = lienzo.getContext("2d");
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, lienzo.width, lienzo.height);
        ctx.drawImage(img, 0, 0, lienzo.width, lienzo.height);
        blob = await new Promise((ok) => lienzo.toBlob(ok, "image/jpeg", .85));
        tipo = "image/jpeg";
        nombre = nombre.replace(/\.[^.]+$/, "") + ".jpg";
      }
    } catch { /* si no se puede leer la imagen, se envía tal cual */ }
  }
  if (blob.size > CHAT_MAX_MB * 1024 * 1024) throw new Error(`“${archivo.name}” pesa ${chatTamano(blob.size)}; el máximo es ${CHAT_MAX_MB} MB.`);
  return { blob, nombre, tipo, vista: tipo.startsWith("image/") ? URL.createObjectURL(blob) : null };
}

async function chatAgregarArchivos(lista) {
  if (!chatConv() || chatConv().cerrado_en) return;
  for (const archivo of lista) {
    if (chat.adjuntos.length >= 10) { avisar("Máximo 10 archivos por mensaje.", "error"); break; }
    try { chat.adjuntos.push(await chatPrepararArchivo(archivo)); }
    catch (e) { avisar(e.message, "error"); }
  }
  chatPintarAdjuntos();
  $("chatTexto")?.focus();
}

const chatNombreSeguro = (n) => n.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.\-]+/g, "_").slice(-80) || "archivo";

async function chatEnviar() {
  const c = chatConv();
  if (!c || chat.enviando) return;
  const texto = $("chatTexto").value.trim();
  const tipo = chat.tipoMsj;
  if (!texto && !chat.adjuntos.length) return;
  if (tipo === "tarea" && !texto) return avisar("Escribe qué hay que hacer.", "error");
  chat.enviando = true;
  $("chatEnviar").disabled = true;
  const subidos = [];
  try {
    const adjuntos = [];
    for (const a of chat.adjuntos) {
      const ruta = `${c.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${chatNombreSeguro(a.nombre)}`;
      const { error } = await db.storage.from(CHAT_BUCKET).upload(ruta, a.blob, { contentType: a.tipo, upsert: false });
      if (error) throw error;
      subidos.push(ruta);
      adjuntos.push({ ruta, nombre: a.nombre, tipo: a.tipo, tamano: a.blob.size });
    }
    const { data: id, error } = await db.rpc("chat_enviar", {
      p_conv: c.id, p_tipo: tipo, p_texto: texto, p_adjuntos: adjuntos, p_cotizacion: null,
      p_responsable: tipo === "tarea" ? $("chatResponsable").value : null,
      p_limite: tipo === "tarea" ? ($("chatLimite").value || null) : null
    });
    if (error) throw error;
    chat.adjuntos.forEach((a) => a.vista && URL.revokeObjectURL(a.vista));
    chat.adjuntos = [];
    $("chatTexto").value = "";
    chatAutoAlto();
    chat.tipoMsj = "normal";
    if ($("chatLimite")) $("chatLimite").value = "";
    chatPintarTipo();
    chatPintarAdjuntos();
    chat.separadorDesde = null;
    await chatTraerMensaje(id, true);
  } catch (e) {
    if (subidos.length) await db.storage.from(CHAT_BUCKET).remove(subidos);
    fallo(e, "No se pudo enviar.");
  } finally {
    chat.enviando = false;
    if ($("chatEnviar")) $("chatEnviar").disabled = false;
    $("chatTexto")?.focus();
  }
}

// Agrega o actualiza un mensaje en la conversación abierta
async function chatTraerMensaje(id, alFinal = false) {
  const { data, error } = await db.rpc("chat_mensaje", { p_id: id });
  if (error || !data || data.conversacion_id !== chat.actual) return;
  chatPonerMensaje(data, alFinal);
}
function chatPonerMensaje(m, alFinal) {
  const i = chat.mensajes.findIndex((x) => x.id === m.id);
  const cerca = alFinal || chatCercaDelFinal();
  if (i >= 0) chat.mensajes[i] = { ...chat.mensajes[i], ...m };
  else { chat.mensajes.push(m); chat.mensajes.sort((a, b) => a.id - b.id); }
  if (chat.editando || chat.cumpliendo) {
    // no se redibuja todo para no perder lo que se está escribiendo
    const nodo = $(`msj-${m.id}`);
    if (nodo && chat.editando !== m.id && chat.cumpliendo !== m.id) nodo.outerHTML = chatHtmlMensaje(chat.mensajes.find((x) => x.id === m.id), null);
    else if (!nodo) chatPintarMensajes(cerca);
  } else chatPintarMensajes(cerca);
}

function chatAutoAlto() {
  const t = $("chatTexto");
  if (!t) return;
  t.style.height = "auto";
  t.style.height = `${Math.min(t.scrollHeight, 180)}px`;
}

// ---------- Escribiendo… ----------
function chatAvisarEscribiendo() {
  if (!chat.presencia || Date.now() - chat.ultimoEscribiendo < 2500) return;
  chat.ultimoEscribiendo = Date.now();
  chat.presencia.send({ type: "broadcast", event: "escribiendo", payload: { conv: chat.actual, perfil: app.yo.id } });
}
function chatPintarEscribiendo() {
  const el = $("chatEscribiendo");
  if (!el) return;
  const mapa = chat.escribiendo.get(chat.actual);
  const ahora = Date.now();
  const quienes = mapa ? [...mapa].filter(([, hasta]) => hasta > ahora).map(([id]) => chatPrimerNombre(id)) : [];
  el.textContent = quienes.length ? `${quienes.join(", ")} ${quienes.length === 1 ? "está" : "están"} escribiendo…` : "";
}
setInterval(chatPintarEscribiendo, 1500);

// =====================================================
// TIEMPO REAL
// =====================================================
function chatConectar() {
  chat.canal = db.channel(`chat-db-${app.yo.id}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "chat_mensajes" }, chatAlCambiarMensaje)
    .on("postgres_changes", { event: "*", schema: "public", table: "chat_miembros" }, chatProgramarResumen)
    .on("postgres_changes", { event: "*", schema: "public", table: "chat_conversaciones" }, chatProgramarResumen)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_atenciones" }, chatAlAtender)
    .subscribe();

  chat.presencia = db.channel("chat-presencia", { config: { presence: { key: app.yo.id } } })
    .on("presence", { event: "sync" }, () => {
      chat.conectados = new Set(Object.keys(chat.presencia.presenceState()));
      chatRepintarPresencia();
    })
    .on("broadcast", { event: "escribiendo" }, ({ payload }) => {
      if (!payload || payload.perfil === app.yo.id || !chatConv(payload.conv)) return;
      if (!chat.escribiendo.has(payload.conv)) chat.escribiendo.set(payload.conv, new Map());
      chat.escribiendo.get(payload.conv).set(payload.perfil, Date.now() + 4000);
      if (payload.conv === chat.actual) chatPintarEscribiendo();
    })
    .subscribe((estado) => { if (estado === "SUBSCRIBED") chat.presencia.track({ desde: new Date().toISOString() }); });
}

function chatRepintarPresencia() {
  document.querySelectorAll(".avatar[data-av]").forEach((a) => {
    const id = a.dataset.av;
    const tiene = !!a.querySelector(".av-punto");
    const debe = chat.conectados.has(id) && id !== app.yo.id;
    if (tiene !== debe) a.outerHTML = chatAvatar(id, [...a.classList].filter((k) => k !== "avatar").join(" "));
  });
  const c = chatConv();
  if (c?.tipo === "privado" && $("chatCabecera")) chatPintarCabecera();
}

async function chatAlCambiarMensaje(payload) {
  const m = payload.new;
  if (!m?.id) return chatProgramarResumen();
  chatProgramarResumen();
  if (payload.eventType === "INSERT" && m.autor_id !== app.yo.id) {
    // se quita el "escribiendo…" de quien envió
    chat.escribiendo.get(m.conversacion_id)?.delete(m.autor_id);
    const c = chatConv(m.conversacion_id);
    const paraMi = m.tipo === "importante" || (m.tipo === "tarea" && m.tarea_responsable === app.yo.id);
    const viendo = !document.hidden && !$("vistaChat").hidden && chat.actual === m.conversacion_id;
    if ((!c?.silenciado || paraMi) && !viendo) { chatSonar(m.tipo === "importante"); chatNotificar(m); }
    else if (viendo && m.tipo === "importante") chatSonar(true);
  }
  if (m.conversacion_id === chat.actual && $("chatMensajes")) {
    await chatTraerMensaje(m.id);
    if (m.tipo === "importante" || payload.eventType === "UPDATE") {
      const { data } = await db.rpc("chat_importantes", { p_conv: chat.actual });
      if (data) { chat.importantes = data; chatPintarFijos(); }
    }
    chatMarcarLeido();
  }
  if (chat.pestana === "tareas" && m.tipo === "tarea" && !$("vistaChat").hidden) chatCargarTareas();
}

async function chatAlAtender(payload) {
  chatProgramarResumen();
  const id = payload.new?.mensaje_id;
  if (id && chat.mensajes.some((m) => m.id === id)) await chatTraerMensaje(id);
}

// =====================================================
// MIS TAREAS
// =====================================================
async function chatCargarTareas() {
  const { data, error } = await db.rpc("chat_mis_tareas");
  if (error) return fallo(error, "No se pudieron cargar las tareas.");
  chat.tareas = data || [];
  if (chat.pestana === "tareas") chatPintarTareas();
}

function chatPintarTareas(cargar = false) {
  const p = $("chatPanel");
  if (!p) return;
  document.querySelector(".chat")?.classList.add("con-panel");
  if (cargar) { p.innerHTML = `<p class="nota chat-cargando">Cargando…</p>`; return chatCargarTareas(); }
  const mias = chat.tareas.filter((t) => t.tarea_responsable === app.yo.id);
  const asignadas = chat.tareas.filter((t) => t.autor_id === app.yo.id && t.tarea_responsable !== app.yo.id);
  const tarjeta = (t) => {
    const cumplida = !!t.tarea_cumplida_en;
    const vencida = !cumplida && t.tarea_limite && t.tarea_limite < chatHoyTexto();
    const donde = t.conversacion_tipo === "privado"
      ? `Chat con ${escapar(chatNombre(t.autor_id === app.yo.id ? t.tarea_responsable : t.autor_id))}` : escapar(t.conversacion_nombre);
    return `
      <li class="tarea-fila ${cumplida ? "cumplida" : vencida ? "vencida" : ""}">
        <span class="tarea-check">${cumplida ? "✓" : ""}</span>
        <div class="tarea-info">
          <p class="tarea-titulo">${escapar(t.texto)}</p>
          <p class="nota">${t.tarea_responsable === app.yo.id ? `Te la asignó ${escapar(t.autor_id === app.yo.id ? "tú mismo" : chatNombre(t.autor_id))}` : `Responsable: ${escapar(chatNombre(t.tarea_responsable))}`}
            · ${donde}${t.tarea_limite ? ` · Límite: <strong>${fecha(t.tarea_limite, { weekday: "short", day: "numeric", month: "short" })}</strong>` : ""}
            ${vencida ? ` · <strong class="txt-rojo">Vencida</strong>` : ""}${cumplida ? ` · Cumplida ${fechaHora(t.tarea_cumplida_en)}` : ""}</p>
        </div>
        <button type="button" class="btn chico" data-chat="ir-tarea" data-conv="${t.conversacion_id}" data-id="${t.id}">Ver en el chat</button>
      </li>`;
  };
  const bloque = (titulo, lista, vacio) => `
    <section class="tareas-bloque">
      <h3>${titulo} <span class="nota">${lista.filter((t) => !t.tarea_cumplida_en).length} pendientes</span></h3>
      ${lista.length ? `<ul class="tareas-lista">${lista.map(tarjeta).join("")}</ul>` : `<p class="nota">${vacio}</p>`}
    </section>`;
  p.innerHTML = `
    <header class="chat-cabecera">
      <button type="button" class="btn-icono chat-volver" data-chat="volver" aria-label="Volver a la lista">←</button>
      <div class="cc-textos"><h2>Mis tareas</h2><p class="nota">Las cumplidas se muestran durante 30 días.</p></div>
    </header>
    <div class="chat-tareas">
      ${bloque("Asignadas a mí", mias, "No tienes tareas asignadas.")}
      ${bloque("Que yo asigné", asignadas, "No has asignado tareas.")}
    </div>`;
}

// =====================================================
// VENTANAS (nuevo chat, grupos, perfil, compartir)
// =====================================================
function chatModal(html, ancho = 480) {
  const m = $("chatModal");
  m.innerHTML = `<section class="chat-modal" role="dialog" aria-modal="true" style="--ancho:${ancho}px">${html}</section>`;
  m.hidden = false;
  m.querySelector("input:not([type=checkbox]):not([type=file]), textarea, button.mp-persona")?.focus();
}
function chatCerrarModal() { $("chatModal").hidden = true; $("chatModal").innerHTML = ""; }
$("chatModal").addEventListener("click", (e) => { if (e.target === $("chatModal")) chatCerrarModal(); });
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!$("chatModal").hidden) { e.stopImmediatePropagation(); chatCerrarModal(); }
  else if (!$("chatMenuPerfil").hidden) $("chatMenuPerfil").hidden = true;
  else if ($("chatMenuConv") && !$("chatMenuConv").hidden) $("chatMenuConv").hidden = true;
}, true);

const chatActivosMenosYo = () => chat.perfiles.filter((p) => p.activo && p.id !== app.yo.id);

function chatModalPrivado() {
  const personas = chatActivosMenosYo();
  chatModal(`
    <h2>Nuevo chat</h2>
    <p class="nota">Elige con quién quieres conversar.</p>
    <div class="mp-personas">${personas.length ? personas.map((p) => `
      <button type="button" class="mp-persona" data-chat="crear-privado" data-id="${p.id}">${chatAvatar(p.id)}<span>${escapar(p.nombre)}</span><span class="nota">${escapar(p.rol)}</span></button>`).join("")
      : `<p class="nota">No hay otros usuarios activos.</p>`}</div>
    <div class="sec-botones"><button type="button" class="btn" data-chat="cerrar-modal">Cancelar</button></div>`);
}

function chatModalGrupo(conv = null) {
  const editar = !!conv;
  const fijo = editar ? conv.tipo === "fijo" : false;
  const actuales = new Set(editar ? conv.miembros.map((m) => m.perfil_id) : []);
  const personas = chat.perfiles.filter((p) => p.activo && (p.id !== app.yo.id || fijo));
  chatModal(`
    <h2>${editar ? "Editar grupo" : "Nuevo grupo"}</h2>
    <label>Nombre del grupo <input id="chatGrupoNombre" maxlength="80" value="${escapar(conv?.nombre || "")}" placeholder="Ej.: Boda García · 15 pax"></label>
    ${!editar && chatSoyAdmin() ? `
      <label class="check-linea"><input id="chatGrupoFijo" type="checkbox"> Grupo fijo (ej. Ventas, Reservas)</label>
      <p class="nota">Los grupos fijos solo los crea y modifica el administrador, y nadie puede salirse. Los momentáneos los puede crear cualquiera y cerrarlos cuando ya no se necesiten.</p>` : ""}
    <fieldset class="mp-integrantes">
      <legend>Integrantes</legend>
      ${!fijo ? `<label class="check-linea"><input type="checkbox" checked disabled> ${escapar(app.yo.nombre)} (tú)</label>` : ""}
      ${personas.map((p) => `<label class="check-linea"><input type="checkbox" data-integrante="${p.id}" ${actuales.has(p.id) ? "checked" : ""}> ${chatAvatar(p.id, "chico")} ${escapar(p.nombre)}${p.id === app.yo.id ? " (tú)" : ""}</label>`).join("")}
    </fieldset>
    <div class="sec-botones">
      <button type="button" class="btn primario" data-chat="${editar ? "guardar-grupo" : "crear-grupo"}">${editar ? "Guardar cambios" : "Crear grupo"}</button>
      <button type="button" class="btn" data-chat="cerrar-modal">Cancelar</button>
    </div>`);
}

function chatModalPerfil() {
  chatModal(`
    <h2>Mi perfil</h2>
    <div class="perfil-foto">
      ${chatAvatar(app.yo.id, "enorme")}
      <div>
        <p><strong>${escapar(app.yo.nombre)}</strong><br><span class="nota">${escapar(app.yo.correo || "")} · ${escapar(app.yo.rol)}</span></p>
        <div class="sec-botones">
          <label class="btn chico">Cambiar foto<input id="chatFotoArchivo" type="file" accept="image/jpeg,image/png,image/webp" hidden></label>
          ${chatPerfil(app.yo.id)?.foto_url ? `<button type="button" class="btn chico peligro" data-chat="quitar-foto">Quitar foto</button>` : ""}
        </div>
        <p class="nota">Se recorta en cuadro al centro. Tus compañeros la ven en el chat y junto a tu nombre.</p>
      </div>
    </div>
    <h3>Avisos de mensajes</h3>
    <label class="check-linea"><input id="chatPrefSonido" type="checkbox" ${chat.prefs.sonido ? "checked" : ""}> Sonido al recibir un mensaje</label>
    <label class="check-linea"><input id="chatPrefNotif" type="checkbox" ${chat.prefs.notificaciones ? "checked" : ""}> Notificación del navegador aunque esté en otra pestaña</label>
    <p class="nota">Estas opciones se guardan en este navegador. Los mensajes importantes y las tareas que te asignen suenan aunque la conversación esté silenciada.</p>
    <div class="sec-botones">
      <button type="button" class="btn" data-chat="cambiar-clave">Cambiar mi clave</button>
      <button type="button" class="btn primario" data-chat="cerrar-modal">Listo</button>
    </div>`);
}

function chatModalCompartir() {
  const cot = app.actual?.cot;
  if (!cot) return;
  const convs = chat.resumen.conversaciones.filter((c) => !c.cerrado_en);
  chatModal(`
    <h2>Compartir en el chat</h2>
    <p><strong>${escapar(cot.numero)}</strong> · ${escapar(nombreCompleto(cot))}</p>
    ${convs.length ? `
      <label>Enviar a
        <select id="chatCompartirConv">${convs.map((c) => `<option value="${c.id}" ${c.id === chat.actual ? "selected" : ""}>${escapar(chatTitulo(c))}${c.tipo !== "privado" ? " (grupo)" : ""}</option>`).join("")}</select>
      </label>` : `<p class="nota">Aún no tienes conversaciones. Elige a una persona:</p>
      <label>Enviar a <select id="chatCompartirPersona">${chatActivosMenosYo().map((p) => `<option value="${p.id}">${escapar(p.nombre)}</option>`).join("")}</select></label>`}
    <label>Mensaje (opcional) <textarea id="chatCompartirTexto" rows="3" maxlength="4000" placeholder="Ej.: El cliente llamó, quiere cambiar el rafting al jueves"></textarea></label>
    <label class="check-linea"><input id="chatCompartirImp" type="checkbox"> Marcar como importante (pide respuesta pronta)</label>
    <div class="sec-botones">
      <button type="button" class="btn primario" data-chat="compartir-ok">Enviar</button>
      <button type="button" class="btn" data-chat="cerrar-modal">Cancelar</button>
    </div>`);
}

// Botón que el panel muestra en la cabecera de cada reserva
function chatBotonCompartir() {
  return `<button type="button" class="btn" data-chat-compartir title="Enviar esta reserva a un compañero por el chat">Compartir en el chat</button>`;
}
$("detalleContenido").addEventListener("click", (e) => {
  if (e.target.closest("[data-chat-compartir]")) chatModalCompartir();
});

// Recorte cuadrado de 256 px para la foto de perfil
async function chatPrepararFoto(archivo) {
  const img = await createImageBitmap(archivo);
  const lado = Math.min(img.width, img.height);
  const lienzo = document.createElement("canvas");
  lienzo.width = lienzo.height = 256;
  const ctx = lienzo.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, 256, 256);
  ctx.drawImage(img, (img.width - lado) / 2, (img.height - lado) / 2, lado, lado, 0, 0, 256, 256);
  return new Promise((ok) => lienzo.toBlob(ok, "image/jpeg", .88));
}
async function chatGuardarFoto(archivo) {
  try {
    let url = null;
    if (archivo) {
      const blob = await chatPrepararFoto(archivo);
      const ruta = `${app.yo.id}/${Date.now()}.jpg`;
      const { error } = await db.storage.from(CHAT_FOTOS).upload(ruta, blob, { contentType: "image/jpeg", cacheControl: "31536000", upsert: false });
      if (error) throw error;
      url = db.storage.from(CHAT_FOTOS).getPublicUrl(ruta).data.publicUrl;
    }
    const { error } = await db.rpc("chat_mi_foto", { p_url: url });
    if (error) throw error;
    // se borran las fotos anteriores (si falla, solo queda el archivo sin usar)
    const { data: viejas } = await db.storage.from(CHAT_FOTOS).list(app.yo.id);
    const borrar = (viejas || []).map((f) => `${app.yo.id}/${f.name}`).filter((r) => !url || !url.endsWith(r));
    if (borrar.length) await db.storage.from(CHAT_FOTOS).remove(borrar);
    await chatCargarPerfiles();
    chatPintarAvatarPropio();
    chatModalPerfil();
    if (!$("vistaChat").hidden) chatPintarVista();
    avisar(url ? "Foto actualizada." : "Foto quitada.");
  } catch (e) {
    fallo(e, "No se pudo guardar la foto.");
  }
}

$("chatModal").addEventListener("change", async (e) => {
  if (e.target.id === "chatFotoArchivo" && e.target.files[0]) chatGuardarFoto(e.target.files[0]);
  if (e.target.id === "chatPrefSonido") { chat.prefs.sonido = e.target.checked; chatGuardarPrefs(); if (e.target.checked) chatSonar(false); }
  if (e.target.id === "chatPrefNotif") {
    if (e.target.checked && "Notification" in window && Notification.permission !== "granted") {
      const permiso = await Notification.requestPermission();
      if (permiso !== "granted") {
        e.target.checked = false;
        return avisar("El navegador no dio permiso para notificaciones. Puedes activarlo en el candado junto a la dirección.", "error");
      }
    }
    if (e.target.checked && !("Notification" in window)) { e.target.checked = false; return avisar("Este navegador no admite notificaciones.", "error"); }
    chat.prefs.notificaciones = e.target.checked; chatGuardarPrefs();
  }
});

// =====================================================
// ACCIONES
// =====================================================
async function chatAccion(btn) {
  const a = btn.dataset.chat, id = Number(btn.dataset.id);
  switch (a) {
    case "pestana":
      chat.pestana = btn.dataset.valor;
      if (chat.pestana === "tareas") { chatPintarLista(); document.querySelectorAll(".chat-pestanas .pestana").forEach((b) => b.classList.toggle("activa", b.dataset.valor === "tareas")); chatPintarTareas(true); }
      else chatPintarVista();
      break;
    case "abrir": chatAbrirConversacion(id); break;
    case "archivados": chat.verArchivados = !chat.verArchivados; chatPintarLista(); break;
    case "volver":
      chat.actual = null; chat.pestana = "conversaciones";
      document.querySelector(".chat")?.classList.remove("con-panel");
      chatPintarVista();
      break;
    case "nuevo-privado": chatModalPrivado(); break;
    case "nuevo-grupo": chatModalGrupo(); break;
    case "cerrar-modal": chatCerrarModal(); break;
    case "crear-privado": await conBoton(btn, async () => {
      const { data, error } = await db.rpc("chat_crear_privado", { p_otro: btn.dataset.id });
      if (error) return fallo(error, "No se pudo abrir el chat.");
      chatCerrarModal();
      await chatCargarResumen();
      chatAbrirConversacion(data);
    }); break;
    case "crear-grupo":
    case "guardar-grupo": {
      const nombre = $("chatGrupoNombre").value.trim();
      const miembros = [...document.querySelectorAll("[data-integrante]:checked")].map((x) => x.dataset.integrante);
      if (!nombre) return avisar("Escribe el nombre del grupo.", "error");
      if (!miembros.filter((x) => x !== app.yo.id).length) return avisar("Elige al menos una persona.", "error");
      await conBoton(btn, async () => {
        const r = a === "crear-grupo"
          ? await db.rpc("chat_crear_grupo", { p_nombre: nombre, p_miembros: miembros, p_fijo: !!$("chatGrupoFijo")?.checked })
          : await db.rpc("chat_editar_grupo", { p_conv: chat.actual, p_nombre: nombre, p_miembros: miembros });
        if (r.error) return fallo(r.error, "No se pudo guardar el grupo.");
        chatCerrarModal();
        await chatCargarResumen();
        if (a === "crear-grupo") chatAbrirConversacion(r.data);
        else if (chatConv()) { chatPintarCabecera(); chatPintarComposer(); await chatRecargarMensajes(); }
        avisar(a === "crear-grupo" ? "Grupo creado." : "Grupo actualizado.");
      });
      break;
    }
    case "menu-conv": {
      const m = $("chatMenuConv");
      m.hidden = !m.hidden;
      break;
    }
    case "silenciar": {
      const c = chatConv();
      $("chatMenuConv").hidden = true;
      const { error } = await db.rpc("chat_silenciar", { p_conv: c.id, p_valor: !c.silenciado });
      if (error) return fallo(error);
      c.silenciado = !c.silenciado;
      chatPintarCabecera(); chatPintarLista();
      avisar(c.silenciado ? "Conversación silenciada. Los importantes y tus tareas sí avisan." : "Avisos activados.");
      break;
    }
    case "editar-grupo": $("chatMenuConv").hidden = true; chatModalGrupo(chatConv()); break;
    case "cerrar-grupo": {
      const c = chatConv();
      if ($("chatMenuConv")) $("chatMenuConv").hidden = true;
      const cerrar = !c.cerrado_en;
      if (cerrar && !confirm(`¿Cerrar el grupo «${c.nombre}»? Queda archivado para consulta y ya no se podrán enviar mensajes.`)) return;
      const { error } = await db.rpc("chat_cerrar_grupo", { p_conv: c.id, p_cerrar: cerrar });
      if (error) return fallo(error);
      await chatCargarResumen();
      chatPintarCabecera(); chatPintarComposer(); await chatRecargarMensajes();
      break;
    }
    case "salir": {
      const c = chatConv();
      $("chatMenuConv").hidden = true;
      if (!confirm(`¿Salir del grupo «${c.nombre}»? Ya no verás sus mensajes.`)) return;
      const { error } = await db.rpc("chat_salir", { p_conv: c.id });
      if (error) return fallo(error);
      chat.actual = null;
      await chatCargarResumen();
      chatPintarVista();
      break;
    }
    case "tipo": chat.tipoMsj = btn.dataset.valor; chatPintarTipo(); $("chatTexto")?.focus(); break;
    case "adjuntar": $("chatArchivo").click(); break;
    case "quitar-adj": {
      const [quitado] = chat.adjuntos.splice(Number(btn.dataset.i), 1);
      if (quitado?.vista) URL.revokeObjectURL(quitado.vista);
      chatPintarAdjuntos();
      break;
    }
    case "anteriores": await conBoton(btn, async () => {
      const el = $("chatMensajes"), alto = el.scrollHeight;
      const { data, error } = await db.rpc("chat_mensajes_de", { p_conv: chat.actual, p_antes: chat.mensajes[0]?.id ?? null, p_limite: 50 });
      if (error) return fallo(error);
      chat.hayMas = (data || []).length >= 50;
      chat.mensajes = [...(data || []), ...chat.mensajes];
      chatPintarMensajes();
      el.scrollTop = el.scrollHeight - alto;
    }); break;
    case "atender": await conBoton(btn, async () => {
      const { error } = await db.rpc("chat_atender", { p_id: id });
      if (error) return fallo(error);
      chat.importantes = chat.importantes.filter((m) => m.id !== id);
      chatPintarFijos();
      await chatTraerMensaje(id);
      chatProgramarResumen();
    }); break;
    case "ir": chatIrAMensaje(id); break;
    case "ir-tarea":
      chat.pestana = "conversaciones";
      chat.actual = Number(btn.dataset.conv);
      await chatPintarVista();
      chatIrAMensaje(id);
      break;
    case "editar": chat.editando = id; chatPintarMensajes(); $("chatEditarTexto")?.focus(); break;
    case "editar-cancelar": chat.editando = null; chatPintarMensajes(); break;
    case "editar-ok": await conBoton(btn, async () => {
      const { error } = await db.rpc("chat_editar", { p_id: id, p_texto: $("chatEditarTexto").value });
      if (error) return fallo(error, "No se pudo editar.");
      chat.editando = null;
      await chatTraerMensaje(id);
    }); break;
    case "borrar": {
      if (!confirm("¿Borrar este mensaje? Quedará la marca “Mensaje eliminado”.")) return;
      const { data, error } = await db.rpc("chat_eliminar", { p_id: id });
      if (error) return fallo(error, "No se pudo borrar.");
      if (data?.length) await db.storage.from(CHAT_BUCKET).remove(data);
      await chatTraerMensaje(id);
      break;
    }
    case "cumplir": chat.cumpliendo = id; chatPintarMensajes(); $("chatComentario")?.focus(); break;
    case "cumplir-cancelar": chat.cumpliendo = null; chatPintarMensajes(); break;
    case "cumplir-ok": await conBoton(btn, async () => {
      const { error } = await db.rpc("chat_cumplir_tarea", { p_id: id, p_comentario: $("chatComentario")?.value || null });
      if (error) return fallo(error);
      chat.cumpliendo = null;
      await chatRecargarMensajes();
      chatPintarMensajes(true);
      chatProgramarResumen();
      avisar("Tarea marcada como cumplida.");
    }); break;
    case "reabrir": await conBoton(btn, async () => {
      const { error } = await db.rpc("chat_reabrir_tarea", { p_id: id });
      if (error) return fallo(error);
      await chatRecargarMensajes();
      chatProgramarResumen();
    }); break;
    case "archivo": await conBoton(btn, async () => {
      try {
        const esFoto = !!btn.querySelector("img");
        const url = await chatUrlArchivo(btn.dataset.ruta, esFoto ? null : btn.dataset.nombre);
        window.open(url, "_blank", "noopener");
      } catch (e) { fallo(e, "No se pudo abrir el archivo."); }
    }); break;
    case "abrir-reserva": abrirDetalle(id); break;
    case "quitar-foto": await conBoton(btn, () => chatGuardarFoto(null)); break;
    case "cambiar-clave": chatCerrarModal(); mostrarVista("mantenimiento"); break;
    case "compartir-ok": await conBoton(btn, async () => {
      let conv = Number($("chatCompartirConv")?.value);
      if (!conv) {
        const r = await db.rpc("chat_crear_privado", { p_otro: $("chatCompartirPersona").value });
        if (r.error) return fallo(r.error);
        conv = r.data;
      }
      const { error } = await db.rpc("chat_enviar", {
        p_conv: conv, p_tipo: $("chatCompartirImp").checked ? "importante" : "normal",
        p_texto: $("chatCompartirTexto").value, p_adjuntos: [], p_cotizacion: app.actual.cot.id,
        p_responsable: null, p_limite: null
      });
      if (error) return fallo(error, "No se pudo compartir.");
      chatCerrarModal();
      await chatCargarResumen();
      avisar(`Reserva compartida con ${chatTitulo(chatConv(conv))}.`);
    }); break;
  }
}

async function chatIrAMensaje(id) {
  let nodo = $(`msj-${id}`);
  // si es un mensaje viejo, se cargan los anteriores hasta encontrarlo (máximo 4 tandas)
  for (let i = 0; !nodo && chat.hayMas && i < 4; i++) {
    const { data } = await db.rpc("chat_mensajes_de", { p_conv: chat.actual, p_antes: chat.mensajes[0]?.id ?? null, p_limite: 200 });
    chat.hayMas = (data || []).length >= 200;
    chat.mensajes = [...(data || []), ...chat.mensajes];
    chatPintarMensajes();
    nodo = $(`msj-${id}`);
  }
  if (!nodo) return avisar("No se encontró el mensaje.", "error");
  nodo.scrollIntoView({ block: "center", behavior: "smooth" });
  nodo.classList.add("resaltado");
  setTimeout(() => nodo.classList.remove("resaltado"), 2200);
}

// Códigos S26-00001, R00001 y P00001 → abre la reserva
async function chatAbrirCodigo(codigo) {
  let cotId = null;
  if (codigo.startsWith("S")) {
    const numero = codigo.slice(0, 9);
    cotId = app.cotizaciones.find((c) => c.numero === numero)?.id;
    if (!cotId) cotId = (await db.from("cotizaciones").select("id").eq("numero", numero).maybeSingle()).data?.id;
  } else if (codigo.startsWith("R")) {
    cotId = app.codigos.find((x) => x.codigo_reserva === codigo)?.cotizacion_id;
    if (!cotId) cotId = (await db.from("actividades").select("cotizacion_id").eq("codigo_reserva", codigo).maybeSingle()).data?.cotizacion_id;
  } else {
    cotId = (app.codigosP || []).find((x) => x.codigo === codigo)?.cotizacion_id;
    if (!cotId) cotId = (await db.from("solicitudes_proveedor").select("cotizacion_id").eq("codigo", codigo).maybeSingle()).data?.cotizacion_id;
  }
  if (!cotId) return avisar(`No se encontró ${codigo}.`, "error");
  abrirDetalle(cotId);
}

// ---------- Escuchas de la vista ----------
$("vistaChat").addEventListener("click", (e) => {
  const cod = e.target.closest("[data-chat-codigo]");
  if (cod) return chatAbrirCodigo(cod.dataset.chatCodigo);
  const btn = e.target.closest("[data-chat]");
  if (btn) return chatAccion(btn);
  const menu = $("chatMenuConv");
  if (menu && !menu.hidden && !e.target.closest(".cc-acciones")) menu.hidden = true;
});
$("chatModal").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-chat]");
  if (btn) chatAccion(btn);
});
$("vistaChat").addEventListener("input", (e) => {
  if (e.target.id === "chatBuscar") { chat.filtro = e.target.value; chatPintarLista(); }
  if (e.target.id === "chatTexto") { chatAutoAlto(); chatAvisarEscribiendo(); }
});
$("vistaChat").addEventListener("change", (e) => {
  if (e.target.id === "chatArchivo") { chatAgregarArchivos([...e.target.files]); e.target.value = ""; }
});
$("vistaChat").addEventListener("submit", (e) => {
  if (e.target.id === "chatComposer") { e.preventDefault(); chatEnviar(); }
});
$("vistaChat").addEventListener("keydown", (e) => {
  if (e.target.id === "chatTexto" && e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); chatEnviar(); }
});
$("vistaChat").addEventListener("paste", (e) => {
  if (!e.target.closest("#chatComposer")) return;
  const archivos = [...(e.clipboardData?.files || [])];
  if (archivos.length) { e.preventDefault(); chatAgregarArchivos(archivos); }
});
$("vistaChat").addEventListener("dragover", (e) => {
  if (!chat.actual || !e.dataTransfer?.types?.includes("Files")) return;
  e.preventDefault();
  $("chatPanel")?.classList.add("soltar");
});
$("vistaChat").addEventListener("dragleave", (e) => {
  if (!e.relatedTarget || !$("chatPanel")?.contains(e.relatedTarget)) $("chatPanel")?.classList.remove("soltar");
});
$("vistaChat").addEventListener("drop", (e) => {
  $("chatPanel")?.classList.remove("soltar");
  if (!chat.actual || !e.dataTransfer?.files?.length) return;
  e.preventDefault();
  chatAgregarArchivos([...e.dataTransfer.files]);
});
