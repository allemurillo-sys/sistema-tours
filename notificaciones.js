// =====================================================================
// Campana de notificaciones en el panel de THOT
// Muestra los mismos avisos que la campana de Ama de llaves (hv.notificaciones):
// estados de limpieza (Lista, Sucia, Pendiente, Bloqueada), alertas de ingreso,
// novedades de reportes, claves de caja y respaldos. Llegan en tiempo real.
// Al tocar un aviso se abre la sección correspondiente de Ama de llaves.
// =====================================================================
const ntf = { iniciado: false, lista: [], canal: null, audio: null, abierto: false };
const hvDb = () => db.schema("hv");

function ntfEsc(t) {
  return String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function ntfFecha(f) {
  try { return new Date(f).toLocaleString("es-CR", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }); }
  catch { return ""; }
}
function ntfTitulo(n) {
  if (n.tipo === "clave") return "🔑 Clave de caja";
  if (n.tipo === "respaldo") return "📦 Respaldo pendiente";
  if (n.tipo === "ocupacion") return n.numero_caso || "🧹 Limpieza";
  return "📬 " + (n.numero_caso || "Reporte");
}
function ntfDestino(n) {
  if (n.tipo === "ocupacion") return "limpieza/?ocupacion=" + (n.fecha_ref || "1");
  if (n.tipo === "clave") return "limpieza/?claves=" + (n.caja_id ?? "");
  if (n.tipo === "respaldo") return "limpieza/?respaldo=1";
  return n.reporte_id ? "limpieza/?caso=" + n.reporte_id : "limpieza/";
}

// ---------- Botón de la campana ----------
function ntfCrearBoton() {
  if (document.getElementById("ntfBtn")) return;
  const caja = document.querySelector(".barra-usuario");
  if (!caja) return;
  const b = document.createElement("button");
  b.type = "button"; b.id = "ntfBtn"; b.className = "ntf-btn";
  b.setAttribute("aria-label", "Notificaciones"); b.setAttribute("aria-haspopup", "true");
  b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-5.5-6.84V3.5a1.5 1.5 0 0 0-3 0v.66A7 7 0 0 0 5 11v5l-2 2v1h18v-1l-2-2Z"/></svg><span id="ntfCuenta" class="burbuja" hidden></span>`;
  const menu = document.createElement("div");
  menu.id = "ntfMenu"; menu.className = "menu-flotante ntf-menu"; menu.hidden = true;
  caja.prepend(menu); caja.prepend(b);
  b.addEventListener("click", (e) => { e.stopPropagation(); ntfAbrirCerrar(); });
  document.addEventListener("click", (e) => {
    if (ntf.abierto && !e.target.closest("#ntfMenu")) ntfAbrirCerrar(false);
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && ntf.abierto) ntfAbrirCerrar(false); });
}

function ntfPintarCuenta() {
  const n = ntf.lista.filter((x) => !x.leida).length;
  const c = document.getElementById("ntfCuenta");
  if (!c) return;
  c.textContent = n > 99 ? "99+" : n;
  c.hidden = !n;
}

function ntfAbrirCerrar(abrir = !ntf.abierto) {
  ntf.abierto = abrir;
  const m = document.getElementById("ntfMenu");
  if (!m) return;
  m.hidden = !abrir;
  if (abrir) ntfPintarMenu();
}

function ntfPintarMenu() {
  const m = document.getElementById("ntfMenu");
  if (!m) return;
  const hayNuevas = ntf.lista.some((x) => !x.leida);
  const items = ntf.lista.map((n) => `
    <button type="button" class="ntf-item${n.leida ? "" : " nueva"}" data-ntf="${n.id}">
      <span class="ntf-t">${n.leida ? "" : "● "}${ntfEsc(ntfTitulo(n))}${n.propiedad_nombre ? " · " + ntfEsc(n.propiedad_nombre) : ""}</span>
      <span class="ntf-m">${ntfEsc(n.mensaje)}</span>
      <span class="ntf-f">${ntfFecha(n.creado_en)}</span>
    </button>`).join("");
  m.innerHTML = `
    <div class="ntf-cabeza"><b>Notificaciones</b>
      ${hayNuevas ? `<button type="button" class="ntf-todas" id="ntfTodas">✔ Marcar todas como leídas</button>` : ""}</div>
    <div class="ntf-lista">${items || `<p class="ntf-vacio">No tiene notificaciones</p>`}</div>`;
  m.querySelectorAll("[data-ntf]").forEach((b) => b.addEventListener("click", () => ntfAbrir(ntf.lista.find((n) => n.id === +b.dataset.ntf))));
  const t = document.getElementById("ntfTodas");
  if (t) t.addEventListener("click", async (e) => {
    e.stopPropagation();
    await hvDb().rpc("marcar_leidas", { p_ids: null });
    ntf.lista.forEach((n) => (n.leida = true));
    ntfPintarCuenta(); ntfPintarMenu();
  });
}

async function ntfAbrir(n) {
  if (!n) return;
  if (!n.leida) {
    n.leida = true; ntfPintarCuenta();
    try { await hvDb().rpc("marcar_leidas", { p_ids: [n.id] }); } catch { /* sin conexión */ }
  }
  location.href = ntfDestino(n);
}

// ---------- Aviso emergente y sonido ----------
document.addEventListener("pointerdown", () => {
  try {
    if (!ntf.audio) ntf.audio = new (window.AudioContext || window.webkitAudioContext)();
    if (ntf.audio.state === "suspended") ntf.audio.resume();
  } catch { /* sin audio */ }
}, { passive: true });

