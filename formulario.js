// =====================================================
// FORMULARIO DEL CLIENTE (usa los textos de i18n.js)
// =====================================================

const $ = (id) => document.getElementById(id);
const MAX_DIAS = 30;
const db = supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey);

let servicios = [];
let tipos = [];
let propiedades = [];
let catalogoListo = false;
let errorCarga = "";          // clave del texto de error, si no se pudo cargar
let ultimoEnvio = null;       // { numero, datos } después de enviar
const seleccion = {};         // { "2026-10-12": [3, 5], ... }

const CODIGOS = [
  ["CR", "+506"], ["US", "+1"], ["MX", "+52"], ["PA", "+507"], ["CO", "+57"],
  ["AR", "+54"], ["BR", "+55"], ["CL", "+56"], ["ES", "+34"], ["FR", "+33"],
  ["DE", "+49"], ["IT", "+39"], ["GB", "+44"], ["NL", "+31"], ["CH", "+41"]
];

// ---------- Utilidades ----------
const pad = (n) => String(n).padStart(2, "0");
const aTexto = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const aFecha = (s) => new Date(s + "T12:00:00");

function escapar(texto) {
  return String(texto ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function nombreDia(s) {
  const txt = aFecha(s).toLocaleDateString(locale(), { weekday: "long", day: "numeric", month: "long" });
  return txt.charAt(0).toUpperCase() + txt.slice(1);
}
function duracion(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return h ? `${h} h${m ? " " + m + " min" : ""}` : `${m} min`;
}
function numero(id) {
  const n = parseInt($(id).value, 10);
  return isNaN(n) || n < 0 ? 0 : n;
}
function sumarDias(s, n) {
  const d = aFecha(s);
  d.setDate(d.getDate() + n);
  return aTexto(d);
}
function listaFechas(inicio, fin) {
  const dias = [];
  for (let s = inicio; s <= fin && dias.length < MAX_DIAS; s = sumarDias(s, 1)) dias.push(s);
  return dias;
}
const servicioPorId = (id) => servicios.find((s) => s.id === id);
const nombreServicio = (id) => tServicio(servicioPorId(id));
const iconoServicio = (id) => tipos.find((x) => x.id === servicioPorId(id)?.tipo_id)?.icono || "";
const totalServicios = () => Object.values(seleccion).reduce((n, l) => n + l.length, 0);

// ---------- Listas que dependen del idioma ----------
function pintarCodigos() {
  const actual = $("codigoPais").value || "+506";
  let nombres = null;
  try { nombres = new Intl.DisplayNames([locale()], { type: "region" }); } catch { /* navegador antiguo */ }
  const pais = (c) => (nombres ? nombres.of(c) : c);
  $("codigoPais").innerHTML = CODIGOS.map(([c, cod]) => {
    const nombre = c === "US" ? `${pais("US")} / ${pais("CA")}` : pais(c);
    return `<option value="${cod}">${cod} ${escapar(nombre)}</option>`;
  }).join("");
  $("codigoPais").value = actual;
}

function pintarPropiedades() {
  const actual = $("propiedad").value;
  if (!catalogoListo) {
    $("propiedad").innerHTML = `<option value="">${escapar(t("f_cargando"))}</option>`;
    return;
  }
  $("propiedad").innerHTML =
    `<option value="">${escapar(t("f_elige"))}</option>` +
    propiedades.map((p) => `<option value="${p.id}">${escapar(p.nombre)}</option>`).join("") +
    `<option value="otro">${escapar(t("f_otro"))}</option>`;
  $("propiedad").value = actual;
}

// ---------- Catálogo ----------
async function cargarCatalogos() {
  if (CONFIG.supabaseUrl.includes("TU-PROYECTO")) return mostrarErrorCarga("e_config");

  const [s, k, p] = await Promise.all([
    db.from("servicios").select("id, nombre, duracion_min, descripcion, tipo_id, traducciones").eq("activo", true).order("nombre"),
    db.from("tipos_servicio").select("id, nombre, icono, traducciones, orden").eq("activo", true).order("orden").order("nombre"),
    db.from("propiedades").select("id, nombre").eq("activa", true).order("nombre")
  ]);
  if (s.error || k.error || p.error) return mostrarErrorCarga("e_carga");

  tipos = k.data;
  // Si un tipo está oculto, sus actividades tampoco se ofrecen
  servicios = s.data.filter((x) => !x.tipo_id || tipos.some((k) => k.id === x.tipo_id));
  propiedades = p.data;
  catalogoListo = true;
  pintarPropiedades();
  pintarDias();
}

function mostrarErrorCarga(clave) {
  errorCarga = clave;
  $("errorCarga").textContent = t(clave);
  $("errorCarga").hidden = false;
  $("btnEnviar").disabled = true;
}

// ---------- Días y actividades ----------
function pintarDias() {
  const inicio = $("fechaInicio").value;
  const fin = $("fechaFin").value;
  const ayuda = $("ayudaDias");
  const cont = $("dias");

  if (!inicio || !fin || fin < inicio) {
    cont.innerHTML = "";
    ayuda.textContent = inicio && fin && fin < inicio ? t("f_fecha_mal") : t("f_ayuda_fechas");
    return;
  }

  const fechas = listaFechas(inicio, fin);
  Object.keys(seleccion).forEach((f) => { if (!fechas.includes(f)) delete seleccion[f]; });
  ayuda.textContent = t("f_ayuda_dias");

  cont.innerHTML = fechas.map((f) => {
    const dia = nombreDia(f);
    const elegidos = seleccion[f] || [];
    const lista = elegidos.map((id) => `
      <li>
        <span class="dia-act">${iconoServicio(id) ? `<span class="dia-icono" aria-hidden="true">${escapar(iconoServicio(id))}</span>` : ""}<span>${escapar(nombreServicio(id))}</span></span>
        <button type="button" class="quitar" data-fecha="${f}" data-id="${id}"
          aria-label="${escapar(t("f_aria_quitar", { servicio: nombreServicio(id), dia }))}">${escapar(t("f_quitar"))}</button>
      </li>`).join("");

    return `
      <div class="dia${elegidos.length ? " activo" : ""}">
        <p class="dia-fecha">${escapar(dia)}</p>
        ${lista ? `<ul class="dia-lista">${lista}</ul>` : `<p class="dia-libre">${escapar(t("f_dia_libre"))}</p>`}
        <button type="button" class="abrir-selector" data-fecha="${f}" ${catalogoListo && servicios.length ? "" : "disabled"}
          aria-label="${escapar(t("f_aria_agregar", { dia }))}">${escapar(t(elegidos.length ? "f_agregar_mas" : "f_agregar"))}</button>
      </div>`;
  }).join("");
}

$("dias").addEventListener("click", (e) => {
  const abrir = e.target.closest("button.abrir-selector");
  if (abrir) return abrirSelector(abrir.dataset.fecha);

  const btn = e.target.closest("button.quitar");
  if (!btn) return;
  const f = btn.dataset.fecha;
  seleccion[f] = seleccion[f].filter((id) => id !== Number(btn.dataset.id));
  if (!seleccion[f].length) delete seleccion[f];
  pintarDias();
  document.querySelector(`button.abrir-selector[data-fecha="${f}"]`)?.focus();
});

// ---------- Selector de actividades (ventana con tipos) ----------
const selector = { fecha: null, tipo: "todas", busqueda: "" };

// Grupos visibles: cada tipo con sus actividades, y al final las que no tienen tipo
function grupos() {
  const lista = tipos
    .map((tp) => ({ id: String(tp.id), nombre: tTipo(tp), icono: tp.icono || "", items: servicios.filter((s) => s.tipo_id === tp.id) }))
    .filter((g) => g.items.length);
  const sinTipo = servicios.filter((s) => !s.tipo_id);
  if (sinTipo.length) lista.push({ id: "otros", nombre: t("s_otros"), icono: "", items: sinTipo });
  lista.forEach((g) => g.items.sort((x, y) => tServicio(x).localeCompare(tServicio(y), locale())));
  return lista;
}

const sinAcentos = (x) => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function abrirSelector(fecha) {
  selector.fecha = fecha;
  selector.busqueda = "";
  if (selector.tipo !== "todas" && !grupos().some((g) => g.id === selector.tipo)) selector.tipo = "todas";
  $("selBuscar").value = "";
  $("selDia").textContent = nombreDia(fecha);
  pintarSelector();
  $("selector").showModal();
  $("selLista").scrollTop = 0;
}

function pintarSelector() {
  if (!selector.fecha) return;
  const todos = grupos();
  const elegidos = seleccion[selector.fecha] || [];
  $("selDia").textContent = nombreDia(selector.fecha);

  $("selTipos").innerHTML = [{ id: "todas", nombre: t("s_todas"), icono: "", items: servicios }, ...todos].map((g) => `
    <button type="button" class="sel-tipo" data-tipo="${g.id}" aria-pressed="${selector.tipo === g.id}">
      ${g.icono ? `<span aria-hidden="true">${escapar(g.icono)}</span>` : ""}${escapar(g.nombre)}
      <span class="sel-tipo-n">${g.items.length}</span>
    </button>`).join("");

  const q = sinAcentos(selector.busqueda.trim());
  const visibles = todos
    .filter((g) => q || selector.tipo === "todas" || g.id === selector.tipo)
    .map((g) => ({ ...g, items: q ? g.items.filter((s) => sinAcentos(tServicio(s)).includes(q)) : g.items }))
    .filter((g) => g.items.length);

  const tarjeta = (s) => {
    const marcado = elegidos.includes(s.id);
    const desc = tDescripcion(s);
    return `
      <button type="button" class="sel-item" data-id="${s.id}" aria-pressed="${marcado}">
        <span class="sel-item-texto">
          <span class="sel-item-nombre">${escapar(tServicio(s))}</span>
          ${s.duracion_min ? `<span class="sel-item-meta">${escapar(duracion(s.duracion_min))}</span>` : ""}
          ${desc ? `<span class="sel-item-desc">${escapar(desc)}</span>` : ""}
        </span>
        <span class="sel-marca" aria-hidden="true"></span>
      </button>`;
  };

  let h;
  if (!servicios.length) h = `<p class="sel-vacio">${escapar(t("s_vacio"))}</p>`;
  else if (!visibles.length) h = `<p class="sel-vacio">${escapar(t("s_sin_resultados"))}</p>`;
  else {
    const conTitulos = visibles.length > 1 || selector.tipo === "todas" || q;
    h = visibles.map((g) => `
      <section class="sel-grupo">
        ${conTitulos ? `<h3 class="sel-grupo-titulo">${g.icono ? `<span aria-hidden="true">${escapar(g.icono)}</span> ` : ""}${escapar(g.nombre)}</h3>` : ""}
        <div class="sel-items">${g.items.map(tarjeta).join("")}</div>
      </section>`).join("");
  }
  $("selLista").innerHTML = h;
  pintarCuenta();
}

function pintarCuenta() {
  const n = (seleccion[selector.fecha] || []).length;
  $("selCuenta").textContent = n ? tp("s_elegidas", n) : t("s_elegidas_0");
}

$("selTipos").addEventListener("click", (e) => {
  const b = e.target.closest(".sel-tipo");
  if (!b) return;
  selector.tipo = b.dataset.tipo;
  selector.busqueda = "";
  $("selBuscar").value = "";
  pintarSelector();
  $("selLista").scrollTop = 0;
  document.querySelector(`.sel-tipo[data-tipo="${selector.tipo}"]`)?.focus();
});

$("selBuscar").addEventListener("input", () => {
  selector.busqueda = $("selBuscar").value;
  pintarSelector();
});

$("selLista").addEventListener("click", (e) => {
  const b = e.target.closest(".sel-item");
  if (!b) return;
  const id = Number(b.dataset.id);
  const lista = (seleccion[selector.fecha] ||= []);
  const i = lista.indexOf(id);
  if (i >= 0) lista.splice(i, 1); else lista.push(id);
  if (!lista.length) delete seleccion[selector.fecha];
  b.setAttribute("aria-pressed", i < 0);
  pintarCuenta();
});

$("selListo").addEventListener("click", () => $("selector").close());
$("selCerrar").addEventListener("click", () => $("selector").close());
// Tocar fuera de la ventana también la cierra
$("selector").addEventListener("click", (e) => { if (e.target === $("selector")) $("selector").close(); });
$("selector").addEventListener("close", () => {
  const f = selector.fecha;
  selector.fecha = null;
  pintarDias();
  document.querySelector(`button.abrir-selector[data-fecha="${f}"]`)?.focus();
});

// ---------- Fechas ----------
function prepararFechas() {
  const hoy = aTexto(new Date());
  $("fechaInicio").min = hoy;
  $("fechaFin").min = hoy;

  $("fechaInicio").addEventListener("change", () => {
    const inicio = $("fechaInicio").value;
    $("fechaFin").min = inicio || hoy;
    $("fechaFin").max = inicio ? sumarDias(inicio, MAX_DIAS - 1) : "";
    if (inicio && (!$("fechaFin").value || $("fechaFin").value < inicio)) $("fechaFin").value = inicio;
    pintarDias();
  });
  $("fechaFin").addEventListener("change", pintarDias);
}

// ---------- Hospedaje y personas ----------
$("propiedad").addEventListener("change", () => {
  const otro = $("propiedad").value === "otro";
  $("campoOtro").hidden = !otro;
  if (otro) $("propiedadOtro").focus();
});

function actualizarTotal() {
  const total = numero("adultos") + numero("ninos") + numero("menores");
  $("totalPersonas").textContent = tp("f_total", total);
}
["adultos", "ninos", "menores"].forEach((id) => $(id).addEventListener("input", actualizarTotal));

function textoPersonas(d) {
  const partes = [tp("p_adulto", d.adultos)];
  if (d.ninos) partes.push(tp("p_nino", d.ninos));
  if (d.menores) partes.push(tp("p_menor", d.menores));
  return partes.join(", ");
}

// ---------- Validación ----------
function validar() {
  const e = [];
  const inicio = $("fechaInicio").value, fin = $("fechaFin").value;

  if (!inicio || !fin) e.push("e_fechas");
  else if (fin < inicio) e.push("f_fecha_mal");
  if (!totalServicios()) e.push("e_servicio");

  const prop = $("propiedad").value;
  if (!prop) e.push("e_hospedaje");
  else if (prop === "otro" && !$("propiedadOtro").value.trim()) e.push("e_lugar");

  if (!$("nombre").value.trim()) e.push("e_nombre");
  if (!$("apellido").value.trim()) e.push("e_apellido");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test($("correo").value.trim())) e.push("e_correo");
  if ($("telefono").value.replace(/\D/g, "").length < 6) e.push("e_telefono");
  if (numero("adultos") < 1) e.push("e_adulto");
  return e;
}

function mostrarErrores(claves) {
  const caja = $("errores");
  caja.innerHTML = `<p>${escapar(t("e_revisa"))}</p><ul>${claves.map((c) => `<li>${escapar(t(c))}</li>`).join("")}</ul>`;
  caja.hidden = false;
  caja.scrollIntoView({ behavior: "smooth", block: "center" });
}

// ---------- Envío ----------
$("formulario").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errores = validar();
  if (errores.length) return mostrarErrores(errores);
  $("errores").hidden = true;

  const prop = $("propiedad").value;
  const datos = {
    fecha_inicio: $("fechaInicio").value,
    fecha_fin: $("fechaFin").value,
    propiedad_id: prop === "otro" ? "" : prop,
    propiedad_otro: prop === "otro" ? $("propiedadOtro").value.trim() : "",
    nombre: $("nombre").value.trim(),
    apellido: $("apellido").value.trim(),
    correo: $("correo").value.trim(),
    telefono: `${$("codigoPais").value} ${$("telefono").value.trim()}`,
    adultos: numero("adultos"),
    ninos: numero("ninos"),
    menores: numero("menores"),
    idioma,
    servicios: Object.entries(seleccion).flatMap(([fecha, ids]) =>
      ids.map((servicio_id) => ({ fecha, servicio_id })))
  };

  const btn = $("btnEnviar");
  btn.disabled = true;
  btn.textContent = t("f_enviando");

  const { data, error } = await db.rpc("crear_cotizacion", { datos });

  btn.disabled = false;
  btn.textContent = t("f_enviar");

  if (error) {
    console.error(error);
    return mostrarErrores(["e_envio"]);
  }
  ultimoEnvio = { numero: data.numero, datos };
  mostrarGracias();
});

