// =====================================================
// STAFF: perfiles del personal y horarios
// (usa las utilidades y datos de panel.js; la planilla está en planilla.js)
// =====================================================

VISTAS.staff = "vistaStaff";

const DIAS_SEMANA = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const DIAS_CORTO = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const EMPRESAS = { HV: "Home Vacations", THT: "The House of Tours", Ambas: "Ambas empresas" };
const TIPOS_CELDA = {
  trabajo: { nombre: "Trabaja", clase: "t-trabajo" },
  libre: { nombre: "Libre", clase: "t-libre" },
  vacaciones: { nombre: "Vacaciones", clase: "t-vac" },
  incapacidad: { nombre: "Incapacidad", clase: "t-inc" }
};

const stf = {
  pestana: "perfiles",
  cargado: false,
  personas: [],
  privado: new Map(),        // persona_id → datos privados (solo administradores)
  filtro: { texto: "", puesto: "", empresa: "", estado: "activos" },
  // Horarios
  horarios: [],
  horario: null,             // { h, personas, celdas: Map("persona|fecha" → celda) }
  turnos: ["06:00", "07:00", "08:00", "10:00", "12:00"],
  turnoSel: { tipo: "trabajo", entrada: "08:00" },
  nuevo: null                // formulario de horario nuevo
};

const stfEsAdmin = () => app.yo?.rol === "administrador";
const stfVePerfiles = () => puede("ver_perfiles_staff");
const stfGestiona = () => puede("gestionar_horarios");
const stfPestanaPermitida = (p) =>
  p === "horarios" || (p === "perfiles" && stfVePerfiles()) || (p === "planilla" && stfEsAdmin());

