// =====================================================
// RESERVA MANUAL
// Para clientes que llegan a la oficina, llaman, escriben por WhatsApp o correo.
// El agente crea la solicitud desde el panel: queda en "Proceso" asignada a quien
// la atiende, y se completa con el mismo editor de itinerario y precios.
// Después se puede enviar al cliente o "Confirmar en nombre del cliente".
// Usa utilidades de panel.js.
// =====================================================

const ORIGENES = {
  web: "Formulario web",
  oficina: "Oficina (en persona)",
  telefono: "Llamada telefónica",
  whatsapp: "WhatsApp",
  correo: "Correo electrónico",
  otro: "Otro"
};
const ORIGEN_CORTO = { oficina: "Oficina", telefono: "Teléfono", whatsapp: "WhatsApp", correo: "Correo", otro: "Manual" };
const CODIGOS_PAIS = [
  ["+506", "Costa Rica"], ["+1", "EE. UU. / Canadá"], ["+52", "México"], ["+507", "Panamá"],
  ["+57", "Colombia"], ["+54", "Argentina"], ["+55", "Brasil"], ["+56", "Chile"],
  ["+34", "España"], ["+33", "Francia"], ["+49", "Alemania"], ["+39", "Italia"],
  ["+44", "Reino Unido"], ["+31", "Países Bajos"], ["+41", "Suiza"], ["", "Otro (escríbelo en el número)"]
];

function htmlFormManual() {
  const hoy = aTexto(new Date());
  const colaboradores = app.perfiles
    .filter((p) => p.activo !== false)
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
  return `
    <div class="det-cabeza estado-proceso">
      <div>
        <p class="det-numero"><span class="chip">Nueva</span><span>Reserva manual</span></p>
        <h2 id="manualTitulo" tabindex="-1">Cliente directo</h2>
      </div>
      <div class="det-acciones">
        <button type="button" class="btn" data-manual="cerrar">Cerrar</button>
      </div>
    </div>

    <form id="formManual" novalidate>
      <section class="det-seccion">
        <h3>¿Cómo llegó el cliente?</h3>
        <div class="fila">
          <label>Origen
            <select id="manOrigen">
              ${Object.entries(ORIGENES).filter(([k]) => k !== "web")
                .map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}
            </select>
          </label>
          <label>Atiende
            <select id="manColaborador">
              ${colaboradores.map((p) => `<option value="${p.id}" ${p.id === app.yo.id ? "selected" : ""}>${escapar(p.nombre)}</option>`).join("")}
            </select>
          </label>
          <label>Idioma del cliente
            <select id="manIdioma">
              ${Object.entries(NOMBRE_IDIOMA).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}
            </select>
          </label>
        </div>
      </section>

      <section class="det-seccion">
        <h3>Datos del cliente</h3>
        <div class="fila">
          <label>Nombre * <input id="manNombre" autocomplete="off" required></label>
          <label>Apellido * <input id="manApellido" autocomplete="off" required></label>
        </div>
        <div class="fila">
          <label>Teléfono *
            <span class="man-telefono">
              <select id="manCodigo" aria-label="Código de país">
                ${CODIGOS_PAIS.map(([c, n]) => `<option value="${c}">${c ? c + " " : ""}${n}</option>`).join("")}
              </select>
              <input id="manTelefono" type="tel" autocomplete="off" aria-label="Número de teléfono">
            </span>
          </label>
          <label>Correo (opcional) <input id="manCorreo" type="email" autocomplete="off"></label>
        </div>
        <p class="nota">Sin correo no se le pueden enviar correos desde el sistema, pero sí el enlace por WhatsApp.</p>
      </section>

      <section class="det-seccion">
        <h3>Viaje</h3>
        <div class="fila">
          <label>Desde * <input id="manInicio" type="date" value="${hoy}" required></label>
          <label>Hasta * <input id="manFin" type="date" value="${hoy}" required></label>
        </div>
        <div class="fila">
          <label>Hospedaje *
            <select id="manPropiedad">
              <option value="">Elige el hospedaje…</option>
              ${app.propiedades.filter((p) => p.activa !== false)
                .map((p) => `<option value="${p.id}">${escapar(p.nombre)}</option>`).join("")}
              <option value="otro">Otro lugar</option>
            </select>
          </label>
          <label id="manOtroCaja" hidden>¿Dónde se hospeda? <input id="manOtro" autocomplete="off"></label>
        </div>
        <div class="fila">
          <label>Adultos (12+) * <input id="manAdultos" type="number" min="1" value="2"></label>
          <label>Niños (6 a 11) <input id="manNinos" type="number" min="0" value="0"></label>
          <label>Menores de 6 <input id="manMenores" type="number" min="0" value="0"></label>
        </div>
      </section>

      <section class="det-seccion">
        <h3>Lo que pide el cliente</h3>
        <label>Notas internas (opcional)
          <textarea id="manNotas" rows="3" placeholder="Ej.: quiere canopy el martes en la mañana y termales el miércoles; paga en efectivo en la oficina."></textarea>
        </label>
        <p class="nota">Al crearla se abre la reserva para que agregues las actividades con sus fechas y tarifas.
          Cuando esté lista puedes enviarle el enlace o usar <strong>Confirmar en nombre del cliente</strong> para pasarla a Reserva.</p>
      </section>

      <div id="manErrores" class="det-seccion man-errores" hidden></div>

      <div class="barra-guardar man-barra">
        <button type="submit" class="btn primario" id="manCrear">Crear y agregar actividades</button>
        <button type="button" class="btn" data-manual="cerrar">Cancelar</button>
      </div>
    </form>`;
}

