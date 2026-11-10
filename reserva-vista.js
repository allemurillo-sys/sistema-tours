// =====================================================
// REDISEÑO DE RESERVAS (nov 2026)
// - Cada servicio: fila compacta + resumen en palabras simples + "Falta en este servicio"
//   + 4 secciones-pregunta (¿Qué y cuándo? ¿Quiénes y cuánto? ¿Cómo llegan? ¿Cómo paga?)
// - Detalle: barra de avance y caja "Lo que falta" con botones que llevan a cada parte
// - Tablero: mini barras de avance, siguiente paso y filtro "Solo las que requieren acción"
// (usa las utilidades y datos de panel.js y proveedores.js)
// =====================================================

const vistaRes = {
  abiertas: new Set(),   // servicios desplegados (clave del servicio)
  pasos: new Map(),      // clave del servicio → Set con las secciones abiertas
  soloAccion: false,     // filtro del tablero
  avance: new Map()      // cotizacion_id → actividades resumidas (para el tablero)
};

const claveAct = (a, idx) => (a.id ? `id${a.id}` : `n${idx}`);
const hoyRv = () => aTexto(new Date());

// ---------- Textos en palabras simples ----------
function nombrePersonas(nombre, n) {
  const t = String(nombre || "persona").toLowerCase();
  if (n === 1) return t;
  const corte = new Set(["de", "del", "con", "sin", "en", "y"]);
  let parar = false;
  return t.split(" ").map((w) => {
    if (parar || corte.has(w) || /\d/.test(w)) { parar = true; return w; }
    if (/[aeiouáéíóú]$/.test(w)) return w + "s";
    if (/z$/.test(w)) return w.slice(0, -1) + "ces";
    return w + "es";
  }).join(" ");
}

function personasTexto(a) {
  const partes = a.participantes.filter((p) => p.cantidad > 0)
    .map((p) => `${p.cantidad} ${nombrePersonas(categoriaPorId(p.categoria_id)?.nombre, p.cantidad)}`);
  if (!partes.length) return "Sin personas";
  return partes.length === 1 ? partes[0] : `${partes.slice(0, -1).join(", ")} y ${partes[partes.length - 1]}`;
}
const totalPersonas = (a) => a.participantes.reduce((s, p) => s + (p.cantidad || 0), 0);

const NOMBRE_TARIFA = { tc: "precio con tarjeta (TC)", cash: "precio en efectivo", manual: "precio escrito a mano", pendiente: "sin tarifa" };

function resumenPaso(a, n) {
  const serv = servicioPorId(a.servicio_id);
  if (n === 1) {
    const horas = a.hora_inicio ? `${a.hora_inicio}${a.hora_fin ? " a " + a.hora_fin : ""}` : "";
    return [serv?.nombre, a.fecha ? fecha(a.fecha, { weekday: "short", day: "numeric", month: "short" }) : "", horas].filter(Boolean).join(" · ") || "Sin elegir";
  }
  if (n === 2) return `${personasTexto(a)} · ${dinero(subtotalPersonas(a))} · ${NOMBRE_TARIFA[a.tarifa_tipo] || "precio escrito a mano"}`;
  if (n === 3) {
    if (a.transporte_modo === "sin_transporte") return "No lleva transporte: llegan por su cuenta";
    const recoge = a.lugar_recogida ? ` · recogen${a.hora_recogida ? " a las " + a.hora_recogida : ""} en ${a.lugar_recogida}` : "";
    if (a.transporte_modo === "incluido") return `Incluido en el precio${recoge}`;
    const resp = a.transporte_respuesta === "si" ? "sí lo quiere" : a.transporte_respuesta === "no" ? "no lo quiere" : "el cliente no ha respondido";
    return `Opcional${Number(a.transporte_costo) > 0 ? ` (${dinero(a.transporte_costo)})` : " (sin costo)"} · ${resp}`;
  }
  const partes = [a.forma_pago === "oficina" ? "Paga en la oficina" : "Prepago"];
  if (a.pago_limite) partes[0] += ` antes del ${fecha(a.pago_limite)}`;
  const enReserva = ["reserva", "finalizado"].includes(app.actual?.cot?.estado);
  if (enReserva && a.id) partes.push(saldoServicio(a) > 0.005 ? `falta ${dinero(saldoServicio(a))}` : "pagado");
  const mensajesN = [a.notas, a.notas_proveedor].filter((x) => String(x || "").trim()).length;
  if (mensajesN) partes.push(`${mensajesN} ${mensajesN === 1 ? "mensaje" : "mensajes"}`);
  return partes.join(" · ");
}

