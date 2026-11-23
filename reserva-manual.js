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
// Las opciones reales vienen de la tabla origenes_reserva (el administrador las edita);
// las de arriba solo se usan si la tabla no se pudo leer.
let origenesLista = [];

async function cargarOrigenes() {
  const { data, error } = await db.from("origenes_reserva").select("*").order("orden").order("nombre");
  if (error) { console.error("Orígenes:", error); return; }
  origenesLista = data || [];
  // Se rellenan los mismos objetos para que el tablero y el detalle sigan funcionando igual
  Object.keys(ORIGENES).forEach((k) => delete ORIGENES[k]);
  Object.keys(ORIGEN_CORTO).forEach((k) => delete ORIGEN_CORTO[k]);
  origenesLista.forEach((o) => {
    ORIGENES[o.clave] = o.nombre;
    if (o.clave !== "web") ORIGEN_CORTO[o.clave] = o.corto || o.nombre;
  });
}

// Opciones que se pueden elegir en una reserva nueva (activas y sin "Formulario web")
function origenesElegibles() {
  const lista = origenesLista.length
    ? origenesLista.filter((o) => o.activo && o.clave !== "web")
    : Object.entries(ORIGENES).filter(([k]) => k !== "web").map(([clave, nombre]) => ({ clave, nombre }));
  return lista;
}

function htmlOpcionesOrigen(elegido) {
  const lista = origenesElegibles();
  const sel = lista.some((o) => o.clave === elegido) ? elegido : lista[0]?.clave;
  return lista.map((o) => `<option value="${escapar(o.clave)}" ${o.clave === sel ? "selected" : ""}>${escapar(o.nombre)}</option>`).join("");
}

// ---------- Editor de opciones de Origen (solo administrador) ----------
const esAdminPanel = () => app.yo?.rol === "administrador";

function htmlEditorOrigenes() {
  const lista = origenesLista.filter((o) => o.clave !== "web");
  const filas = lista.map((o, i) => `
    <div class="org-fila${o.activo ? "" : " org-inactiva"}" data-clave="${escapar(o.clave)}">
      <input data-org-nombre value="${escapar(o.nombre)}" maxlength="60" aria-label="Nombre de la opción">
      <input data-org-corto value="${escapar(o.corto || "")}" maxlength="20" placeholder="Etiqueta corta" aria-label="Etiqueta corta en el tablero">
      <span class="org-botones">
        <button type="button" class="btn chico" data-manual="org-subir" ${i === 0 ? "disabled" : ""} aria-label="Subir">▲</button>
        <button type="button" class="btn chico" data-manual="org-bajar" ${i === lista.length - 1 ? "disabled" : ""} aria-label="Bajar">▼</button>
        <button type="button" class="btn chico" data-manual="org-guardar">Guardar</button>
        ${o.activo
          ? `<button type="button" class="enlace peligro" data-manual="org-eliminar">Eliminar</button>`
          : `<span class="org-estado">Desactivada</span> <button type="button" class="enlace" data-manual="org-reactivar">Reactivar</button>`}
      </span>
    </div>`).join("");
  return `
    <p class="nota">Cambia el nombre y presiona <strong>Guardar</strong>. La etiqueta corta es la que se ve en el tablero (si la dejas vacía se usa el nombre). Una opción que ya se usó en reservas no se borra: se desactiva y deja de aparecer en reservas nuevas. "Formulario web" es fija.</p>
    ${filas || `<p class="nota">No hay opciones. Agrega al menos una.</p>`}
    <div class="org-fila org-nueva">
      <input id="orgNuevoNombre" maxlength="60" placeholder="Nueva opción (ej.: Recomendación de hotel)" aria-label="Nombre de la nueva opción">
      <input id="orgNuevoCorto" maxlength="20" placeholder="Etiqueta corta" aria-label="Etiqueta corta de la nueva opción">
      <span class="org-botones"><button type="button" class="btn" data-manual="org-agregar">+ Agregar</button></span>
    </div>
    <p><button type="button" class="btn" data-manual="origenes">Listo</button></p>`;
}

// Vuelve a pintar el editor y el selector (conserva lo elegido si sigue activo)
async function refrescarOrigenes() {
  const elegido = $("manOrigen")?.value;
  await cargarOrigenes();
  if ($("manOrigen")) $("manOrigen").innerHTML = htmlOpcionesOrigen(elegido);
  if ($("manOrigenesCaja") && !$("manOrigenesCaja").hidden) $("manOrigenesCaja").innerHTML = htmlEditorOrigenes();
}