// ---------- Utilidades compartidas con planilla.js ----------
function colones(n, decimales = 0) {
  const v = Number(n) || 0;
  const signo = v < 0 ? "−" : "";
  const [ent, dec] = Math.abs(v).toFixed(decimales).split(".");
  return `${signo}₡${ent.replace(/\B(?=(\d{3})+(?!\d))/g, ".")}${dec ? "," + dec : ""}`;
}
function dolares(n) {
  const v = Number(n) || 0;
  return `${v < 0 ? "−" : ""}$${Math.abs(v).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
}
function hora12(h) {
  if (!h) return "";
  const [a, b] = String(h).slice(0, 5).split(":").map(Number);
  const sufijo = a < 12 ? "AM" : "PM";
  const h12 = a % 12 === 0 ? 12 : a % 12;
  return `${h12}:${pad(b)} ${sufijo}`;
}
function sumarHoras(h, horas) {
  const [a, b] = String(h).slice(0, 5).split(":").map(Number);
  const t = (a * 60 + b + horas * 60) % (24 * 60);
  return `${pad(Math.floor(t / 60))}:${pad(t % 60)}`;
}
function fechasEntre(desde, hasta) {
  const lista = [];
  const d = new Date(desde + "T12:00:00");
  const fin = new Date(hasta + "T12:00:00");
  while (d <= fin && lista.length < 400) { lista.push(aTexto(d)); d.setDate(d.getDate() + 1); }
  return lista;
}
const diaSemana = (f) => new Date(f + "T12:00:00").getDay();
const iniciales = (n) => String(n || "").split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join("");
const fechaCorta = (f) => fecha(f, { day: "numeric", month: "short" });
const fechaAnio = (f) => fecha(f, { day: "numeric", month: "short", year: "numeric" });
const horasJornada = (p) => (p?.jornada === "media" ? 4 : 8);

let stfPromesaExcel = null;
function stfCargarExcel() {
  if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
  return (stfPromesaExcel ||= new Promise((ok, mal) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js";
    s.onload = () => ok(window.ExcelJS);
    s.onerror = () => { stfPromesaExcel = null; mal(new Error("No se pudo cargar el generador de Excel. Revisa tu conexión a internet.")); };
    document.head.appendChild(s);
  }));
}
function stfDescargar(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = nombre;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
const nombreArchivo = (t) => String(t).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_|_$/g, "");

// Impresión: el contenido se arma en #impresion; "horizontal" gira la hoja carta
function stfImprimir(html, horizontal = false) {
  $("impresion").innerHTML = html;
  let estilo = null;
  if (horizontal) {
    estilo = document.createElement("style");
    estilo.textContent = "@page { size: letter landscape; margin: 10mm; }";
    document.head.appendChild(estilo);
  }
  document.body.classList.add("imprimiendo");
  window.print();
  if (estilo) setTimeout(() => estilo.remove(), 1000);
}

// ---------- Modal propio de Staff ----------
function stfAbrirModal(html, ancho = "") {
  const m = $("staffModal");
  m.innerHTML = `<section class="detalle stf-modal ${ancho}" role="dialog" aria-modal="true" aria-labelledby="stfModalTitulo">${html}</section>`;
  m.hidden = false;
  document.body.classList.add("detalle-abierto");
  m.querySelector("[autofocus]")?.focus();
}
function stfCerrarModal() {
  $("staffModal").hidden = true;
  $("staffModal").innerHTML = "";
  document.body.classList.remove("detalle-abierto");
}
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("staffModal").hidden) stfCerrarModal(); });
$("staffModal").addEventListener("click", (e) => { if (e.target.id === "staffModal") stfCerrarModal(); });

// =====================================================
// NAVEGACIÓN
// =====================================================
document.addEventListener("vista-abierta", (e) => { if (e.detail === "staff") stfAbrir(true); });
document.addEventListener("datos-actualizados", () => {
  if (!$("vistaStaff").hidden && $("staffModal").hidden && !stf.nuevo) stfAbrir(true);
});
document.querySelectorAll(".pestana[data-staff]").forEach((b) => b.addEventListener("click", () => {
  stf.pestana = b.dataset.staff;
  stf.horario = null; stf.nuevo = null;
  stfAbrir(false);
}));

async function stfAbrir(recargar = false) {
  document.querySelectorAll(".pestana[data-staff]").forEach((b) => (b.hidden = !stfPestanaPermitida(b.dataset.staff)));
  if (!stfPestanaPermitida(stf.pestana)) stf.pestana = stfVePerfiles() ? "perfiles" : "horarios";
  document.querySelectorAll(".pestana[data-staff]").forEach((b) => {
    const activa = b.dataset.staff === stf.pestana;
    b.classList.toggle("activa", activa);
    b.setAttribute("aria-selected", activa);
  });
  if (stf.pestana === "planilla") return plaAbrir(recargar);
  if (recargar || !stf.cargado) {
    $("staffContenido").innerHTML = `<p class="nota">Cargando…</p>`;
    try { await stfCargar(); } catch (error) {
      $("staffContenido").innerHTML = "";
      return fallo(error, "No se pudo cargar Staff.");
    }
  }
  stfPintar();
}

async function stfCargar() {
  const tareas = [
    db.from("staff_personas").select("*").order("nombre"),
    db.from("staff_horarios").select("*, staff_horario_personas(persona_id)").order("desde", { ascending: false }),
    db.from("staff_ajustes").select("*")
  ];
  if (stfEsAdmin()) tareas.push(db.from("staff_privado").select("*"), db.from("pla_ajustes").select("valor").eq("clave", "conceptos").maybeSingle());
  const [p, h, a, pr, co] = await Promise.all(tareas);
  const error = p.error || h.error || a.error || pr?.error || co?.error;
  if (error) throw error;
  stf.personas = p.data || [];
  stf.horarios = h.data || [];
  const turnos = (a.data || []).find((x) => x.clave === "turnos");
  if (Array.isArray(turnos?.valor)) stf.turnos = turnos.valor;
  stf.privado = new Map((pr?.data || []).map((x) => [x.persona_id, x]));
  stf.conceptos = co?.data?.valor || [];
  stf.cargado = true;
  if (stf.horario) await stfCargarHorario(stf.horario.h.id);
}

function stfPintar() {
  const c = $("staffContenido");
  if (stf.pestana === "perfiles") c.innerHTML = htmlPerfiles();
  else if (stf.nuevo) c.innerHTML = htmlNuevoHorario();
  else if (stf.horario) c.innerHTML = htmlHorario();
  else c.innerHTML = htmlHorarios();
}

// =====================================================
// PERFILES DE COLABORADORES
// =====================================================
const personaPorId = (id) => stf.personas.find((p) => p.id === Number(id));
const puestosConocidos = () => [...new Set(stf.personas.map((p) => p.puesto).filter(Boolean))].sort();
function fotoPersona(p) {
  const lista = typeof chat !== "undefined" && Array.isArray(chat.perfiles) ? chat.perfiles : [];
  const perfil = p.perfil_id ? lista.find((x) => x.id === p.perfil_id) : null;
  return perfil?.foto_url || "";
}
function avatar(p, grande = false) {
  const foto = fotoPersona(p);
  return foto
    ? `<img class="stf-avatar ${grande ? "grande" : ""}" src="${escapar(foto)}" alt="">`
    : `<span class="stf-avatar ${grande ? "grande" : ""}" aria-hidden="true">${escapar(iniciales(p.nombre))}</span>`;
}

function personasFiltradas() {
  const f = stf.filtro;
  const t = f.texto.trim().toLowerCase();
  return stf.personas.filter((p) =>
    (f.estado === "todos" || (f.estado === "activos" ? p.activo : !p.activo)) &&
    (!f.puesto || p.puesto === f.puesto) &&
    (!f.empresa || p.empresa === f.empresa) &&
    (!t || [p.nombre, p.telefono, p.puesto, p.cedula].some((v) => String(v || "").toLowerCase().includes(t))));
}

function htmlPerfiles() {
  const f = stf.filtro;
  const lista = personasFiltradas();
  const tarjetas = lista.map((p) => `
    <button type="button" class="stf-tarjeta ${p.activo ? "" : "inactivo"}" data-stf-accion="ficha" data-id="${p.id}">
      <span class="stf-tarjeta-cab">${avatar(p)}
        <span><strong>${escapar(p.nombre)}</strong><small>${escapar(p.puesto || "Sin puesto")}</small></span>
      </span>
      <span class="stf-chips">
        <span class="stf-chip">${escapar(EMPRESAS[p.empresa] || p.empresa)}</span>
        <span class="stf-chip ${p.activo ? "ok" : "gris"}">${p.activo ? "Activo" : "Inactivo"}</span>
        ${p.perfil_id ? `<span class="stf-chip">Usuario del sistema</span>` : ""}
      </span>
      <small>${escapar(p.telefono || "Sin teléfono")}${p.dia_libre != null ? ` · Libre: ${DIAS_SEMANA[p.dia_libre]}` : ""}</small>
    </button>`).join("");

  return `
    <div class="herramientas stf-herramientas">
      <input id="stfBuscar" type="search" placeholder="Buscar por nombre, teléfono o cédula" aria-label="Buscar colaborador" value="${escapar(f.texto)}">
      <select id="stfFiltroPuesto" aria-label="Puesto"><option value="">Todos los puestos</option>${puestosConocidos().map((x) => `<option ${x === f.puesto ? "selected" : ""}>${escapar(x)}</option>`).join("")}</select>
      <select id="stfFiltroEmpresa" aria-label="Empresa"><option value="">Ambas empresas</option>${Object.entries(EMPRESAS).filter(([k]) => k !== "Ambas").map(([k, v]) => `<option value="${k}" ${k === f.empresa ? "selected" : ""}>${v}</option>`).join("")}</select>
      <select id="stfFiltroEstado" aria-label="Estado">
        <option value="activos" ${f.estado === "activos" ? "selected" : ""}>Activos</option>
        <option value="inactivos" ${f.estado === "inactivos" ? "selected" : ""}>Inactivos</option>
        <option value="todos" ${f.estado === "todos" ? "selected" : ""}>Todos</option>
      </select>
      ${stfEsAdmin() ? `<button type="button" class="btn primario" data-stf-accion="nueva-persona">+ Nuevo colaborador</button>` : ""}
    </div>
    ${!stfEsAdmin() ? `<p class="nota">Puedes consultar las fichas. Solo un administrador puede crearlas, modificarlas o inactivarlas.</p>` : ""}
    <div class="stf-tarjetas">${tarjetas || `<p class="nota">No hay colaboradores con ese filtro.</p>`}</div>`;
}

function htmlFicha(p) {
  const nuevo = !p.id;
  const admin = stfEsAdmin();
  const dis = admin ? "" : "disabled";
  const pr = stf.privado.get(p.id) || { tipo_pago: "mensual", bloque: p.empresa === "HV" ? "HV" : "THT", salario_mensual: 0, tarifa_hora: 0, monto_usd: 0, rebajos_fijos: {}, notas: "" };
  const usados = new Set(stf.personas.filter((x) => x.perfil_id && x.id !== p.id).map((x) => x.perfil_id));
  const usuarios = (app.perfiles || []).filter((u) => !usados.has(u.id));
  const conceptos = (stf.conceptos || []).filter((c) => c.tipo === "rebajo");
  const v = (k) => escapar(p[k] ?? "");

  return `
    <div class="det-cabeza" style="--c: var(--verde)">
      <div class="stf-ficha-cab">
        ${avatar(p, true)}
        <div>
          <p class="det-numero">Ficha de colaborador ${!nuevo ? `<span class="stf-chip ${p.activo ? "ok" : "gris"}">${p.activo ? "Activo" : "Inactivo"}</span>` : ""}</p>
          <h2 id="stfModalTitulo">${nuevo ? "Nuevo colaborador" : escapar(p.nombre)}</h2>
        </div>
      </div>
      <div class="det-acciones">
        <button type="button" class="btn" data-stf-accion="cerrar-modal">Cerrar</button>
        ${admin && !nuevo ? `<button type="button" class="btn ${p.activo ? "peligro" : ""}" data-stf-accion="activar" data-id="${p.id}">${p.activo ? "Inactivar" : "Reactivar"}</button>` : ""}
        ${admin ? `<button type="button" class="btn primario" data-stf-accion="guardar-persona">Guardar</button>` : ""}
      </div>
    </div>
    <form id="stfFicha" class="stf-ficha" novalidate data-id="${p.id || ""}">
      <div class="det-seccion">
        <h3>Datos personales</h3>
        <div class="fila">
          <label>Nombre completo <input name="nombre" value="${v("nombre")}" required ${dis} autofocus></label>
          <label>Cédula <input name="cedula" value="${v("cedula")}" ${dis}></label>
          <label>Fecha de nacimiento <input name="fecha_nacimiento" type="date" value="${v("fecha_nacimiento")}" ${dis}></label>
        </div>
        <label>Idiomas que habla <input name="idiomas" value="${v("idiomas")}" placeholder="Español, inglés…" ${dis}></label>
      </div>
      <div class="det-seccion">
        <h3>Contacto</h3>
        <div class="fila">
          <label>Teléfono / WhatsApp <input name="telefono" value="${v("telefono")}" placeholder="+506" ${dis}></label>
          <label>Correo <input name="correo" type="email" value="${v("correo")}" ${dis}></label>
        </div>
        <p class="stf-subtitulo">Contacto de emergencia</p>
        <div class="fila">
          <label>Nombre <input name="emergencia_nombre" value="${v("emergencia_nombre")}" ${dis}></label>
          <label>Parentesco <input name="emergencia_parentesco" value="${v("emergencia_parentesco")}" ${dis}></label>
          <label>Teléfono <input name="emergencia_telefono" value="${v("emergencia_telefono")}" ${dis}></label>
        </div>
      </div>
      <div class="det-seccion">
        <h3>Datos laborales</h3>
        <div class="fila">
          <label>Puesto <input name="puesto" value="${v("puesto")}" list="stfPuestos" ${dis}></label>
          <label>Empresa <select name="empresa" ${dis}>${Object.entries(EMPRESAS).map(([k, t]) => `<option value="${k}" ${p.empresa === k ? "selected" : ""}>${t}</option>`).join("")}</select></label>
          <label>Fecha de ingreso <input name="fecha_ingreso" type="date" value="${v("fecha_ingreso")}" ${dis}></label>
        </div>
        <div class="fila">
          <label>Jornada <select name="jornada" ${dis}><option value="completa" ${p.jornada !== "media" ? "selected" : ""}>Tiempo completo (8 h diarias)</option><option value="media" ${p.jornada === "media" ? "selected" : ""}>Medio tiempo (4 h diarias)</option></select></label>
          <label>Día libre habitual <select name="dia_libre" ${dis}><option value="">Sin día fijo</option>${DIAS_SEMANA.map((d, i) => `<option value="${i}" ${Number(p.dia_libre) === i && p.dia_libre != null ? "selected" : ""}>${d}</option>`).join("")}</select></label>
          <label>Fecha de salida <input name="fecha_salida" type="date" value="${v("fecha_salida")}" ${dis}></label>
        </div>
        <datalist id="stfPuestos">${puestosConocidos().map((x) => `<option value="${escapar(x)}">`).join("")}</datalist>
      </div>
      <div class="det-seccion">
        <h3>Acceso al sistema y reloj marcador</h3>
        <div class="fila">
          <label>Usuario vinculado <select name="perfil_id" ${dis}><option value="">Sin usuario</option>${usuarios.map((u) => `<option value="${u.id}" ${u.id === p.perfil_id ? "selected" : ""}>${escapar(u.nombre)} (${escapar(u.rol)})</option>`).join("")}</select></label>
          <label>Nombre en el reloj marcador <input name="nombre_reloj" value="${v("nombre_reloj")}" placeholder="Como aparece en el reloj" ${dis}></label>
        </div>
        <p class="nota">Con el usuario vinculado, la persona ve en Staff › Horarios los horarios publicados en los que está incluida. El correo, la clave y el tipo de usuario se siguen administrando en Mantenimiento › Usuarios.</p>
      </div>
      ${admin ? `
      <div class="det-seccion stf-privado">
        <h3>Planilla y notas internas <span class="stf-chip alerta">Solo administradores</span></h3>
        <div class="fila">
          <label>Tipo de pago <select name="tipo_pago">
            <option value="mensual" ${pr.tipo_pago === "mensual" ? "selected" : ""}>Salario mensual con CCSS</option>
            <option value="hora" ${pr.tipo_pago === "hora" ? "selected" : ""}>Por horas (sin CCSS)</option>
            <option value="socio" ${pr.tipo_pago === "socio" ? "selected" : ""}>Socio en dólares (sin CCSS)</option>
          </select></label>
          <label>Bloque en la planilla <select name="bloque">
            <option value="HV" ${pr.bloque === "HV" ? "selected" : ""}>Home Vacations</option>
            <option value="THT" ${pr.bloque === "THT" ? "selected" : ""}>The House of Tours</option>
            <option value="HORA" ${pr.bloque === "HORA" ? "selected" : ""}>Trabajadores por hora</option>
            <option value="SOCIOS" ${pr.bloque === "SOCIOS" ? "selected" : ""}>Socios</option>
          </select></label>
        </div>
        <div class="fila">
          <label>Salario mensual (₡) <input name="salario_mensual" type="number" min="0" step="100" value="${Number(pr.salario_mensual) || 0}"></label>
          <label>Tarifa por hora (₡) <input name="tarifa_hora" type="number" min="0" step="25" value="${Number(pr.tarifa_hora) || 0}"></label>
          <label>Monto quincenal ($, socios) <input name="monto_usd" type="number" min="0" step="10" value="${Number(pr.monto_usd) || 0}"></label>
        </div>
        ${conceptos.length ? `<p class="stf-subtitulo">Rebajos fijos de cada quincena (se copian al crear la quincena)</p>
        <div class="fila">${conceptos.map((c) => `<label>${escapar(c.nombre)} (₡) <input name="rebajo_${escapar(c.clave)}" type="number" min="0" step="100" value="${Number(pr.rebajos_fijos?.[c.clave]) || 0}"></label>`).join("")}</div>` : ""}
        <label>Notas internas <textarea name="notas" rows="3" placeholder="Observaciones privadas">${escapar(pr.notas || "")}</textarea></label>
      </div>` : ""}
    </form>`;
}

async function stfGuardarPersona() {
  const form = $("stfFicha");
  const d = Object.fromEntries(new FormData(form).entries());
  if (!d.nombre?.trim()) { avisar("Escribe el nombre del colaborador.", "error"); return; }
  const id = Number(form.dataset.id) || null;
  const persona = {
    nombre: d.nombre.trim(), cedula: d.cedula || null, fecha_nacimiento: d.fecha_nacimiento || null, idiomas: d.idiomas || null,
    telefono: d.telefono || null, correo: d.correo || null,
    emergencia_nombre: d.emergencia_nombre || null, emergencia_parentesco: d.emergencia_parentesco || null, emergencia_telefono: d.emergencia_telefono || null,
    puesto: d.puesto || null, empresa: d.empresa || "THT", fecha_ingreso: d.fecha_ingreso || null, fecha_salida: d.fecha_salida || null,
    jornada: d.jornada || "completa", dia_libre: d.dia_libre === "" ? null : Number(d.dia_libre),
    perfil_id: d.perfil_id || null, nombre_reloj: d.nombre_reloj || null, actualizado_en: new Date().toISOString()
  };
  const rebajos = {};
  Object.entries(d).forEach(([k, v]) => { if (k.startsWith("rebajo_") && Number(v)) rebajos[k.slice(7)] = Number(v); });
  const privado = {
    tipo_pago: d.tipo_pago, bloque: d.bloque, notas: d.notas || null,
    salario_mensual: Number(d.salario_mensual) || 0, tarifa_hora: Number(d.tarifa_hora) || 0, monto_usd: Number(d.monto_usd) || 0,
    rebajos_fijos: rebajos
  };
  let personaId = id;
  if (id) {
    const { error } = await db.from("staff_personas").update(persona).eq("id", id);
    if (error) return fallo(error);
  } else {
    const { data, error } = await db.from("staff_personas").insert(persona).select("id").single();
    if (error) return fallo(error);
    personaId = data.id;
  }
  const { error: e2 } = await db.from("staff_privado").upsert({ persona_id: personaId, ...privado });
  if (e2) return fallo(e2, "Se guardó la ficha, pero no los datos de planilla.");
  avisar(id ? "Ficha guardada." : "Colaborador creado.");
  stfCerrarModal();
  await stfAbrir(true);
}

async function stfCambiarActivo(id) {
  const p = personaPorId(id);
  if (!p) return;
  const activar = !p.activo;
  if (!activar && !confirm(`¿Inactivar a ${p.nombre}? Ya no aparecerá en horarios ni quincenas nuevas. Su historial se conserva.`)) return;
  const cambios = { activo: activar, actualizado_en: new Date().toISOString() };
  if (!activar && !p.fecha_salida) cambios.fecha_salida = aTexto(new Date());
  if (activar) cambios.fecha_salida = null;
  const { error } = await db.from("staff_personas").update(cambios).eq("id", id);
  if (error) return fallo(error);
  avisar(activar ? "Colaborador reactivado." : "Colaborador inactivado.");
  stfCerrarModal();
  await stfAbrir(true);
}

// =====================================================
// HORARIOS
// =====================================================
function htmlHorarios() {
  const gestiona = stfGestiona();
  const filas = stf.horarios.map((h) => {
    const n = (h.staff_horario_personas || []).length;
    return `
      <tr>
        <td><button type="button" class="enlace" data-stf-accion="abrir-horario" data-id="${h.id}">${escapar(h.nombre || `${fechaCorta(h.desde)} – ${fechaAnio(h.hasta)}`)}</button></td>
        <td>${fechaCorta(h.desde)} – ${fechaAnio(h.hasta)}</td>
        <td>${n}</td>
        <td><span class="stf-chip ${h.estado === "publicado" ? "ok" : "aviso"}">${h.estado === "publicado" ? "Publicado" : "Borrador"}</span></td>
        <td>${h.estado === "publicado" && h.publicado_en ? fechaHora(h.publicado_en) : ""}</td>
      </tr>`;
  }).join("");
  return `
    <div class="herramientas stf-herramientas">
      <h2 class="stf-h2">${gestiona ? "Horarios" : "Mis horarios"}</h2>
      ${gestiona ? `<button type="button" class="btn primario" data-stf-accion="nuevo-horario">+ Nuevo horario</button>` : ""}
    </div>
    ${!gestiona ? `<p class="nota">Aquí aparecen los horarios publicados en los que estás incluido.</p>` : ""}
    ${stf.horarios.length ? `
    <div class="det-seccion sin-margen tabla-scroll">
      <table class="tabla">
        <thead><tr><th>Horario</th><th>Periodo</th><th>Personas</th><th>Estado</th><th>Publicado</th></tr></thead>
        <tbody>${filas}</tbody>
      </table>
    </div>` : `<p class="nota">${gestiona ? "Todavía no hay horarios. Crea el primero con “Nuevo horario”." : "Todavía no tienes horarios publicados."}</p>`}`;
}

// ---------- Nuevo horario ----------
function rangoRapido(tipo) {
  const hoy = new Date(); hoy.setHours(12);
  const lunes = new Date(hoy); lunes.setDate(hoy.getDate() - ((hoy.getDay() + 6) % 7));
  const mas = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  if (tipo === "semana") return [aTexto(lunes), aTexto(mas(lunes, 6))];
  if (tipo === "proxima") return [aTexto(mas(lunes, 7)), aTexto(mas(lunes, 13))];
  if (tipo === "quincena") {
    const d = hoy.getDate(), y = hoy.getFullYear(), m = hoy.getMonth();
    if (d >= 14 && d <= 28) return [aTexto(new Date(y, m, 14, 12)), aTexto(new Date(y, m, 28, 12))];
    const ini = d >= 29 ? new Date(y, m, 29, 12) : new Date(y, m - 1, 29, 12);
    const fin = d >= 29 ? new Date(y, m + 1, 13, 12) : new Date(y, m, 13, 12);
    return [aTexto(ini), aTexto(fin)];
  }
  if (tipo === "mes") return [aTexto(new Date(hoy.getFullYear(), hoy.getMonth(), 1, 12)), aTexto(new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0, 12))];
  return null;
}

function stfIniciarNuevo() {
  const [desde, hasta] = rangoRapido("proxima");
  stf.nuevo = {
    desde, hasta, nombre: "", rapido: "proxima",
    seleccion: new Set(stf.personas.filter((p) => p.activo && stf.privado.get(p.id)?.tipo_pago !== "socio").map((p) => p.id)),
    puesto: "", empresa: "", diaLibre: true, copiar: ""
  };
  if (!stfEsAdmin()) stf.nuevo.seleccion = new Set(stf.personas.filter((p) => p.activo).map((p) => p.id));
  stfPintar();
}

function htmlNuevoHorario() {
  const n = stf.nuevo;
  const activos = stf.personas.filter((p) => p.activo);
  const visibles = activos.filter((p) => (!n.puesto || p.puesto === n.puesto) && (!n.empresa || p.empresa === n.empresa));
  const dias = n.desde && n.hasta && n.hasta >= n.desde ? fechasEntre(n.desde, n.hasta).length : 0;
  const rapido = (id, t) => `<button type="button" class="stf-pill ${n.rapido === id ? "on" : ""}" data-stf-accion="rango" data-rango="${id}">${t}</button>`;
  return `
    <div class="herramientas stf-herramientas">
      <button type="button" class="enlace" data-stf-accion="volver-horarios">‹ Volver a horarios</button>
      <h2 class="stf-h2">Nuevo horario</h2>
    </div>
    <div class="stf-dos">
      <div class="stf-col">
        <div class="det-seccion sin-margen">
          <h3><span class="stf-paso">1</span> Periodo del horario</h3>
          <div class="stf-pills">${rapido("semana", "Esta semana")}${rapido("proxima", "Próxima semana")}${rapido("quincena", "Quincena actual")}${rapido("mes", "Este mes")}</div>
          <div class="fila">
            <label>Desde <input id="stfNDesde" type="date" value="${n.desde}"></label>
            <label>Hasta <input id="stfNHasta" type="date" value="${n.hasta}"></label>
          </div>
          <label>Nombre (opcional) <input id="stfNNombre" value="${escapar(n.nombre)}" placeholder="Ej.: Semana del 9 de noviembre"></label>
        </div>
        <div class="det-seccion sin-margen">
          <h3><span class="stf-paso">2</span> Colaboradores a incluir</h3>
          <div class="stf-pills">
            <select id="stfNPuesto" aria-label="Puesto"><option value="">Todos los puestos</option>${puestosConocidos().map((x) => `<option ${x === n.puesto ? "selected" : ""}>${escapar(x)}</option>`).join("")}</select>
            <select id="stfNEmpresa" aria-label="Empresa"><option value="">Ambas empresas</option><option value="HV" ${n.empresa === "HV" ? "selected" : ""}>Home Vacations</option><option value="THT" ${n.empresa === "THT" ? "selected" : ""}>The House of Tours</option></select>
            <button type="button" class="stf-pill" data-stf-accion="marcar-todos">Marcar visibles</button>
            <button type="button" class="stf-pill" data-stf-accion="quitar-todos">Quitar visibles</button>
          </div>
          <div class="stf-personas">
            ${visibles.map((p) => `
              <label class="stf-persona ${n.seleccion.has(p.id) ? "on" : ""}">
                <input type="checkbox" data-stf-sel="${p.id}" ${n.seleccion.has(p.id) ? "checked" : ""}>
                <span><strong>${escapar(p.nombre)}</strong><small>${escapar(p.puesto || "")}${p.dia_libre != null ? ` · libre ${DIAS_SEMANA[p.dia_libre].toLowerCase()}` : ""}</small></span>
              </label>`).join("") || `<p class="nota">No hay colaboradores activos con ese filtro.</p>`}
          </div>
        </div>
      </div>
      <aside class="det-seccion sin-margen stf-resumen">
        <h3>Resumen</h3>
        <dl class="stf-dl">
          <dt>Periodo</dt><dd>${n.desde && n.hasta ? `${fechaCorta(n.desde)} – ${fechaAnio(n.hasta)}` : "—"}</dd>
          <dt>Días</dt><dd>${dias || "—"}</dd>
          <dt>Colaboradores</dt><dd>${n.seleccion.size} seleccionados</dd>
        </dl>
        <label class="check-linea chico"><input type="checkbox" id="stfNLibre" ${n.diaLibre ? "checked" : ""}> Proponer el día libre habitual de cada persona</label>
        <label>Copiar los turnos de un horario anterior
          <select id="stfNCopiar"><option value="">No copiar</option>${stf.horarios.map((h) => `<option value="${h.id}" ${String(h.id) === n.copiar ? "selected" : ""}>${escapar(h.nombre || `${fechaCorta(h.desde)} – ${fechaAnio(h.hasta)}`)}</option>`).join("")}</select>
        </label>
        <p class="nota">Al copiar se repite el turno de cada persona día por día, en el mismo orden.</p>
        <button type="button" class="btn primario" data-stf-accion="crear-horario">Crear tabla del horario</button>
        <p class="nota">Se guarda como borrador: nadie más lo ve hasta que lo publiques.</p>
      </aside>
    </div>`;
}

async function stfCrearHorario() {
  const n = stf.nuevo;
  if (!n.desde || !n.hasta || n.hasta < n.desde) return avisar("Revisa las fechas del periodo.", "error");
  const fechas = fechasEntre(n.desde, n.hasta);
  if (fechas.length > 62) return avisar("El periodo no puede ser mayor a dos meses.", "error");
  const personas = stf.personas.filter((p) => n.seleccion.has(p.id));
  if (!personas.length) return avisar("Elige al menos un colaborador.", "error");

  const { data: h, error } = await db.from("staff_horarios")
    .insert({ nombre: n.nombre.trim() || null, desde: n.desde, hasta: n.hasta }).select().single();
  if (error) return fallo(error, "No se pudo crear el horario.");

  const filas = personas.map((p, i) => ({ horario_id: h.id, persona_id: p.id, nombre: p.nombre, puesto: p.puesto, orden: i }));
  const { error: e2 } = await db.from("staff_horario_personas").insert(filas);
  if (e2) return fallo(e2);

  // Celdas iniciales: copia de otro horario y/o día libre habitual
  const celdas = new Map();
  if (n.copiar) {
    const { data: origen } = await db.from("staff_horarios").select("desde, hasta").eq("id", n.copiar).single();
    const { data: oc } = await db.from("staff_horario_celdas").select("*").eq("horario_id", n.copiar);
    if (origen && oc) {
      const fo = fechasEntre(origen.desde, origen.hasta);
      oc.forEach((c) => {
        if (!n.seleccion.has(c.persona_id)) return;
        const i = fo.indexOf(c.fecha);
        if (i < 0 || i >= fechas.length) return;
        celdas.set(`${c.persona_id}|${fechas[i]}`, { horario_id: h.id, persona_id: c.persona_id, fecha: fechas[i], tipo: c.tipo, entrada: c.entrada });
      });
    }
  }
  if (n.diaLibre) {
    personas.forEach((p) => {
      if (p.dia_libre == null) return;
      fechas.forEach((f) => {
        if (diaSemana(f) === Number(p.dia_libre) && !celdas.has(`${p.id}|${f}`))
          celdas.set(`${p.id}|${f}`, { horario_id: h.id, persona_id: p.id, fecha: f, tipo: "libre", entrada: null });
      });
    });
  }
  if (celdas.size) {
    const { error: e3 } = await db.from("staff_horario_celdas").insert([...celdas.values()]);
    if (e3) fallo(e3, "El horario se creó, pero no se pudieron copiar los turnos.");
  }
  stf.nuevo = null;
  await stfCargar();
  await stfCargarHorario(h.id);
  stfPintar();
  avisar("Horario creado como borrador.");
}

// ---------- Tabla del horario ----------
async function stfCargarHorario(id) {
  const [h, p, c] = await Promise.all([
    db.from("staff_horarios").select("*").eq("id", id).single(),
    db.from("staff_horario_personas").select("*").eq("horario_id", id).order("orden"),
    db.from("staff_horario_celdas").select("*").eq("horario_id", id)
  ]);
  const error = h.error || p.error || c.error;
  if (error) { stf.horario = null; return fallo(error, "No se pudo abrir el horario."); }
  stf.horario = {
    h: h.data,
    personas: p.data || [],
    celdas: new Map((c.data || []).map((x) => [`${x.persona_id}|${x.fecha}`, x]))
  };
}

function resumenHorario(hp) {
  const H = stf.horario;
  const fechas = fechasEntre(H.h.desde, H.h.hasta);
  const persona = personaPorId(hp.persona_id);
  let dias = 0;
  fechas.forEach((f) => { if (H.celdas.get(`${hp.persona_id}|${f}`)?.tipo === "trabajo") dias++; });
  return { dias, horas: dias * horasJornada(persona) };
}
function textoCelda(c, persona) {
  if (!c) return { a: "—", b: "", clase: "t-vacia" };
  if (c.tipo === "trabajo") return { a: hora12(c.entrada), b: `a ${hora12(sumarHoras(c.entrada, horasJornada(persona)))}`, clase: "t-trabajo" };
  return { a: TIPOS_CELDA[c.tipo].nombre, b: "", clase: TIPOS_CELDA[c.tipo].clase };
}

function htmlHorario() {
  const H = stf.horario;
  const h = H.h;
  const editable = stfGestiona();
  const fechas = fechasEntre(h.desde, h.hasta);
  const sel = stf.turnoSel;
  const chipTurno = (t) => `<button type="button" class="stf-turno t-trabajo ${sel.tipo === "trabajo" && sel.entrada === t ? "on" : ""}" data-stf-accion="turno" data-tipo="trabajo" data-entrada="${t}" aria-pressed="${sel.tipo === "trabajo" && sel.entrada === t}">${hora12(t)}</button>`;
  const chipTipo = (tipo, txt, clase) => `<button type="button" class="stf-turno ${clase} ${sel.tipo === tipo ? "on" : ""}" data-stf-accion="turno" data-tipo="${tipo}" aria-pressed="${sel.tipo === tipo}">${txt}</button>`;
  const yo = staffMiPersona();

  const cab = fechas.map((f) => {
    const d = diaSemana(f);
    const cont = editable ? `<button type="button" class="stf-dia" data-stf-accion="aplicar-columna" data-fecha="${f}">` : `<span class="stf-dia">`;
    return `<th class="${d === 0 ? "dom" : ""}">${cont}${DIAS_CORTO[d]}<small>${fechaCorta(f)}</small>${editable ? "</button>" : "</span>"}</th>`;
  }).join("");

  const filas = H.personas.map((hp) => {
    const persona = personaPorId(hp.persona_id);
    const r = resumenHorario(hp);
    const celdas = fechas.map((f) => {
      const c = H.celdas.get(`${hp.persona_id}|${f}`);
      const t = textoCelda(c, persona);
      const etiqueta = `${hp.nombre}, ${fechaLarga(f)}: ${t.a} ${t.b}`.trim();
      return editable
        ? `<td><button type="button" class="stf-celda ${t.clase}" data-stf-accion="celda" data-persona="${hp.persona_id}" data-fecha="${f}" aria-label="${escapar(etiqueta)}"><b>${t.a}</b><small>${t.b}</small></button></td>`
        : `<td><span class="stf-celda ${t.clase}" aria-label="${escapar(etiqueta)}"><b>${t.a}</b><small>${t.b}</small></span></td>`;
    }).join("");
    const esYo = yo && yo === hp.persona_id;
    return `
      <tr class="${esYo ? "stf-yo" : ""}">
        <th scope="row" class="stf-nombre">
          ${editable ? `<button type="button" class="stf-dia izq" data-stf-accion="aplicar-fila" data-persona="${hp.persona_id}">` : "<span>"}
            <strong>${escapar(hp.nombre)}</strong><small>${escapar(hp.puesto || "")}</small>
          ${editable ? "</button>" : "</span>"}
          ${editable ? `<button type="button" class="btn-icono stf-quitar" data-stf-accion="quitar-persona" data-persona="${hp.persona_id}" aria-label="Quitar a ${escapar(hp.nombre)} del horario" title="Quitar del horario">×</button>` : ""}
        </th>
        ${celdas}
        <td class="stf-total"><b>${r.horas} h</b><small>${r.dias} días</small></td>
      </tr>`;
  }).join("");

  const cobertura = fechas.map((f) => {
    const n = H.personas.filter((hp) => H.celdas.get(`${hp.persona_id}|${f}`)?.tipo === "trabajo").length;
    return `<td class="stf-cob">${n}</td>`;
  }).join("");

  const fuera = stf.personas.filter((p) => p.activo && !H.personas.some((hp) => hp.persona_id === p.id));

  return `
    <div class="stf-horario-cab">
      <div>
        <button type="button" class="enlace" data-stf-accion="volver-horarios">‹ Volver a horarios</button>
        <h2 class="stf-h2">${escapar(h.nombre || `${fechaCorta(h.desde)} – ${fechaAnio(h.hasta)}`)}
          <span class="stf-chip ${h.estado === "publicado" ? "ok" : "aviso"}">${h.estado === "publicado" ? "Publicado" : "Borrador"}</span></h2>
        <p class="nota">${fechaLarga(h.desde)} al ${fechaLarga(h.hasta)} · ${H.personas.length} colaboradores · la salida se calcula sola (jornada de 8 h; 4 h en medio tiempo)</p>
      </div>
      <div class="stf-botones">
        <button type="button" class="btn" data-stf-accion="imprimir-horario">Imprimir</button>
        <button type="button" class="btn" data-stf-accion="excel-horario">Descargar Excel</button>
        ${editable ? `
          <button type="button" class="btn peligro" data-stf-accion="eliminar-horario">Eliminar</button>
          ${h.estado === "publicado"
            ? `<button type="button" class="btn" data-stf-accion="despublicar">Volver a borrador</button>`
            : `<button type="button" class="btn primario" data-stf-accion="publicar">Publicar</button>`}` : ""}
      </div>
    </div>
    ${editable ? `
    <div class="det-seccion sin-margen stf-turnos">
      <span class="stf-turnos-tit">Turno a aplicar:</span>
      ${stf.turnos.map(chipTurno).join("")}
      <span class="stf-otra">
        <input id="stfOtraHora" type="time" value="${sel.tipo === "trabajo" && !stf.turnos.includes(sel.entrada) ? sel.entrada : ""}" aria-label="Otra hora de entrada">
        <button type="button" class="stf-turno" data-stf-accion="otra-hora">Usar</button>
        <button type="button" class="enlace" data-stf-accion="guardar-turno" title="Agregar esta hora a los turnos rápidos">Guardar</button>
      </span>
      <span class="stf-sep" aria-hidden="true"></span>
      ${chipTipo("libre", "Libre", "t-libre")}${chipTipo("vacaciones", "Vacaciones", "t-vac")}${chipTipo("incapacidad", "Incapacidad", "t-inc")}${chipTipo("borrar", "Borrar", "")}
      <p class="nota">Elige un turno y toca las casillas. Toca un día o un nombre para aplicarlo a toda la columna o la fila.</p>
    </div>` : ""}
    <div class="det-seccion sin-margen tabla-scroll stf-tabla-caja">
      <table class="stf-tabla">
        <thead><tr><th class="stf-nombre">Colaborador</th>${cab}<th>Total</th></tr></thead>
        <tbody>${filas || `<tr><td colspan="${fechas.length + 2}" class="nota">Agrega colaboradores al horario.</td></tr>`}</tbody>
        <tfoot><tr><th scope="row" class="stf-nombre">Personas trabajando</th>${cobertura}<td></td></tr></tfoot>
      </table>
    </div>
    ${editable && fuera.length ? `
      <div class="stf-agregar">
        <label>Agregar colaborador <select id="stfAgregarPersona"><option value="">Elegir…</option>${fuera.map((p) => `<option value="${p.id}">${escapar(p.nombre)}</option>`).join("")}</select></label>
        <button type="button" class="btn" data-stf-accion="agregar-persona">Agregar</button>
      </div>` : ""}
    <div class="stf-leyenda"><span class="t-trabajo">Trabaja</span><span class="t-libre">Libre</span><span class="t-vac">Vacaciones</span><span class="t-inc">Incapacidad</span></div>`;
}

function staffMiPersona() {
  return stf.personas.find((p) => p.perfil_id && p.perfil_id === app.yo?.id)?.id ?? null;
}

// Aplica el turno elegido a una lista de casillas y lo guarda
async function stfAplicar(objetivos) {
  const H = stf.horario;
  const sel = stf.turnoSel;
  if (sel.tipo === "trabajo" && !sel.entrada) return avisar("Elige una hora de entrada.", "error");
  const borrar = [], guardar = [];
  objetivos.forEach(({ persona, fecha: f }) => {
    const k = `${persona}|${f}`;
    if (sel.tipo === "borrar") { if (H.celdas.has(k)) { borrar.push(f); H.celdas.delete(k); } return; }
    const c = { horario_id: H.h.id, persona_id: persona, fecha: f, tipo: sel.tipo, entrada: sel.tipo === "trabajo" ? sel.entrada : null };
    H.celdas.set(k, c);
    guardar.push(c);
  });
  stfPintar();
  try {
    if (guardar.length) {
      const { error } = await db.from("staff_horario_celdas").upsert(guardar);
      if (error) throw error;
    }
    if (borrar.length) {
      const porPersona = {};
      objetivos.forEach(({ persona, fecha: f }) => { if (borrar.includes(f)) (porPersona[persona] ||= []).push(f); });
      for (const [persona, fs] of Object.entries(porPersona)) {
        const { error } = await db.from("staff_horario_celdas").delete().eq("horario_id", H.h.id).eq("persona_id", persona).in("fecha", fs);
        if (error) throw error;
      }
    }
    await db.from("staff_horarios").update({ actualizado_en: new Date().toISOString() }).eq("id", H.h.id);
  } catch (error) {
    fallo(error, "No se pudo guardar el cambio.");
    await stfCargarHorario(H.h.id);
    stfPintar();
  }
}

async function stfPublicar(publicar) {
  const H = stf.horario;
  if (publicar && !confirm("¿Publicar el horario? Cada colaborador incluido con usuario podrá verlo en Staff › Horarios.")) return;
  const { error } = await db.from("staff_horarios")
    .update({ estado: publicar ? "publicado" : "borrador", publicado_en: publicar ? new Date().toISOString() : null }).eq("id", H.h.id);
  if (error) return fallo(error);
  await stfCargar();
  stfPintar();
  avisar(publicar ? "Horario publicado." : "El horario volvió a borrador.");
}

async function stfEliminarHorario() {
  const H = stf.horario;
  if (!confirm("¿Eliminar este horario? No se puede deshacer.")) return;
  const { error } = await db.from("staff_horarios").delete().eq("id", H.h.id);
  if (error) return fallo(error);
  stf.horario = null;
  await stfCargar();
  stfPintar();
  avisar("Horario eliminado.");
}

async function stfAgregarPersona(id) {
  const H = stf.horario;
  const p = personaPorId(id);
  if (!p) return;
  const { error } = await db.from("staff_horario_personas")
    .insert({ horario_id: H.h.id, persona_id: p.id, nombre: p.nombre, puesto: p.puesto, orden: H.personas.length });
  if (error) return fallo(error);
  await stfCargarHorario(H.h.id);
  stfPintar();
}

async function stfQuitarPersona(id) {
  const H = stf.horario;
  const hp = H.personas.find((x) => x.persona_id === Number(id));
  if (!hp || !confirm(`¿Quitar a ${hp.nombre} de este horario? Se borran sus turnos.`)) return;
  const { error } = await db.from("staff_horario_personas").delete().eq("horario_id", H.h.id).eq("persona_id", hp.persona_id);
  if (error) return fallo(error);
  await stfCargarHorario(H.h.id);
  stfPintar();
}

async function stfGuardarTurno() {
  const v = $("stfOtraHora")?.value;
  if (!v) return avisar("Escribe la hora que quieres guardar.", "error");
  if (stf.turnos.includes(v)) return avisar("Esa hora ya está en los turnos rápidos.");
  const turnos = [...stf.turnos, v].sort();
  const { error } = await db.from("staff_ajustes").upsert({ clave: "turnos", valor: turnos });
  if (error) return fallo(error);
  stf.turnos = turnos;
  stf.turnoSel = { tipo: "trabajo", entrada: v };
  stfPintar();
  avisar(`${hora12(v)} se agregó a los turnos rápidos.`);
}

// ---------- Imprimir y Excel del horario ----------
function stfImprimirHorario() {
  const H = stf.horario;
  const h = H.h;
  const fechas = fechasEntre(h.desde, h.hasta);
  const filas = H.personas.map((hp) => {
    const persona = personaPorId(hp.persona_id);
    const r = resumenHorario(hp);
    return `<tr><th>${escapar(hp.nombre)}<small>${escapar(hp.puesto || "")}</small></th>${fechas.map((f) => {
      const t = textoCelda(H.celdas.get(`${hp.persona_id}|${f}`), persona);
      return `<td class="${t.clase}"><b>${t.a}</b><small>${t.b}</small></td>`;
    }).join("")}<td><b>${r.horas} h</b><small>${r.dias} días</small></td></tr>`;
  }).join("");
  stfImprimir(`
    <div class="imp-cabeza">
      <p class="imp-marca">The House of Tours · Home Vacations</p>
      <p class="imp-titulo">Horario ${escapar(h.nombre || "")} — ${fechaCorta(h.desde)} al ${fechaAnio(h.hasta)}</p>
    </div>
    <table class="stf-imp-tabla">
      <thead><tr><th>Colaborador</th>${fechas.map((f) => `<th>${DIAS_CORTO[diaSemana(f)]}<small>${fechaCorta(f)}</small></th>`).join("")}<th>Total</th></tr></thead>
      <tbody>${filas}</tbody>
      <tfoot><tr><th>Personas trabajando</th>${fechas.map((f) => `<td>${H.personas.filter((hp) => H.celdas.get(`${hp.persona_id}|${f}`)?.tipo === "trabajo").length}</td>`).join("")}<td></td></tr></tfoot>
    </table>
    <p class="imp-pie">${h.estado === "publicado" ? "Publicado" : "Borrador"} · Impreso el ${fechaHora(new Date())} por ${escapar(app.yo.nombre)}</p>`, true);
}

const EXCEL_COLOR = { "t-trabajo": "FFE4EFE8", "t-libre": "FFE6EBEA", "t-vac": "FFE3ECF7", "t-inc": "FFFCEBDD", "t-vacia": "FFFFFFFF" };
const EXCEL_TEXTO = { "t-trabajo": "FF1F4F38", "t-libre": "FF45535A", "t-vac": "FF24527A", "t-inc": "FF8A3B12", "t-vacia": "FF8A979C" };
const excelBorde = { top: { style: "thin", color: { argb: "FFD5DEDA" } }, left: { style: "thin", color: { argb: "FFD5DEDA" } }, bottom: { style: "thin", color: { argb: "FFD5DEDA" } }, right: { style: "thin", color: { argb: "FFD5DEDA" } } };

async function stfExcelHorario() {
  const ExcelJS = await stfCargarExcel();
  const H = stf.horario;
  const h = H.h;
  const fechas = fechasEntre(h.desde, h.hasta);
  const wb = new ExcelJS.Workbook();
  wb.creator = "THOT Sistema";
  const ws = wb.addWorksheet("Horario", {
    pageSetup: { paperSize: 1, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } },
    views: [{ state: "frozen", xSplit: 1, ySplit: 4 }]
  });
  const ultimaCol = fechas.length + 2;
  ws.mergeCells(1, 1, 1, ultimaCol);
  ws.getCell(1, 1).value = `Horario ${h.nombre ? h.nombre + " — " : ""}${fechaCorta(h.desde)} al ${fechaAnio(h.hasta)}`;
  ws.getCell(1, 1).font = { bold: true, size: 14, color: { argb: "FF1F4F38" } };
  ws.mergeCells(2, 1, 2, ultimaCol);
  ws.getCell(2, 1).value = `${h.estado === "publicado" ? "Publicado" : "Borrador"} · Generado el ${fechaHora(new Date())} · Jornada de 8 horas (la salida se calcula sola)`;
  ws.getCell(2, 1).font = { size: 9, color: { argb: "FF5B6B72" } };

  const cab = ws.getRow(4);
  cab.values = ["Colaborador", ...fechas.map((f) => `${DIAS_CORTO[diaSemana(f)]} ${fechaCorta(f)}`), "Total"];
  cab.font = { bold: true, color: { argb: "FFFFFFFF" } };
  cab.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  cab.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF23343D" } }; c.border = excelBorde; });
  cab.height = 30;

  H.personas.forEach((hp, i) => {
    const persona = personaPorId(hp.persona_id);
    const r = resumenHorario(hp);
    const fila = ws.getRow(5 + i);
    fila.getCell(1).value = `${hp.nombre}${hp.puesto ? "\n" + hp.puesto : ""}`;
    fila.getCell(1).alignment = { wrapText: true, vertical: "middle" };
    fila.getCell(1).font = { bold: true };
    fechas.forEach((f, j) => {
      const t = textoCelda(H.celdas.get(`${hp.persona_id}|${f}`), persona);
      const c = fila.getCell(2 + j);
      c.value = t.b ? `${t.a}\n${t.b}` : t.a;
      c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: EXCEL_COLOR[t.clase] } };
      c.font = { color: { argb: EXCEL_TEXTO[t.clase] }, size: 10 };
    });
    const tot = fila.getCell(ultimaCol);
    tot.value = `${r.horas} h\n${r.dias} días`;
    tot.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    tot.font = { bold: true };
    fila.height = 34;
    fila.eachCell({ includeEmpty: true }, (c) => (c.border = excelBorde));
  });
  const fCob = ws.getRow(5 + H.personas.length);
  fCob.getCell(1).value = "Personas trabajando";
  fechas.forEach((f, j) => {
    fCob.getCell(2 + j).value = H.personas.filter((hp) => H.celdas.get(`${hp.persona_id}|${f}`)?.tipo === "trabajo").length;
    fCob.getCell(2 + j).alignment = { horizontal: "center" };
  });
  fCob.font = { bold: true };
  fCob.eachCell({ includeEmpty: true }, (c) => { c.border = excelBorde; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF7FAF8" } }; });

  const ley = ws.getRow(7 + H.personas.length);
  [["Trabaja", "t-trabajo"], ["Libre", "t-libre"], ["Vacaciones", "t-vac"], ["Incapacidad", "t-inc"]].forEach(([t, k], j) => {
    const c = ley.getCell(2 + j);
    c.value = t; c.alignment = { horizontal: "center" };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: EXCEL_COLOR[k] } };
    c.font = { color: { argb: EXCEL_TEXTO[k] }, size: 9 };
  });
  ws.getColumn(1).width = 28;
  for (let j = 2; j <= ultimaCol; j++) ws.getColumn(j).width = 12;

  const buf = await wb.xlsx.writeBuffer();
  stfDescargar(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `Horario_${nombreArchivo(h.desde)}_al_${nombreArchivo(h.hasta)}.xlsx`);
}

// =====================================================
// EVENTOS
// =====================================================
$("staffContenido").addEventListener("click", (e) => {
  const b = e.target.closest("[data-stf-accion]");
  if (!b) return;
  const accion = b.dataset.stfAccion;
  const id = b.dataset.id;
  const sincrono = {
    "ficha": () => stfAbrirModal(htmlFicha(personaPorId(id))),
    "nueva-persona": () => stfAbrirModal(htmlFicha({ activo: true, empresa: "THT", jornada: "completa" })),
    "nuevo-horario": () => stfIniciarNuevo(),
    "volver-horarios": () => { stf.horario = null; stf.nuevo = null; stfPintar(); },
    "rango": () => {
      const r = rangoRapido(b.dataset.rango);
      Object.assign(stf.nuevo, { desde: r[0], hasta: r[1], rapido: b.dataset.rango });
      stfPintar();
    },
    "marcar-todos": () => { $("staffContenido").querySelectorAll("[data-stf-sel]").forEach((x) => stf.nuevo.seleccion.add(Number(x.dataset.stfSel))); stfPintar(); },
    "quitar-todos": () => { $("staffContenido").querySelectorAll("[data-stf-sel]").forEach((x) => stf.nuevo.seleccion.delete(Number(x.dataset.stfSel))); stfPintar(); },
    "turno": () => { stf.turnoSel = { tipo: b.dataset.tipo, entrada: b.dataset.entrada || null }; stfPintar(); },
    "otra-hora": () => {
      const v = $("stfOtraHora").value;
      if (!v) return avisar("Escribe una hora de entrada.", "error");
      stf.turnoSel = { tipo: "trabajo", entrada: v }; stfPintar();
    },
    "imprimir-horario": () => stfImprimirHorario()
  };
  if (sincrono[accion]) return sincrono[accion]();

  const asincrono = {
    "abrir-horario": async () => { await stfCargarHorario(Number(id)); stfPintar(); },
    "crear-horario": () => stfCrearHorario(),
    "celda": () => stfAplicar([{ persona: Number(b.dataset.persona), fecha: b.dataset.fecha }]),
    "aplicar-columna": () => stfAplicar(stf.horario.personas.map((hp) => ({ persona: hp.persona_id, fecha: b.dataset.fecha }))),
    "aplicar-fila": () => stfAplicar(fechasEntre(stf.horario.h.desde, stf.horario.h.hasta).map((f) => ({ persona: Number(b.dataset.persona), fecha: f }))),
    "publicar": () => stfPublicar(true),
    "despublicar": () => stfPublicar(false),
    "eliminar-horario": () => stfEliminarHorario(),
    "agregar-persona": () => { const v = $("stfAgregarPersona").value; if (v) return stfAgregarPersona(v); },
    "quitar-persona": () => stfQuitarPersona(b.dataset.persona),
    "guardar-turno": () => stfGuardarTurno(),
    "excel-horario": () => stfExcelHorario().catch((err) => fallo(err, "No se pudo generar el Excel."))
  };
  if (asincrono[accion]) {
    // Las casillas no se bloquean para poder tocar varias seguidas
    if (accion === "celda") return asincrono[accion]();
    conBoton(b, asincrono[accion]);
  }
});

$("staffContenido").addEventListener("input", (e) => {
  const t = e.target;
  if (t.id === "stfBuscar") {
    stf.filtro.texto = t.value;
    const pos = t.selectionStart;
    stfPintar();
    const n = $("stfBuscar"); n.focus(); n.setSelectionRange(pos, pos);
  }
  if (stf.nuevo && t.id === "stfNNombre") stf.nuevo.nombre = t.value;
});
$("staffContenido").addEventListener("change", (e) => {
  const t = e.target;
  const f = stf.filtro;
  if (t.id === "stfFiltroPuesto") { f.puesto = t.value; stfPintar(); }
  if (t.id === "stfFiltroEmpresa") { f.empresa = t.value; stfPintar(); }
  if (t.id === "stfFiltroEstado") { f.estado = t.value; stfPintar(); }
  const n = stf.nuevo;
  if (!n) return;
  if (t.id === "stfNDesde") { n.desde = t.value; n.rapido = ""; stfPintar(); }
  if (t.id === "stfNHasta") { n.hasta = t.value; n.rapido = ""; stfPintar(); }
  if (t.id === "stfNPuesto") { n.puesto = t.value; stfPintar(); }
  if (t.id === "stfNEmpresa") { n.empresa = t.value; stfPintar(); }
  if (t.id === "stfNLibre") n.diaLibre = t.checked;
  if (t.id === "stfNCopiar") n.copiar = t.value;
  if (t.dataset.stfSel) {
    const pid = Number(t.dataset.stfSel);
    if (t.checked) n.seleccion.add(pid); else n.seleccion.delete(pid);
    stfPintar();
  }
});

$("staffModal").addEventListener("click", (e) => {
  const b = e.target.closest("[data-stf-accion]");
  if (!b) return;
  const accion = b.dataset.stfAccion;
  if (accion === "cerrar-modal") return stfCerrarModal();
  if (accion === "guardar-persona") return conBoton(b, stfGuardarPersona);
  if (accion === "activar") return conBoton(b, () => stfCambiarActivo(Number(b.dataset.id)));
  if (typeof plaModalClick === "function") plaModalClick(e, b);
});