// Lo que le falta a un servicio. paso 1-4 = sección de la tarjeta; ir = sección del detalle
function faltasServicio(a) {
  const f = [];
  if (!a.servicio_id) return [{ paso: 1, texto: "Elige la actividad." }];
  if (!a.fecha) f.push({ paso: 1, texto: "Falta el día." });
  if (!a.hora_inicio) f.push({ paso: 1, texto: "Falta la hora de inicio." });
  if (!a.operador_id) f.push({ paso: 1, texto: "Falta elegir el proveedor (solo oficina)." });

  const pers = totalPersonas(a);
  if (!pers) f.push({ paso: 2, texto: "No hay personas en este servicio." });
  if (a.tarifa_tipo === "pendiente") f.push({ paso: 2, texto: "No hay tarifa para esa fecha: pregúntale el precio al proveedor y escríbelo (Manual)." });
  else if (pers && a.participantes.some((p) => p.cantidad > 0 && !(p.precio_unitario > 0))) f.push({ paso: 2, texto: "Hay personas sin precio." });

  const lleva = a.transporte_modo === "incluido" || (a.transporte_modo === "opcional" && a.transporte_respuesta === "si");
  if (lleva && !String(a.lugar_recogida || "").trim()) f.push({ paso: 3, texto: "Falta dónde lo recogen." });
  if (lleva && !a.hora_recogida) f.push({ paso: 3, texto: "Falta la hora en que lo recogen." });
  if (transportePendiente(a)) f.push({ paso: 3, texto: "El cliente no ha dicho si quiere transporte." });

  const c = app.actual?.cot;
  if (c?.estado === "reserva" && a.id && a.estado_servicio !== "cancelado") {
    if (a.pago_limite && a.pago_limite < hoyRv() && saldoServicio(a) > 0.005) {
      f.push({ paso: 4, texto: `Venció la fecha límite de pago (${fecha(a.pago_limite)}) y falta ${dinero(saldoServicio(a))}.` });
    }
    const st = a.estado_servicio;
    const ir = { ir: "#secSolicitudes", boton: "Ir a solicitudes" };
    if (st === "por_solicitar") f.push({ ...ir, texto: "Falta pedirlo al proveedor." });
    if (st === "revisar") f.push({ ...ir, texto: "El proveedor pide revisar algo." });
    if (st === "sin_disponibilidad") f.push({ ...ir, texto: "El proveedor no tiene disponibilidad: cambia la fecha o el proveedor." });
    if (st === "cotizando" && typeof solicitudDeActividad === "function") {
      const s = solicitudDeActividad(a.id);
      const horas = s?.enviada_en ? Math.floor((Date.now() - new Date(s.enviada_en)) / 36e5) : 0;
      if (horas >= 24) f.push({ ...ir, boton: "Reenviar", texto: `El proveedor no responde desde hace ${horas} h.` });
    }
  }
  return f;
}

// ---------- Tarjeta de servicio ----------
function chipRv(texto, tono) { return `<span class="rv-chip ${tono}">${escapar(texto)}</span>`; }

