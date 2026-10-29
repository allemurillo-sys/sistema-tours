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