function claveNueva(nombre) {
  const base = nombre.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 30) || "origen";
  let clave = base, n = 2;
  while (origenesLista.some((o) => o.clave === clave)) clave = `${base}_${n++}`;
  return clave;
}

const nombreRepetido = (nombre, salvo) => origenesLista.some((o) =>
  o.clave !== salvo && o.nombre.trim().toLowerCase() === nombre.trim().toLowerCase());

async function accionOrigen(accion, boton) {
  if (!esAdminPanel()) return avisar("Solo el administrador puede editar las opciones de Origen.", "error");
  const fila = boton.closest(".org-fila");
  const clave = fila?.dataset.clave;
  const o = origenesLista.find((x) => x.clave === clave);

  await conBoton(boton, async () => {
    if (accion === "org-agregar") {
      const nombre = $("orgNuevoNombre").value.trim();
      const corto = $("orgNuevoCorto").value.trim() || null;
      if (!nombre) { $("orgNuevoNombre").focus(); return avisar("Escribe el nombre de la nueva opción.", "error"); }
      if (nombreRepetido(nombre)) return avisar("Ya existe una opción con ese nombre.", "error");
      const orden = Math.max(0, ...origenesLista.map((x) => x.orden)) + 1;
      const { error } = await db.from("origenes_reserva").insert({ clave: claveNueva(nombre), nombre, corto, orden });
      if (error) return fallo(error, "No se pudo agregar la opción.");
      await refrescarOrigenes();
      return avisar(`Opción "${nombre}" agregada.`);
    }
    if (!o) return;

    if (accion === "org-guardar") {
      const nombre = fila.querySelector("[data-org-nombre]").value.trim();
      const corto = fila.querySelector("[data-org-corto]").value.trim() || null;
      if (!nombre) return avisar("El nombre no puede quedar vacío.", "error");
      if (nombreRepetido(nombre, clave)) return avisar("Ya existe una opción con ese nombre.", "error");
      const { error } = await db.from("origenes_reserva").update({ nombre, corto }).eq("clave", clave);
      if (error) return fallo(error, "No se pudo guardar la opción.");
      await refrescarOrigenes();
      return avisar("Opción guardada.");
    }

    if (accion === "org-subir" || accion === "org-bajar") {
      const lista = origenesLista.filter((x) => x.clave !== "web");
      const i = lista.findIndex((x) => x.clave === clave);
      const j = accion === "org-subir" ? i - 1 : i + 1;
      if (j < 0 || j >= lista.length) return;
      [lista[i], lista[j]] = [lista[j], lista[i]];
      const cambios = lista.map((x, k) => ({ clave: x.clave, orden: k + 1 })).filter((x) => origenesLista.find((y) => y.clave === x.clave).orden !== x.orden);
      for (const c of cambios) {
        const { error } = await db.from("origenes_reserva").update({ orden: c.orden }).eq("clave", c.clave);
        if (error) return fallo(error, "No se pudo cambiar el orden.");
      }
      return refrescarOrigenes();
    }

    if (accion === "org-reactivar") {
      const { error } = await db.from("origenes_reserva").update({ activo: true }).eq("clave", clave);
      if (error) return fallo(error, "No se pudo reactivar la opción.");
      await refrescarOrigenes();
      return avisar(`Opción "${o.nombre}" reactivada.`);
    }

    if (accion === "org-eliminar") {
      if (origenesElegibles().length <= 1) return avisar("Debe quedar al menos una opción activa.", "error");
      // ¿Ya se usó en alguna reserva? Entonces solo se puede desactivar
      const { count, error: e1 } = await db.from("cotizaciones").select("id", { count: "exact", head: true }).eq("origen", clave);
      if (e1) return fallo(e1, "No se pudo revisar si la opción está en uso.");
      if (count) {
        if (!confirm(`"${o.nombre}" ya se usó en ${count} ${count === 1 ? "reserva" : "reservas"}, así que no se puede borrar (esas reservas la siguen mostrando).\n\n¿Desactivarla para que no aparezca en reservas nuevas?`)) return;
        const { error } = await db.from("origenes_reserva").update({ activo: false }).eq("clave", clave);
        if (error) return fallo(error, "No se pudo desactivar la opción.");
        await refrescarOrigenes();
        return avisar(`Opción "${o.nombre}" desactivada.`);
      }
      if (!confirm(`¿Eliminar la opción "${o.nombre}"? No se ha usado en ninguna reserva.`)) return;
      const { error } = await db.from("origenes_reserva").delete().eq("clave", clave);
      if (error) return fallo(error, "No se pudo eliminar la opción.");
      await refrescarOrigenes();
      return avisar(`Opción "${o.nombre}" eliminada.`);
    }
  });
}
const CODIGOS_PAIS = [
  ["+506", "Costa Rica"], ["+1", "EE. UU. / Canadá"], ["+52", "México"], ["+507", "Panamá"],
  ["+57", "Colombia"], ["+54", "Argentina"], ["+55", "Brasil"], ["+56", "Chile"],
  ["+34", "España"], ["+33", "Francia"], ["+49", "Alemania"], ["+39", "Italia"],
  ["+44", "Reino Unido"], ["+31", "Países Bajos"], ["+41", "Suiza"], ["", "Otro (escríbelo en el número)"]
];

