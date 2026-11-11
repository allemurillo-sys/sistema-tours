// =====================================================
// PERMISOS Y VENCIMIENTOS (solo administradores)
// Patentes, permisos de salud, mantenimiento de vehículos, pólizas, etc.
// (usa las utilidades y datos de panel.js)
// =====================================================

VISTAS.permisos = "vistaPermisos";

const PERM_BUCKET = "permisos-docs";
const PERM_CATEGORIAS = {
  patente: { nombre: "Patente / municipal", icono: "🏛" },
  salud: { nombre: "Permiso de salud", icono: "⚕" },
  vehiculo: { nombre: "Vehículo (mantenimiento, RTV, marchamo)", corto: "Vehículo", icono: "🚐" },
  turismo: { nombre: "Turismo (ICT, declaratorias)", corto: "Turismo", icono: "🧭" },
  seguro: { nombre: "Póliza de seguro", icono: "🛡" },
  bomberos: { nombre: "Bomberos / extintores", icono: "🧯" },
  licencia: { nombre: "Licencias y carnés", icono: "🪪" },
  contrato: { nombre: "Contratos y alquileres", icono: "📑" },
  otro: { nombre: "Otro", icono: "📌" }
};
const PERM_EMPRESAS = { HV: "Home Vacations", THT: "The House of Tours", Ambas: "Ambas empresas" };
const PERM_PERIODOS = { "": "Sin repetición fija", 1: "Cada mes", 3: "Cada 3 meses", 6: "Cada 6 meses", 12: "Cada año", 24: "Cada 2 años", 36: "Cada 3 años", 60: "Cada 5 años" };
const PERM_ACEPTA = ".pdf,.jpg,.jpeg,.png,.webp,.heic,.doc,.docx";
const PERM_MIME = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
const PERM_MAX = 10 * 1024 * 1024;
const PERM_AVISO_DIAS = 14;   // todos los permisos avisan dos semanas antes de vencer

const perm = {
  cargado: false,
  lista: [],
  registros: new Map(),     // permiso_id → registros (historial), se carga al abrir la ficha
  filtro: { texto: "", categoria: "", empresa: "", estado: "activos" }
};
const permEsAdmin = () => app.yo?.rol === "administrador";
const permHoy = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Costa_Rica" });
const permDias = (f) => Math.round((new Date(f + "T12:00:00") - new Date(permHoy() + "T12:00:00")) / 86400000);
const permFecha = (f) => fecha(f, { day: "numeric", month: "short", year: "numeric" });

function permSumarMeses(f, meses) {
  const [a, m, d] = f.split("-").map(Number);
  const destino = new Date(Date.UTC(a, m - 1 + meses, 1));
  const ultimo = new Date(Date.UTC(destino.getUTCFullYear(), destino.getUTCMonth() + 1, 0)).getUTCDate();
  destino.setUTCDate(Math.min(d, ultimo));
  return destino.toISOString().slice(0, 10);
}