function htmlFilaActividad(a, idx, faltas = faltasServicio(a)) {
  const serv = servicioPorId(a.servicio_id);
  const c = app.actual.cot;
  const abierta = actAbierta(a, idx);
  const chips = [];
  if (a._pendiente) chips.push(chipRv(a.id ? "Cambios sin guardar" : "Nuevo · sin guardar", "espera"));
  const datos = faltas.filter((x) => x.paso).length;
  if (c.estado === "reserva" && a.id) {
    const st = a.estado_servicio || "por_solicitar";
    const txt = (typeof ESTADO_SERVICIO !== "undefined" && ESTADO_SERVICIO[st]?.[0]) || st;
    const tono = st === "confirmado" ? "ok" : ["revisar", "sin_disponibilidad"].includes(st) ? "falta" : st === "cancelado" ? "neutro" : "espera";
    chips.push(chipRv(`Proveedor: ${txt}${st === "confirmado" && a.codigo_reserva ? " · " + a.codigo_reserva : ""}`, tono));
    if (st !== "cancelado") {
      const saldo = saldoServicio(a);
      chips.push(saldo > 0.005 ? chipRv(`Falta cobrar ${dinero(saldo)}`, "espera") : chipRv("Pagado", "ok"));
      if (st === "confirmado") chips.push(a.voucher_habilitado ? chipRv("Tiquete visible", "ok") : chipRv("Tiquete sin habilitar", "neutro"));
    }
  }
  if (datos) chips.push(chipRv(datos === 1 ? "Falta 1 dato" : `Faltan ${datos} datos`, "falta"));
  else if (c.estado !== "reserva" && a.servicio_id) chips.push(chipRv("Completo", "ok"));

  return `
    <button type="button" class="act-fila" data-rv="abrir-act" aria-expanded="${abierta}">
      <span class="act-fila-cuando"><strong>${escapar(a.hora_inicio || "--:--")}</strong><small>${a.fecha ? escapar(fecha(a.fecha, { weekday: "short", day: "numeric", month: "short" })) : "Sin día"}</small></span>
      <span class="act-fila-que"><strong>${escapar(serv?.nombre ?? "Servicio nuevo: elige la actividad")}</strong><small>${escapar(personasTexto(a))} · ${escapar(resumenPaso(a, 3))}</small></span>
      <span class="act-fila-chips">${chips.join("")}</span>
      <span class="act-fila-total">${dinero(subtotal(a))}</span>
      <span class="act-fila-flecha" aria-hidden="true">${abierta ? "▴" : "▾"}</span>
    </button>`;
}

function htmlExplicaServicio(a) {
  const serv = servicioPorId(a.servicio_id);
  if (!serv) return `<p>Elige la actividad para empezar.</p>`;
  const pers = totalPersonas(a);
  let s = `<strong>${escapar(personasTexto(a))}</strong> ${pers === 1 ? "va" : "van"} `;
  s += a.fecha ? `el <strong>${escapar(fecha(a.fecha, { weekday: "long", day: "numeric", month: "long" }))}</strong>` : "(falta el día)";
  if (a.hora_inicio) s += `, de <strong>${escapar(a.hora_inicio)}${a.hora_fin ? " a " + escapar(a.hora_fin) : ""}</strong>`;
  s += `. Se le cobra al cliente <strong>${dinero(subtotal(a))}</strong>`;
  if (transportePendiente(a) && Number(a.transporte_costo) > 0) s += ` (más ${dinero(a.transporte_costo)} si quiere transporte)`;
  s += ".";
  const op = nombreOperador(a.operador_id);
  const costos = puede("ver_utilidad") ? `, nos cobra ${dinero(costoNeto(a))}, ganancia ${dinero(subtotal(a) - costoNeto(a))}` : "";
  return `<p>${s}</p><p class="act-explica-oficina">Solo oficina: ${op ? `lo opera ${escapar(op)}` : "todavía sin proveedor"}${costos}.</p>`;
}