// Idioma que se sugiere según el código de país del teléfono (el agente lo puede cambiar)
const IDIOMA_PAIS = { "+506": "es", "+52": "es", "+507": "es", "+57": "es", "+54": "es", "+56": "es", "+34": "es",
  "+1": "en", "+44": "en", "+31": "en", "+55": "en", "+33": "fr", "+49": "de", "+41": "de", "+39": "it" };
const man = { fechasManuales: false, idiomaManual: false };
const leerLocal = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const guardarLocal = (k, v) => { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } };
const sumarDia = (f, n) => { const d = new Date(`${f}T12:00:00`); d.setDate(d.getDate() + n); return aTexto(d); };

// Una fila de actividad del formulario: qué actividad (del Tarifario final) y qué día
function htmlFilaManual(dia) {
  return `
    <div class="man-act">
      <input type="search" class="tar-buscar" data-man-buscar placeholder="Buscar actividad o proveedor…" aria-label="Buscar actividad o proveedor">
      <select data-man-serv aria-label="Actividad"><option value="">Elige una actividad</option>${htmlOpcionesTarifario(null)}</select>
      <input type="date" data-man-dia value="${dia}" aria-label="Día de la actividad">
      <button type="button" class="enlace peligro" data-manual="quitar-act">Quitar</button>
    </div>`;
}

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
            <select id="manOrigen">${htmlOpcionesOrigen(leerLocal("thot.manOrigen") || "oficina")}</select>
            ${esAdminPanel() ? `<button type="button" class="enlace man-origen-editar" data-manual="origenes">Editar opciones</button>` : ""}
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
        <div id="manOrigenesCaja" class="man-origenes" hidden></div>
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
        <h3>Actividades</h3>
        <p class="nota">Elige cada actividad y su día. Al crear la reserva quedan con el precio del Tarifario, el horario y el proveedor; después solo revisas.</p>
        <div id="manActs">${htmlFilaManual(hoy)}</div>
        <button type="button" class="btn" data-manual="agregar-act">+ Agregar otra actividad</button>
        <label class="man-transporte">Método de pago
          <select id="manPago">
            <option value="">Definir después (en cada servicio)</option>
            <option value="tc">Tarjeta (TC)</option>
            <option value="cash">Efectivo (Cash)</option>
          </select>
        </label>
        <label class="man-transporte">Si la actividad tiene transporte opcional, ¿lo quiere?
          <select id="manTransporte">
            <option value="">Preguntarle después</option>
            <option value="si">Sí lo quiere</option>
            <option value="no">No lo quiere</option>
          </select>
        </label>
        <div class="fila man-fechas">
          <label>Viaje desde * <input id="manInicio" type="date" value="${hoy}" required></label>
          <label>Hasta * <input id="manFin" type="date" value="${hoy}" required></label>
        </div>
        <p class="nota">Las fechas del viaje se calculan solas con los días de las actividades (puedes cambiarlas si el viaje es más largo).</p>
      </section>

      <section class="det-seccion">
        <h3>Notas internas (opcional)</h3>
        <textarea id="manNotas" rows="2" aria-label="Notas internas" placeholder="Ej.: paga en efectivo en la oficina; prefiere tours en la mañana."></textarea>
        <p class="nota">Cuando esté lista puedes enviarle el enlace o usar <strong>Confirmar en nombre del cliente</strong> para pasarla a Reserva.</p>
      </section>

      <div id="manErrores" class="det-seccion man-errores" hidden></div>

      <div class="barra-guardar man-barra">
        <button type="submit" class="btn primario" id="manCrear">Crear reserva</button>
        <button type="button" class="btn" data-manual="cerrar">Cancelar</button>
      </div>
    </form>`;
}

async function abrirManual() {
  await cargarOrigenes();   // por si el administrador cambió las opciones en otro equipo
  man.fechasManuales = false;
  man.idiomaManual = false;
  $("manualContenido").innerHTML = htmlFormManual();
  $("manual").hidden = false;
  document.body.classList.add("detalle-abierto");
  $("manNombre").focus();
}

function hayDatosManual() {
  return ["manNombre", "manApellido", "manTelefono", "manCorreo", "manNotas"]
    .some((id) => $(id)?.value.trim()) || leerActsManual().length > 0;
}

function cerrarManual(preguntar = true) {
  if ($("manual").hidden) return;
  if (preguntar && hayDatosManual() && !confirm("Hay datos escritos en la reserva manual. ¿Cerrar sin guardar?")) return;
  $("manual").hidden = true;
  $("manualContenido").innerHTML = "";
  if ($("detalle").hidden) document.body.classList.remove("detalle-abierto");
}

// Actividades elegidas en el formulario (las filas sin actividad se ignoran)
function leerActsManual() {
  return [...document.querySelectorAll("#manActs .man-act")]
    .map((f) => ({ servicio_id: Number(f.querySelector("[data-man-serv]").value) || null, fecha: f.querySelector("[data-man-dia]").value }))
    .filter((x) => x.servicio_id);
}

// Fechas del viaje = primer y último día de las actividades (salvo que el agente las haya cambiado a mano)
function recalcularFechasManual() {
  if (man.fechasManuales) return;
  const dias = leerActsManual().map((x) => x.fecha).filter(Boolean).sort();
  if (!dias.length) return;
  $("manInicio").value = dias[0];
  $("manFin").value = dias[dias.length - 1];
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
  const acts = leerActsManual();
  if (acts.some((x) => !x.fecha)) e.push("Cada actividad necesita su día.");
  else if (acts.some((x) => x.fecha < d.fecha_inicio || x.fecha > d.fecha_fin)) e.push("Hay actividades fuera de las fechas del viaje.");
  return e;
}

async function crearManual() {
  recalcularFechasManual();
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
  const acts = leerActsManual();
  const transporte = $("manTransporte").value;
  const pago = $("manPago").value;
  guardarLocal("thot.manOrigen", d.origen);
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
    if (!acts.length) return avisar(`Reserva manual ${data.numero} creada. Agrega las actividades y guarda.`);

    // Las actividades del formulario se crean con la tarifa TC de su temporada, horario y proveedor, y se guardan
    app.actual.pagoManual = pago;   // "Método de pago" del formulario, para todas sus actividades
    const nuevas = acts.map((x) => nuevaActividad(x.servicio_id, x.fecha));
    delete app.actual.pagoManual;
    await cargarTarifas(nuevas);
    nuevas.forEach((a) => {
      aplicarTarifa(a, "tc");
      if (a.transporte_modo === "opcional" && transporte) a.transporte_respuesta = transporte;   // respuesta dada en el formulario
    });
    app.actual.actividades.push(...nuevas);
    app.actual.actividades.sort(ordenActividad);
    pintarDetalle();
    const ok = await guardarTodo(null);
    const pendientes = nuevas.filter((a) => a.tarifa_tipo === "pendiente").length;
    avisar(ok
      ? `Reserva ${data.numero} creada con ${nuevas.length} ${nuevas.length === 1 ? "actividad" : "actividades"}.${pendientes ? ` ${pendientes} sin tarifa para su día: escribe el precio.` : ""} Revisa lo que falta en cada servicio.`
      : `Reserva ${data.numero} creada, pero no se pudieron guardar las actividades. Revísalas y presiona Guardar cambios.`, ok ? "ok" : "error");
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
  if (e.target.id === "manInicio" || e.target.id === "manFin") man.fechasManuales = true;
  if (e.target.id === "manInicio" && $("manFin").value < e.target.value) $("manFin").value = e.target.value;
  if (e.target.id === "manIdioma") man.idiomaManual = true;
  if (e.target.id === "manCodigo" && !man.idiomaManual && IDIOMA_PAIS[e.target.value]) $("manIdioma").value = IDIOMA_PAIS[e.target.value];
  if (e.target.matches("[data-man-serv], [data-man-dia]")) recalcularFechasManual();
});

// Buscador de cada fila de actividad
$("manualContenido").addEventListener("input", (e) => {
  if (!e.target.matches("[data-man-buscar]")) return;
  const sel = e.target.parentElement.querySelector("[data-man-serv]");
  const actual = Number(sel.value) || null;
  sel.innerHTML = `<option value="">${e.target.value.trim() ? "Elige entre las que coinciden" : "Elige una actividad"}</option>${htmlOpcionesTarifario(actual, e.target.value)}`;
  if (actual) sel.value = String(actual);
});
$("manualContenido").addEventListener("keydown", (e) => {
  if (!e.target.matches("[data-man-buscar]") || e.key !== "Enter") return;
  e.preventDefault();   // Enter en el buscador no envía el formulario: elige la única coincidencia
  const sel = e.target.parentElement.querySelector("[data-man-serv]");
  const opciones = [...sel.options].filter((op) => op.value && !op.disabled);
  if (opciones.length === 1) { sel.value = opciones[0].value; recalcularFechasManual(); e.target.parentElement.querySelector("[data-man-dia]").focus(); }
  else sel.focus();
});

$("manualContenido").addEventListener("click", (e) => {
  const b = e.target.closest("[data-manual]");
  if (!b) return;
  if (b.dataset.manual === "origenes") {
    e.preventDefault();
    const caja = $("manOrigenesCaja");
    caja.hidden = !caja.hidden;
    if (!caja.hidden) { caja.innerHTML = htmlEditorOrigenes(); $("orgNuevoNombre").focus(); }
    else caja.innerHTML = "";
    return;
  }
  if (b.dataset.manual.startsWith("org-")) { e.preventDefault(); accionOrigen(b.dataset.manual, b); return; }
  if (b.dataset.manual === "agregar-act") {
    // La siguiente actividad empieza el día después de la última
    const dias = [...document.querySelectorAll("#manActs [data-man-dia]")].map((x) => x.value).filter(Boolean).sort();
    const dia = dias.length ? sumarDia(dias[dias.length - 1], 1) : $("manInicio").value;
    $("manActs").insertAdjacentHTML("beforeend", htmlFilaManual(dia));
    $("manActs").lastElementChild.querySelector("[data-man-buscar]").focus();
  }
  if (b.dataset.manual === "quitar-act") {
    b.closest(".man-act").remove();
    if (!document.querySelector("#manActs .man-act")) $("manActs").insertAdjacentHTML("beforeend", htmlFilaManual($("manInicio").value));
    recalcularFechasManual();
  }
});

// Enter en el editor de Origen: guarda esa fila (o agrega la nueva) en vez de crear la reserva
$("manualContenido").addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || !e.target.closest("#manOrigenesCaja .org-fila")) return;
  e.preventDefault();
  const fila = e.target.closest(".org-fila");
  const b = fila.querySelector("[data-manual='org-agregar'], [data-manual='org-guardar']");
  if (b) accionOrigen(b.dataset.manual, b);
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
    const cats = [...new Set(t.precios.map((x) => x.categoria_id))];
    const soloGrupo = typeof esCategoriaGrupo === "function" && cats.every(esCategoriaGrupo);
    const btn = `<button type="button" class="btn chico" data-accion="aplicar-tarifa">Usar los precios del Tarifario</button>`;
    if (soloGrupo && !a.participantes.some((p) => p.cantidad > 0 && cats.includes(p.categoria_id))) {
      // Servicio guardado antes de este cambio: la tarifa es por vehículo o servicio y aún no tiene esa fila
      avisos.push(`El precio de esta actividad es por ${escapar(categoriaPorId(cats[0])?.nombre?.toLowerCase() ?? "grupo")}, no por persona. ${btn}`);
    } else if (!(typeof tieneFilaGrupo === "function" && tieneFilaGrupo(a))) {
      const sinPrecio = a.participantes.filter((p) => p.cantidad > 0 && !t.precios.some((x) => x.categoria_id === p.categoria_id && x.tc != null));
      if (sinPrecio.length) avisos.push(`La tarifa no tiene precio para: ${sinPrecio.map((p) => escapar(categoriaPorId(p.categoria_id)?.nombre ?? "")).join(", ")}. Escribe el precio a mano (Manual).`);
    }
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
