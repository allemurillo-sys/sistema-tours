// =====================================================
// PÁGINA DEL CLIENTE: REVISAR Y CONFIRMAR LA COTIZACIÓN
// =====================================================

const $ = (id) => document.getElementById(id);
const db = supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey);
const params = new URLSearchParams(location.search);
const numero = params.get("n");
const token = params.get("t");

let datos = null;
let confirmarMarcado = false;

function escapar(texto) {
  return String(texto ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
const dinero = (n) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(n) || 0);
const hora = (h) => (h ? String(h).slice(0, 5) : "");
function fecha(t, opciones) {
  const s = new Date(t.slice(0, 10) + "T12:00:00").toLocaleDateString("es-CR", opciones);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const subtotalPersonas = (a) => a.participantes.reduce((s, p) => s + p.cantidad * p.precio, 0);
const transporteCobrado = (a) =>
  a.transporte_modo === "opcional" && a.transporte_respuesta === true ? Number(a.transporte_costo) || 0 : 0;
const transportePendiente = (a) => a.transporte_modo === "opcional" && a.transporte_respuesta === null;

function mostrarError(texto) {
  $("cargando").hidden = true;
  $("contenido").hidden = true;
  $("error").textContent = texto;
  $("error").hidden = false;
}

async function cargar() {
  if (!numero || !token) {
    return mostrarError("El enlace está incompleto. Revisa que lo hayas copiado completo del mensaje que te enviamos.");
  }
  const { data, error } = await db.rpc("ver_cotizacion", { p_numero: numero, p_token: token });
  if (error || !data) {
    return mostrarError("No encontramos esta cotización. Revisa el enlace o escríbenos y con gusto te ayudamos.");
  }
  datos = data;
  pintar();
}

function htmlTransporte(a, puedeResponder) {
  const lugares = [
    a.recogida && `Pick up: ${escapar(a.recogida)}${a.hora_recogida ? " a las " + hora(a.hora_recogida) : ""}`,
    a.dejada && `Drop off: ${escapar(a.dejada)}`
  ].filter(Boolean).map((t) => `<p class="act-lugar">${t}</p>`).join("");

  if (a.transporte_modo === "sin_transporte") {
    return `<p class="act-lugar">Este servicio no incluye transporte.</p>`;
  }
  if (a.transporte_modo === "incluido") {
    return `<p class="act-lugar"><strong>Transporte incluido.</strong></p>${lugares}`;
  }

  const costo = Number(a.transporte_costo) ? `+${dinero(a.transporte_costo)}` : "sin costo";
  if (!puedeResponder) {
    if (a.transporte_respuesta === true) return `<p class="act-lugar"><strong>Con transporte</strong> (${costo})</p>${lugares}`;
    if (a.transporte_respuesta === false) return `<p class="act-lugar">Sin transporte: llegas por tu cuenta.</p>`;
    return `<p class="act-lugar">Transporte opcional (${costo}).</p>`;
  }

  return `
    <div class="pregunta${transportePendiente(a) ? " falta" : ""}">
      <p class="pregunta-texto">¿Necesitas transporte para esta actividad? (${costo})</p>
      <label class="opcion"><input type="radio" name="trans-${a.id}" value="si" data-actividad="${a.id}" ${a.transporte_respuesta === true ? "checked" : ""}> Sí, necesito transporte</label>
      <label class="opcion"><input type="radio" name="trans-${a.id}" value="no" data-actividad="${a.id}" ${a.transporte_respuesta === false ? "checked" : ""}> No, llego por mi cuenta</label>
      ${lugares ? `<div class="pregunta-lugares">${lugares}</div>` : ""}
    </div>`;
}

function pintar() {
  const d = datos;
  if (d.estado === "cancelado") {
    $("cargando").hidden = true;
    $("contenido").innerHTML = `
      <h1>Cotización ${escapar(d.numero)}</h1>
      <p class="aviso">Esta cotización fue cancelada. Si crees que es un error o quieres retomarla, escríbenos y con gusto te ayudamos.</p>`;
    $("contenido").hidden = false;
    return;
  }
  const reservada = d.estado === "reserva" || d.estado === "finalizado";
  const puedeResponder = d.estado === "proceso";
  const porDia = {};
  d.actividades.forEach((a) => (porDia[a.fecha] ||= []).push(a));

  let total = 0;
  const dias = Object.keys(porDia).sort().map((f) => `
    <section class="dia-bloque">
      <p class="dia-titulo">${escapar(fecha(f, { weekday: "long", day: "numeric", month: "long" }))}</p>
      ${porDia[f].map((a) => {
        const sub = subtotalPersonas(a) + transporteCobrado(a);
        total += sub;
        const horario = a.hora_inicio ? `${hora(a.hora_inicio)}${a.hora_fin ? " a " + hora(a.hora_fin) : ""}` : "Horario por confirmar";
        return `
          <div class="act">
            <div class="act-cab">
              <p class="act-nombre">${escapar(a.servicio ?? "Actividad")}</p>
              <span class="monto">${dinero(sub)}</span>
            </div>
            <p class="act-hora">${horario}</p>
            <p class="act-part">${a.participantes.map((p) => `${p.cantidad} ${escapar(p.categoria)} × ${dinero(p.precio)}`).join(", ")}</p>
            ${htmlTransporte(a, puedeResponder)}
          </div>`;
      }).join("")}
    </section>`).join("");

  const pagado = Number(d.pagado) || 0;
  const prepago = Number(d.prepago_solicitado) || 0;
  const faltan = d.actividades.filter(transportePendiente).length;

  let html = `
    <h1>${reservada ? "Tu reserva" : "Tu cotización"} ${escapar(d.numero)}</h1>
    <p class="intro">Hola ${escapar(d.nombre)}. ${reservada
      ? "Tu reserva está confirmada. Aquí tienes el itinerario completo."
      : "Este es el itinerario que preparamos para ti. Revísalo, indica si necesitas transporte donde se te pregunta y, si todo está bien, confírmalo al final de la página."}</p>
    ${dias || `<p class="ayuda">Todavía no hay actividades en esta cotización.</p>`}
    <div class="caja-total">
      <p class="grande"><span>Total</span><strong>${dinero(total)}</strong></p>
      ${reservada && prepago ? `<p><span>Prepago solicitado</span><span>${dinero(prepago)}</span></p>` : ""}
      ${reservada ? `<p><span>Pagado</span><span>${dinero(pagado)}</span></p><p><span>Saldo pendiente</span><strong>${dinero(total - pagado)}</strong></p>` : ""}
      <p class="ayuda" style="margin-top:6px">Precios en dólares estadounidenses (USD).${faltan ? " El total se ajustará según tus respuestas de transporte." : ""}</p>
    </div>`;

  if (puedeResponder) {
    html += `
      <div class="caja">
        <h2>¿Todo está bien?</h2>
        ${faltan ? `<p class="aviso">Antes de confirmar, indica si necesitas transporte en ${faltan === 1 ? "la actividad marcada" : `las ${faltan} actividades marcadas`}.</p>` : ""}
        <label class="check"><input id="chkConfirmar" type="checkbox" ${confirmarMarcado ? "checked" : ""} ${faltan ? "disabled" : ""}> CONFIRMAR: estoy de acuerdo con esta cotización</label>
        <button id="btnConfirmar" type="button" class="btn primario" ${confirmarMarcado && !faltan ? "" : "disabled"}>Confirmar mi reserva</button>
        <p id="msgConfirmar" class="aviso" hidden style="margin-top:12px"></p>
      </div>`;
  }

  if (d.estado === "proceso" || d.estado === "reserva") {
    html += `
      <div class="caja">
        <h2>¿Quieres cambiar algo?</h2>
        <p class="ayuda">Cuéntanos qué te gustaría modificar y un colaborador te contactará.</p>
        <textarea id="txtComentario" maxlength="2000" aria-label="Cambios que deseas"></textarea>
        <button id="btnComentario" type="button" class="btn">Enviar comentario</button>
        <p id="msgComentario" hidden style="margin-top:12px"></p>
      </div>`;
  }

  html += `<div class="acciones"><button type="button" class="btn" onclick="window.print()">Imprimir</button></div>`;

  const scroll = window.scrollY;
  $("cargando").hidden = true;
  $("contenido").innerHTML = html;
  $("contenido").hidden = false;
  window.scrollTo(0, scroll);

  $("chkConfirmar")?.addEventListener("change", (e) => {
    confirmarMarcado = e.target.checked;
    $("btnConfirmar").disabled = !confirmarMarcado;
  });
  $("btnConfirmar")?.addEventListener("click", confirmar);
  $("btnComentario")?.addEventListener("click", comentar);
}

// Respuesta de transporte: se guarda apenas el cliente elige
$("contenido").addEventListener("change", async (e) => {
  const radio = e.target.closest('input[type="radio"][data-actividad]');
  if (!radio) return;
  const id = Number(radio.dataset.actividad);
  const requiere = radio.value === "si";

  document.querySelectorAll(`input[name="trans-${id}"]`).forEach((r) => (r.disabled = true));
  const { data, error } = await db.rpc("responder_transporte", {
    p_numero: numero, p_token: token, p_actividad: id, p_requiere: requiere
  });

  if (error || !data) {
    alert("No pudimos guardar tu respuesta. Intenta de nuevo o escríbenos.");
    await cargar();
    return;
  }
  const act = datos.actividades.find((a) => a.id === id);
  if (act) act.transporte_respuesta = requiere;
  pintar();
});

async function confirmar() {
  const btn = $("btnConfirmar");
  btn.disabled = true;
  btn.textContent = "Confirmando…";
  const { data, error } = await db.rpc("confirmar_cotizacion", { p_numero: numero, p_token: token });
  if (error || !data) {
    btn.textContent = "Confirmar mi reserva";
    btn.disabled = false;
    $("msgConfirmar").textContent = error?.message?.includes("transporte")
      ? "Indica si necesitas transporte en cada actividad antes de confirmar."
      : "No pudimos confirmar desde aquí. Escríbenos y lo resolvemos de inmediato.";
    $("msgConfirmar").hidden = false;
    return;
  }
  await cargar();
  $("contenido").insertAdjacentHTML("afterbegin",
    `<div class="exito"><strong>¡Reserva confirmada!</strong>Gracias. Un colaborador te contactará para coordinar el prepago y los detalles.</div>`);
  window.scrollTo(0, 0);
}

async function comentar() {
  const texto = $("txtComentario").value.trim();
  const msg = $("msgComentario");
  if (!texto) {
    msg.className = "aviso";
    msg.textContent = "Escribe qué te gustaría cambiar.";
    msg.hidden = false;
    return;
  }
  const btn = $("btnComentario");
  btn.disabled = true;
  const { data, error } = await db.rpc("comentar_cotizacion", { p_numero: numero, p_token: token, p_texto: texto });
  btn.disabled = false;
  if (error || !data) {
    msg.className = "aviso";
    msg.textContent = "No pudimos enviar tu comentario. Intenta de nuevo o escríbenos.";
  } else {
    msg.className = "exito";
    msg.textContent = "Recibimos tu comentario. Un colaborador te contactará pronto.";
    $("txtComentario").value = "";
  }
  msg.hidden = false;
}

cargar();
