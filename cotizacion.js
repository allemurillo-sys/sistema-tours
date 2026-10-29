// =====================================================
// PÁGINA DEL CLIENTE: REVISAR Y CONFIRMAR LA COTIZACIÓN
// (usa los textos de i18n.js)
// =====================================================

const $ = (id) => document.getElementById(id);
const db = supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey);
const params = new URLSearchParams(location.search);
const numero = params.get("n");
const token = params.get("t");

let datos = null;
let errorClave = "";
let confirmarMarcado = false;
let mensajeExito = false;
let mensajeComentario = null;   // { clave, tipo }
const mensajePregunta = {};      // id de la pregunta → { clave, tipo }

function escapar(texto) {
  return String(texto ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
const dinero = (n) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(n) || 0);
const hora = (h) => (h ? String(h).slice(0, 5) : "");
function fecha(s, opciones) {
  const txt = new Date(s.slice(0, 10) + "T12:00:00").toLocaleDateString(locale(), opciones);
  return txt.charAt(0).toUpperCase() + txt.slice(1);
}

const subtotalPersonas = (a) => a.participantes.reduce((s, p) => s + p.cantidad * p.precio, 0);
const transporteCobrado = (a) =>
  a.transporte_modo === "opcional" && a.transporte_respuesta === true ? Number(a.transporte_costo) || 0 : 0;
const transportePendiente = (a) => a.transporte_modo === "opcional" && a.transporte_respuesta === null;
// Saldo de cada servicio: total del servicio menos lo que se le aplicó de los pagos (etapa 10)
const saldoServicio = (a) => Math.round((subtotalPersonas(a) + transporteCobrado(a) - (Number(a.pagado) || 0)) * 100) / 100;

// Estado y pago de cada servicio en una reserva
function htmlEstadoServicio(a) {
  if (a.estado_servicio === "cancelado") return "";
  const estado = a.estado_servicio === "confirmado" && a.codigo_reserva
    ? `<span class="sv-chip ok">${escapar(t("sv_confirmado", { codigo: a.codigo_reserva }))}</span>`
    : a.estado_servicio === "sin_disponibilidad"
      ? `<span class="sv-chip alerta">${escapar(t("sv_alternativa"))}</span>`
      : `<span class="sv-chip">${escapar(t("sv_confirmacion"))}</span>`;
  const saldo = saldoServicio(a);
  const forma = a.forma_pago === "oficina"
    ? (a.pago_limite ? t("sv_oficina_fecha", { fecha: fecha(a.pago_limite, { day: "numeric", month: "long" }) }) : t("sv_oficina"))
    : t("sv_prepago");
  const pago = saldo <= 0.005
    ? `<span class="sv-chip ok">✓ ${escapar(t("sv_pagado"))}</span>`
    : `<span class="sv-chip aviso">${escapar(t("sv_saldo", { monto: dinero(saldo) }))}</span> <span class="sv-forma">${escapar(forma)}</span>`;
  return `<p class="sv-estado">${estado} ${pago}</p>`;
}

function mostrarError(clave) {
  errorClave = clave;
  $("cargando").hidden = true;
  $("contenido").hidden = true;
  $("error").textContent = t(clave);
  $("error").hidden = false;
}

async function cargar() {
  if (!numero || !token) return mostrarError("c_e_enlace");
  const { data, error } = await db.rpc("ver_cotizacion", { p_numero: numero, p_token: token });
  if (error || !data) return mostrarError("c_e_no_encontrada");
  datos = data;

  // La página se abre en el idioma guardado en la cotización (el que eligió el cliente
  // o el que ajustó el agente). Un enlace con ?lang=xx tiene prioridad.
  const delEnlace = idiomaValido(params.get("lang"));
  const inicial = delEnlace || data.idioma;
  if (inicial && inicial !== idioma) cambiarIdioma(inicial, false);
  pintar();
}

// Si el cliente cambia el idioma aquí, queda guardado en su cotización:
// todo lo que reciba después llegará en ese idioma.
$("selectorIdioma")?.addEventListener("change", async () => {
  if (!datos || datos.idioma === idioma) return;
  const nuevo = idioma;
  const { error } = await db.rpc("cambiar_idioma_cotizacion", { p_numero: numero, p_token: token, p_idioma: nuevo });
  if (error) return console.error(error);
  datos.idioma = nuevo;
});

function htmlTransporte(a, puedeResponder) {
  const lugares = [
    a.recogida && (a.hora_recogida
      ? t("t_pickup_hora", { lugar: a.recogida, hora: hora(a.hora_recogida) })
      : t("t_pickup", { lugar: a.recogida })),
    a.dejada && t("t_dropoff", { lugar: a.dejada })
  ].filter(Boolean).map((x) => `<p class="act-lugar">${escapar(x)}</p>`).join("");

  if (a.transporte_modo === "sin_transporte") return `<p class="act-lugar">${escapar(t("t_sin_servicio"))}</p>`;
  if (a.transporte_modo === "incluido") return `<p class="act-lugar"><strong>${escapar(t("t_incluido"))}</strong></p>${lugares}`;

  const costo = Number(a.transporte_costo) ? `+${dinero(a.transporte_costo)}` : t("t_sin_costo");
  if (!puedeResponder) {
    if (a.transporte_respuesta === true) return `<p class="act-lugar"><strong>${escapar(t("t_con"))}</strong> (${escapar(costo)})</p>${lugares}`;
    if (a.transporte_respuesta === false) return `<p class="act-lugar">${escapar(t("t_sin_cuenta"))}</p>`;
    return `<p class="act-lugar">${escapar(t("t_opcional", { costo }))}</p>`;
  }

  return `
    <div class="pregunta${transportePendiente(a) ? " falta" : ""}">
      <p class="pregunta-texto">${escapar(t("t_pregunta", { costo }))}</p>
      <label class="opcion"><input type="radio" name="trans-${a.id}" value="si" data-actividad="${a.id}" ${a.transporte_respuesta === true ? "checked" : ""}> ${escapar(t("t_si"))}</label>
      <label class="opcion"><input type="radio" name="trans-${a.id}" value="no" data-actividad="${a.id}" ${a.transporte_respuesta === false ? "checked" : ""}> ${escapar(t("t_no"))}</label>
      ${lugares ? `<div class="pregunta-lugares">${lugares}</div>` : ""}
    </div>`;
}

function pintar() {
  const d = datos;
  $("cargando").hidden = true;

  if (d.estado === "cancelado") {
    $("contenido").innerHTML = `
      <h1>${escapar(t("c_cancelada_titulo", { numero: d.numero }))}</h1>
      <p class="aviso">${escapar(t("c_cancelada"))}</p>`;
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
        const horario = a.hora_inicio
          ? `${hora(a.hora_inicio)}${a.hora_fin ? " – " + hora(a.hora_fin) : ""}`
          : t("c_horario_pendiente");
        return `
          <div class="act">
            <div class="act-cab">
              <p class="act-nombre">${escapar(tServicio({ nombre: a.servicio, traducciones: a.servicio_tr }))}</p>
              <span class="monto">${dinero(sub)}</span>
            </div>
            <p class="act-hora">${escapar(horario)}</p>
            <p class="act-part">${a.participantes.map((p) => `${p.cantidad} ${escapar(tCategoria(p.categoria))} × ${dinero(p.precio)}`).join(", ")}</p>
            ${htmlTransporte(a, puedeResponder)}
            ${reservada ? htmlEstadoServicio(a) : ""}
          </div>`;
      }).join("")}
    </section>`).join("");

  const pagado = Number(d.pagado) || 0;
  const prepago = Number(d.prepago_solicitado) || 0;
  const faltan = d.actividades.filter(transportePendiente).length;

  let html = `
    ${mensajeExito ? `<div class="exito"><strong>${escapar(t("c_exito_titulo"))}</strong>${escapar(t("c_exito"))}</div>` : ""}
    <h1>${escapar(t(reservada ? "c_tu_reserva" : "c_tu_cotizacion", { numero: d.numero }))}</h1>
    <p class="intro">${escapar(t(reservada ? "c_intro_reserva" : "c_intro_cot", { nombre: d.nombre }))}</p>
    ${dias || `<p class="ayuda">${escapar(t("c_sin_actividades"))}</p>`}
    <div class="caja-total">
      <p class="grande"><span>${escapar(t("c_total"))}</span><strong>${dinero(total)}</strong></p>
      ${reservada && prepago ? `<p><span>${escapar(t("c_prepago"))}</span><span>${dinero(prepago)}</span></p>` : ""}
      ${reservada ? `
        <p><span>${escapar(t("c_pagado"))}</span><span>${dinero(pagado)}</span></p>
        <p><span>${escapar(t("c_saldo"))}</span><strong>${dinero(total - pagado)}</strong></p>` : ""}
      <p class="ayuda" style="margin-top:6px">${escapar(t("c_usd"))}${faltan ? " " + escapar(t("c_ajuste")) : ""}</p>
    </div>`;

  if (puedeResponder) {
    html += `
      <div class="caja">
        <h2>${escapar(t("c_todo_bien"))}</h2>
        ${faltan ? `<p class="aviso">${escapar(faltan === 1 ? t("c_faltan_1") : t("c_faltan_n", { n: faltan }))}</p>` : ""}
        <label class="check"><input id="chkConfirmar" type="checkbox" ${confirmarMarcado ? "checked" : ""} ${faltan ? "disabled" : ""}> ${escapar(t("c_check"))}</label>
        <button id="btnConfirmar" type="button" class="btn primario" ${confirmarMarcado && !faltan ? "" : "disabled"}>${escapar(t("c_btn_confirmar"))}</button>
        <p id="msgConfirmar" class="aviso" hidden style="margin-top:12px"></p>
      </div>`;
  }

  html += htmlPreguntas(d);

  if (d.estado === "proceso" || d.estado === "reserva") {
    const textoPrevio = $("txtComentario")?.value ?? "";
    html += `
      <div class="caja">
        <h2>${escapar(t("c_cambiar"))}</h2>
        <p class="ayuda">${escapar(t("c_cambiar_ayuda"))}</p>
        <textarea id="txtComentario" maxlength="2000" aria-label="${escapar(t("c_aria_cambios"))}">${escapar(textoPrevio)}</textarea>
        <button id="btnComentario" type="button" class="btn">${escapar(t("c_btn_comentario"))}</button>
        ${mensajeComentario ? `<p class="${mensajeComentario.tipo}" style="margin-top:12px">${escapar(t(mensajeComentario.clave))}</p>` : ""}
      </div>`;
  }

  html += htmlVouchers(d, total - pagado);
  html += `<div class="acciones"><button type="button" class="btn" data-imprimir="pagina">${escapar(t("c_imprimir"))}</button></div>`;

  const scroll = window.scrollY;
  $("contenido").innerHTML = html;
  $("contenido").hidden = false;
  window.scrollTo(0, scroll);

  $("chkConfirmar")?.addEventListener("change", (e) => {
    confirmarMarcado = e.target.checked;
    $("btnConfirmar").disabled = !confirmarMarcado;
  });
  $("btnConfirmar")?.addEventListener("click", confirmar);
  $("btnComentario")?.addEventListener("click", comentar);
  const destino = location.hash.slice(1);
  if ((destino === "vouchers" || destino === "preguntas") && !irAVouchers && $(destino)) {
    irAVouchers = true;
    $(destino).scrollIntoView();
  }
}

// =====================================================
// PREGUNTAS DEL AGENTE (llegan por correo; el cliente responde aquí)
// =====================================================
function htmlPreguntas(d) {
  const lista = d.preguntas || [];
  if (!lista.length || d.estado === "cancelado") return "";
  const previo = (id) => document.querySelector(`[data-respuesta="${id}"]`)?.value ?? "";
  return `
    <section id="preguntas" class="caja preguntas">
      <h2>${escapar(t("p_titulo"))}</h2>
      <p class="ayuda">${escapar(t("p_intro"))}</p>
      ${lista.map((p) => {
        const sobre = p.servicio ? t("p_sobre", { servicio: tServicio({ nombre: p.servicio, traducciones: p.servicio_tr }), fecha: fecha(p.fecha, { day: "numeric", month: "long" }) }) : "";
        const msg = mensajePregunta[p.id];
        return `
          <div class="pregunta-agente${p.respuesta ? " respondida" : " falta"}">
            ${sobre ? `<p class="ayuda">${escapar(sobre)}</p>` : ""}
            <p class="pregunta-texto">${escapar(p.pregunta)}</p>
            ${p.respuesta
              ? `<p class="respuesta-cliente"><strong>${escapar(t("p_tu_respuesta"))}:</strong> ${escapar(p.respuesta)}</p>`
              : `<textarea data-respuesta="${p.id}" maxlength="2000" aria-label="${escapar(t("p_aria"))}">${escapar(previo(p.id))}</textarea>
                 <button type="button" class="btn primario" data-responder="${p.id}">${escapar(t("p_enviar"))}</button>`}
            ${msg ? `<p class="${msg.tipo}" style="margin-top:10px">${escapar(t(msg.clave))}</p>` : ""}
          </div>`;
      }).join("")}
    </section>`;
}

async function responderPregunta(btn) {
  const id = Number(btn.dataset.responder);
  const texto = document.querySelector(`[data-respuesta="${id}"]`).value.trim();
  if (!texto) { mensajePregunta[id] = { clave: "p_vacia", tipo: "aviso" }; return pintar(); }
  btn.disabled = true;
  btn.textContent = t("p_enviando");
  const { data, error } = await db.functions.invoke("correo", {
    body: { accion: "responder", numero, token, mensaje_id: id, texto }
  });
  if (error || !data?.ok) {
    mensajePregunta[id] = { clave: "p_error", tipo: "aviso" };
    return pintar();
  }
  mensajePregunta[id] = { clave: "p_ok", tipo: "exito" };
  const p = datos.preguntas.find((x) => x.id === id);
  if (p) { p.respuesta = texto; p.respondida_en = new Date().toISOString(); }
  pintar();
}

// =====================================================
// MIS VOUCHERS: un tiquete por servicio confirmado y habilitado por el agente
// =====================================================
let irAVouchers = false;

// Etiqueta en el idioma del cliente, con el español al lado
function etiqueta(clave) {
  const propia = t(clave);
  const es = TEXTOS.es[clave] ?? clave;
  return idioma === "es" || propia === es
    ? escapar(propia)
    : `${escapar(propia)} <span class="vch-es">/ ${escapar(es)}</span>`;
}

const nombreCategoria = (p) => (idioma !== "es" && p.categoria_tr?.[idioma]) || tCategoria(p.categoria);

function marcaEmpresa(e) {
  if (e?.logo) return `<img class="vch-logo" src="${escapar(e.logo)}" alt="${escapar(e.nombre_legal || "The House of Tours")}">`;
  return `
    <span class="vch-marca">
      <svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="18" fill="none" stroke="currentColor" stroke-width="2"/><path d="M20 5 L25 20 L15 20 Z" fill="#5FAF84"/><path d="M20 35 L25 20 L15 20 Z" fill="currentColor"/></svg>
      The House of Tours
    </span>`;
}

function pieEmpresa(e) {
  if (!e) return "";
  const partes = [
    e.nombre_legal,
    e.cedula && `Céd. ${e.cedula}`,
    e.direccion,
    e.movil,
    e.correo
  ].filter(Boolean).map(escapar);
  return partes.length ? `<p class="vch-pie">${partes.join(" · ")}</p>` : "";
}

function htmlVoucher(d, a, saldo) {
  const fila = (clave, valor, ancha = false) => (valor ? `<div class="vch-fila${ancha ? " ancha" : ""}"><dt>${etiqueta(clave)}</dt><dd>${valor}</dd></div>` : "");
  const horario = a.hora_inicio ? `${hora(a.hora_inicio)}${a.hora_fin ? " – " + hora(a.hora_fin) : ""}` : t("c_horario_pendiente");
  const conTransporte = a.transporte_modo === "incluido" || (a.transporte_modo === "opcional" && a.transporte_respuesta === true);
  const participantes = a.participantes.map((p) => `${p.cantidad} ${escapar(nombreCategoria(p))}`).join(", ");
  return `
    <article class="vch">
      <header class="vch-cab">
        ${marcaEmpresa(d.empresa)}
        <div class="vch-titulo">
          <p>${etiqueta("v_tiquete")}</p>
          <p class="vch-codigo"><span>${etiqueta("v_codigo")}</span><strong>${escapar(a.codigo_reserva)}</strong></p>
        </div>
      </header>
      <h3 class="vch-servicio">${escapar(tServicio({ nombre: a.servicio, traducciones: a.servicio_tr }))}</h3>
      <dl class="vch-datos">
        ${fila("v_titular", escapar(`${d.nombre ?? ""} ${d.apellido ?? ""}`.trim()))}
        ${fila("v_fecha", escapar(fecha(a.fecha, { weekday: "long", day: "numeric", month: "long", year: "numeric" })))}
        ${fila("v_hora", escapar(horario))}
        ${conTransporte ? fila("v_recogida", escapar(hora(a.hora_recogida))) : ""}
        ${conTransporte && a.recogida ? `<div class="vch-fila"><dt>Pick up</dt><dd>${escapar(a.recogida)}</dd></div>` : ""}
        ${conTransporte && a.dejada ? `<div class="vch-fila"><dt>Drop off</dt><dd>${escapar(a.dejada)}</dd></div>` : ""}
        ${fila("v_participantes", participantes)}
        ${fila("v_operador", escapar(a.operador))}
        ${fila("v_ref_proveedor", escapar(a.ref_proveedor))}
        ${fila("v_notas", escapar(a.notas), true)}
      </dl>
      <p class="vch-pago">${saldo > 0.005
        ? `<span class="vch-saldo">${etiqueta("v_saldo")}</span>`
        : `<span class="vch-pagado">✓ ${etiqueta("v_pagado")}</span>`}</p>
      ${pieEmpresa(d.empresa)}
    </article>`;
}

function htmlVouchers(d, saldo) {
  const lista = d.actividades.filter((a) => a.voucher && a.codigo_reserva)
    .sort((x, y) => `${x.fecha} ${x.hora_inicio ?? "99"}`.localeCompare(`${y.fecha} ${y.hora_inicio ?? "99"}`));
  if (!lista.length) return "";
  let diaPrevio = "";
  const tiquetes = lista.map((a) => {
    const dia = a.fecha !== diaPrevio
      ? `<p class="vch-dia">${escapar(fecha(a.fecha, { weekday: "long", day: "numeric", month: "long" }))}</p>` : "";
    diaPrevio = a.fecha;
    return dia + htmlVoucher(d, a, a.pagado !== undefined ? saldoServicio(a) : saldo);
  }).join("");
  return `
    <section id="vouchers" class="caja vouchers">
      <h2>${escapar(t("v_titulo"))}</h2>
      <p class="ayuda">${escapar(t("v_intro"))}</p>
      <div class="vch-botones">
        <button type="button" class="btn" data-imprimir="vouchers">${escapar(t("v_imprimir"))}</button>
        <button type="button" class="btn" data-imprimir="compacto">${escapar(t("v_compacto"))}</button>
        <button type="button" class="btn" data-imprimir="pdf">${escapar(t("v_pdf"))}</button>
      </div>
      <p id="ayudaPdf" class="ayuda" hidden>${escapar(t("v_pdf_ayuda"))}</p>
      <div class="vch-lista">${tiquetes}</div>
    </section>`;
}

// Modos de impresión: página completa, un tiquete por hoja o itinerario compacto
function imprimir(modo) {
  document.body.classList.remove("imp-vouchers", "imp-compacto");
  const pdf = modo === "pdf";
  if (pdf) { $("ayudaPdf").hidden = false; modo = "vouchers"; }
  if (modo === "vouchers") document.body.classList.add("imp-vouchers");
  if (modo === "compacto") document.body.classList.add("imp-compacto");
  setTimeout(() => window.print(), pdf ? 900 : 50);
}
window.addEventListener("afterprint", () => document.body.classList.remove("imp-vouchers", "imp-compacto"));
$("contenido").addEventListener("click", (e) => {
  const b = e.target.closest("[data-imprimir]");
  if (b) imprimir(b.dataset.imprimir);
  const r = e.target.closest("[data-responder]");
  if (r) responderPregunta(r);
});

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
    alert(t("t_e_guardar"));
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
  btn.textContent = t("c_confirmando");
  const { data, error } = await db.rpc("confirmar_cotizacion", { p_numero: numero, p_token: token });
  if (error || !data) {
    btn.textContent = t("c_btn_confirmar");
    btn.disabled = false;
    $("msgConfirmar").textContent = error?.message?.includes("transporte")
      ? t("c_e_confirmar_transporte")
      : t("c_e_confirmar");
    $("msgConfirmar").hidden = false;
    return;
  }
  mensajeExito = true;
  await cargar();
  window.scrollTo(0, 0);
}

async function comentar() {
  const texto = $("txtComentario").value.trim();
  if (!texto) {
    mensajeComentario = { clave: "c_e_comentario_vacio", tipo: "aviso" };
    return pintar();
  }
  $("btnComentario").disabled = true;
  const { data, error } = await db.rpc("comentar_cotizacion", { p_numero: numero, p_token: token, p_texto: texto });
  if (error || !data) {
    mensajeComentario = { clave: "c_e_comentario", tipo: "aviso" };
  } else {
    mensajeComentario = { clave: "c_ok_comentario", tipo: "exito" };
    $("txtComentario").value = "";
  }
  pintar();
}

// Cambio de idioma: se redibuja la página sin perder lo escrito
document.addEventListener("idioma-cambiado", () => {
  if (datos) pintar();
  else if (errorClave) $("error").textContent = t(errorClave);
});

cargar();