function abrirManual() {
  $("manualContenido").innerHTML = htmlFormManual();
  $("manual").hidden = false;
  document.body.classList.add("detalle-abierto");
  $("manNombre").focus();
}

function hayDatosManual() {
  return ["manNombre", "manApellido", "manTelefono", "manCorreo", "manNotas"]
    .some((id) => $(id)?.value.trim());
}

function cerrarManual(preguntar = true) {
  if ($("manual").hidden) return;
  if (preguntar && hayDatosManual() && !confirm("Hay datos escritos en la reserva manual. ¿Cerrar sin guardar?")) return;
  $("manual").hidden = true;
  $("manualContenido").innerHTML = "";
  if ($("detalle").hidden) document.body.classList.remove("detalle-abierto");
}

function leerManual() {
  const n = (id, min) => Math.max(min, parseInt($(id).value, 10) || 0);
  const prop = $("manPropiedad").value;
  const numeroTel = $("manTelefono").value.trim();
  return {
    origen: $("manOrigen").value,
    colaborador_id: $("manColaborador").value || app.yo.id,
    idioma: $("manIdioma").value,
    nombre: $("manNombre").value.trim(),
    apellido: $("manApellido").value.trim(),
    telefono: numeroTel ? `${$("manCodigo").value} ${numeroTel}`.trim() : "",
    correo: $("manCorreo").value.trim().toLowerCase(),
    fecha_inicio: $("manInicio").value,
    fecha_fin: $("manFin").value,
    propiedad_id: prop && prop !== "otro" ? Number(prop) : null,
    propiedad_otro: prop === "otro" ? $("manOtro").value.trim() : null,
    _prop: prop,
    adultos: n("manAdultos", 0),
    ninos: n("manNinos", 0),
    menores: n("manMenores", 0),
    notas: $("manNotas").value.trim() || null
  };
}

function validarManual(d) {
  const e = [];
  if (!d.nombre) e.push("Escribe el nombre del cliente.");
  if (!d.apellido) e.push("Escribe el apellido del cliente.");
  if (d.telefono.replace(/\D/g, "").length < 6) e.push("Escribe un teléfono válido.");
  if (d.correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.correo)) e.push("El correo no es válido (o déjalo vacío).");
  if (!d.fecha_inicio || !d.fecha_fin) e.push("Indica las fechas del viaje.");
  else if (d.fecha_fin < d.fecha_inicio) e.push("La fecha final no puede ser antes de la inicial.");
  if (!d._prop) e.push("Elige el hospedaje (o \"Otro lugar\").");
  if (d._prop === "otro" && !d.propiedad_otro) e.push("Escribe dónde se hospeda el cliente.");
  if (d.adultos < 1) e.push("Debe haber al menos un adulto.");
  return e;
}

