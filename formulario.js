// =====================================================
// FORMULARIO DEL CLIENTE
// =====================================================

const $ = (id) => document.getElementById(id);
const MAX_DIAS = 30;
const db = supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey);

let servicios = [];     // catálogo desde la base de datos
const seleccion = {};   // { "2026-10-12": [3, 5], ... }

// ---------- Utilidades ----------
const pad = (n) => String(n).padStart(2, "0");
const aTexto = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const aFecha = (t) => new Date(t + "T12:00:00");

function escapar(texto) {
  return String(texto ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function nombreDia(t) {
  const s = aFecha(t).toLocaleDateString("es-CR", { weekday: "long", day: "numeric", month: "long" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function duracion(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return h ? `${h} h${m ? " " + m + " min" : ""}` : `${m} min`;
}
function numero(id) {
  const n = parseInt($(id).value, 10);
  return isNaN(n) || n < 0 ? 0 : n;
}
function sumarDias(t, n) {
  const d = aFecha(t);
  d.setDate(d.getDate() + n);
  return aTexto(d);
}
function listaFechas(inicio, fin) {
  const dias = [];
  for (let t = inicio; t <= fin && dias.length < MAX_DIAS; t = sumarDias(t, 1)) dias.push(t);
  return dias;
}
const nombreServicio = (id) => servicios.find((s) => s.id === id)?.nombre ?? "Servicio";
const totalServicios = () => Object.values(seleccion).reduce((n, l) => n + l.length, 0);

// ---------- Catálogos ----------
async function cargarCatalogos() {
  if (CONFIG.supabaseUrl.includes("TU-PROYECTO")) {
    mostrarErrorCarga("Falta configurar la conexión: edita js/config.js con los datos de tu proyecto de Supabase.");
    return;
  }

  const [s, p] = await Promise.all([
    db.from("servicios").select("id, nombre, duracion_min").eq("activo", true).order("nombre"),
    db.from("propiedades").select("id, nombre").eq("activa", true).order("nombre")
  ]);

  if (s.error || p.error) {
    mostrarErrorCarga("No se pudo cargar la lista de servicios. Revisa tu conexión y recarga la página.");
    return;
  }

  servicios = s.data;
  $("propiedad").innerHTML =
    `<option value="">Elige una opción</option>` +
    p.data.map((x) => `<option value="${x.id}">${escapar(x.nombre)}</option>`).join("") +
    `<option value="otro">Otro lugar</option>`;
  pintarDias();
}

function mostrarErrorCarga(texto) {
  $("errorCarga").textContent = texto;
  $("errorCarga").hidden = false;
  $("btnEnviar").disabled = true;
}

// ---------- Días y servicios ----------
function pintarDias() {
  const inicio = $("fechaInicio").value;
  const fin = $("fechaFin").value;
  const ayuda = $("ayudaDias");
  const cont = $("dias");

  if (!inicio || !fin || fin < inicio) {
    cont.innerHTML = "";
    ayuda.textContent = inicio && fin && fin < inicio
      ? "La fecha final debe ser igual o posterior a la inicial."
      : "Elige primero las fechas para ver los días.";
    return;
  }

  const fechas = listaFechas(inicio, fin);
  Object.keys(seleccion).forEach((f) => { if (!fechas.includes(f)) delete seleccion[f]; });
  ayuda.textContent = "Puedes agregar varios servicios en un mismo día. Los días sin servicios quedan libres.";

  cont.innerHTML = fechas.map((f) => {
    const elegidos = seleccion[f] || [];
    const lista = elegidos.map((id) => `
      <li>
        <span>${escapar(nombreServicio(id))}</span>
        <button type="button" class="quitar" data-fecha="${f}" data-id="${id}"
          aria-label="Quitar ${escapar(nombreServicio(id))} del ${escapar(nombreDia(f))}">Quitar</button>
      </li>`).join("");
    const opciones = servicios
      .filter((s) => !elegidos.includes(s.id))
      .map((s) => `<option value="${s.id}">${escapar(s.nombre)}${s.duracion_min ? ` (${duracion(s.duracion_min)})` : ""}</option>`)
      .join("");

    return `
      <div class="dia${elegidos.length ? " activo" : ""}">
        <p class="dia-fecha">${escapar(nombreDia(f))}</p>
        ${lista ? `<ul class="dia-lista">${lista}</ul>` : ""}
        ${opciones ? `
          <select class="agregar" data-fecha="${f}" aria-label="Agregar servicio el ${escapar(nombreDia(f))}">
            <option value="">+ Agregar servicio</option>${opciones}
          </select>` : ""}
      </div>`;
  }).join("");
}

$("dias").addEventListener("change", (e) => {
  const sel = e.target.closest("select.agregar");
  if (!sel || !sel.value) return;
  const f = sel.dataset.fecha;
  (seleccion[f] ||= []).push(Number(sel.value));
  pintarDias();
  document.querySelector(`select.agregar[data-fecha="${f}"]`)?.focus();
});

$("dias").addEventListener("click", (e) => {
  const btn = e.target.closest("button.quitar");
  if (!btn) return;
  const f = btn.dataset.fecha;
  seleccion[f] = seleccion[f].filter((id) => id !== Number(btn.dataset.id));
  if (!seleccion[f].length) delete seleccion[f];
  pintarDias();
  document.querySelector(`select.agregar[data-fecha="${f}"]`)?.focus();
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
  $("totalPersonas").textContent = `Total: ${total} ${total === 1 ? "persona" : "personas"}`;
}
["adultos", "ninos", "menores"].forEach((id) => $(id).addEventListener("input", actualizarTotal));

// ---------- Validación ----------
function validar() {
  const errores = [];
  const inicio = $("fechaInicio").value, fin = $("fechaFin").value;

  if (!inicio || !fin) errores.push("Indica la fecha de inicio y la final.");
  else if (fin < inicio) errores.push("La fecha final debe ser igual o posterior a la inicial.");
  if (!totalServicios()) errores.push("Agrega al menos un servicio en alguno de los días.");

  const prop = $("propiedad").value;
  if (!prop) errores.push("Indica dónde te hospedas.");
  else if (prop === "otro" && !$("propiedadOtro").value.trim()) errores.push("Escribe el nombre del lugar donde te hospedas.");

  if (!$("nombre").value.trim()) errores.push("Escribe tu nombre.");
  if (!$("apellido").value.trim()) errores.push("Escribe tu apellido.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test($("correo").value.trim())) errores.push("Revisa el correo electrónico.");
  if ($("telefono").value.replace(/\D/g, "").length < 6) errores.push("Revisa el número de teléfono.");
  if (numero("adultos") < 1) errores.push("Debe viajar al menos un adulto.");

  return errores;
}

function mostrarErrores(lista) {
  const caja = $("errores");
  caja.innerHTML = `<p>Antes de enviar, revisa esto:</p><ul>${lista.map((e) => `<li>${escapar(e)}</li>`).join("")}</ul>`;
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
    servicios: Object.entries(seleccion).flatMap(([fecha, ids]) =>
      ids.map((servicio_id) => ({ fecha, servicio_id })))
  };

  const btn = $("btnEnviar");
  btn.disabled = true;
  btn.textContent = "Enviando…";

  const { data, error } = await db.rpc("crear_cotizacion", { datos });

  btn.disabled = false;
  btn.textContent = "Enviar solicitud";

  if (error) {
    mostrarErrores([error.message || "No se pudo enviar la solicitud. Intenta de nuevo en unos minutos."]);
    return;
  }
  mostrarGracias(data.numero, datos);
});

function mostrarGracias(num, datos) {
  $("numeroFinal").textContent = num;
  $("correoFinal").textContent = datos.correo;

  const dias = Object.keys(seleccion).sort().map((f) => `
    <div class="linea">
      <span class="linea-dia">${escapar(nombreDia(f))}</span>
      <span>${seleccion[f].map((id) => escapar(nombreServicio(id))).join("<br>")}</span>
    </div>`).join("");

  const personas = [`${datos.adultos} ${datos.adultos === 1 ? "adulto" : "adultos"}`];
  if (datos.ninos) personas.push(`${datos.ninos} ${datos.ninos === 1 ? "niño" : "niños"}`);
  if (datos.menores) personas.push(`${datos.menores} ${datos.menores === 1 ? "menor" : "menores"} de 6 años`);

  $("resumenFinal").innerHTML = `
    <p class="resumen-grupo">${escapar(datos.nombre)} ${escapar(datos.apellido)}: ${personas.join(", ")}</p>
    ${dias}`;

  $("vistaFormulario").hidden = true;
  $("vistaGracias").hidden = false;
  window.scrollTo(0, 0);
  $("numeroFinal").focus();
}

$("btnImprimir").addEventListener("click", () => window.print());
$("btnNueva").addEventListener("click", () => location.reload());

// ---------- Inicio ----------
prepararFechas();
actualizarTotal();
cargarCatalogos();