function htmlFaltasServicio(faltas) {
  if (!faltas.length) return "";
  return `
    <div class="act-faltas">
      <strong>Falta en este servicio (${faltas.length})</strong>
      <ul>${faltas.map((x) => `
        <li><span>${escapar(x.texto)}</span>
          ${x.paso ? `<button type="button" class="btn chico" data-rv="ir-paso" data-paso="${x.paso}">Ir a completarlo</button>`
            : x.ir ? `<button type="button" class="btn chico" data-rv="ir" data-ir="${x.ir}">${escapar(x.boton || "Ver")}</button>` : ""}</li>`).join("")}
      </ul>
    </div>`;
}

function actAbierta(a, idx) {
  return !a.id || vistaRes.abiertas.has(claveAct(a, idx));
}

function htmlPasoAct(a, idx, n, titulo, cuerpo, faltas) {
  const f = faltas.filter((x) => x.paso === n);
  const guardado = vistaRes.pasos.get(claveAct(a, idx));
  const abierto = guardado ? guardado.has(n) : (f.length > 0 || (!a.id && n === 1));
  return `
    <details class="act-paso" data-paso="${n}" ${abierto ? "open" : ""}>
      <summary class="act-paso-cab">
        <span class="act-num ${f.length ? "falta" : !a.servicio_id && n > 1 ? "neutro" : "ok"}" aria-hidden="true">${n}</span>
        <span class="act-paso-txt"><span class="act-paso-tit">${titulo}</span><span class="act-paso-res">${escapar(resumenPaso(a, n))}</span></span>
        ${htmlChipPaso(f, a, n)}
      </summary>
      <div class="act-paso-cuerpo">${cuerpo}</div>
    </details>`;
}
const htmlChipPaso = (f, a, n) => f.length ? chipRv(f.length === 1 ? "Falta 1 dato" : `Faltan ${f.length}`, "falta")
  : !a.servicio_id && n > 1 ? chipRv("Primero elige la actividad", "neutro") : chipRv("Completo", "ok");

function htmlCostosAct(a) {
  const cliente = `<div><span>Paga el cliente${transporteCobrado(a) ? " (con transporte)" : ""}</span><strong>${dinero(subtotal(a))}</strong></div>`;
  if (!puede("ver_utilidad")) return cliente;
  const costo = costoNeto(a);
  return `${cliente}
    <div class="oficina"><span>Costo del proveedor</span><strong>${dinero(costo)}</strong></div>
    <div class="oficina"><span>Ganancia</span><strong>${dinero(subtotal(a) - costo)}</strong></div>`;
}

// Al escribir: actualiza fila, resumen, faltas y encabezados de sección sin repintar los campos
function refrescarActividad(card, a) {
  const idx = Number(card.dataset.idx);
  const faltas = faltasServicio(a);
  const fila = card.querySelector(".act-fila");
  if (fila) fila.outerHTML = htmlFilaActividad(a, idx, faltas);
  const exp = card.querySelector(".act-explica");
  if (exp) exp.innerHTML = htmlExplicaServicio(a);
  const caja = card.querySelector(".act-faltas-caja");
  if (caja) caja.innerHTML = htmlFaltasServicio(faltas);
  card.querySelectorAll(".act-paso").forEach((d) => {
    const n = Number(d.dataset.paso);
    const f = faltas.filter((x) => x.paso === n);
    d.querySelector(".act-paso-res").textContent = resumenPaso(a, n);
    d.querySelector(".act-num").className = `act-num ${f.length ? "falta" : !a.servicio_id && n > 1 ? "neutro" : "ok"}`;
    const chip = d.querySelector("summary > .rv-chip");
    if (chip) chip.outerHTML = htmlChipPaso(f, a, n);
  });
  const costos = card.querySelector(".act-costos");
  if (costos) costos.innerHTML = htmlCostosAct(a);
}

