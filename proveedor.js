// =====================================================
// PÁGINA DEL PROVEEDOR: ver y responder una solicitud de servicio (P00001…)
// Se abre con el enlace que recibe por correo o WhatsApp (?p=P00001&t=token). Siempre en español.
// =====================================================

const $ = (id) => document.getElementById(id);
const db = supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey);
const params = new URLSearchParams(location.search);
const codigo = params.get("p");
const token = params.get("t");

let datos = null;
let eleccion = null;          // "confirmar" | "revisar" | "sin_disponibilidad" | "correcto" | "incorrecto"
let mensaje = null;           // { texto, tipo }
let mensajeChat = null;

function escapar(texto) {
  return String(texto ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
const usd = (n) => "$" + (Number(n) || 0).toFixed(2);
const hora = (h) => (h ? String(h).slice(0, 5) : "");
function fechaLarga(f) {
  if (!f) return "";
  const t = new Date(String(f).slice(0, 10) + "T12:00:00").toLocaleDateString("es-CR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return t.charAt(0).toUpperCase() + t.slice(1);
}
const fechaHora = (ts) => new Date(ts).toLocaleString("es-CR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const RESPUESTA = { confirmar: "Confirmado", revisar: "Revisar", sin_disponibilidad: "Sin disponibilidad" };

async function cargar() {
  if (!codigo || !token) return fallar("El enlace está incompleto. Revise que lo copió completo.");
  const { data, error } = await db.rpc("ver_solicitud", { p_codigo: codigo, p_token: token });
  if (error || !data) return fallar("No encontramos esta solicitud. Revise el enlace o comuníquese con The House of Tours.");
  datos = data;
  pintar();
}
function fallar(texto) {
  $("cargando").hidden = true;
  $("error").textContent = texto;
  $("error").hidden = false;
}

function htmlContenido(c) {
  const fila = (k, v) => (v ? `<div><dt>${k}</dt><dd>${escapar(v)}</dd></div>` : "");
  return `
    <dl class="datos">
      ${fila("Servicio", c.servicio)}
      ${fila("Titular", c.titular)}
      ${fila("Fecha", fechaLarga(c.fecha))}
      ${fila("Hora", c.hora_inicio ? hora(c.hora_inicio) + (c.hora_fin ? " a " + hora(c.hora_fin) : "") : "Por confirmar")}
      ${c.transporte ? fila("Pick up", c.recogida ? `${c.recogida}${c.hora_recogida ? " · " + hora(c.hora_recogida) : ""}` : "") : ""}
      ${c.transporte ? fila("Drop off", c.dejada) : ""}
    </dl>
    <table class="part">
      <thead><tr><th>Participantes</th><th class="num">Neto por persona</th><th class="num">Subtotal</th></tr></thead>
      <tbody>
        ${(c.participantes || []).map((p) => `<tr><td>${escapar(p.cantidad)} ${escapar(p.categoria)}</td><td class="num">${usd(p.neto)}</td><td class="num">${usd(p.subtotal)}</td></tr>`).join("")}
        ${Number(c.transporte_neto) ? `<tr><td>Transporte</td><td></td><td class="num">${usd(c.transporte_neto)}</td></tr>` : ""}
      </tbody>
      <tfoot><tr><th colspan="2">Total neto</th><th class="num">${usd(c.total)}</th></tr></tfoot>
    </table>
    ${c.notas ? `<p style="margin-top:14px"><strong>Notas:</strong> ${escapar(c.notas)}</p>` : ""}`;
}

// Formulario de respuesta (tres opciones) o de verificación de lo registrado por chat
function htmlResponder(verificacion) {
  const opciones = verificacion
    ? [["correcto", "confirmar", "Correcto, confirmo", "Lo registrado es correcto"],
       ["incorrecto", "sin", "Esto no es correcto", "Hay que revisar o no hay disponibilidad"]]
    : [["confirmar", "confirmar", "Confirmar", "Todo está bien y se aprueba"],
       ["revisar", "revisar", "Revisar", "Algo en la solicitud no está bien"],
       ["sin_disponibilidad", "sin", "Sin disponibilidad", "La reserva no se puede hacer"]];
  const e = eleccion;
  const pideNumero = e === "confirmar" || e === "correcto";
  const notaObligatoria = e === "revisar" || e === "incorrecto";
  return `
    <div class="caja">
      <h2>${verificacion ? "¿Es correcto lo registrado?" : "Su respuesta"}</h2>
      <div class="opciones">
        ${opciones.map(([v, clase, t, d]) => `<button type="button" class="opcion ${clase}${e === v ? " activa" : ""}" data-eleccion="${v}"><strong>${t}</strong><span>${d}</span></button>`).join("")}
      </div>
      ${e ? `
        <div class="campos">
          ${e === "incorrecto" ? `
            <label>¿Qué corresponde?
              <select id="rCorreccion"><option value="revisar">Revisar (algo no está bien)</option><option value="sin_disponibilidad">Sin disponibilidad</option></select></label>` : ""}
          <label>Su nombre (obligatorio) <input id="rNombre" type="text" maxlength="120" autocomplete="name"></label>
          ${pideNumero ? `<label>Número de confirmación (opcional) <input id="rNumero" type="text" maxlength="80"></label>` : ""}
          <label>Nota ${notaObligatoria ? "(obligatoria: indique qué hay que revisar)" : "(opcional)"}
            <textarea id="rNota" rows="3" maxlength="2000" placeholder="Ej.: Hay espacio, pero la tarifa correcta es $80"></textarea></label>
          <button type="button" id="btnResponder" class="btn primario">Enviar respuesta</button>
          ${mensaje ? `<p class="${mensaje.tipo}">${escapar(mensaje.texto)}</p>` : ""}
        </div>` : `<p class="ayuda">Elija una opción.</p>`}
    </div>`;
}

function pintar() {
  const d = datos;
  const c = d.contenido || {};
  const e = d.empresa || {};
  $("cargando").hidden = true;

  const cancelada = d.estado === "cancelada";
  const respondida = d.respuesta && d.respuesta_origen === "enlace";
  const porChat = !cancelada && d.respuesta && d.respuesta_origen === "agente" && !d.verificada_en;

  let banner = "";
  if (cancelada) {
    banner = `<div class="banner alerta"><strong>CANCELACIÓN</strong>Esta solicitud fue cancelada. ${d.cancelacion_recibida_en
      ? `Recibida por ${escapar(d.cancelacion_recibida_por)} el ${fechaHora(d.cancelacion_recibida_en)}.`
      : "Por favor confirme que la recibió con el botón \"Recibido\"."}</div>`;
  } else if (d.estado === "borrador") {
    banner = `<div class="banner info"><strong>Hay cambios en esta solicitud</strong>En breve recibirá la nueva versión (versión ${d.version}) para confirmarla de nuevo.</div>`;
  } else if (porChat) {
    banner = `
      <div class="banner info"><strong>Esta solicitud ya fue respondida por chat</strong>
        Respuesta: ${escapar(RESPUESTA[d.respuesta])} · ${escapar(d.respuesta_nombre)} · ${escapar(d.respuesta_medio || "")} · ${d.respuesta_en ? fechaHora(d.respuesta_en) : ""}<br>
        Registrado por: ${escapar(d.registrada_por || "agente")} (The House of Tours)</div>`;
  } else if (respondida) {
    banner = `
      <div class="banner ${d.respuesta === "confirmar" ? "ok" : "alerta"}"><strong>Respuesta recibida, gracias</strong>
        ${escapar(RESPUESTA[d.respuesta])} · ${escapar(d.respuesta_nombre)} · ${d.respuesta_en ? fechaHora(d.respuesta_en) : ""}
        ${d.respuesta_numero ? `<br>N.º de confirmación: ${escapar(d.respuesta_numero)}` : ""}
        ${d.respuesta_nota ? `<br>Nota: ${escapar(d.respuesta_nota)}` : ""}</div>`;
  } else if (d.version > 1 && d.estado === "enviada") {
    banner = `<div class="banner alerta"><strong>MODIFICACIÓN · versión ${d.version}</strong>Hubo cambios: revise los datos y confirme de nuevo.</div>`;
  }
  if (!cancelada && d.servicio_confirmado && d.codigo_cliente) {
    banner += `<div class="banner ok"><strong>CONFIRMADA · código del cliente ${escapar(d.codigo_cliente)}</strong>El cliente presentará este código en su voucher.</div>`;
  }

  const puedeResponder = !cancelada && (d.estado === "enviada" || porChat);
  const marca = e.logo
    ? `<img class="sol-logo" src="${escapar(e.logo)}" alt="${escapar(e.nombre_legal || "The House of Tours")}">`
    : `<span class="sol-marca">The House of Tours</span>`;
  const pie = [e.nombre_legal, e.cedula && `Céd. ${e.cedula}`, e.direccion, e.movil, e.correo].filter(Boolean).map(escapar).join(" · ");

  const borradorChat = $("chTexto")?.value ?? "";
  const nombreChat = $("chNombre")?.value ?? "";
  // Lo que el proveedor ya escribió en la respuesta se conserva al redibujar (por ejemplo, tras un aviso)
  const previos = {};
  ["rNombre", "rNumero", "rNota", "rCorreccion", "rcNombre"].forEach((id) => { if ($(id)) previos[id] = $(id).value; });

  $("contenido").innerHTML = `
    <div class="caja">
      <div class="sol-cab">
        ${marca}
        <div class="sol-num">
          <p>SOLICITUD DE SERVICIO</p>
          <strong>${escapar(d.codigo)}</strong>
          <p>Ref. ${escapar(c.codigo_reserva || c.cotizacion || "")}${d.version > 1 ? ` · versión ${d.version}` : ""}</p>
        </div>
      </div>
      ${banner}
      ${htmlContenido(c)}
      ${d.agente?.nombre ? `<p class="ayuda" style="margin-top:14px">Agente: ${escapar(d.agente.nombre)}${d.agente.correo ? " · " + escapar(d.agente.correo) : ""}</p>` : ""}
    </div>
    ${puedeResponder ? htmlResponder(porChat) : ""}
    ${cancelada && !d.cancelacion_recibida_en ? `
      <div class="caja">
        <h2>Confirmar que recibió la cancelación</h2>
        <div class="campos">
          <label>Su nombre (obligatorio) <input id="rcNombre" type="text" maxlength="120" autocomplete="name"></label>
          <button type="button" id="btnRecibido" class="btn primario">Recibido</button>
          ${mensaje ? `<p class="${mensaje.tipo}">${escapar(mensaje.texto)}</p>` : ""}
        </div>
      </div>` : ""}
    <div class="caja">
      <h2>Mensajes</h2>
      ${(d.mensajes || []).length ? `<ul class="mensajes">${d.mensajes.map((m) => `
        <li class="${m.tipo === "mensaje_agente" ? "agente" : ""}"><small>${m.tipo === "mensaje_agente" ? "The House of Tours" : "Proveedor"} · ${escapar(m.nombre || "")} · ${fechaHora(m.creado_en)}</small>${escapar(m.texto)}</li>`).join("")}</ul>`
        : `<p class="ayuda">Si necesita aclarar algo, escríbanos aquí.</p>`}
      <div class="campos">
        <label>Su nombre <input id="chNombre" type="text" maxlength="120" value="${escapar(nombreChat)}"></label>
        <label>Mensaje <textarea id="chTexto" rows="3" maxlength="2000">${escapar(borradorChat)}</textarea></label>
        <button type="button" id="btnMensaje" class="btn">Enviar mensaje</button>
        ${mensajeChat ? `<p class="${mensajeChat.tipo}">${escapar(mensajeChat.texto)}</p>` : ""}
      </div>
    </div>
    ${pie ? `<p class="pie">${pie}</p>` : ""}`;
  Object.entries(previos).forEach(([id, valor]) => { if ($(id)) $(id).value = valor; });
  $("contenido").hidden = false;
}

async function llamar(cuerpo) {
  const { data, error } = await db.functions.invoke("correo", { body: { codigo, token, ...cuerpo } });
  if (error || data?.error) {
    let m = data?.error;
    try { m ||= (await error.context.json())?.error; } catch { /* sin detalle */ }
    throw new Error(m || "No pudimos enviar. Intente de nuevo.");
  }
  return data;
}

$("contenido").addEventListener("click", async (ev) => {
  const op = ev.target.closest("[data-eleccion]");
  if (op) { eleccion = op.dataset.eleccion; mensaje = null; return pintar(); }

  if (ev.target.id === "btnResponder") {
    const nombre = $("rNombre").value.trim();
    const nota = $("rNota").value.trim();
    const numero = $("rNumero")?.value.trim() || "";
    let respuesta = eleccion;
    if (eleccion === "correcto") respuesta = "confirmar";
    if (eleccion === "incorrecto") respuesta = $("rCorreccion").value;
    if (!nombre) { mensaje = { texto: "Escriba su nombre.", tipo: "error-texto" }; return pintar(); }
    if ((respuesta === "revisar" || eleccion === "incorrecto") && !nota) {
      mensaje = { texto: "Escriba en la nota qué hay que revisar.", tipo: "error-texto" };
      return pintar();
    }
    ev.target.disabled = true;
    ev.target.textContent = "Enviando…";
    try {
      await llamar({ accion: "proveedor_responder", respuesta, nombre, numero, nota });
      eleccion = null;
      mensaje = null;
      await cargar();
      window.scrollTo(0, 0);
    } catch (e) {
      mensaje = { texto: e.message, tipo: "error-texto" };
      pintar();
    }
  }

  if (ev.target.id === "btnRecibido") {
    const nombre = $("rcNombre").value.trim();
    if (!nombre) { mensaje = { texto: "Escriba su nombre.", tipo: "error-texto" }; return pintar(); }
    ev.target.disabled = true;
    try {
      await llamar({ accion: "proveedor_recibido", nombre });
      mensaje = null;
      await cargar();
      window.scrollTo(0, 0);
    } catch (e) {
      mensaje = { texto: e.message, tipo: "error-texto" };
      pintar();
    }
  }

  if (ev.target.id === "btnMensaje") {
    const nombre = $("chNombre").value.trim();
    const texto = $("chTexto").value.trim();
    if (!nombre || !texto) { mensajeChat = { texto: "Escriba su nombre y el mensaje.", tipo: "error-texto" }; return pintar(); }
    ev.target.disabled = true;
    try {
      await llamar({ accion: "proveedor_mensaje", nombre, texto });
      $("chTexto").value = "";
      mensajeChat = { texto: "Mensaje enviado. Le responderemos pronto.", tipo: "ayuda" };
      await cargar();
    } catch (e) {
      mensajeChat = { texto: e.message, tipo: "error-texto" };
      pintar();
    }
  }
});

cargar();