async function crearManual() {
  const d = leerManual();
  const errores = validarManual(d);
  const caja = $("manErrores");
  if (errores.length) {
    caja.innerHTML = `<p><strong>Revisa lo siguiente:</strong></p><ul>${errores.map((x) => `<li>${escapar(x)}</li>`).join("")}</ul>`;
    caja.hidden = false;
    caja.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  caja.hidden = true;
  if (d.fecha_inicio < aTexto(new Date()) &&
      !confirm("La fecha de inicio ya pasó. ¿Crear la reserva de todos modos?")) return;

  const { _prop, ...fila } = d;
  await conBoton($("manCrear"), async () => {
    const { data, error } = await db.from("cotizaciones")
      .insert({ ...fila, estado: "proceso" })
      .select("id, numero").single();
    if (error) return fallo(error, "No se pudo crear la reserva manual.");

    const atiende = nombrePerfil(d.colaborador_id) || app.yo.nombre;
    await registrar(data.id, "creada manualmente",
      `${ORIGENES[d.origen]} · registrada por ${app.yo.nombre}${d.colaborador_id !== app.yo.id ? ` · atiende ${atiende}` : ""}`);

    cerrarManual(false);
    await cargarTablero();
    await abrirDetalle(data.id);
    avisar(`Reserva manual ${data.numero} creada. Agrega las actividades y guarda.`);
  });
}

// ---------- Botón y eventos ----------
$("btnNuevaManual").addEventListener("click", abrirManual);

$("manual").addEventListener("click", (e) => {
  if (e.target === $("manual") || e.target.closest("[data-manual='cerrar']")) cerrarManual();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("manual").hidden) { e.stopImmediatePropagation(); cerrarManual(); }
}, true);

$("manualContenido").addEventListener("change", (e) => {
  if (e.target.id === "manPropiedad") {
    $("manOtroCaja").hidden = e.target.value !== "otro";
    if (e.target.value === "otro") $("manOtro").focus();
  }
  if (e.target.id === "manInicio" && $("manFin").value < e.target.value) $("manFin").value = e.target.value;
});

$("manualContenido").addEventListener("submit", (e) => {
  if (e.target.id !== "formManual") return;
  e.preventDefault();
  crearManual();
});

// =====================================================
// ACTIVIDADES DE LAS RESERVAS (MANUALES Y DEL FORMULARIO WEB): SOLO DEL TARIFARIO FINAL
// La lista sale de las tarifas aprobadas (actividad + proveedor), aunque la
// actividad no sea visible para clientes: "Visible" solo decide lo que ve el
// cliente en el formulario. Las actividades nuevas se crean únicamente en el
// Tarifario (administrador).
// Avisa si la actividad no tiene tarifa vigente o le falta algo necesario.
// =====================================================
const esReservaManual = (c) => !!c && !!c.origen && c.origen !== "web";
const normTar = (t) => String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const opcionTarifario = (servicioId) => (app.opcionesTarifario || []).find((o) => o.servicio_id === Number(servicioId));
const tarHoy = () => aTexto(new Date());

function htmlOpcionesTarifario(seleccionado, filtro = "") {
  const q = normTar(filtro).trim();
  const lista = (app.opcionesTarifario || []).filter((o) => !q || normTar(`${o.nombre} ${o.operador}`).includes(q));
  const etiqueta = (o) => `${o.nombre} · ${o.operador}`;
  const opcion = (o) => o.servicio_id
    ? `<option value="${o.servicio_id}" ${o.servicio_id === seleccionado ? "selected" : ""}>${escapar(etiqueta(o))}${o.sin_equivalencia?.length ? " ⚠" : ""}</option>`
    : `<option disabled>${escapar(etiqueta(o))} (falta enlazarla en el Catálogo)</option>`;
  const vigentes = lista.filter((o) => o.hasta >= tarHoy());
  const vencidas = lista.filter((o) => !(o.hasta >= tarHoy()));
  let h = "";
  // si la actividad ya guardada no está en el Tarifario final, se muestra igual para no perderla
  const actual = seleccionado && !opcionTarifario(seleccionado) ? servicioPorId(seleccionado) : null;
  if (actual) h += `<option value="${actual.id}" selected>${escapar(actual.nombre)} (no está en el Tarifario final)</option>`;
  h += vigentes.map(opcion).join("");
  if (vencidas.length) h += `<optgroup label="Sin tarifa vigente">${vencidas.map(opcion).join("")}</optgroup>`;
  if (!lista.length && !actual) h += `<option disabled>Ninguna actividad coincide con “${escapar(filtro)}”</option>`;
  return h;
}

function htmlSelectorTarifario(a) {
  const total = (app.opcionesTarifario || []).length;
  return `
    <label class="ancho">Actividad del Tarifario final
      <input type="search" class="tar-buscar" data-buscar-tarifario placeholder="Buscar actividad o proveedor (${total} disponibles)…" aria-label="Buscar actividad o proveedor">
      <select data-campo="servicio_id"><option value="">Elige una actividad</option>${htmlOpcionesTarifario(a.servicio_id)}</select>
    </label>`;
}