function mostrarGracias() {
  const { numero: num, datos } = ultimoEnvio;
  $("numeroFinal").textContent = num;
  $("textoGracias").innerHTML = escapar(t("g_texto", { correo: "\u0000" }))
    .replace("\u0000", `<strong>${escapar(datos.correo)}</strong>`);

  const dias = Object.keys(seleccion).sort().map((f) => `
    <div class="linea">
      <span class="linea-dia">${escapar(nombreDia(f))}</span>
      <span>${seleccion[f].map((id) => escapar(nombreServicio(id))).join("<br>")}</span>
    </div>`).join("");

  $("resumenFinal").innerHTML = `
    <p class="resumen-grupo">${escapar(datos.nombre)} ${escapar(datos.apellido)}: ${escapar(textoPersonas(datos))}</p>
    ${dias}`;

  const primeraVez = $("vistaGracias").hidden;
  $("vistaFormulario").hidden = true;
  $("vistaGracias").hidden = false;
  if (primeraVez) {
    window.scrollTo(0, 0);
    $("numeroFinal").focus();
  }
}

$("btnImprimir").addEventListener("click", () => window.print());
$("btnNueva").addEventListener("click", () => location.reload());

// ---------- Cambio de idioma: se redibuja todo sin perder lo escrito ----------
document.addEventListener("idioma-cambiado", () => {
  pintarCodigos();
  pintarPropiedades();
  pintarDias();
  actualizarTotal();
  $("errores").hidden = true;
  if (errorCarga) $("errorCarga").textContent = t(errorCarga);
  if (!$("btnEnviar").disabled) $("btnEnviar").textContent = t("f_enviar");
  if (ultimoEnvio) mostrarGracias();
  if ($("selector").open) pintarSelector();
});

// ---------- Inicio ----------
pintarCodigos();
pintarPropiedades();
prepararFechas();
pintarDias();
actualizarTotal();
cargarCatalogos();
