// =====================================================
// SOLICITUDES AL PROVEEDOR (P00001…) — etapa 8
// En una reserva, cada servicio se pasa a COTIZANDO y se le envía su solicitud al proveedor
// por correo (desde Gmail) o por WhatsApp (el agente la envía desde el chat de la empresa).
// El proveedor responde en su enlace (proveedor.html): Confirmar / Revisar / Sin disponibilidad.
// Si responde por chat o teléfono, el agente registra la respuesta con nombre, medio y motivo.
// (usa las utilidades y datos de panel.js)
// =====================================================

const solP = {
  seleccion: new Set(),   // actividades marcadas para pasar a COTIZANDO
  abierto: null,          // { id, tipo: "vista" | "registro" | "mensaje" }
  medio: {},              // medio elegido en la vista previa, por solicitud
  contactos: null         // operador_id → { correo_reservas, whatsapp, medio_preferido }
};

const ESTADO_SERVICIO = {
  por_solicitar: ["Por solicitar", ""], cotizando: ["Cotizando", "info"], revisar: ["Revisar", "alerta"],
  sin_disponibilidad: ["Sin disponibilidad", "alerta"], confirmado: ["Confirmado", "ok"], cancelado: ["Cancelado", ""]
};
const ESTADO_P = {
  borrador: ["Sin enviar", ""], enviada: ["Enviada · esperando respuesta", "info"], confirmada: ["Confirmada por el proveedor", "ok"],
  revisar: ["El proveedor pide revisar", "alerta"], sin_disponibilidad: ["Sin disponibilidad", "alerta"],
  cancelada: ["Cancelada", ""], cerrada: ["Cerrada", ""]
};
const RESPUESTA_P = { confirmar: "Confirmar", revisar: "Revisar", sin_disponibilidad: "Sin disponibilidad" };
const AVISO_P = { modificacion: "MODIFICACIÓN por enviar", cancelacion: "CANCELACIÓN por avisar", confirmacion_final: "Confirmación final por enviar" };
const chipP = ([texto, clase]) => `<span class="chip-p ${clase}">${escapar(texto)}</span>`;
const usdP = (n) => dinero(n);

// ---------- Datos ----------
async function cargarContactosProveedores(forzar = false) {
  if (solP.contactos && !forzar) return;
  const { data, error } = await db.rpc("contactos_proveedores");
  solP.contactos = new Map((error ? [] : data || []).map((x) => [Number(x.operador_id), x]));
}
const contactoDe = (operadorId) => solP.contactos?.get(Number(operadorId)) || null;

function solicitudDeActividad(actividadId) {
  if (!actividadId || !app.actual?.solicitudesP) return null;
  const lista = app.actual.solicitudesP.filter((s) => s.actividad_id === actividadId);
  return lista.length ? lista.reduce((a, b) => (b.id > a.id ? b : a)) : null;
}
const enlaceProveedor = (s) => new URL(`proveedor.html?p=${encodeURIComponent(s.codigo)}&t=${s.token}`, location.href).href;

document.addEventListener("detalle-abierto", async () => {
  solP.seleccion.clear();
  solP.abierto = null;
  if (app.actual?.cot.estado !== "reserva") return;
  await cargarContactosProveedores();
  if (app.actual && document.getElementById("secSolicitudes")) pintarDetalle();
});
document.addEventListener("detalle-cerrado", () => { solP.seleccion.clear(); solP.abierto = null; });

// ---------- Contenido de una solicitud (lo mismo que ve el proveedor) ----------
function htmlContenidoSolicitud(c) {
  const fila = (k, v) => (v ? `<div><dt>${k}</dt><dd>${escapar(v)}</dd></div>` : "");
  const horario = c.hora_inicio ? `${hora(c.hora_inicio)}${c.hora_fin ? " a " + hora(c.hora_fin) : ""}` : "Por confirmar";
  return `
    <dl class="sol-datos">
      ${fila("Servicio", c.servicio)}${fila("Titular", c.titular)}
      ${fila("Fecha", fechaLarga(c.fecha))}${fila("Hora", horario)}
      ${c.transporte ? fila("Pick up", c.recogida ? `${c.recogida}${c.hora_recogida ? " · " + hora(c.hora_recogida) : ""}` : "") : ""}
      ${c.transporte ? fila("Drop off", c.dejada) : ""}
    </dl>
    <table class="tabla sol-tabla">
      <thead><tr><th>Participantes</th><th class="num">Neto por persona</th><th class="num">Subtotal</th></tr></thead>
      <tbody>${(c.participantes || []).map((p) => `<tr><td>${p.cantidad} ${escapar(p.categoria)}</td><td class="num">${usdP(p.neto)}</td><td class="num">${usdP(p.subtotal)}</td></tr>`).join("")}
        ${Number(c.transporte_neto) ? `<tr><td>Transporte</td><td></td><td class="num">${usdP(c.transporte_neto)}</td></tr>` : ""}</tbody>
      <tfoot><tr><th colspan="2">Total neto</th><th class="num">${usdP(c.total)}</th></tr></tfoot>
    </table>
    ${c.notas ? `<p><strong>Notas para el proveedor:</strong> ${escapar(c.notas)}</p>` : ""}`;
}