// Estado según la fecha de vencimiento y los días de anticipación de cada permiso
function permEstado(p) {
  if (!p.activo) return { clave: "inactivo", texto: "Inactivo", clase: "gris", dias: null };
  const dias = permDias(p.vence);
  if (dias < 0) return { clave: "vencido", texto: "Vencido", clase: "alerta", dias };
  if (dias <= PERM_AVISO_DIAS) return { clave: "por_vencer", texto: "Por vencer", clase: "aviso", dias };
  return { clave: "al_dia", texto: "Al día", clase: "ok", dias };
}
function permFalta(dias) {
  if (dias === null) return "";
  if (dias < 0) return `Venció hace ${-dias} ${dias === -1 ? "día" : "días"}`;
  if (dias === 0) return "Vence hoy";
  if (dias === 1) return "Vence mañana";
  if (dias <= 60) return `Faltan ${dias} días`;
  const meses = Math.round(dias / 30.4);
  return `Faltan ${meses < 24 ? `${meses} meses` : `${Math.round(dias / 365)} años`}`;
}
const permPeso = (b) => !b ? "" : b < 1048576 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${String(Math.round(b / 104857.6) / 10).replace(".", ",")} MB`;
const permPorId = (id) => perm.lista.find((p) => p.id === Number(id));

// ---------- Acceso y contador del menú ----------
function permRevisarAcceso() {
  const admin = permEsAdmin();
  $("btnMenuPermisos").hidden = !admin;
  if (!admin) { $("permMenuCuenta").hidden = true; if ($("permAlarma")) $("permAlarma").hidden = true; if (!$("vistaPermisos").hidden) mostrarVista("reservas"); return; }
  if (!perm.cargado && !permRevisarAcceso.pidiendo) {
    permRevisarAcceso.pidiendo = true;
    permCargar().catch((e) => console.error("Permisos:", e)).finally(() => (permRevisarAcceso.pidiendo = false));
  }
}
function permActualizarCuenta() {
  const n = perm.lista.filter((p) => ["vencido", "por_vencer"].includes(permEstado(p).clave)).length;
  const c = $("permMenuCuenta");
  c.textContent = n;
  c.hidden = !n || !permEsAdmin();
  c.title = n ? `${n} ${n === 1 ? "permiso vencido o por vencer" : "permisos vencidos o por vencer"}` : "";
  permPintarAlarma();
}
// ---------- Alarma en el perfil de los administradores ----------
// Campana sobre la foto del usuario, aviso en su menú de perfil y una ventana de alarma
// la primera vez que entra cada día mientras haya permisos vencidos o por vencer.
const permPendientes = () => perm.lista
  .map((p) => ({ p, e: permEstado(p) }))
  .filter((x) => ["vencido", "por_vencer"].includes(x.e.clave))
  .sort((a, b) => a.e.dias - b.e.dias);

function permPintarAlarma() {
  let campana = $("permAlarma");
  if (!campana) {
    campana = document.createElement("span");
    campana.id = "permAlarma";
    campana.className = "perm-alarma";
    campana.setAttribute("aria-hidden", "true");
    campana.textContent = "🔔";
    $("chatAvatarBtn").appendChild(campana);
  }
  const pend = permEsAdmin() ? permPendientes() : [];
  const vencidos = pend.filter((x) => x.e.clave === "vencido").length;
  campana.hidden = !pend.length;
  campana.classList.toggle("vencido", vencidos > 0);
  campana.title = pend.length ? `${pend.length} ${pend.length === 1 ? "permiso vencido o por vencer" : "permisos vencidos o por vencer"}` : "";
  const btn = $("chatAvatarBtn");
  const base = (btn.getAttribute("aria-label") || "Mi perfil y mensajes").replace(/\. Alarma:.*$/, "");
  btn.setAttribute("aria-label", pend.length ? `${base}. Alarma: ${campana.title}` : base);
  permAlarmaDelDia(pend);
}

function htmlPermListaAlarma(pend, max = 6) {
  return pend.slice(0, max).map(({ p, e }) => `
    <li class="perm-alarma-item ${e.clave}">
      <span class="perm-estado ${e.clase}">${e.texto}</span>
      <span><strong>${escapar(p.nombre)}</strong><small>${permFecha(p.vence)} · ${permFalta(e.dias)}</small></span>
    </li>`).join("") + (pend.length > max ? `<li class="perm-alarma-mas">y ${pend.length - max} más…</li>` : "");
}

// Ventana de alarma: una vez al día por administrador (se vuelve a mostrar si aparece uno nuevo)
function permAlarmaDelDia(pend) {
  if (!pend.length || !app.yo?.id || !$("permModal").hidden) return;
  const firma = pend.map((x) => `${x.p.id}:${x.e.clave}`).join(",");
  const clave = `permAlarma:${app.yo.id}:${permHoy()}`;
  try { if (localStorage.getItem(clave) === firma) return; } catch (_) { if (permAlarmaDelDia.vista === firma) return; }
  permAlarmaDelDia.vista = firma;
  try { localStorage.setItem(clave, firma); } catch (_) {}
  const vencidos = pend.filter((x) => x.e.clave === "vencido").length;
  permAbrirModal(`
    <div class="det-cabeza perm-alarma-cab ${vencidos ? "vencido" : ""}">
      <div>
        <p class="det-numero">🔔 Alarma de vencimientos</p>
        <h2 id="permModalTitulo">${vencidos ? `${vencidos} ${vencidos === 1 ? "permiso vencido" : "permisos vencidos"}` : ""}${vencidos && pend.length > vencidos ? " y " : ""}${pend.length > vencidos ? `${pend.length - vencidos} por vencer` : ""}</h2>
        <p class="perm-sub">Estos permisos vencen en las próximas dos semanas o ya vencieron.</p>
      </div>
    </div>
    <div class="det-seccion"><ul class="perm-alarma-lista">${htmlPermListaAlarma(pend, 10)}</ul></div>
    <div class="det-seccion perm-alarma-btns">
      <button type="button" class="btn" data-perm-accion="cerrar">Recordarme mañana</button>
      <button type="button" class="btn primario" data-perm-accion="ir-permisos" autofocus>Ver permisos</button>
    </div>`);
}

// Al abrir el menú de la foto se agrega el aviso arriba (el menú lo arma chat.js)
$("chatAvatarBtn").addEventListener("click", () => {
  const menu = $("chatMenuPerfil");
  if (menu.hidden || !permEsAdmin()) return;
  const pend = permPendientes();
  if (!pend.length) return;
  const caja = document.createElement("div");
  caja.className = "perm-mp";
  caja.innerHTML = `
    <button type="button" class="mp-opcion importante" data-perm-mp="1">🔔 Permisos por renovar <span class="mp-cuenta">${pend.length}</span></button>
    <ul class="perm-alarma-lista compacta">${htmlPermListaAlarma(pend, 3)}</ul>`;
  menu.querySelector(".mp-cabeza")?.after(caja);
});
$("chatMenuPerfil").addEventListener("click", (e) => {
  if (!e.target.closest("[data-perm-mp], .perm-mp")) return;
  e.stopPropagation();
  $("chatMenuPerfil").hidden = true;
  perm.filtro.estado = "pendientes";
  mostrarVista("permisos");
}, true);

new MutationObserver(permRevisarAcceso).observe($("usuarioNombre"), { childList: true, characterData: true, subtree: true });
permRevisarAcceso();

document.addEventListener("vista-abierta", (e) => {
  if (e.detail !== "permisos") return;
  if (!permEsAdmin()) return mostrarVista("reservas");
  permAbrir(true);
});
document.addEventListener("datos-actualizados", () => {
  if (!permEsAdmin()) return;
  if (!$("vistaPermisos").hidden && $("permModal").hidden) permAbrir(true);
  else permCargar().catch(() => {});
});

// ---------- Carga ----------
async function permCargar() {
  const { data, error } = await db.from("permisos").select("*").order("vence");
  if (error) throw error;
  perm.lista = data || [];
  perm.cargado = true;
  permActualizarCuenta();
}
async function permAbrir(recargar = false) {
  if (recargar || !perm.cargado) {
    if (!perm.cargado) $("permContenido").innerHTML = `<p class="nota">Cargando…</p>`;
    try { await permCargar(); } catch (error) {
      $("permContenido").innerHTML = "";
      return fallo(error, "No se pudieron cargar los permisos.");
    }
  }
  permPintar();
}

// ---------- Lista ----------
function permFiltrados() {
  const f = perm.filtro;
  const t = f.texto.trim().toLowerCase();
  return perm.lista.filter((p) => {
    const e = permEstado(p).clave;
    if (f.estado === "inactivos" ? p.activo : !p.activo) return false;
    if (f.estado === "pendientes" && !["vencido", "por_vencer"].includes(e)) return false;
    if (f.categoria && p.categoria !== f.categoria) return false;
    if (f.empresa && p.empresa !== f.empresa && p.empresa !== "Ambas") return false;
    return !t || [p.nombre, p.referencia, p.institucion, p.responsable, p.notas].some((v) => String(v || "").toLowerCase().includes(t));
  }).sort((a, b) => (a.vence < b.vence ? -1 : a.vence > b.vence ? 1 : 0));
}

function permPintar() {
  const c = $("permContenido");
  const y = window.scrollY;
  const f = perm.filtro;
  const activos = perm.lista.filter((p) => p.activo);
  const cuenta = (clave) => activos.filter((p) => permEstado(p).clave === clave).length;
  const vencidos = cuenta("vencido"), porVencer = cuenta("por_vencer"), alDia = cuenta("al_dia");
  const lista = permFiltrados();

  const filas = lista.map((p) => {
    const e = permEstado(p);
    const cat = PERM_CATEGORIAS[p.categoria] || PERM_CATEGORIAS.otro;
    return `
      <tr class="perm-fila perm-${e.clave}">
        <td><span class="perm-estado ${e.clase}">${e.texto}</span></td>
        <td class="perm-nombre">
          <button type="button" class="enlace" data-perm-accion="abrir" data-id="${p.id}"><strong>${escapar(p.nombre)}</strong></button>
          ${p.referencia || p.institucion ? `<small>${[p.referencia, p.institucion].filter(Boolean).map(escapar).join(" · ")}</small>` : ""}
        </td>
        <td><span aria-hidden="true">${cat.icono}</span> ${escapar(cat.corto || cat.nombre)}</td>
        <td>${escapar(PERM_EMPRESAS[p.empresa] || p.empresa)}</td>
        <td class="perm-vence"><strong>${permFecha(p.vence)}</strong><small>${permFalta(e.dias)}</small></td>
        <td>${escapar(p.responsable || "—")}</td>
        <td class="perm-acciones">
          ${p.activo ? `<button type="button" class="btn ${e.clave === "al_dia" ? "" : "primario"}" data-perm-accion="renovar" data-id="${p.id}">Renovar</button>` : ""}
          <button type="button" class="btn" data-perm-accion="abrir" data-id="${p.id}">Abrir</button>
        </td>
      </tr>`;
  }).join("");

  c.innerHTML = `
    <div class="perm-cifras">
      <button type="button" class="fin-cifra alerta ${f.estado === "pendientes" ? "activa" : ""}" data-perm-accion="ver-pendientes"><span>Vencidos</span><strong>${vencidos}</strong></button>
      <button type="button" class="fin-cifra perm-aviso ${f.estado === "pendientes" ? "activa" : ""}" data-perm-accion="ver-pendientes"><span>Por vencer</span><strong>${porVencer}</strong></button>
      <button type="button" class="fin-cifra ok" data-perm-accion="ver-activos"><span>Al día</span><strong>${alDia}</strong></button>
      <button type="button" class="fin-cifra" data-perm-accion="ver-activos"><span>Total activos</span><strong>${activos.length}</strong></button>
    </div>
    <div class="herramientas stf-herramientas">
      <input id="permBuscar" type="search" placeholder="Buscar por nombre, placa, número o institución" aria-label="Buscar permiso" value="${escapar(f.texto)}">
      <select id="permFiltroCat" aria-label="Categoría"><option value="">Todas las categorías</option>${Object.entries(PERM_CATEGORIAS).map(([k, x]) => `<option value="${k}" ${k === f.categoria ? "selected" : ""}>${x.nombre}</option>`).join("")}</select>
      <select id="permFiltroEmp" aria-label="Empresa"><option value="">Ambas empresas</option>${["HV", "THT"].map((k) => `<option value="${k}" ${k === f.empresa ? "selected" : ""}>${PERM_EMPRESAS[k]}</option>`).join("")}</select>
      <select id="permFiltroEstado" aria-label="Estado">
        <option value="activos" ${f.estado === "activos" ? "selected" : ""}>Todos los activos</option>
        <option value="pendientes" ${f.estado === "pendientes" ? "selected" : ""}>Solo vencidos y por vencer</option>
        <option value="inactivos" ${f.estado === "inactivos" ? "selected" : ""}>Inactivos</option>
      </select>
      <button type="button" class="btn primario" data-perm-accion="nuevo">+ Nuevo permiso</button>
    </div>
    ${lista.length ? `
      <div class="tabla-scroll"><table class="tabla perm-tabla">
        <thead><tr><th>Estado</th><th>Permiso</th><th>Categoría</th><th>Empresa</th><th>Vence</th><th>Responsable</th><th><span class="sr-only">Acciones</span></th></tr></thead>
        <tbody>${filas}</tbody>
      </table></div>`
    : `<p class="nota perm-vacio">${perm.lista.length ? "No hay permisos con ese filtro." : "Todavía no hay permisos registrados. Toca «+ Nuevo permiso» para agregar la patente, el permiso de salud, el mantenimiento de un vehículo, etc."}</p>`}
    <p class="nota">Cada permiso pasa a «Por vencer» dos semanas (14 días) antes de su fecha de vencimiento. El número rojo del menú cuenta los vencidos y por vencer. Solo los administradores ven esta sección.</p>`;
  window.scrollTo(window.scrollX, y);
}

// ---------- Ventana (ficha, renovación) ----------
function permAbrirModal(html) {
  const m = $("permModal");
  m.innerHTML = `<section class="detalle stf-modal" role="dialog" aria-modal="true" aria-labelledby="permModalTitulo">${html}</section>`;
  m.hidden = false;
  document.body.classList.add("detalle-abierto");
  m.querySelector("[autofocus]")?.focus();
}
function permCerrarModal() {
  $("permModal").hidden = true;
  $("permModal").innerHTML = "";
  document.body.classList.remove("detalle-abierto");
}
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("permModal").hidden) permCerrarModal(); });

function htmlPermFicha(p) {
  const nuevo = !p.id;
  const e = nuevo ? null : permEstado(p);
  const v = (k) => escapar(p[k] ?? "");
  return `
    <div class="det-cabeza" style="--c: var(--verde)">
      <div>
        <p class="det-numero">${nuevo ? "Permiso nuevo" : `${escapar((PERM_CATEGORIAS[p.categoria] || PERM_CATEGORIAS.otro).nombre)} <span class="perm-estado ${e.clase}">${e.texto}</span>`}</p>
        <h2 id="permModalTitulo">${nuevo ? "Nuevo permiso o vencimiento" : escapar(p.nombre)}</h2>
        ${nuevo ? "" : `<p class="perm-sub">Vence el <strong>${permFecha(p.vence)}</strong> · ${permFalta(e.dias)}</p>`}
      </div>
      <div class="det-acciones">
        <button type="button" class="btn" data-perm-accion="cerrar">Cerrar</button>
        ${!nuevo && p.activo ? `<button type="button" class="btn primario" data-perm-accion="renovar" data-id="${p.id}">Renovar</button>` : ""}
        <button type="button" class="btn ${nuevo ? "primario" : ""}" data-perm-accion="guardar">Guardar</button>
      </div>
    </div>
    <form id="permFicha" class="stf-ficha" novalidate data-id="${p.id || ""}">
      <div class="det-seccion">
        <h3>Datos del permiso</h3>
        <div class="fila">
          <label>Nombre <input name="nombre" value="${v("nombre")}" placeholder="Ej.: Patente comercial oficina La Fortuna" required autofocus></label>
          <label>Categoría <select name="categoria">${Object.entries(PERM_CATEGORIAS).map(([k, x]) => `<option value="${k}" ${p.categoria === k ? "selected" : ""}>${x.nombre}</option>`).join("")}</select></label>
          <label>Empresa <select name="empresa">${Object.entries(PERM_EMPRESAS).map(([k, t]) => `<option value="${k}" ${p.empresa === k ? "selected" : ""}>${t}</option>`).join("")}</select></label>
        </div>
        <div class="fila">
          <label>Número, placa o referencia <input name="referencia" value="${v("referencia")}" placeholder="Ej.: placa CL-123456 o N.º de permiso"></label>
          <label>Institución o proveedor <input name="institucion" value="${v("institucion")}" placeholder="Ej.: Municipalidad de San Carlos, taller…"></label>
          <label>Responsable de renovarlo <input name="responsable" value="${v("responsable")}" placeholder="Nombre de quien lo tramita"></label>
        </div>
      </div>
      <div class="det-seccion">
        <h3>Vencimiento</h3>
        <div class="fila">
          <label>Fecha de vencimiento <input name="vence" type="date" value="${v("vence")}" required></label>
          <label>Se renueva <select name="periodicidad_meses">${Object.entries(PERM_PERIODOS).map(([k, t]) => `<option value="${k}" ${String(p.periodicidad_meses ?? "") === k ? "selected" : ""}>${t}</option>`).join("")}</select></label>
        </div>
        <label>Notas <textarea name="notas" rows="2" placeholder="Requisitos, kilometraje del próximo mantenimiento, contacto del trámite…">${escapar(p.notas || "")}</textarea></label>
        ${nuevo ? `<label>Documento actual (opcional: PDF, foto o Word, máx. 10 MB) <input name="archivo" type="file" accept="${PERM_ACEPTA}"></label>` : ""}
      </div>
    </form>
    ${nuevo ? "" : `
      <div class="det-seccion" id="permHistorial"><h3>Historial y documentos</h3><p class="nota">Cargando…</p></div>
      <div class="det-seccion perm-zona">
        <h3>Otras acciones</h3>
        <div class="perm-zona-btns">
          <button type="button" class="btn" data-perm-accion="activo" data-id="${p.id}">${p.activo ? "Inactivar (ya no se necesita)" : "Reactivar"}</button>
          <button type="button" class="btn peligro" data-perm-accion="eliminar" data-id="${p.id}">Eliminar permiso</button>
        </div>
        <p class="nota">Inactivar lo saca de la lista y del contador sin borrar su historial. Eliminar borra el permiso, su historial y sus documentos.</p>
      </div>`}`;
}

function permValoresFicha() {
  const d = Object.fromEntries(new FormData($("permFicha")).entries());
  if (!d.nombre?.trim()) { avisar("Escribe el nombre del permiso.", "error"); return null; }
  if (!d.vence) { avisar("Indica la fecha de vencimiento.", "error"); return null; }
  return {
    datos: {
      nombre: d.nombre.trim(), categoria: d.categoria || "otro", empresa: d.empresa || "Ambas",
      referencia: d.referencia?.trim() || null, institucion: d.institucion?.trim() || null, responsable: d.responsable?.trim() || null,
      vence: d.vence, periodicidad_meses: d.periodicidad_meses ? Number(d.periodicidad_meses) : null, avisar_dias: PERM_AVISO_DIAS,
      notas: d.notas?.trim() || null, actualizado_en: new Date().toISOString()
    },
    archivo: $("permFicha").querySelector('input[type="file"]')?.files[0] || null
  };
}

// Sube un archivo y devuelve los datos para el registro (o null si no hay archivo)
async function permSubirArchivo(permisoId, archivo) {
  if (!archivo) return {};
  if (archivo.size > PERM_MAX) throw new Error("El archivo pesa más de 10 MB.");
  const partes = archivo.name.split(".");
  const ext = partes.length > 1 ? partes.pop().toLowerCase() : "";
  const mime = PERM_MIME[ext];
  if (!mime) throw new Error("Ese tipo de archivo no se acepta. Usa PDF, JPG, PNG, WEBP, HEIC o Word.");
  const ruta = `${permisoId}/${Date.now()}_${nombreArchivo(partes.join(".")) || "documento"}.${ext}`;
  const { error } = await db.storage.from(PERM_BUCKET).upload(ruta, archivo, { contentType: mime, upsert: false });
  if (error) throw error;
  return { archivo: ruta, nombre_archivo: archivo.name, tipo_mime: mime, tamano: archivo.size };
}
function permRevisarArchivo(archivo) {
  if (!archivo) return true;
  const ext = archivo.name.includes(".") ? archivo.name.split(".").pop().toLowerCase() : "";
  if (!PERM_MIME[ext]) { avisar("Ese tipo de archivo no se acepta. Usa PDF, JPG, PNG, WEBP, HEIC o Word.", "error"); return false; }
  if (archivo.size > PERM_MAX) { avisar("El archivo pesa más de 10 MB. Si es una foto, conviértela a PDF o tómala con menos resolución.", "error"); return false; }
  return true;
}

async function permGuardar() {
  const v = permValoresFicha();
  if (!v || !permRevisarArchivo(v.archivo)) return;
  const id = Number($("permFicha").dataset.id) || null;
  if (id) {
    const antes = permPorId(id);
    const { error } = await db.from("permisos").update(v.datos).eq("id", id);
    if (error) return fallo(error);
    // Si se cambió la fecha a mano, queda anotado en el historial
    if (antes && antes.vence !== v.datos.vence) {
      await db.from("permisos_registros").insert({ permiso_id: id, tipo: "cambio", fecha: permHoy(), vence_anterior: antes.vence, vence_nuevo: v.datos.vence, notas: "Fecha de vencimiento corregida" });
    }
    avisar("Permiso guardado.");
  } else {
    const { data, error } = await db.from("permisos").insert(v.datos).select("id").single();
    if (error) return fallo(error);
    let doc = {};
    try { doc = await permSubirArchivo(data.id, v.archivo); } catch (err) { fallo(err, "El permiso se creó, pero no se pudo subir el documento."); }
    await db.from("permisos_registros").insert({ permiso_id: data.id, tipo: "inicial", fecha: permHoy(), vence_nuevo: v.datos.vence, notas: "Registro inicial", ...doc });
    avisar("Permiso creado.");
  }
  permCerrarModal();
  await permAbrir(true);
}

// ---------- Historial ----------
async function permCargarHistorial(id) {
  const { data, error } = await db.from("permisos_registros").select("*").eq("permiso_id", id).order("fecha", { ascending: false }).order("id", { ascending: false });
  const caja = $("permHistorial");
  if (!caja) return;
  if (error) { caja.querySelector(".nota").textContent = "No se pudo cargar el historial."; return fallo(error, "No se pudo cargar el historial."); }
  perm.registros.set(id, data || []);
  permPintarHistorial(id);
}
const PERM_TIPO_REG = { inicial: "Registro inicial", renovacion: "Renovación", documento: "Documento agregado", cambio: "Cambio de fecha" };
function permPintarHistorial(id) {
  const caja = $("permHistorial");
  if (!caja) return;
  const regs = perm.registros.get(id) || [];
  caja.innerHTML = `
    <h3>Historial y documentos</h3>
    ${regs.length ? `<ul class="stf-docs">${regs.map((r) => `
      <li class="stf-doc">
        <span class="stf-doc-icono" aria-hidden="true">${r.tipo === "renovacion" ? "🔄" : r.archivo ? "📄" : "📝"}</span>
        <span class="stf-doc-info">
          <strong>${PERM_TIPO_REG[r.tipo] || r.tipo}</strong> <small>· ${permFecha(r.fecha)}</small>
          ${r.vence_nuevo && r.tipo !== "inicial" ? `<span class="stf-doc-desc">${r.vence_anterior ? `Vencía ${permFecha(r.vence_anterior)} → ` : ""}nuevo vencimiento ${permFecha(r.vence_nuevo)}</span>` : ""}
          ${r.costo ? `<span class="stf-doc-desc">Costo: ${colonesPerm(r.costo)}</span>` : ""}
          ${r.notas && r.notas !== "Registro inicial" ? `<span class="stf-doc-desc">${escapar(r.notas)}</span>` : ""}
          ${r.archivo ? `<small class="stf-doc-archivo">${escapar(r.nombre_archivo)}${r.tamano ? ` · ${permPeso(r.tamano)}` : ""}</small>` : ""}
        </span>
        ${r.archivo ? `<span class="stf-doc-acciones">
          <button type="button" class="btn" data-perm-accion="ver-doc" data-reg="${r.id}" data-id="${id}">Ver</button>
          <button type="button" class="btn" data-perm-accion="bajar-doc" data-reg="${r.id}" data-id="${id}">Descargar</button>
        </span>` : ""}
      </li>`).join("")}</ul>` : `<p class="nota">Sin movimientos todavía.</p>`}
    <p class="stf-subtitulo">Agregar un documento (sin renovar)</p>
    <div class="fila stf-doc-subir">
      <label>Descripción <input id="permDocNota" maxlength="200" placeholder="Ej.: recibo de pago, requisito presentado…"></label>
      <label>Archivo <input id="permDocArchivo" type="file" accept="${PERM_ACEPTA}"></label>
      <button type="button" class="btn" data-perm-accion="subir-doc" data-id="${id}">Subir</button>
    </div>`;
}
const colonesPerm = (n) => "₡" + new Intl.NumberFormat("es-CR", { maximumFractionDigits: 2 }).format(Number(n) || 0);

async function permSubirDocumento(id) {
  const archivo = $("permDocArchivo").files[0];
  if (!archivo) return avisar("Elige el archivo.", "error");
  if (!permRevisarArchivo(archivo)) return;
  let doc;
  try { doc = await permSubirArchivo(id, archivo); } catch (err) { return fallo(err, "No se pudo subir el archivo."); }
  const { error } = await db.from("permisos_registros").insert({ permiso_id: id, tipo: "documento", fecha: permHoy(), notas: $("permDocNota").value.trim() || null, ...doc });
  if (error) { await db.storage.from(PERM_BUCKET).remove([doc.archivo]); return fallo(error, "No se pudo registrar el documento."); }
  avisar("Documento agregado.");
  await permCargarHistorial(id);
}

async function permAbrirDocumento(id, regId, descargar) {
  const r = (perm.registros.get(Number(id)) || []).find((x) => x.id === Number(regId));
  if (!r?.archivo) return;
  const ventana = descargar ? null : window.open("", "_blank");
  const { data, error } = await db.storage.from(PERM_BUCKET).createSignedUrl(r.archivo, 300, descargar ? { download: r.nombre_archivo } : undefined);
  if (error) { ventana?.close(); return fallo(error, "No se pudo abrir el documento."); }
  if (ventana) ventana.location.href = data.signedUrl;
  else window.location.assign(data.signedUrl);
}

// ---------- Renovación ----------
function htmlPermRenovar(p) {
  const base = p.vence > permHoy() ? p.vence : permHoy();
  const sugerida = permSumarMeses(base, Number(p.periodicidad_meses) || 12);
  return `
    <div class="det-cabeza" style="--c: var(--verde)">
      <div>
        <p class="det-numero">Renovar</p>
        <h2 id="permModalTitulo">${escapar(p.nombre)}</h2>
        <p class="perm-sub">Vencimiento actual: <strong>${permFecha(p.vence)}</strong> · ${permFalta(permEstado(p).dias)}</p>
      </div>
      <div class="det-acciones">
        <button type="button" class="btn" data-perm-accion="abrir" data-id="${p.id}">Volver</button>
        <button type="button" class="btn primario" data-perm-accion="guardar-renovacion" data-id="${p.id}">Guardar renovación</button>
      </div>
    </div>
    <form id="permRenovar" class="stf-ficha" novalidate>
      <div class="det-seccion">
        <div class="fila">
          <label>Nueva fecha de vencimiento <input name="vence_nuevo" type="date" value="${sugerida}" min="${permHoy()}" required autofocus></label>
          <label>Fecha en que se renovó <input name="fecha" type="date" value="${permHoy()}" max="${permHoy()}"></label>
          <label>Costo pagado (₡, opcional) <input name="costo" type="number" min="0" step="any" inputmode="decimal"></label>
        </div>
        <label>Notas <input name="notas" maxlength="300" placeholder="Ej.: pagado en la municipalidad, recibo N.º…; próximo mantenimiento a los 85.000 km"></label>
        <label>Documento nuevo o comprobante (opcional: PDF, foto o Word, máx. 10 MB) <input name="archivo" type="file" accept="${PERM_ACEPTA}"></label>
        <p class="nota">La fecha sugerida suma ${p.periodicidad_meses ? (p.periodicidad_meses % 12 === 0 ? (p.periodicidad_meses === 12 ? "un año" : `${p.periodicidad_meses / 12} años`) : `${p.periodicidad_meses} ${p.periodicidad_meses === 1 ? "mes" : "meses"}`) : "un año"} al vencimiento actual (o a hoy, si ya venció); cámbiala si hace falta. El vencimiento anterior queda guardado en el historial.</p>
      </div>
    </form>`;
}

async function permGuardarRenovacion(id) {
  const p = permPorId(id);
  const d = Object.fromEntries(new FormData($("permRenovar")).entries());
  const archivo = $("permRenovar").querySelector('input[type="file"]').files[0] || null;
  if (!d.vence_nuevo) return avisar("Indica la nueva fecha de vencimiento.", "error");
  if (d.vence_nuevo <= p.vence && !confirm("La nueva fecha no es posterior al vencimiento actual. ¿Guardar de todos modos?")) return;
  if (!permRevisarArchivo(archivo)) return;
  let doc = {};
  try { doc = await permSubirArchivo(id, archivo); } catch (err) { return fallo(err, "No se pudo subir el archivo."); }
  const { error } = await db.from("permisos_registros").insert({
    permiso_id: id, tipo: "renovacion", fecha: d.fecha || permHoy(), vence_anterior: p.vence, vence_nuevo: d.vence_nuevo,
    costo: d.costo ? Number(d.costo) : null, notas: d.notas?.trim() || null, ...doc
  });
  if (error) { if (doc.archivo) await db.storage.from(PERM_BUCKET).remove([doc.archivo]); return fallo(error, "No se pudo guardar la renovación."); }
  const { error: e2 } = await db.from("permisos").update({ vence: d.vence_nuevo, actualizado_en: new Date().toISOString() }).eq("id", id);
  if (e2) return fallo(e2, "Se guardó el registro, pero no la nueva fecha.");
  avisar(`Renovado hasta el ${permFecha(d.vence_nuevo)}.`);
  permCerrarModal();
  await permAbrir(true);
}

async function permCambiarActivo(id) {
  const p = permPorId(id);
  const { error } = await db.from("permisos").update({ activo: !p.activo, actualizado_en: new Date().toISOString() }).eq("id", id);
  if (error) return fallo(error);
  avisar(p.activo ? "Permiso inactivado." : "Permiso reactivado.");
  permCerrarModal();
  await permAbrir(true);
}

async function permEliminar(id) {
  const p = permPorId(id);
  if (!confirm(`¿Eliminar «${p.nombre}» con todo su historial y documentos? No se puede deshacer.\n\nSi solo ya no se necesita, mejor usa «Inactivar».`)) return;
  const { data: archivos } = await db.storage.from(PERM_BUCKET).list(String(id));
  const { error } = await db.from("permisos").delete().eq("id", id);
  if (error) return fallo(error, "No se pudo eliminar.");
  if (archivos?.length) await db.storage.from(PERM_BUCKET).remove(archivos.map((a) => `${id}/${a.name}`));
  avisar("Permiso eliminado.");
  permCerrarModal();
  await permAbrir(true);
}

function permAbrirFicha(id) {
  const p = permPorId(id);
  if (!p) return;
  permAbrirModal(htmlPermFicha(p));
  permCargarHistorial(p.id);
}

// ---------- Eventos ----------
$("permContenido").addEventListener("click", (e) => {
  const b = e.target.closest("[data-perm-accion]");
  if (!b) return;
  const a = b.dataset.permAccion;
  if (a === "nuevo") return permAbrirModal(htmlPermFicha({ activo: true, categoria: "patente", empresa: "Ambas", periodicidad_meses: 12 }));
  if (a === "abrir") return permAbrirFicha(b.dataset.id);
  if (a === "renovar") return permAbrirModal(htmlPermRenovar(permPorId(b.dataset.id)));
  if (a === "ver-pendientes") { perm.filtro.estado = "pendientes"; return permPintar(); }
  if (a === "ver-activos") { perm.filtro.estado = "activos"; return permPintar(); }
});
$("permContenido").addEventListener("input", (e) => {
  if (e.target.id !== "permBuscar") return;
  perm.filtro.texto = e.target.value;
  const pos = e.target.selectionStart;
  permPintar();
  const n = $("permBuscar"); n.focus(); n.setSelectionRange(pos, pos);
});
$("permContenido").addEventListener("change", (e) => {
  const t = e.target, f = perm.filtro;
  if (t.id === "permFiltroCat") f.categoria = t.value;
  else if (t.id === "permFiltroEmp") f.empresa = t.value;
  else if (t.id === "permFiltroEstado") f.estado = t.value;
  else return;
  permPintar();
});
$("permModal").addEventListener("click", (e) => {
  if (e.target.id === "permModal") return permCerrarModal();
  const b = e.target.closest("[data-perm-accion]");
  if (!b) return;
  const a = b.dataset.permAccion;
  const id = Number(b.dataset.id);
  if (a === "cerrar") return permCerrarModal();
  if (a === "ir-permisos") { permCerrarModal(); perm.filtro.estado = "pendientes"; return mostrarVista("permisos"); }
  if (a === "guardar") return conBoton(b, permGuardar);
  if (a === "abrir") return permAbrirFicha(id);
  if (a === "renovar") return permAbrirModal(htmlPermRenovar(permPorId(id)));
  if (a === "guardar-renovacion") return conBoton(b, () => permGuardarRenovacion(id));
  if (a === "activo") return conBoton(b, () => permCambiarActivo(id));
  if (a === "eliminar") return conBoton(b, () => permEliminar(id));
  if (a === "subir-doc") return conBoton(b, () => permSubirDocumento(id));
  if (a === "ver-doc") return permAbrirDocumento(id, b.dataset.reg, false);
  if (a === "bajar-doc") return conBoton(b, () => permAbrirDocumento(id, b.dataset.reg, true));
});
// Al cambiar la categoría de un permiso nuevo, se sugiere cada cuánto se renueva
$("permModal").addEventListener("change", (e) => {
  const form = $("permFicha");
  if (!form || form.dataset.id || e.target.name !== "categoria") return;
  const sug = { vehiculo: 6, seguro: 12, patente: 12, bomberos: 12 }[e.target.value];
  if (sug) form.periodicidad_meses.value = String(sug);
});