function ntfSonar(fuerte) {
  if (!ntf.audio) return;
  try {
    const t0 = ntf.audio.currentTime;
    const tonos = fuerte ? [[880, 0], [880, .22], [1175, .44]] : [[660, 0], [990, .14]];
    tonos.forEach(([f, d]) => {
      const o = ntf.audio.createOscillator(), g = ntf.audio.createGain();
      o.frequency.value = f; o.type = "sine";
      g.gain.setValueAtTime(.0001, t0 + d);
      g.gain.exponentialRampToValueAtTime(.2, t0 + d + .02);
      g.gain.exponentialRampToValueAtTime(.0001, t0 + d + .2);
      o.connect(g).connect(ntf.audio.destination);
      o.start(t0 + d); o.stop(t0 + d + .22);
    });
  } catch { /* sin audio */ }
}

function ntfEmergente(n) {
  let pila = document.getElementById("ntfPila");
  if (!pila) {
    pila = document.createElement("div");
    pila.id = "ntfPila"; pila.className = "ntf-pila";
    pila.setAttribute("role", "status"); pila.setAttribute("aria-live", "polite");
    document.body.appendChild(pila);
  }
  const alerta = /Ingresos|ingreso \(|Bloqueada/.test(n.numero_caso || "");
  const el = document.createElement("div");
  el.className = "ntf-toast" + (alerta ? " alerta" : "");
  el.innerHTML = `
    <div class="ntf-t">${ntfEsc(ntfTitulo(n))}${n.propiedad_nombre ? " · " + ntfEsc(n.propiedad_nombre) : ""}</div>
    <div class="ntf-m">${ntfEsc(n.mensaje)}</div>
    <div class="ntf-acc"><button type="button" class="btn" data-cerrar>Ocultar</button>
      <button type="button" class="btn primario" data-ver>Ver</button></div>`;
  el.querySelector("[data-cerrar]").addEventListener("click", () => el.remove());
  el.querySelector("[data-ver]").addEventListener("click", () => { el.remove(); ntfAbrir(n); });
  pila.prepend(el);
  // Se oculta sola después de 1 minuto (queda guardada en la campana)
  setTimeout(() => el.remove(), 60000);
  while (pila.children.length > 4) pila.lastElementChild.remove();
  ntfSonar(alerta);
}

function ntfNueva(n) {
  if (!n || ntf.lista.some((x) => x.id === n.id)) return;
  ntf.lista.unshift(n);
  ntf.lista = ntf.lista.slice(0, 60);
  ntfPintarCuenta();
  if (ntf.abierto) ntfPintarMenu();
  ntfEmergente(n);
}

// ---------- Carga y tiempo real ----------
async function ntfCargar() {
  const { data, error } = await hvDb().from("notificaciones").select("*")
    .order("creado_en", { ascending: false }).limit(60);
  if (error) return;
  // Si llegaron avisos mientras no había conexión en tiempo real, se muestran también
  const conocidas = new Set(ntf.lista.map((x) => x.id));
  const nuevas = ntf.iniciado && ntf.lista.length ? (data || []).filter((x) => !conocidas.has(x.id) && !x.leida) : [];
  ntf.lista = data || [];
  ntfPintarCuenta();
  if (ntf.abierto) ntfPintarMenu();
  nuevas.slice(0, 3).reverse().forEach(ntfEmergente);
}

function ntfConectar() {
  if (ntf.canal) db.removeChannel(ntf.canal);
  ntf.canal = db.channel("thot-notif-" + app.yo.id)
    .on("postgres_changes", { event: "INSERT", schema: "hv", table: "notificaciones", filter: "usuario_id=eq." + app.yo.id },
      (p) => ntfNueva(p.new))
    .subscribe();
}

async function ntfIniciar() {
  if (ntf.iniciado || !app.yo || typeof CONFIG === "undefined" || !CONFIG.moduloAmaLlaves) return;
  ntf.iniciado = true;
  ntfCrearBoton();
  await ntfCargar();
  ntfConectar();
}

function ntfDetener() {
  if (ntf.canal) db.removeChannel(ntf.canal);
  Object.assign(ntf, { iniciado: false, lista: [], canal: null, abierto: false });
  const b = document.getElementById("ntfBtn"); if (b) b.remove();
  const m = document.getElementById("ntfMenu"); if (m) m.remove();
  const p = document.getElementById("ntfPila"); if (p) p.remove();
}

// Arranca al entrar al panel (igual que el chat)
new MutationObserver(() => { if (app.yo && !$("vistaApp").hidden) ntfIniciar(); })
  .observe($("vistaApp"), { attributes: true, attributeFilter: ["hidden"] });
new MutationObserver(() => { if (app.yo && !$("vistaApp").hidden) ntfIniciar(); })
  .observe($("usuarioNombre"), { childList: true, characterData: true, subtree: true });
db.auth.onAuthStateChange((evento) => { if (evento === "SIGNED_OUT") ntfDetener(); });

// Respaldo por si se pierde la conexión en tiempo real: se revisa con la actualización de cada minuto
document.addEventListener("tablero-actualizado", () => { if (ntf.iniciado) ntfCargar(); else ntfIniciar(); });
document.addEventListener("datos-actualizados", () => { if (ntf.iniciado) ntfCargar(); else ntfIniciar(); });