// Avisos de la actividad elegida: tarifa vigente, tarifa para la fecha y datos que faltan
function htmlAlertasTarifario(a) {
  if (!a.servicio_id) return "";
  const admin = app.yo?.rol === "administrador";
  const donde = (lugar) => admin ? ` Corrígelo en <strong>Tarifario › ${lugar}</strong>.` : " Avísale al administrador para que lo corrija en el Tarifario.";
  const o = opcionTarifario(a.servicio_id);
  const avisos = [], notas = [];
  if (!o) {
    avisos.push(`Esta actividad no está en el Tarifario final (no tiene tarifas aprobadas).${donde("Procesar")}`);
  } else {
    if (!(o.hasta >= tarHoy())) avisos.push(`La tarifa venció el ${fecha(o.hasta, { day: "numeric", month: "short", year: "numeric" })}; falta cargar la nueva.${donde("Importar / Procesar")}`);
    if (a.fecha && !(o.temporadas || []).some((t) => a.fecha >= t.inicio && a.fecha <= t.fin)) {
      const temps = (o.temporadas || []).map((t) => `${fecha(t.inicio)} – ${fecha(t.fin, { day: "numeric", month: "short", year: "numeric" })}`).join(" · ");
      avisos.push(`No hay tarifa para el ${fecha(a.fecha, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}: queda como <strong>tarifa pendiente</strong>.${temps ? ` Temporadas cargadas: ${temps}.` : ""}`);
    }
    if (o.sin_equivalencia?.length) avisos.push(`Categorías del proveedor sin equivalencia con un tipo de cliente (${o.sin_equivalencia.map(escapar).join(", ")}): sus precios no se aplican.${donde("Ajustes")}`);
    if (o.sin_precio > 0) avisos.push(`Hay tarifas vigentes sin precio TC.${donde("Tarifario final")}`);
    if (!o.contacto) notas.push(`El proveedor no tiene correo ni WhatsApp de reservas: no se le podrá enviar la solicitud desde el sistema.${donde("Operadores")}`);
  }
  // tipos de cliente con personas pero sin precio en la tarifa de esa fecha
  const t = typeof tarifaDe === "function" ? tarifaDe(a) : null;
  if (t?.precios?.length) {
    const sinPrecio = a.participantes.filter((p) => p.cantidad > 0 && !t.precios.some((x) => x.categoria_id === p.categoria_id && x.tc != null));
    if (sinPrecio.length) avisos.push(`La tarifa no tiene precio para: ${sinPrecio.map((p) => escapar(categoriaPorId(p.categoria_id)?.nombre ?? "")).join(", ")}. Escribe el precio a mano (Manual).`);
  }
  if (!avisos.length && !notas.length) return "";
  return `<div class="tar-alertas">
    ${avisos.map((x) => `<p class="tar-alerta">⚠ ${x}</p>`).join("")}
    ${notas.map((x) => `<p class="tar-nota">ⓘ ${x}</p>`).join("")}
  </div>`;
}

// Buscador: filtra la lista sin marcar la actividad como modificada
$("detalleContenido").addEventListener("input", (e) => {
  if (!e.target.matches("[data-buscar-tarifario]")) return;
  e.stopImmediatePropagation();
  const sel = e.target.closest("label").querySelector('[data-campo="servicio_id"]');
  const actual = Number(sel.value) || null;
  sel.innerHTML = `<option value="">${e.target.value.trim() ? "Elige entre las que coinciden" : "Elige una actividad"}</option>${htmlOpcionesTarifario(actual, e.target.value)}`;
  if (actual) sel.value = String(actual);
}, true);
$("detalleContenido").addEventListener("change", (e) => {
  if (e.target.matches("[data-buscar-tarifario]")) e.stopImmediatePropagation();
}, true);
$("detalleContenido").addEventListener("keydown", (e) => {
  // Enter en el buscador: si queda una sola coincidencia, la elige
  if (!e.target.matches("[data-buscar-tarifario]") || e.key !== "Enter") return;
  e.preventDefault();
  const sel = e.target.closest("label").querySelector('[data-campo="servicio_id"]');
  const opciones = [...sel.options].filter((op) => op.value && !op.disabled);
  if (opciones.length === 1 && sel.value !== opciones[0].value) {
    sel.value = opciones[0].value;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  } else sel.focus();
});