// Itinerario agrupado por día (cada tarjeta conserva su posición en la lista: data-idx)
function htmlListaPorDia(actividades) {
  const orden = actividades.map((a, idx) => ({ a, idx }))
    .sort((x, y) => (x.a.fecha || "9999") .localeCompare(y.a.fecha || "9999") || (x.a.hora_inicio || "").localeCompare(y.a.hora_inicio || "") || x.idx - y.idx);
  let dia = null, h = "";
  for (const { a, idx } of orden) {
    const d = a.fecha || "";
    if (d !== dia) {
      dia = d;
      h += `<h4 class="act-dia">${d ? escapar(fecha(d, { weekday: "long", day: "numeric", month: "long" })) : "Sin día"}</h4>`;
    }
    h += htmlActividad(a, idx);
  }
  return h;
}

// ---------- Avance y "Lo que falta" del detalle ----------
function pendientesReserva(c) {
  const lista = [];
  const acts = app.actual.actividades;
  acts.forEach((a, idx) => {
    const nombre = servicioPorId(a.servicio_id)?.nombre ?? "Servicio nuevo";
    faltasServicio(a).forEach((x) => lista.push({ ...x, idx, nombre, tono: x.paso ? "falta" : "espera" }));
  });
  if (acts.some((a) => a._pendiente)) lista.unshift({ texto: "Hay cambios sin guardar en el itinerario.", accion: "guardar-todo", boton: "Guardar cambios", tono: "espera" });

  if (c.estado === "proceso") {
    const datos = lista.filter((x) => x.paso).length;
    if (!acts.length) lista.push({ texto: "Todavía no hay servicios en el itinerario.", ir: "#secItinerario", boton: "Ir al itinerario", tono: "falta" });
    else if (!c.enviada_en && !datos) lista.push({ texto: "Todo está completo: prepárala y envíasela al cliente.", ir: "#secEnvio", boton: "Ir a enviar", tono: "espera" });
    else if (c.enviada_en) lista.push({ texto: "Esperando que el cliente confirme. Si ya aceptó por teléfono o WhatsApp, confírmala en su nombre.", ir: "#secEnvio", boton: "Ver envío", tono: "neutro" });
  }
  if (c.estado === "reserva") {
    const avisos = (app.actual.solicitudesP || []).filter((s) => s.estado === "borrador" || s.aviso).length;
    if (avisos) lista.push({ texto: `${avisos} ${avisos === 1 ? "solicitud o aviso" : "solicitudes o avisos"} por enviar a proveedores.`, ir: "#secSolicitudes", boton: "Ir a solicitudes", tono: "falta" });
    const saldo = saldoActual();
    if (saldo > 0.005) lista.push({ texto: `Falta cobrar ${dinero(saldo)} de esta reserva.`, ir: "#secPagos", boton: "Ir a pagos", tono: "espera" });
    if (c.reserva_confirmada_en) {
      const listos = acts.filter((a) => a.id && a.estado_servicio === "confirmado" && !a.voucher_habilitado).length;
      if (listos) lista.push({ texto: `${listos} ${listos === 1 ? "tiquete está listo" : "tiquetes están listos"} para habilitar.`, ir: "#secTiquetes", boton: "Ir a tiquetes", tono: "espera" });
    }
  }
  return lista;
}

function htmlBarraPaso(titulo, hecho, total, texto) {
  const pct = total ? Math.round((hecho / total) * 100) : 0;
  const listo = total > 0 && hecho >= total;
  return `
    <li class="rv-paso${listo ? " listo" : ""}">
      <span class="rv-paso-tit">${listo ? "✓ " : ""}${titulo}</span>
      <span class="rv-pista"><span style="width:${Math.min(100, pct)}%"></span></span>
      <span class="rv-paso-txt">${texto}</span>
    </li>`;
}