// ---------- Correo que recibe el proveedor (vista previa) ----------
// Copia de la plantilla htmlSolicitud de la función de Supabase "correo": si cambias una, cambia la otra.
const usdCorreo = (n) => "$" + (Number(n) || 0).toFixed(2);
function fechaLargaCorreo(f) {
  if (!f) return "";
  const t = new Date(String(f).slice(0, 10) + "T12:00:00").toLocaleDateString("es-CR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return t.charAt(0).toUpperCase() + t.slice(1);
}
function htmlCorreoSolicitud(s, enlace, empresa, agente, aviso) {
  const c = s.contenido || {};
  const fila = (k, v) => v ? `<tr><td style="padding:6px 10px;color:#6b7a73;white-space:nowrap;vertical-align:top">${escapar(k)}</td><td style="padding:6px 10px;font-weight:bold">${escapar(v)}</td></tr>` : "";
  const part = (c.participantes || []).map((p) => `<tr><td style="padding:5px 10px">${escapar(String(p.cantidad))} ${escapar(p.categoria)}</td><td style="padding:5px 10px;text-align:right">${usdCorreo(p.neto)}</td><td style="padding:5px 10px;text-align:right">${usdCorreo(p.subtotal)}</td></tr>`).join("");
  const marca = empresa?.logo
    ? `<img src="${escapar(empresa.logo)}" alt="${escapar(empresa?.nombre_legal || "The House of Tours")}" style="max-height:48px;max-width:180px">`
    : `<strong style="font-size:18px;color:#1f5a3e">The House of Tours</strong>`;
  const pie = [empresa?.nombre_legal, empresa?.cedula && `Céd. ${empresa.cedula}`, empresa?.direccion, empresa?.movil, empresa?.correo].filter(Boolean).map(escapar).join(" · ");
  return `<div style="max-width:640px;margin:0 auto;padding:24px 16px">
   <div style="background:#fff;border-radius:12px;padding:22px">
    <table width="100%" style="border-bottom:2px solid #2f7a55;margin-bottom:14px"><tr><td>${marca}</td>
      <td style="text-align:right"><div style="font-size:12px;color:#6b7a73;text-transform:uppercase">Solicitud de servicio</div>
      <div style="font-size:22px;font-weight:bold">${escapar(s.codigo)}</div>
      <div style="font-size:12px;color:#6b7a73">Ref. ${escapar(c.codigo_reserva || c.cotizacion || "")}${s.version > 1 ? ` · versión ${s.version}` : ""}</div></td></tr></table>
    ${aviso ? `<p style="background:#fcebdd;color:#8a3b12;padding:10px 12px;border-radius:8px;font-weight:bold">${escapar(aviso)}</p>` : ""}
    <table style="border-collapse:collapse;font-size:15px">
      ${fila("Servicio", c.servicio)}${fila("Titular", c.titular)}
      ${fila("Fecha", fechaLargaCorreo(c.fecha))}
      ${fila("Hora", c.hora_inicio ? hora(c.hora_inicio) + (c.hora_fin ? " a " + hora(c.hora_fin) : "") : "Por confirmar")}
      ${c.transporte ? fila("Pick up", c.recogida ? `${c.recogida}${c.hora_recogida ? " · " + hora(c.hora_recogida) : ""}` : "") : ""}
      ${c.transporte ? fila("Drop off", c.dejada || "") : ""}
    </table>
    <table width="100%" style="border-collapse:collapse;font-size:14px;margin-top:12px;border-top:1px solid #dfe6e2">
      <tr style="color:#6b7a73;font-size:12px"><td style="padding:6px 10px">Participantes</td><td style="padding:6px 10px;text-align:right">Neto por persona</td><td style="padding:6px 10px;text-align:right">Subtotal</td></tr>
      ${part}
      ${Number(c.transporte_neto) ? `<tr><td style="padding:5px 10px">Transporte</td><td></td><td style="padding:5px 10px;text-align:right">${usdCorreo(c.transporte_neto)}</td></tr>` : ""}
      <tr style="border-top:2px solid #1d2a24"><td style="padding:8px 10px;font-weight:bold">TOTAL NETO</td><td></td><td style="padding:8px 10px;text-align:right;font-weight:bold;font-size:17px">${usdCorreo(c.total)}</td></tr>
    </table>
    ${c.notas ? `<p style="margin:14px 0 0"><strong>Notas:</strong> ${escapar(c.notas)}</p>` : ""}
    <p style="margin:20px 0 6px">Para <strong>confirmar</strong>, <strong>revisar</strong> o indicar que <strong>no hay disponibilidad</strong>, ingrese al enlace:</p>
    <p style="margin:0 0 6px"><a href="${escapar(enlace)}" style="background:#2f7a55;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:bold;display:inline-block">Responder solicitud</a></p>
    ${agente?.nombre ? `<p style="font-size:13px;color:#6b7a73;margin-top:16px">Agente: ${escapar(agente.nombre)}${agente.correo ? " · " + escapar(agente.correo) : ""}</p>` : ""}
   </div>
   ${pie ? `<p style="font-size:12px;color:#6b7a73;text-align:center;margin:14px 0 0">${pie}</p>` : ""}
  </div>`;
}

// Abre en otra pestaña el correo tal como lo recibe el proveedor, con Para y Asunto arriba
async function abrirCorreoProveedor(s) {
  const w = window.open("", "_blank");
  if (!w) return avisar("El navegador bloqueó la pestaña nueva. Permite las ventanas emergentes para este sitio.", "error");
  w.document.write(`<p style="font-family:Arial,sans-serif;padding:20px">Preparando la vista previa…</p>`);
  const [ref, emp] = await Promise.all([
    s.estado === "borrador" ? db.rpc("refrescar_solicitud", { p_id: s.id }) : Promise.resolve({ data: null }),
    db.from("empresa").select("*").eq("id", 1).maybeSingle()
  ]);
  if (ref.data) s.contenido = ref.data;   // datos actuales del servicio (como al enviar)
  const c = s.contenido || {};
  const k = contactoDe(s.operador_id) || {};
  const modif = s.aviso === "modificacion";
  const aviso = modif ? `MODIFICACIÓN (versión ${s.version}): hubo cambios en esta solicitud. Por favor revise y confirme de nuevo.` : "";
  const asunto = `${modif ? "MODIFICACIÓN · " : ""}Solicitud de servicio ${s.codigo}${s.version > 1 ? ` (versión ${s.version})` : ""} · ${c.servicio} · ${fechaLargaCorreo(c.fecha)}`;
  const cuerpo = htmlCorreoSolicitud(s, enlaceProveedor(s) + "&vista=1", emp.data, app.yo, aviso);
  w.document.open();
  w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Vista previa · ${escapar(s.codigo)}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>@media print { .vp { display: none } body { background: #fff !important } }</style></head>
    <body style="margin:0;background:#f2f5f3;font-family:Arial,Helvetica,sans-serif;color:#1d2a24">
    <div class="vp" style="background:#1d2a24;color:#fff;padding:12px 16px;font-size:14px;line-height:1.5">
      <strong>Vista previa del correo al proveedor</strong> · todavía no se ha enviado nada<br>
      Para: ${escapar(k.correo_reservas || "(el proveedor no tiene correo para reservas)")}<br>
      Asunto: ${escapar(asunto)}<br>
      <button onclick="print()" style="margin-top:8px;padding:6px 14px;border-radius:6px;border:0;cursor:pointer">Imprimir o guardar en PDF</button>
    </div>${cuerpo}</body></html>`);
  w.document.close();
}

// Texto para WhatsApp (corto; el detalle completo está en el enlace)
function textoWhatsApp(s, aviso = "") {
  const c = s.contenido || {};
  const part = (c.participantes || []).map((p) => `${p.cantidad} ${p.categoria}`).join(", ");
  return [
    aviso,
    `Solicitud ${s.codigo}${s.version > 1 ? ` (versión ${s.version})` : ""} · The House of Tours`,
    `${c.servicio} · ${fechaLarga(c.fecha)}${c.hora_inicio ? " · " + hora(c.hora_inicio) : ""}`,
    `${part}${Number(c.total) ? ` · Total neto ${usdP(c.total)}` : ""}`,
    "",
    "Para confirmar, revisar o indicar que no hay disponibilidad, ingrese al enlace:",
    enlaceProveedor(s)
  ].filter((x, i) => i !== 0 || x).join("\n");
}
const enlaceWhatsApp = (numero, texto) => `https://wa.me/${String(numero || "").replace(/\D/g, "")}?text=${encodeURIComponent(texto)}`;

// ---------- Aviso del proveedor (arriba en la reserva) ----------
function htmlAlertaProveedor(c) {
  const urgente = c.alerta_proveedor === "urgente";
  const ultimas = (app.actual.bitacora || []).filter((b) => /proveedor/i.test(b.accion)).slice(0, 3);
  return `
    <section class="det-seccion ${urgente ? "alerta-urgente" : "cambios"}">
      <h3>${urgente ? "ALERTA: un proveedor corrige una respuesta registrada por chat" : "Hay respuesta de un proveedor"}</h3>
      ${ultimas.map((b) => `<p class="cita">${escapar(b.detalle ?? b.accion)}</p>`).join("")}
      <p class="nota">Revisa los detalles en "Solicitudes a proveedores".</p>
      <button type="button" class="btn" data-solp="alerta-revisada">Marcar como revisado</button>
    </section>`;
}

// ---------- Sección "Solicitudes a proveedores" ----------
function htmlSolicitudes(c) {
  const acts = app.actual.actividades.filter((a) => a.servicio_id).slice().sort(ordenActividad);
  const pendientes = app.actual.actividades.some((a) => a._pendiente);
  const seleccionables = acts.filter(puedeSolicitar);
  const marcadas = [...solP.seleccion].filter((id) => seleccionables.some((a) => a.id === id));

  return `
    <section class="det-seccion" id="secSolicitudes">
      <div class="sec-cabeza">
        <h3>Solicitudes a proveedores</h3>
        <div class="sec-botones">
          <button type="button" class="btn primario" data-solp="crear" ${marcadas.length && !pendientes ? "" : "disabled"}>Pasar a cotizando y solicitar${marcadas.length ? ` (${marcadas.length})` : ""}</button>
        </div>
      </div>
      <p class="nota">Marca los servicios y presiona "Pasar a cotizando y solicitar": cada uno recibe su número P y se abre la vista previa para enviarlo por correo o WhatsApp. El proveedor responde en su enlace.</p>
      ${pendientes ? `<p class="aviso">Guarda los cambios del itinerario antes de solicitar a los proveedores.</p>` : ""}
      ${acts.length ? `<ul class="sol-lista">${acts.map((a) => htmlFilaSolicitud(a, c)).join("")}</ul>` : `<p class="nota">La reserva no tiene servicios.</p>`}
      ${htmlCancelacionesSueltas()}
    </section>`;
}

// Cancelaciones por avisar de servicios eliminados o de proveedores reemplazados (no son la última solicitud del servicio)
function htmlCancelacionesSueltas() {
  const sueltas = (app.actual.solicitudesP || []).filter((x) => x.estado === "cancelada" && (x.aviso === "cancelacion" || !x.cancelacion_recibida_en && x.aviso)
    && (!x.actividad_id || solicitudDeActividad(x.actividad_id)?.id !== x.id));
  if (!sueltas.length) return "";
  return `
    <h4>Cancelaciones por avisar a proveedores</h4>
    <ul class="sol-lista">${sueltas.map((x) => `
      <li class="sol-fila">
        <div class="sol-detalle">
          <span class="etiqueta">${escapar(x.codigo)}</span>
          <strong>${escapar(x.contenido?.servicio ?? "")}</strong>
          <small>${escapar(nombreOperador(x.operador_id))} · ${fecha(x.contenido?.fecha, { day: "numeric", month: "short" })}</small>
          ${chipP([AVISO_P.cancelacion, "alerta"])}
        </div>
        <div class="sec-botones"><button type="button" class="btn primario chico" data-solp="aviso" data-id="${x.id}">Avisar cancelación</button></div>
        ${solP.abierto?.id === x.id && solP.abierto.tipo === "aviso" ? htmlAviso(x) : ""}
      </li>`).join("")}</ul>`;
}

// Avance de la reserva: reemplaza el antiguo "Confirmar reserva" (cada servicio se confirma por separado)
function htmlAvanceReserva(c) {
  const acts = app.actual.actividades.filter((a) => a.id && a.servicio_id && a.estado_servicio !== "cancelado");
  const conf = acts.filter((a) => a.estado_servicio === "confirmado");
  return `
    <section class="det-seccion">
      <h3>Servicios confirmados: ${conf.length} de ${acts.length}</h3>
      ${conf.length ? `<ul class="codigos-reserva">${conf.slice().sort(ordenActividad).map((a) => `
        <li><strong>${escapar(c.numero)}-${escapar(a.codigo_reserva ?? "")}</strong>
          <span>${escapar(servicioPorId(a.servicio_id)?.nombre ?? "")} · ${fecha(a.fecha, { weekday: "short", day: "numeric", month: "short" })}</span>
          ${solicitudDeActividad(a.id) ? `<span class="etiqueta">${escapar(solicitudDeActividad(a.id).codigo)}</span>` : ""}</li>`).join("")}</ul>`
        : `<p class="nota">Cada servicio se confirma en "Solicitudes a proveedores" cuando su proveedor lo confirma: ahí nace su código R.</p>`}
    </section>`;
}

function puedeSolicitar(a) {
  if (!a.id || !a.operador_id || a._pendiente) return false;
  const s = solicitudDeActividad(a.id);
  return !s || ["cancelada", "cerrada"].includes(s.estado) || (s.estado === "sin_disponibilidad" && s.operador_id !== a.operador_id);
}

function htmlFilaSolicitud(a, c) {
  const s = solicitudDeActividad(a.id);
  const serv = servicioPorId(a.servicio_id);
  const [estTxt, estClase] = ESTADO_SERVICIO[a.estado_servicio] || ESTADO_SERVICIO.por_solicitar;
  const seleccionable = puedeSolicitar(a);
  const abierto = s && solP.abierto?.id === s.id ? solP.abierto.tipo : null;
  const sinOperador = !a.operador_id;
  const sinDisp = s && s.estado === "sin_disponibilidad";
  const cambioProveedor = s && a.operador_id && s.operador_id !== a.operador_id && !["cancelada", "cerrada"].includes(s.estado);

  let acciones = "";
  if (s) {
    if (s.estado === "confirmada" && a.estado_servicio !== "confirmado" && !cambioProveedor) {
      acciones += `<button type="button" class="btn primario chico" data-solp="confirmar-servicio" data-id="${s.id}" data-act="${a.id}">Confirmar servicio</button>`;
    }
    if (s.aviso === "confirmacion_final" || s.aviso === "cancelacion") {
      acciones += `<button type="button" class="btn primario chico" data-solp="aviso" data-id="${s.id}">${s.aviso === "cancelacion" ? "Avisar cancelación" : "Enviar confirmación final"}</button>`;
    }
    if (s.estado === "borrador") acciones += `<button type="button" class="btn primario chico" data-solp="vista" data-id="${s.id}">${s.aviso === "modificacion" ? "Vista previa y enviar MODIFICACIÓN" : "Vista previa y enviar"}</button>`;
    if (s.estado === "enviada") {
      acciones += `<button type="button" class="btn chico" data-solp="vista" data-id="${s.id}">Reenviar</button>`;
      acciones += `<button type="button" class="btn chico" data-solp="registro" data-id="${s.id}">Registrar respuesta recibida por chat</button>`;
    }
    if (["revisar", "confirmada", "sin_disponibilidad"].includes(s.estado) && !cambioProveedor) {
      acciones += `<button type="button" class="btn chico" data-solp="nueva-version" data-id="${s.id}">Nueva versión y reenviar</button>`;
    }
    if (!["cancelada", "cerrada"].includes(s.estado) && !cambioProveedor && a.estado_servicio !== "cancelado") {
      acciones += `<button type="button" class="btn chico" data-solp="editar" data-id="${s.id}">Editar</button>`;
    }
    if (s.estado !== "borrador" && s.estado !== "cancelada") {
      acciones += `<button type="button" class="btn chico" data-solp="mensaje" data-id="${s.id}">Mensaje al proveedor</button>`;
      acciones += `<button type="button" class="enlace" data-solp="copiar" data-id="${s.id}">Copiar enlace</button>`;
    }
  }

  const resp = s?.respuesta ? `
    <p class="sol-respuesta">
      <strong>${RESPUESTA_P[s.respuesta]}</strong> · ${escapar(s.respuesta_nombre ?? "")}
      ${s.respuesta_origen === "agente"
        ? `<span class="chip-p aviso">Por chat · registrado por ${escapar(nombrePerfil(s.respuesta_registrada_por))}</span> <small>${escapar(s.respuesta_medio ?? "")} · motivo: ${escapar(s.respuesta_motivo ?? "")}</small>`
        : `<span class="chip-p ok">En el enlace${s.verificada_en ? " (verificó lo registrado por chat)" : ""}</span>`}
      <small>${s.respuesta_en ? fechaHora(s.respuesta_en) : ""}${s.respuesta_numero ? ` · N.º ${escapar(s.respuesta_numero)}` : ""}</small>
      ${s.respuesta_nota ? `<span class="cita">${escapar(s.respuesta_nota)}</span>` : ""}
    </p>` : "";

  return `
    <li class="sol-fila">
      <div class="sol-cabeza">
        ${seleccionable ? `<input type="checkbox" data-solp-sel="${a.id}" ${solP.seleccion.has(a.id) ? "checked" : ""} aria-label="Solicitar este servicio">` : `<span class="sol-espacio"></span>`}
        <div class="sol-titulo">
          <strong>${escapar(serv?.nombre ?? "")}</strong>
          <span class="nota">${fecha(a.fecha, { weekday: "short", day: "numeric", month: "short" })}${a.hora_inicio ? " · " + hora(a.hora_inicio) : ""} · ${escapar(nombreOperador(a.operador_id) || "Sin operador")}</span>
        </div>
        ${chipP([estTxt, estClase])}
      </div>
      ${sinOperador ? `<p class="nota">Asigna el operador en la actividad para poder solicitarlo.</p>` : ""}
      ${sinDisp && !cambioProveedor ? `<p class="aviso">El proveedor no tiene disponibilidad. Si cambias la fecha u hora, guarda y usa "Nueva versión y reenviar". Si cambias de proveedor en la actividad, guarda y aparecerá la casilla para pedirle al nuevo proveedor (nuevo número P).</p>` : ""}
      ${cambioProveedor && !sinDisp ? `<p class="aviso">El proveedor de la actividad ya no es el de la solicitud ${escapar(s.codigo)} (${escapar(nombreOperador(s.operador_id))}). Guarda los cambios del itinerario: la solicitud anterior se cancela y queda el aviso de cancelación.</p>` : ""}
      ${a.estado_servicio === "confirmado" && a.codigo_reserva ? `<p class="sol-confirmado">Servicio confirmado · <strong>${escapar(c.numero)}-${escapar(a.codigo_reserva)}</strong>${s && s.estado !== "confirmada" ? " · el proveedor debe confirmar la modificación (el código R se conserva)" : ""}</p>` : ""}
      ${a.estado_servicio !== "confirmado" && a.codigo_reserva ? `<p class="nota">Conserva su código ${escapar(c.numero)}-${escapar(a.codigo_reserva)}: se volverá a usar al confirmar el servicio.</p>` : ""}
      ${s ? `
        <div class="sol-detalle">
          <span class="etiqueta">${escapar(s.codigo)}${s.version > 1 ? ` · v${s.version}` : ""}</span>
          ${chipP(ESTADO_P[s.estado] || [s.estado, ""])}
          ${s.aviso ? chipP([AVISO_P[s.aviso], "alerta"]) : ""}
          ${s.enviada_en ? `<small>Enviada por ${s.medio === "whatsapp" ? "WhatsApp" : "correo"} el ${fechaHora(s.enviada_en)}${s.enviada_por ? ` · ${escapar(nombrePerfil(s.enviada_por))}` : ""}</small>` : ""}
          ${s.confirmacion_final_en ? `<small>Confirmación final enviada el ${fechaHora(s.confirmacion_final_en)}</small>` : ""}
          ${s.cancelacion_recibida_en ? `<small>Cancelación recibida por ${escapar(s.cancelacion_recibida_por ?? "")} el ${fechaHora(s.cancelacion_recibida_en)}</small>` : ""}
        </div>
        ${resp}
        ${acciones ? `<div class="sec-botones">${acciones}</div>` : ""}
        ${abierto === "vista" ? htmlVistaPrevia(s) : ""}
        ${abierto === "editar" ? htmlEditarSolicitud(s, a) : ""}
        ${abierto === "registro" ? htmlRegistro(s) : ""}
        ${abierto === "mensaje" ? htmlMensaje(s) : ""}
        ${abierto === "aviso" ? htmlAviso(s) : ""}
        ${htmlConversacion(s)}` : ""}
    </li>`;
}

// ---------- Editar una solicitud ----------
// Los cambios se guardan en el servicio de la reserva (una sola fuente de datos) y luego la solicitud
// se actualiza: sin enviar → se refresca; ya enviada → MODIFICACIÓN (nueva versión). Todo queda en la bitácora.
const llevaTransporteSol = (a) => a.transporte_modo === "incluido" || (a.transporte_modo === "opcional" && a.transporte_respuesta === "si");
function htmlEditarSolicitud(s, a) {
  const campo = (etq, attr, valor, tipo = "text") => `<label>${etq} <input type="${tipo}" data-ed="${attr}" value="${escapar(valor ?? "")}"${tipo === "number" ? ' min="0" step="0.01"' : ""}></label>`;
  const filas = a.participantes.filter((p) => p.cantidad > 0).map((p) => `
    <tr><td>${p.cantidad} ${escapar(categoriaPorId(p.categoria_id)?.nombre ?? "")}${p.opcion ? ` · ${escapar(p.opcion)}` : ""}</td>
      <td class="num"><input type="number" min="0" step="0.01" data-ed-neto data-cat="${p.categoria_id}" data-op="${escapar(p.opcion || "")}" value="${Number(p.neto_unitario) || 0}" aria-label="Neto por persona"></td></tr>`).join("");
  const enviada = s.estado !== "borrador";
  return `
    <div class="sol-panel sol-editar">
      <h4>Editar la solicitud · ${escapar(s.codigo)}</h4>
      <p class="nota">Los cambios se guardan también en el servicio de la reserva, para que todo coincida.
        ${enviada ? "<strong>Como ya se le envió al proveedor, se preparará una MODIFICACIÓN (nueva versión) para que la confirme de nuevo.</strong>" : "La solicitud todavía no se ha enviado: solo se actualiza."}</p>
      <div class="fila-form">
        ${campo("Día", "fecha", a.fecha, "date")}
        ${campo("Empieza", "hora_inicio", a.hora_inicio, "time")}
        ${campo("Termina", "hora_fin", a.hora_fin, "time")}
      </div>
      ${llevaTransporteSol(a) ? `
      <div class="fila-form">
        ${campo("Pick up (lugar)", "lugar_recogida", a.lugar_recogida)}
        ${campo("Hora de pick up", "hora_recogida", a.hora_recogida, "time")}
        ${campo("Drop off", "lugar_dejada", a.lugar_dejada)}
        ${campo("Transporte neto", "transporte_neto", a.transporte_neto, "number")}
      </div>` : ""}
      ${filas ? `<table class="tabla sol-tabla"><thead><tr><th>Participantes</th><th class="num">Neto por persona</th></tr></thead><tbody>${filas}</tbody></table>` : ""}
      <label class="ancho">Notas para el proveedor <textarea data-ed="notas_proveedor" rows="2">${escapar(a.notas_proveedor || "")}</textarea></label>
      <label class="ancho">Motivo del cambio (opcional, queda en la bitácora) <input type="text" data-ed-motivo placeholder="Ej.: el proveedor pidió cambiar la hora"></label>
      <p class="nota">Para cambiar la actividad, el proveedor o cuántas personas van, hazlo en el servicio del itinerario.</p>
      <div class="sec-botones">
        <button type="button" class="btn primario" data-solp="guardar-edicion" data-id="${s.id}" data-act="${a.id}">Guardar cambios</button>
        <button type="button" class="btn" data-solp="cerrar">Cancelar</button>
      </div>
    </div>`;
}

async function guardarEdicionSolicitud(btn, s) {
  const panel = btn.closest(".sol-editar");
  const leer = (k) => panel.querySelector(`[data-ed="${k}"]`)?.value.trim();
  const nuevo = {};
  ["fecha", "hora_inicio", "hora_fin", "lugar_recogida", "hora_recogida", "lugar_dejada", "transporte_neto", "notas_proveedor"]
    .forEach((k) => { const v = leer(k); if (v !== undefined) nuevo[k] = v; });
  const netos = [...panel.querySelectorAll("[data-ed-neto]")].map((x) => ({ cat: Number(x.dataset.cat), op: x.dataset.op || "", neto: Math.max(0, parseFloat(x.value) || 0) }));
  const motivo = panel.querySelector("[data-ed-motivo]").value.trim();
  if (!nuevo.fecha) return avisar("El servicio necesita un día.", "error");

  if (!(await guardarSiHayCambios())) return;   // otros cambios del itinerario sin guardar
  const a = app.actual.actividades.find((x) => x.id === Number(btn.dataset.act));
  if (!a) return avisar("No se encontró el servicio.", "error");

  // Qué cambió (para la bitácora)
  const NOMBRES = { fecha: "Día", hora_inicio: "Hora", hora_fin: "Termina", lugar_recogida: "Pick up", hora_recogida: "Hora de pick up",
    lugar_dejada: "Drop off", transporte_neto: "Transporte neto", notas_proveedor: "Notas para el proveedor" };
  const mostrar = (k, v) => k === "fecha" ? (v ? fecha(v, { day: "numeric", month: "short", year: "numeric" }) : "—")
    : k === "transporte_neto" ? dinero(v) : (String(v ?? "").trim() || "—");
  const cambios = [];
  Object.entries(nuevo).forEach(([k, v]) => {
    const antes = k === "transporte_neto" ? Number(a[k]) || 0 : String(a[k] ?? "").trim();
    const despues = k === "transporte_neto" ? Number(v) || 0 : v;
    if (antes !== despues) cambios.push(`${NOMBRES[k]}: ${mostrar(k, antes)} → ${mostrar(k, despues)}`);
  });
  const netosCambiados = netos.filter((n) => {
    const p = a.participantes.find((x) => x.categoria_id === n.cat && (x.opcion || "") === n.op);
    if (!p || Math.abs((Number(p.neto_unitario) || 0) - n.neto) < 0.005) return false;
    cambios.push(`Neto ${categoriaPorId(n.cat)?.nombre ?? ""}${n.op ? " · " + n.op : ""}: ${dinero(p.neto_unitario)} → ${dinero(n.neto)}`);
    return true;
  });
  if (!cambios.length) return avisar("No hay cambios por guardar.");

  await conBoton(btn, async () => {
    const fila = {
      fecha: nuevo.fecha, hora_inicio: nuevo.hora_inicio || null, hora_fin: nuevo.hora_fin || null,
      notas_proveedor: nuevo.notas_proveedor || null
    };
    if ("lugar_recogida" in nuevo) Object.assign(fila, {
      lugar_recogida: nuevo.lugar_recogida || null, hora_recogida: nuevo.hora_recogida || null,
      lugar_dejada: nuevo.lugar_dejada || null, transporte_neto: Math.max(0, parseFloat(nuevo.transporte_neto) || 0)
    });
    let r = await db.from("actividades").update(fila).eq("id", a.id);
    if (r.error) return fallo(r.error, "No se pudo guardar el cambio.");
    for (const n of netosCambiados) {
      r = await db.from("actividad_participantes").update({ neto_unitario: n.neto })
        .eq("actividad_id", a.id).eq("categoria_id", n.cat).eq("opcion", n.op);
      if (r.error) return fallo(r.error, "No se pudo guardar el neto.");
    }
    const texto = cambios.join("; ");
    r = await db.rpc("registrar_edicion_solicitud", { p_id: s.id, p_cambios: texto, p_motivo: motivo || null });
    const sinBitacora = !!r.error;
    if (sinBitacora) console.error("Bitácora:", r.error);

    // La solicitud toma los datos nuevos: sin enviar → se refresca; enviada → MODIFICACIÓN; sin disponibilidad → nueva versión
    if (s.estado === "sin_disponibilidad") {
      r = await db.rpc("nueva_version_solicitud", { p_id: s.id });
      if (r.error) fallo(r.error, "Se guardó el cambio, pero no se pudo crear la nueva versión.");
    } else {
      await revisarCambiosSolicitudes(app.actual.cot);
    }
    await recargarDetalle(false);
    cargarTablero();
    const sol = solicitudPorId(s.id);
    solP.abierto = sol?.estado === "borrador" ? { id: s.id, tipo: "vista" } : null;
    pintarDetalle();
    if (sinBitacora) return avisar(`${s.codigo} se editó, pero el cambio no quedó en la bitácora. Avísale al administrador.`, "error");
    avisar(`${s.codigo} editada: ${texto}.${sol?.estado === "borrador" && s.estado !== "borrador" ? " Revisa la vista previa y envía la MODIFICACIÓN." : ""}${nuevo.fecha !== a.fecha ? " El precio al cliente no cambió: si el nuevo día es de otra temporada, revísalo en el servicio." : ""}`);
  });
}

function htmlVistaPrevia(s) {
  const k = contactoDe(s.operador_id) || {};
  const medio = solP.medio[s.id] || k.medio_preferido || "correo";
  const falta = medio === "correo" ? !k.correo_reservas : !k.whatsapp;
  return `
    <div class="sol-panel">
      <h4>Vista previa · ${escapar(s.codigo)}${s.version > 1 ? ` (versión ${s.version})` : ""}</h4>
      ${s.aviso === "modificacion" ? `<p class="aviso">Se enviará como <strong>MODIFICACIÓN</strong>: el proveedor deberá confirmar de nuevo.</p>` : ""}
      ${htmlContenidoSolicitud(s.contenido || {})}
      <div class="sol-recibe">
        <p class="oficina-tit">Lo que recibe el proveedor</p>
        <div class="sec-botones">
          <button type="button" class="btn" data-solp="ver-correo" data-id="${s.id}">Ver el correo</button>
          <button type="button" class="btn" data-solp="ver-pagina" data-id="${s.id}">Ver su página de respuesta</button>
        </div>
        ${medio === "whatsapp" ? `<p class="nota">Mensaje de WhatsApp:</p><pre class="correo-vista">${escapar(textoWhatsApp(s, s.aviso === "modificacion" ? `MODIFICACIÓN (versión ${s.version}): hubo cambios, por favor confirme de nuevo.` : ""))}</pre>` : ""}
        <p class="nota">Se abren en otra pestaña tal como los verá el proveedor (puedes imprimirlos). En la vista previa los botones de respuesta no envían nada.</p>
      </div>
      <div class="fila-form">
        <label>Enviar por
          <select data-solp-medio="${s.id}">
            <option value="correo" ${medio === "correo" ? "selected" : ""}>Correo${k.correo_reservas ? ` (${escapar(k.correo_reservas)})` : " (sin correo registrado)"}</option>
            <option value="whatsapp" ${medio === "whatsapp" ? "selected" : ""}>WhatsApp${k.whatsapp ? ` (${escapar(k.whatsapp)})` : " (sin número registrado)"}</option>
          </select></label>
        ${medio === "correo"
          ? `<button type="button" class="btn primario" data-solp="enviar-correo" data-id="${s.id}" ${falta ? "disabled" : ""}>Enviar por correo</button>`
          : `<button type="button" class="btn primario" data-solp="enviar-whatsapp" data-id="${s.id}" ${falta ? "disabled" : ""}>Abrir WhatsApp</button>`}
        <button type="button" class="btn" data-solp="cerrar">Cerrar</button>
      </div>
      ${falta ? `<p class="aviso">Este proveedor no tiene ${medio === "correo" ? "correo para reservas" : "WhatsApp para reservas"}. ${app.yo?.rol === "administrador" ? "Agrégalo en Tarifario › Operadores" : "Pídele al administrador que lo agregue en Tarifario › Operadores"} o usa el otro medio.</p>` : ""}
      ${medio === "whatsapp" ? `<p class="nota">Se abre el chat del proveedor con el mensaje escrito (usa el WhatsApp de la empresa). Presiona Enviar en WhatsApp y luego confirma aquí que se envió.</p>` : ""}
    </div>`;
}

// Texto de la confirmación final o la cancelación (lo mismo por correo y por WhatsApp)
function textoAviso(s) {
  const c = s.contenido || {};
  const detalle = `${c.servicio} · ${fechaLarga(c.fecha)}${c.hora_inicio ? " · " + hora(c.hora_inicio) : ""}`;
  if (s.aviso === "cancelacion") {
    return `CANCELACIÓN · Solicitud ${s.codigo} · The House of Tours\n${detalle} · Titular: ${c.titular}\n\nPor favor confirme que la recibió con el botón "Recibido" del enlace:\n${enlaceProveedor(s)}`;
  }
  const chat = s.respuesta_origen === "agente" ? `\nRegistramos su confirmación por chat (${s.respuesta_nombre}, ${fecha(s.respuesta_en, { day: "numeric", month: "short" })}). Puede verla y verificarla en el enlace.` : "";
  return `CONFIRMADA · Solicitud ${s.codigo} · The House of Tours\n${detalle} · Titular: ${c.titular}\nCódigo del cliente: ${c.codigo_reserva}\nEl cliente presentará este código en su voucher.${chat}\n\n${enlaceProveedor(s)}`;
}

function htmlAviso(s) {
  const k = contactoDe(s.operador_id) || {};
  const medio = solP.medio["a" + s.id] || s.medio || k.medio_preferido || "correo";
  const falta = medio === "correo" ? !k.correo_reservas : !k.whatsapp;
  return `
    <div class="sol-panel">
      <h4>${s.aviso === "cancelacion" ? "Avisar la cancelación" : "Confirmación final"} · ${escapar(s.codigo)}</h4>
      <pre class="correo-vista">${escapar(textoAviso(s))}</pre>
      <div class="fila-form">
        <label>Enviar por
          <select data-solp-medio="a${s.id}">
            <option value="correo" ${medio === "correo" ? "selected" : ""}>Correo${k.correo_reservas ? ` (${escapar(k.correo_reservas)})` : " (sin correo registrado)"}</option>
            <option value="whatsapp" ${medio === "whatsapp" ? "selected" : ""}>WhatsApp${k.whatsapp ? ` (${escapar(k.whatsapp)})` : " (sin número registrado)"}</option>
          </select></label>
        ${medio === "correo"
          ? `<button type="button" class="btn primario" data-solp="aviso-correo" data-id="${s.id}" ${falta ? "disabled" : ""}>Enviar por correo</button>`
          : `<button type="button" class="btn primario" data-solp="aviso-whatsapp" data-id="${s.id}" ${falta ? "disabled" : ""}>Abrir WhatsApp</button>`}
        <button type="button" class="btn" data-solp="aviso-otro" data-id="${s.id}">Ya lo avisé por teléfono u otro medio</button>
        <button type="button" class="btn" data-solp="cerrar">Cerrar</button>
      </div>
      ${falta ? `<p class="aviso">Falta el ${medio === "correo" ? "correo" : "WhatsApp"} para reservas de este proveedor.</p>` : ""}
    </div>`;
}

function htmlRegistro(s) {
  const ahora = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  return `
    <div class="sol-panel">
      <h4>Registrar respuesta recibida por chat o teléfono · ${escapar(s.codigo)}</h4>
      <p class="nota">Úsalo cuando el proveedor respondió fuera del enlace. Si después abre el enlace, verá lo que registraste a su nombre y podrá confirmarlo o corregirlo.</p>
      <div class="fila">
        <label>Respuesta del proveedor
          <select data-reg="respuesta">
            <option value="confirmar">Confirmar</option><option value="revisar">Revisar</option><option value="sin_disponibilidad">Sin disponibilidad</option>
          </select></label>
        <label>Nombre de quien respondió <input data-reg="nombre" type="text" placeholder="Ej.: Bryan Méndez"></label>
        <label>Medio
          <select data-reg="medio"><option>WhatsApp</option><option>Llamada telefónica</option><option>Otro</option></select></label>
        <label>Fecha y hora de la respuesta <input data-reg="fecha" type="datetime-local" value="${ahora}"></label>
      </div>
      <div class="fila">
        <label>N.º de confirmación del proveedor (opcional) <input data-reg="numero" type="text"></label>
        <label>Nota del proveedor (obligatoria si es "Revisar") <input data-reg="nota" type="text"></label>
      </div>
      <label>Motivo por el que lo registras tú <input data-reg="motivo" type="text" placeholder="Ej.: Respondió por el chat de WhatsApp y no usó el enlace"></label>
      <div class="sec-botones">
        <button type="button" class="btn primario" data-solp="guardar-registro" data-id="${s.id}">Registrar respuesta</button>
        <button type="button" class="btn" data-solp="cerrar">Cancelar</button>
      </div>
    </div>`;
}

function htmlMensaje(s) {
  const k = contactoDe(s.operador_id) || {};
  const medio = solP.medio["m" + s.id] || s.medio || k.medio_preferido || "correo";
  return `
    <div class="sol-panel">
      <h4>Mensaje al proveedor · ${escapar(s.codigo)}</h4>
      <p class="nota">El mensaje queda en la solicitud y el proveedor lo ve en su enlace, donde puede contestar.</p>
      <textarea data-solp-texto="${s.id}" rows="3" maxlength="2000" placeholder="Ej.: Gracias, ya corregimos la tarifa. Por favor confirme de nuevo."></textarea>
      <div class="fila-form">
        <label>Avisarle por
          <select data-solp-medio="m${s.id}">
            <option value="correo" ${medio === "correo" ? "selected" : ""}>Correo${k.correo_reservas ? "" : " (sin correo registrado)"}</option>
            <option value="whatsapp" ${medio === "whatsapp" ? "selected" : ""}>WhatsApp${k.whatsapp ? "" : " (sin número registrado)"}</option>
          </select></label>
        <button type="button" class="btn primario" data-solp="enviar-mensaje" data-id="${s.id}">Enviar mensaje</button>
        <button type="button" class="btn" data-solp="cerrar">Cancelar</button>
      </div>
    </div>`;
}

function htmlConversacion(s) {
  const ev = (app.actual.eventosP || []).filter((e) => e.solicitud_id === s.id);
  if (!ev.length) return "";
  const texto = (e) => {
    const d = e.detalle || {};
    switch (e.tipo) {
      case "creada": return `Solicitud creada · servicio pasa a COTIZANDO`;
      case "edicion": return `Editada: ${d.cambios ?? ""}${d.motivo ? ` · motivo: ${d.motivo}` : ""}`;
      case "enviada": return `Enviada por ${d.medio === "whatsapp" ? "WhatsApp" : "correo"}${d.para ? " a " + d.para : ""}${d.version > 1 ? ` (versión ${d.version})` : ""}`;
      case "nueva_version": return `Nueva versión ${d.version}`;
      case "respuesta": return `Respuesta en el enlace: ${RESPUESTA_P[d.respuesta] ?? ""} · ${e.nombre ?? ""}${d.numero ? ` · N.º ${d.numero}` : ""}`;
      case "verificacion": return `${d.respuesta === "confirmar" ? "El proveedor verificó en el enlace la confirmación por chat" : "ALERTA: el proveedor corrige lo registrado por chat: " + (RESPUESTA_P[d.respuesta] ?? "")} · ${e.nombre ?? ""}`;
      case "registro_agente": return `Respuesta registrada por el agente: ${RESPUESTA_P[d.respuesta] ?? ""} · ${e.nombre ?? ""} por ${d.medio ?? ""} · motivo: ${d.motivo ?? ""}`;
      case "mensaje_agente": return `Mensaje del agente${d.medio ? ` (aviso por ${d.medio === "whatsapp" ? "WhatsApp" : "correo"})` : ""}`;
      case "mensaje_proveedor": return `Mensaje del proveedor · ${e.nombre ?? ""}`;
      case "modificacion": return `MODIFICACIÓN: versión ${d.version} pendiente de enviar`;
      case "cancelacion": return `Solicitud cancelada`;
      case "cancelacion_recibida": return `El proveedor recibió la cancelación · ${e.nombre ?? ""}`;
      case "servicio_confirmado": return `Servicio confirmado · código ${d.codigo ?? ""}`;
      case "confirmacion_final": return `Confirmación final enviada por ${d.medio === "whatsapp" ? "WhatsApp" : d.medio === "correo" ? "correo" : "otro medio"}`;
      case "aviso_marcado": return `Aviso de ${d.aviso === "cancelacion" ? "cancelación" : "confirmación"} enviado por ${d.medio === "whatsapp" ? "WhatsApp" : d.medio === "correo" ? "correo" : "otro medio"}`;
      default: return e.tipo;
    }
  };
  return `
    <details class="sol-historial">
      <summary>Historial y conversación (${ev.length})</summary>
      <ul>${ev.map((e) => `
        <li class="ev-${e.tipo}">
          <small>${fechaHora(e.creado_en)}${e.autor ? ` · ${escapar(nombrePerfil(e.autor))}` : ""}</small>
          <span>${escapar(texto(e))}</span>
          ${e.texto ? `<span class="cita">${escapar(e.texto)}</span>` : ""}
        </li>`).join("")}</ul>
    </details>`;
}

// ---------- Acciones ----------
async function errorFuncion(error, data) {
  let m = data?.error;
  if (error && !m) { try { m = (await error.context.json())?.error; } catch { /* sin detalle */ } }
  return m || error?.message || "No se pudo completar la acción.";
}
async function recargarSolicitudes(mensaje) {
  await recargarDetalle(false);
  cargarTablero();
  if (mensaje) avisar(mensaje);
}
const solicitudPorId = (id) => app.actual.solicitudesP.find((s) => s.id === Number(id));

$("detalleContenido").addEventListener("change", (e) => {
  const sel = e.target.dataset.solpSel;
  if (sel) {
    e.target.checked ? solP.seleccion.add(Number(sel)) : solP.seleccion.delete(Number(sel));
    const btn = document.querySelector('[data-solp="crear"]');
    const n = solP.seleccion.size;
    if (btn) { btn.disabled = !n || app.actual.actividades.some((a) => a._pendiente); btn.textContent = `Pasar a cotizando y solicitar${n ? ` (${n})` : ""}`; }
    return;
  }
  if (e.target.dataset.solpMedio) {
    solP.medio[e.target.dataset.solpMedio] = e.target.value;
    if (!String(e.target.dataset.solpMedio).startsWith("m")) pintarDetalle();   // vista previa ("123") y avisos ("a123") cambian de botón
  }
});

$("detalleContenido").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-solp]");
  if (!btn) return;
  const c = app.actual.cot;
  const s = btn.dataset.id ? solicitudPorId(btn.dataset.id) : null;

  switch (btn.dataset.solp) {
    case "alerta-revisada":
      await conBoton(btn, async () => {
        const { error } = await db.from("cotizaciones").update({ alerta_proveedor: null }).eq("id", c.id);
        if (error) return fallo(error);
        await registrar(c.id, "aviso del proveedor revisado");
        await recargarSolicitudes();
      });
      break;

    case "crear": {
      if (!(await guardarSiHayCambios())) return;
      const ids = [...solP.seleccion];
      if (!ids.length) return;
      await conBoton(btn, async () => {
        const { data, error } = await db.rpc("crear_solicitudes", { p_actividades: ids });
        if (error) return fallo(error, "No se pudieron crear las solicitudes.");
        solP.seleccion.clear();
        await cargarContactosProveedores(true);
        await recargarDetalle(false);
        cargarTablero();
        const primera = (data || [])[0];
        if (primera) solP.abierto = { id: primera.id, tipo: "vista" };
        pintarDetalle();
        document.getElementById("secSolicitudes")?.scrollIntoView({ block: "start" });
        avisar(`${(data || []).length} solicitud(es) creada(s): ${(data || []).map((x) => x.codigo).join(", ")}. Revisa la vista previa y envíalas.`);
      });
      break;
    }

    case "vista": {
      const { data, error } = await db.rpc("refrescar_solicitud", { p_id: s.id });
      if (!error && data && s.estado === "borrador") s.contenido = data;
      solP.abierto = { id: s.id, tipo: "vista" };
      pintarDetalle();
      break;
    }
    case "confirmar-servicio": {
      if (!(await guardarSiHayCambios())) return;
      const act = app.actual.actividades.find((x) => x.id === Number(btn.dataset.act));
      const saldo = typeof saldoServicio === "function" ? saldoServicio(act) : 0;
      const nombre = servicioPorId(act?.servicio_id)?.nombre ?? "el servicio";
      const forma = typeof textoFormaPago === "function" ? textoFormaPago(act) : "";
      const texto = saldo > 0.005
        ? `Atención: ${nombre} ${pagadoServicio(act) > 0 ? `tiene un saldo pendiente de ${dinero(saldo)}` : `no tiene pago (${dinero(saldo)})`}. Forma de pago acordada: ${forma}.\n\n¿Confirmar el servicio de todos modos? Se generará su código R y quedará anotado en el historial.`
        : `¿Confirmar ${nombre}? Se generará su código R.`;
      if (!confirm(texto)) return;
      await conBoton(btn, async () => {
        const { data, error } = await db.rpc("confirmar_servicio", {
          p_actividad: act.id, p_nota: saldo > 0.005 ? `Advertencia mostrada: saldo pendiente del servicio ${dinero(saldo)} (${forma}); se confirmó de todos modos.` : null
        });
        if (error) return fallo(error, "No se pudo confirmar el servicio.");
        await recargarDetalle(false);
        cargarTablero();
        solP.abierto = { id: data.solicitud_id, tipo: "aviso" };
        pintarDetalle();
        avisar(`Servicio confirmado: ${data.codigo}. Envía la confirmación final al proveedor.`);
      });
      break;
    }

    case "aviso":
      solP.abierto = { id: s.id, tipo: "aviso" };
      pintarDetalle();
      break;

    case "aviso-correo":
      await conBoton(btn, async () => {
        btn.textContent = "Enviando…";
        const { data, error } = await db.functions.invoke("correo", { body: { accion: "solicitud_aviso", solicitud_id: s.id, enlace_base: location.href } });
        if (error || data?.error) return avisar(await errorFuncion(error, data), "error");
        solP.abierto = null;
        await recargarSolicitudes(`Aviso de ${s.codigo} enviado a ${data.para}.`);
      });
      break;

    case "aviso-whatsapp": {
      const k = contactoDe(s.operador_id);
      window.open(enlaceWhatsApp(k?.whatsapp, textoAviso(s)), "_blank", "noopener");
      if (!confirm(`¿Se envió el aviso de ${s.codigo} por WhatsApp?\n\nPresiona Aceptar solo después de presionar Enviar en WhatsApp.`)) return;
      await conBoton(btn, async () => {
        const { error } = await db.rpc("marcar_aviso_enviado", { p_id: s.id, p_medio: "whatsapp", p_nota: null });
        if (error) return fallo(error, "No se pudo registrar el aviso.");
        solP.abierto = null;
        await recargarSolicitudes(`Aviso de ${s.codigo} registrado como enviado por WhatsApp.`);
      });
      break;
    }

    case "aviso-otro": {
      const nota = prompt(`¿Cómo le avisaste al proveedor de ${s.codigo}? (por ejemplo: "Llamada a Bryan, 29 oct 9:00")`)?.trim();
      if (!nota) return;
      await conBoton(btn, async () => {
        const { error } = await db.rpc("marcar_aviso_enviado", { p_id: s.id, p_medio: "otro", p_nota: nota });
        if (error) return fallo(error, "No se pudo registrar el aviso.");
        solP.abierto = null;
        await recargarSolicitudes("Aviso registrado.");
      });
      break;
    }

    case "registro":
    case "mensaje":
      solP.abierto = { id: s.id, tipo: btn.dataset.solp };
      pintarDetalle();
      break;
    case "cerrar":
      solP.abierto = null;
      pintarDetalle();
      break;

    case "ver-correo": return abrirCorreoProveedor(s);
    case "editar":
      solP.abierto = { id: s.id, tipo: "editar" };
      pintarDetalle();
      break;
    case "guardar-edicion": return guardarEdicionSolicitud(btn, s);
    case "ver-pagina": {
      // La página del proveedor en modo vista previa (los botones no responden)
      const w = window.open(enlaceProveedor(s) + "&vista=1", "_blank");
      if (!w) avisar("El navegador bloqueó la pestaña nueva. Permite las ventanas emergentes para este sitio.", "error");
      break;
    }

    case "copiar":
      try { await navigator.clipboard.writeText(enlaceProveedor(s)); avisar("Enlace del proveedor copiado."); }
      catch { prompt("Copia el enlace del proveedor:", enlaceProveedor(s)); }
      break;

    case "enviar-correo":
      await conBoton(btn, async () => {
        btn.textContent = "Enviando…";
        const { data, error } = await db.functions.invoke("correo", { body: { accion: "solicitud_enviar", solicitud_id: s.id, enlace_base: location.href } });
        if (error || data?.error) return avisar(await errorFuncion(error, data), "error");
        solP.abierto = null;
        await recargarSolicitudes(`Solicitud ${s.codigo} enviada a ${data.para}.`);
        abrirSiguienteBorrador();
      });
      break;

    case "enviar-whatsapp": {
      const k = contactoDe(s.operador_id);
      window.open(enlaceWhatsApp(k?.whatsapp, textoWhatsApp(s, s.aviso === "modificacion" ? `MODIFICACIÓN (versión ${s.version}): hubo cambios, por favor confirme de nuevo.` : "")), "_blank", "noopener");
      if (!confirm(`¿Se envió el mensaje de la solicitud ${s.codigo} por WhatsApp?\n\nPresiona Aceptar solo después de presionar Enviar en WhatsApp.`)) return;
      await conBoton(btn, async () => {
        const { error } = await db.rpc("marcar_solicitud_enviada", { p_id: s.id, p_medio: "whatsapp" });
        if (error) return fallo(error, "No se pudo registrar el envío.");
        solP.abierto = null;
        await recargarSolicitudes(`Solicitud ${s.codigo} registrada como enviada por WhatsApp.`);
        abrirSiguienteBorrador();
      });
      break;
    }

    case "guardar-registro": {
      const panel = btn.closest(".sol-panel");
      const v = (k) => panel.querySelector(`[data-reg="${k}"]`).value.trim();
      if (!v("nombre")) return avisar("Escribe el nombre de la persona del proveedor que respondió.", "error");
      if (!v("motivo")) return avisar("Escribe el motivo por el que registras la respuesta.", "error");
      if (v("respuesta") === "revisar" && !v("nota")) return avisar("Escribe la nota: qué indicó el proveedor que hay que revisar.", "error");
      await conBoton(btn, async () => {
        const { error } = await db.rpc("registrar_respuesta_solicitud", {
          p_id: s.id, p_respuesta: v("respuesta"), p_nombre: v("nombre"), p_medio: v("medio"),
          p_fecha: v("fecha") ? new Date(v("fecha")).toISOString() : null, p_motivo: v("motivo"),
          p_numero: v("numero") || null, p_nota: v("nota") || null
        });
        if (error) return fallo(error, "No se pudo registrar la respuesta.");
        solP.abierto = null;
        await recargarSolicitudes("Respuesta del proveedor registrada.");
      });
      break;
    }

    case "nueva-version":
      if (!(await guardarSiHayCambios())) return;
      if (!confirm(`¿Crear una nueva versión de ${s.codigo} con los datos actuales de la actividad? El proveedor deberá responder de nuevo.`)) return;
      await conBoton(btn, async () => {
        const { error } = await db.rpc("nueva_version_solicitud", { p_id: s.id });
        if (error) return fallo(error, "No se pudo crear la nueva versión.");
        await recargarDetalle(false);
        solP.abierto = { id: s.id, tipo: "vista" };
        pintarDetalle();
        avisar(`Nueva versión de ${s.codigo} lista. Revisa la vista previa y envíala.`);
      });
      break;

    case "enviar-mensaje": {
      const texto = document.querySelector(`[data-solp-texto="${s.id}"]`).value.trim();
      const medio = document.querySelector(`[data-solp-medio="m${s.id}"]`).value;
      if (!texto) return avisar("Escribe el mensaje.", "error");
      const k = contactoDe(s.operador_id);
      if (medio === "whatsapp" && !k?.whatsapp) return avisar("Este proveedor no tiene WhatsApp registrado.", "error");
      await conBoton(btn, async () => {
        const { data, error } = await db.functions.invoke("correo", {
          body: { accion: "solicitud_mensaje", solicitud_id: s.id, texto, medio, enlace_base: location.href }
        });
        if (error || data?.error) return avisar(await errorFuncion(error, data), "error");
        if (medio === "whatsapp") {
          window.open(enlaceWhatsApp(k.whatsapp, `Mensaje sobre ${s.codigo} (The House of Tours):\n${texto}\n\nVer y responder: ${enlaceProveedor(s)}`), "_blank", "noopener");
        }
        solP.abierto = null;
        await recargarSolicitudes(medio === "correo" ? "Mensaje enviado al proveedor por correo." : "Mensaje guardado. Envíalo en el chat de WhatsApp que se abrió.");
      });
      break;
    }
  }
});

// Vuelve a leer solo las solicitudes P (por ejemplo, después de eliminar un servicio)
async function recargarSoloSolicitudes() {
  if (!app.actual) return;
  const sp = await db.from("solicitudes_proveedor").select("*").eq("cotizacion_id", app.actual.cot.id).order("id");
  if (sp.error) return;
  app.actual.solicitudesP = sp.data;
  const ev = sp.data.length ? await db.from("solicitud_eventos").select("*").in("solicitud_id", sp.data.map((x) => x.id)).order("id") : { data: [] };
  app.actual.eventosP = ev.error ? [] : ev.data;
}

// Al guardar el itinerario de una reserva: prepara MODIFICACIONES y cancela solicitudes de proveedores reemplazados
async function revisarCambiosSolicitudes(c) {
  if (!(app.actual?.solicitudesP || []).length) return;
  const { data, error } = await db.rpc("revisar_cambios_solicitudes", { p_cotizacion: c.id });
  if (error) return console.error(error);
  const mods = (data || []).filter((x) => x.cambio === "modificacion").map((x) => x.codigo);
  const canc = (data || []).filter((x) => x.cambio === "cancelada").map((x) => x.codigo);
  const partes = [];
  if (mods.length) partes.push(`MODIFICACIÓN lista para enviar: ${mods.join(", ")}`);
  if (canc.length) partes.push(`Solicitud cancelada por cambio de proveedor: ${canc.join(", ")} (avisa la cancelación)`);
  if (partes.length) setTimeout(() => avisar(partes.join(". ") + "."), 400);
}

// Después de enviar una, abre la vista previa de la siguiente sin enviar
function abrirSiguienteBorrador() {
  const siguiente = (app.actual?.solicitudesP || []).find((x) => x.estado === "borrador");
  if (siguiente) { solP.abierto = { id: siguiente.id, tipo: "vista" }; pintarDetalle(); }
}