function htmlAvanceDetalle(c) {
  if (!["proceso", "reserva"].includes(c.estado)) return "";
  const acts = app.actual.actividades.filter((a) => a.estado_servicio !== "cancelado");
  const conDatos = acts.filter((a) => !faltasServicio(a).some((x) => x.paso)).length;
  let pasos = htmlBarraPaso("Itinerario", conDatos, acts.length || 1,
    !acts.length ? "Sin servicios" : conDatos === acts.length ? `${acts.length} ${acts.length === 1 ? "servicio completo" : "servicios completos"}` : `${acts.length - conDatos} con datos por completar`);

  if (c.estado === "proceso") {
    pasos += htmlBarraPaso("Enviada al cliente", c.enviada_en ? 1 : 0, 1, c.enviada_en ? `El ${fechaHora(c.enviada_en)}` : "Sin enviar");
    pasos += htmlBarraPaso("Cliente confirma", 0, 1, c.enviada_en ? "Esperando respuesta" : "Después de enviarla");
  } else {
    pasos += htmlBarraPaso("Cliente confirmó", 1, 1, c.confirmada_en ? `El ${fecha(c.confirmada_en)}` : "Listo");
    const guardados = acts.filter((a) => a.id);
    const conf = guardados.filter((a) => a.estado_servicio === "confirmado").length;
    pasos += htmlBarraPaso("Proveedores", conf, guardados.length, `${conf} de ${guardados.length} confirmados`);
    const total = app.actual.actividades.reduce((s, a) => s + subtotal(a), 0);
    const pagado = app.actual.pagos.reduce((s, p) => s + Number(p.monto), 0);
    pasos += htmlBarraPaso("Pagos", Math.min(pagado, total), total, `${dinero(pagado)} de ${dinero(total)}`);
    const tiq = guardados.filter((a) => a.voucher_habilitado).length;
    pasos += htmlBarraPaso("Tiquetes", tiq, guardados.length, `${tiq} de ${guardados.length} habilitados`);
  }

  const lista = pendientesReserva(c);
  const visibles = lista.slice(0, 8);
  const boton = (x) => x.accion ? `<button type="button" class="btn chico primario" data-accion="${x.accion}">${escapar(x.boton)}</button>`
    : x.paso ? `<button type="button" class="btn chico" data-rv="ver-act" data-idx="${x.idx}" data-paso="${x.paso}">Completar</button>`
    : x.idx != null && x.ir ? `<button type="button" class="btn chico" data-rv="ir" data-ir="${x.ir}">${escapar(x.boton || "Ver")}</button>`
    : x.ir ? `<button type="button" class="btn chico" data-rv="ir" data-ir="${x.ir}">${escapar(x.boton || "Ver")}</button>` : "";
  const reales = lista.filter((x) => x.tono !== "neutro").length;

  return `
    <section class="det-seccion rv-avance">
      <ol class="rv-pasos" aria-label="Avance">${pasos}</ol>
      <div class="rv-falta${reales ? "" : " vacio"}">
        <h3>${reales ? `Lo que falta <span class="rv-chip espera">${reales}</span>` : "Todo al día"}</h3>
        ${lista.length ? `<ul>${visibles.map((x) => `
          <li class="${x.tono}"><span>${x.nombre ? `<strong>${escapar(x.nombre)}:</strong> ` : ""}${escapar(x.texto)}</span>${boton(x)}</li>`).join("")}</ul>` : `<p class="nota">No hay pendientes en esta ${c.estado === "reserva" ? "reserva" : "cotización"}.</p>`}
        ${lista.length > visibles.length ? `<p class="nota">Y ${lista.length - visibles.length} más en las tarjetas de los servicios.</p>` : ""}
      </div>
    </section>`;
}

// Vuelve a dibujar la barra de avance y "Lo que falta" (se llama desde pintarTotales)
function refrescarAvance() {
  const av = document.querySelector("#detalleContenido .rv-avance");
  if (av && app.actual) av.outerHTML = htmlAvanceDetalle(app.actual.cot);
}

// ---------- Eventos del detalle ----------
function abrirTarjeta(card, abrir = true) {
  const idx = Number(card.dataset.idx);
  const a = app.actual.actividades[idx];
  const clave = claveAct(a, idx);
  if (abrir) vistaRes.abiertas.add(clave); else vistaRes.abiertas.delete(clave);
  card.classList.toggle("abierta", abrir);
  card.querySelector(".act-cuerpo").hidden = !abrir;
  const fila = card.querySelector(".act-fila");
  fila.setAttribute("aria-expanded", String(abrir));
  fila.querySelector(".act-fila-flecha").textContent = abrir ? "▴" : "▾";
}

function irAPaso(card, n) {
  abrirTarjeta(card, true);
  const d = card.querySelector(`.act-paso[data-paso="${n}"]`);
  if (!d) return;
  d.open = true;
  d.scrollIntoView({ behavior: "smooth", block: "start" });
  setTimeout(() => d.querySelector(".act-paso-cuerpo input, .act-paso-cuerpo select")?.focus({ preventScroll: true }), 350);
}

$("detalleContenido").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-rv]");
  if (!btn) return;
  const card = btn.closest(".actividad");
  switch (btn.dataset.rv) {
    case "abrir-act": abrirTarjeta(card, !card.classList.contains("abierta")); break;
    case "ir-paso": irAPaso(card, Number(btn.dataset.paso)); break;
    case "ver-act": {
      const destino = document.querySelector(`.actividad[data-idx="${btn.dataset.idx}"]`);
      if (destino) irAPaso(destino, Number(btn.dataset.paso));
      break;
    }
    case "ir": document.querySelector(btn.dataset.ir)?.scrollIntoView({ behavior: "smooth", block: "start" }); break;
  }
});

// Recuerda qué secciones abrió el agente (para que no se cierren al repintar la tarjeta)
document.addEventListener("toggle", (e) => {
  const d = e.target;
  if (!d.matches?.(".act-paso")) return;
  const card = d.closest(".actividad[data-idx]");
  if (!card || !app.actual) return;
  const idx = Number(card.dataset.idx);
  const a = app.actual.actividades[idx];
  if (!a) return;
  const clave = claveAct(a, idx);
  const set = vistaRes.pasos.get(clave) || new Set([...card.querySelectorAll(".act-paso[open]")].map((x) => Number(x.dataset.paso)));
  if (d.open) set.add(Number(d.dataset.paso)); else set.delete(Number(d.dataset.paso));
  vistaRes.pasos.set(clave, set);
}, true);

document.addEventListener("detalle-abierto", () => { vistaRes.abiertas.clear(); vistaRes.pasos.clear(); });

// ---------- Tablero ----------
async function cargarAvanceTablero() {
  const ids = app.cotizaciones.filter((c) => ["proceso", "reserva"].includes(c.estado)).map((c) => c.id);
  vistaRes.avance = new Map();
  if (!ids.length) return;
  const { data, error } = await db.from("actividades")
    .select("cotizacion_id, estado_servicio, voucher_habilitado, tarifa_tipo").in("cotizacion_id", ids);
  if (error) return;
  data.forEach((a) => {
    if (!vistaRes.avance.has(a.cotizacion_id)) vistaRes.avance.set(a.cotizacion_id, []);
    vistaRes.avance.get(a.cotizacion_id).push(a);
  });
}

function siguientePaso(c) {
  const acts = (vistaRes.avance.get(c.id) || []).filter((a) => a.estado_servicio !== "cancelado");
  const opciones = [];
  if (c.estado === "cotizacion") {
    const horas = (Date.now() - new Date(c.creado_en)) / 36e5;
    return { texto: "Siguiente: tomarla y armar el itinerario", tono: horas > 24 ? "falta" : "espera" };
  }
  if (c.cambios_pendientes) opciones.push({ texto: "El cliente pidió cambios", tono: "falta" });
  if (c.estado === "proceso") {
    const sinPrecio = acts.filter((a) => a.tarifa_tipo === "pendiente").length;
    if (!acts.length) opciones.push({ texto: "Siguiente: armar el itinerario", tono: "espera" });
    else if (sinPrecio) opciones.push({ texto: `${sinPrecio} ${sinPrecio === 1 ? "servicio" : "servicios"} sin precio`, tono: "falta" });
    else if (!c.enviada_en) opciones.push({ texto: "Siguiente: enviarla al cliente", tono: "espera" });
    else opciones.push({ texto: "Enviada · esperando al cliente", tono: "neutro" });
  }
  if (c.estado === "reserva") {
    const avisos = (app.codigosP || []).filter((x) => x.cotizacion_id === c.id && (x.aviso || x.estado === "borrador")).length;
    const revisar = acts.filter((a) => ["revisar", "sin_disponibilidad"].includes(a.estado_servicio)).length;
    const porPedir = acts.filter((a) => (a.estado_servicio || "por_solicitar") === "por_solicitar").length;
    const conf = acts.filter((a) => a.estado_servicio === "confirmado");
    if (revisar) opciones.push({ texto: `${revisar} ${revisar === 1 ? "servicio" : "servicios"}: el proveedor pide revisar`, tono: "falta" });
    if (avisos) opciones.push({ texto: `${avisos} ${avisos === 1 ? "aviso" : "avisos"} por enviar a proveedores`, tono: "falta" });
    if (porPedir) opciones.push({ texto: `${porPedir} ${porPedir === 1 ? "servicio" : "servicios"} por pedir al proveedor`, tono: "espera" });
    if (Number(c.balance) > 0.005) opciones.push({ texto: `Falta cobrar ${dinero(c.balance)}`, tono: "espera" });
    const sinTiq = conf.filter((a) => !a.voucher_habilitado).length;
    if (sinTiq && !porPedir && !revisar) opciones.push({ texto: `Habilitar ${sinTiq} ${sinTiq === 1 ? "tiquete" : "tiquetes"}`, tono: "espera" });
    if (!opciones.length) opciones.push(acts.some((a) => a.estado_servicio === "cotizando")
      ? { texto: "Esperando respuesta de proveedores", tono: "neutro" } : { texto: "Todo listo", tono: "ok" });
  }
  if (c.estado === "finalizado") return { texto: "Finalizada", tono: "ok" };
  if (c.estado === "cancelado") return { texto: "Cancelada", tono: "neutro" };
  const peso = { falta: 0, espera: 1, neutro: 2, ok: 3 };
  return opciones.sort((x, y) => peso[x.tono] - peso[y.tono])[0] || { texto: "", tono: "neutro" };
}

const requiereAccion = (c) => ["falta", "espera"].includes(siguientePaso(c).tono);

function htmlAvanceItem(c) {
  const sig = siguientePaso(c);
  let barras = "";
  if (c.estado === "reserva") {
    const acts = (vistaRes.avance.get(c.id) || []).filter((a) => a.estado_servicio !== "cancelado");
    const conf = acts.filter((a) => a.estado_servicio === "confirmado").length;
    const tiq = acts.filter((a) => a.voucher_habilitado).length;
    const total = Number(c.total) || 0;
    const pagado = Math.max(0, total - (Number(c.balance) || 0));
    const pct = total ? Math.round((pagado / total) * 100) : 0;
    const barra = (txt, p) => `<span class="rv-mini${p >= 100 ? " listo" : ""}"><span>${txt}</span><span class="rv-pista"><span style="width:${Math.min(100, p)}%"></span></span></span>`;
    barras = `<span class="rv-minis">${barra(`Proveed. ${conf}/${acts.length}`, acts.length ? (conf / acts.length) * 100 : 0)}${barra(`Pago ${pct} %`, pct)}${barra(`Tiquetes ${tiq}/${acts.length}`, acts.length ? (tiq / acts.length) * 100 : 0)}</span>`;
  }
  return `${barras}${sig.texto ? `<span class="rv-siguiente ${sig.tono}">${escapar(sig.texto)}</span>` : ""}`;
}

$("soloAccion")?.addEventListener("change", (e) => {
  vistaRes.soloAccion = e.target.checked;
  pintarTablero();
});

// Si el tablero se dibujó antes de que cargara este archivo, se vuelve a dibujar con el avance
if (app.cotizaciones?.length) cargarAvanceTablero().then(pintarTablero);
