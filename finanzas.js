// =====================================================
// VENTAS Y CUENTAS POR PAGAR (solo administrador)
// (usa las utilidades y datos de panel.js)
// =====================================================

VISTAS.finanzas = "vistaFinanzas";
const fin = {
  pestana: "ventas",
  cargado: false,
  cotizaciones: [], actividades: [], pagos: [], pagosProv: [],
  filtros: null,           // ventas: { desde, hasta, colaborador, operador }
  cxp: { operador: "", ver: "pendientes", hasta: "" },
  seleccion: new Set()     // ids de actividades marcadas para pagar
};
const finEsAdmin = () => app.yo?.rol === "administrador";
const hoyTexto = () => aTexto(new Date());

function finRevisarAcceso() {
  $("btnMenuFinanzas").hidden = !finEsAdmin();
  if (!finEsAdmin() && !$("vistaFinanzas").hidden) mostrarVista("reservas");
}
new MutationObserver(finRevisarAcceso).observe($("usuarioNombre"), { childList: true, characterData: true, subtree: true });
finRevisarAcceso();

document.addEventListener("vista-abierta", (e) => {
  if (e.detail !== "finanzas") return;
  if (!finEsAdmin()) return mostrarVista("reservas");
  finAbrir(true);
});
document.addEventListener("datos-actualizados", () => { if (!$("vistaFinanzas").hidden) finAbrir(true); });

document.querySelectorAll(".pestana[data-fin]").forEach((b) => b.addEventListener("click", () => {
  fin.pestana = b.dataset.fin;
  finPintar();
}));

// ---------- Carga (en bloques de 1000 filas) ----------
async function finTodo(consulta) {
  const filas = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await consulta().range(desde, desde + 999);
    if (error) throw error;
    filas.push(...data);
    if (data.length < 1000) return filas;
  }
}

async function finAbrir(recargar = false) {
  if (recargar || !fin.cargado) {
    $("finContenido").innerHTML = `<p class="nota">Cargando…</p>`;
    try {
      const [c, a, p, pp] = await Promise.all([
        finTodo(() => db.from("cotizaciones").select("id, numero, nombre, apellido, estado, colaborador_id, confirmada_en, reserva_confirmada_en, creado_en").in("estado", ["reserva", "finalizado", "cancelado"]).order("id")),
        finTodo(() => db.from("actividades").select("id, cotizacion_id, fecha, hora_inicio, servicio_id, operador_id, codigo_reserva, transporte_modo, transporte_costo, transporte_neto, transporte_respuesta, actividad_participantes(cantidad, precio_unitario, neto_unitario)").order("id")),
        finTodo(() => db.from("pagos").select("id, cotizacion_id, monto, fecha").order("id")),
        finTodo(() => db.from("pagos_proveedores").select("*").order("fecha").order("id"))
      ]);
      fin.cotizaciones = c; fin.actividades = a; fin.pagos = p; fin.pagosProv = pp;
      fin.cargado = true;
    } catch (error) {
      $("finContenido").innerHTML = "";
      return fallo(error, "No se pudieron cargar las ventas.");
    }
  }
  finPintar();
}

// ---------- Cálculos ----------
function finMontos(a) {
  const part = a.actividad_participantes || [];
  const rackP = part.reduce((s, p) => s + p.cantidad * Number(p.precio_unitario || 0), 0);
  const netoP = part.reduce((s, p) => s + p.cantidad * Number(p.neto_unitario || 0), 0);
  const conTransporte = a.transporte_modo === "opcional" && a.transporte_respuesta === true;
  const rackT = conTransporte ? Number(a.transporte_costo || 0) : 0;
  const netoT = conTransporte || a.transporte_modo === "incluido" ? Number(a.transporte_neto || 0) : 0;
  return { personas: part.reduce((s, p) => s + p.cantidad, 0), venta: rackP + rackT, neto: netoP + netoT };
}
const redondear = (n) => Math.round(n * 100) / 100;
const finCot = (id) => fin.cotizaciones.find((c) => c.id === id);
const fechaVenta = (c) => (c.confirmada_en || c.reserva_confirmada_en || c.creado_en || "").slice(0, 10);
const codigoDe = (a, c) => (a.codigo_reserva && c ? `${c.numero}-${a.codigo_reserva}` : c?.numero ?? "");

// Cada servicio de una reserva: lo que se le debe al proveedor y lo que ya se le pagó
function finCuentas() {
  const pagadoPor = new Map();
  fin.pagosProv.forEach((p) => { if (p.actividad_id) pagadoPor.set(p.actividad_id, (pagadoPor.get(p.actividad_id) || 0) + Number(p.monto)); });
  const items = [];
  for (const a of fin.actividades) {
    const c = finCot(a.cotizacion_id);
    if (!c) continue;
    const cancelada = c.estado === "cancelado";
    const pagado = redondear(pagadoPor.get(a.id) || 0);
    if (cancelada && !pagado) continue;
    const m = finMontos(a);
    const monto = cancelada ? 0 : redondear(m.neto);
    const saldo = redondear(monto - pagado);
    const estado = saldo < 0 ? "favor" : saldo === 0 ? (monto ? "pagado" : "sin-costo") : pagado > 0 ? "parcial" : "pendiente";
    items.push({ a, c, cancelada, personas: m.personas, monto, pagado, saldo, estado, operador_id: a.operador_id || 0 });
  }
  // Pagos de servicios que se eliminaron: quedan a favor
  fin.pagosProv.filter((p) => !p.actividad_id).forEach((p) => items.push({
    a: null, c: null, cancelada: true, eliminado: true, pago: p, personas: 0, monto: 0, pagado: Number(p.monto),
    saldo: -Number(p.monto), estado: "favor", operador_id: p.operador_id || 0
  }));
  return items;
}

const ESTADO_CXP = {
  pendiente: ["Pendiente", "alerta"], parcial: ["Parcial", "alerta"], pagado: ["Pagado", "ok"],
  favor: ["Saldo a favor", "favor"], "sin-costo": ["Sin costo", ""]
};

// ---------- Dibujo ----------
function finPintar() {
  document.querySelectorAll(".pestana[data-fin]").forEach((b) => {
    const activa = b.dataset.fin === fin.pestana;
    b.classList.toggle("activa", activa);
    b.setAttribute("aria-selected", activa);
  });
  $("finContenido").innerHTML = fin.pestana === "ventas" ? finHtmlVentas() : finHtmlCxp();
}

function finOpcionesOperador(sel, conTodos = "Todos los proveedores") {
  const usados = new Set(fin.actividades.map((a) => a.operador_id).filter(Boolean));
  fin.pagosProv.forEach((p) => p.operador_id && usados.add(p.operador_id));
  return `<option value="">${conTodos}</option>` + [...usados]
    .map((id) => ({ id, nombre: nombreOperador(id) || `Operador ${id}` }))
    .sort((x, y) => x.nombre.localeCompare(y.nombre))
    .map((o) => `<option value="${o.id}" ${String(sel) === String(o.id) ? "selected" : ""}>${escapar(o.nombre)}</option>`).join("");
}

function tarjeta(titulo, valor, extra = "") {
  return `<div class="fin-cifra ${extra}"><span>${titulo}</span><strong>${valor}</strong></div>`;
}

// ===== VENTAS =====
function finHtmlVentas() {
  const hoy = new Date();
  const f = fin.filtros ||= { desde: aTexto(new Date(hoy.getFullYear(), hoy.getMonth(), 1)), hasta: aTexto(hoy), colaborador: "", operador: "" };
  const op = f.operador ? Number(f.operador) : null;

  const filas = fin.cotizaciones
    .filter((c) => c.estado !== "cancelado")
    .filter((c) => { const d = fechaVenta(c); return d >= f.desde && d <= f.hasta; })
    .filter((c) => !f.colaborador || c.colaborador_id === f.colaborador)
    .map((c) => {
      const acts = fin.actividades.filter((a) => a.cotizacion_id === c.id && (!op || a.operador_id === op));
      const m = acts.reduce((s, a) => { const x = finMontos(a); s.venta += x.venta; s.neto += x.neto; return s; }, { venta: 0, neto: 0 });
      const cobrado = fin.pagos.filter((p) => p.cotizacion_id === c.id).reduce((s, p) => s + Number(p.monto), 0);
      return { c, acts: acts.length, venta: redondear(m.venta), neto: redondear(m.neto), cobrado: redondear(cobrado) };
    })
    .filter((r) => !op || r.acts)
    .sort((x, y) => fechaVenta(x.c).localeCompare(fechaVenta(y.c)));

  const t = filas.reduce((s, r) => ({ venta: s.venta + r.venta, neto: s.neto + r.neto, cobrado: s.cobrado + r.cobrado }), { venta: 0, neto: 0, cobrado: 0 });
  const colaboradores = [...new Set(fin.cotizaciones.map((c) => c.colaborador_id).filter(Boolean))];

  return `
    <div class="det-seccion sin-margen no-imprimir">
      <div class="fila-form">
        <label>Desde <input data-fin-filtro="desde" type="date" value="${f.desde}"></label>
        <label>Hasta <input data-fin-filtro="hasta" type="date" value="${f.hasta}"></label>
        <label>Colaborador
          <select data-fin-filtro="colaborador"><option value="">Todos</option>
            ${colaboradores.map((id) => `<option value="${id}" ${f.colaborador === id ? "selected" : ""}>${escapar(nombrePerfil(id) || "Usuario eliminado")}</option>`).join("")}
          </select></label>
        <label>Proveedor <select data-fin-filtro="operador">${finOpcionesOperador(f.operador)}</select></label>
        <button type="button" class="btn" data-fin-accion="imprimir">Imprimir</button>
      </div>
      <p class="nota">Reservas confirmadas en el período (fecha en que el cliente confirmó). No incluye las canceladas.${op ? " Con un proveedor elegido, vendido y costo son solo de sus servicios; el cobro es de toda la reserva." : ""}</p>
    </div>
    <div class="fin-cifras">
      ${tarjeta("Vendido", dinero(t.venta))}
      ${op ? "" : tarjeta("Cobrado", dinero(t.cobrado))}
      ${op ? "" : tarjeta("Balance por cobrar", dinero(t.venta - t.cobrado), t.venta - t.cobrado > 0.005 ? "alerta" : "")}
      ${tarjeta("Costo neto", dinero(t.neto))}
      ${tarjeta("Utilidad", dinero(t.venta - t.neto), "ok")}
      ${tarjeta("Reservas", filas.length)}
    </div>
    <div class="det-seccion sin-margen reporte">
      <p class="imp-marca solo-impresion">The House of Tours · Ventas del ${fecha(f.desde, { day: "numeric", month: "short", year: "numeric" })} al ${fecha(f.hasta, { day: "numeric", month: "short", year: "numeric" })}</p>
      ${filas.length ? `
      <div class="tabla-scroll">
        <table class="tabla fin-tabla">
          <thead><tr><th>Confirmada</th><th>Reserva</th><th>Cliente</th><th>Colaborador</th><th class="num">Vendido</th>${op ? "" : `<th class="num">Cobrado</th><th class="num">Balance</th>`}<th class="num">Costo neto</th><th class="num">Utilidad</th></tr></thead>
          <tbody>${filas.map((r) => `
            <tr>
              <td>${fecha(fechaVenta(r.c), { day: "numeric", month: "short", year: "numeric" })}</td>
              <td><button type="button" class="enlace" data-fin-accion="abrir" data-id="${r.c.id}">${escapar(r.c.numero)}</button>${r.c.estado === "finalizado" ? ` <small>finalizada</small>` : ""}</td>
              <td>${escapar(`${r.c.nombre} ${r.c.apellido}`)}</td>
              <td>${escapar(nombrePerfil(r.c.colaborador_id))}</td>
              <td class="num">${dinero(r.venta)}</td>
              ${op ? "" : `<td class="num">${dinero(r.cobrado)}</td><td class="num">${r.venta - r.cobrado > 0.005 ? `<strong>${dinero(r.venta - r.cobrado)}</strong>` : dinero(r.venta - r.cobrado)}</td>`}
              <td class="num">${dinero(r.neto)}</td>
              <td class="num">${dinero(r.venta - r.neto)}</td>
            </tr>`).join("")}
          </tbody>
          <tfoot><tr><th colspan="4">Total</th><th class="num">${dinero(t.venta)}</th>${op ? "" : `<th class="num">${dinero(t.cobrado)}</th><th class="num">${dinero(t.venta - t.cobrado)}</th>`}<th class="num">${dinero(t.neto)}</th><th class="num">${dinero(t.venta - t.neto)}</th></tr></tfoot>
        </table>
      </div>` : `<p class="nota">No hay reservas confirmadas en este período con esos filtros.</p>`}
    </div>`;
}

// ===== CUENTAS POR PAGAR =====
function finHtmlCxp() {
  const g = fin.cxp;
  const hoy = hoyTexto();
  const todos = finCuentas();
  const items = todos.filter((i) => !g.operador || String(i.operador_id) === String(g.operador));

  // La deuda nace el día del servicio
  const vencidos = items.filter((i) => i.eliminado || i.a.fecha <= hoy);
  const proximos = items.filter((i) => !i.eliminado && i.a.fecha > hoy && i.saldo > 0);
  const totalDeuda = redondear(vencidos.filter((i) => i.saldo > 0).reduce((s, i) => s + i.saldo, 0));
  const totalFavor = redondear(vencidos.filter((i) => i.saldo < 0).reduce((s, i) => s - i.saldo, 0));
  const totalProx = redondear(proximos.reduce((s, i) => s + i.saldo, 0));

  const visibles = g.ver === "todos" ? vencidos : vencidos.filter((i) => i.saldo !== 0);
  const porOper = new Map();
  visibles.forEach((i) => { if (!porOper.has(i.operador_id)) porOper.set(i.operador_id, []); porOper.get(i.operador_id).push(i); });
  const grupos = [...porOper.entries()]
    .map(([id, lista]) => ({ id, nombre: id ? nombreOperador(id) || `Operador ${id}` : "Sin operador asignado", lista: lista.sort((x, y) => (x.a?.fecha ?? "").localeCompare(y.a?.fecha ?? "")) }))
    .sort((x, y) => x.nombre.localeCompare(y.nombre));

  return `
    <div class="det-seccion sin-margen no-imprimir">
      <div class="fila-form">
        <label>Proveedor <select data-fin-cxp="operador">${finOpcionesOperador(g.operador)}</select></label>
        <label>Mostrar
          <select data-fin-cxp="ver">
            <option value="pendientes" ${g.ver === "pendientes" ? "selected" : ""}>Con saldo (pendientes, parciales y a favor)</option>
            <option value="todos" ${g.ver === "todos" ? "selected" : ""}>Todos, incluidos los pagados</option>
          </select></label>
        <button type="button" class="btn" data-fin-accion="imprimir">Imprimir</button>
      </div>
      <p class="nota">Cada servicio se vuelve deuda el día en que se brinda. Monto = neto × participantes + neto del transporte. Si una reserva se cancela, su deuda desaparece; lo que ya se había pagado queda como saldo a favor.</p>
    </div>
    <div class="fin-cifras">
      ${tarjeta("Por pagar hoy", dinero(totalDeuda), totalDeuda ? "alerta" : "")}
      ${tarjeta("Saldo a favor", dinero(totalFavor), totalFavor ? "favor" : "")}
      ${tarjeta("Próximos (aún no son deuda)", dinero(totalProx))}
    </div>
    ${grupos.length ? grupos.map(finHtmlGrupo).join("") : `<p class="nota">No hay cuentas ${g.ver === "todos" ? "" : "con saldo "}a la fecha.</p>`}
    ${proximos.length ? finHtmlProximos(proximos) : ""}`;
}

function finFilaServicio(i, conCheck) {
  if (i.eliminado) {
    return `
      <tr class="fin-favor">
        <td></td><td>${fecha(i.pago.fecha, { day: "numeric", month: "short", year: "numeric" })}</td>
        <td>${escapar(i.pago.codigo || "")}</td><td colspan="2"><small>Servicio eliminado de la reserva (pago registrado)</small></td><td></td>
        <td class="num">${dinero(0)}</td><td class="num">${dinero(i.pagado)}</td><td class="num">${dinero(i.saldo)}</td>
        <td><span class="fin-estado favor">Saldo a favor</span></td>
      </tr>`;
  }
  const [txt, clase] = ESTADO_CXP[i.estado];
  const marcado = fin.seleccion.has(i.a.id);
  return `
    <tr class="${i.cancelada ? "fin-favor" : ""}">
      <td>${conCheck && i.saldo > 0 ? `<input type="checkbox" data-fin-sel="${i.a.id}" ${marcado ? "checked" : ""} aria-label="Pagar este servicio">` : ""}</td>
      <td>${fecha(i.a.fecha, { day: "numeric", month: "short", year: "numeric" })}</td>
      <td><button type="button" class="enlace" data-fin-accion="abrir" data-id="${i.c.id}">${escapar(codigoDe(i.a, i.c))}</button>${i.cancelada ? ` <small>reserva cancelada</small>` : ""}</td>
      <td>${escapar(`${i.c.nombre} ${i.c.apellido}`)}</td>
      <td>${escapar(servicioPorId(i.a.servicio_id)?.nombre ?? "")}</td>
      <td class="num">${i.personas}</td>
      <td class="num">${dinero(i.monto)}</td>
      <td class="num">${dinero(i.pagado)}</td>
      <td class="num">${i.saldo > 0 ? `<strong>${dinero(i.saldo)}</strong>` : dinero(i.saldo)}</td>
      <td><span class="fin-estado ${clase}">${txt}</span></td>
    </tr>`;
}

function finHtmlGrupo(gr) {
  const deuda = redondear(gr.lista.reduce((s, i) => s + i.monto, 0));
  const pagado = redondear(gr.lista.reduce((s, i) => s + i.pagado, 0));
  const saldo = redondear(deuda - pagado);
  const ids = new Set(gr.lista.filter((i) => !i.eliminado).map((i) => i.a.id));
  const seleccion = [...fin.seleccion].filter((id) => ids.has(id));
  const montoSel = redondear(gr.lista.filter((i) => !i.eliminado && fin.seleccion.has(i.a.id)).reduce((s, i) => s + Math.max(0, i.saldo), 0));
  const historial = fin.pagosProv.filter((p) => (p.operador_id || 0) === gr.id).slice().reverse();

  return `
    <section class="det-seccion sin-margen reporte fin-grupo" data-fin-grupo="${gr.id}">
      <div class="fin-grupo-cab">
        <h3>${escapar(gr.nombre)}</h3>
        <p><span>Deuda ${dinero(deuda)}</span> · <span>Pagado ${dinero(pagado)}</span> · <strong>${saldo < 0 ? `A favor ${dinero(-saldo)}` : `Saldo neto ${dinero(saldo)}`}</strong></p>
      </div>
      <div class="tabla-scroll">
        <table class="tabla fin-tabla">
          <thead><tr><th class="no-imprimir"></th><th>Fecha del servicio</th><th>Referencia</th><th>Cliente</th><th>Servicio</th><th class="num">Pers.</th><th class="num">Monto</th><th class="num">Pagado</th><th class="num">Saldo</th><th>Estado</th></tr></thead>
          <tbody>${gr.lista.map((i) => finFilaServicio(i, !!gr.id)).join("")}</tbody>
        </table>
      </div>
      ${gr.id ? `
      <div class="fin-pago no-imprimir">
        <h4>Registrar pago a ${escapar(gr.nombre)}</h4>
        <p class="nota">${seleccion.length
          ? `${seleccion.length} servicio(s) marcado(s), saldo ${dinero(montoSel)}. Si pagas menos, el monto se aplica del servicio más antiguo al más reciente.`
          : "Marca los servicios que pagas en la tabla."}</p>
        <div class="fila-form">
          <label>Monto <input data-fin-pago="monto" type="number" min="0" step="0.01" value="${seleccion.length ? montoSel.toFixed(2) : ""}"></label>
          <label>Fecha <input data-fin-pago="fecha" type="date" value="${hoyTexto()}"></label>
          <label>Método <select data-fin-pago="metodo">${METODOS_PAGO.map((m) => `<option>${m}</option>`).join("")}</select></label>
          <label>Referencia <input data-fin-pago="referencia" type="text" placeholder="Número de comprobante"></label>
          <label>Notas <input data-fin-pago="notas" type="text"></label>
          <button type="button" class="btn primario" data-fin-accion="pagar" ${seleccion.length ? "" : "disabled"}>Registrar pago</button>
        </div>
      </div>` : `<p class="nota no-imprimir">Asigna el operador en cada actividad para poder registrar pagos.</p>`}
      ${historial.length ? `
      <details class="fin-historial">
        <summary>Pagos registrados (${historial.length})</summary>
        <table class="tabla">
          <thead><tr><th>Fecha</th><th>Referencia del servicio</th><th>Método</th><th>Comprobante</th><th>Notas</th><th class="num">Monto</th><th>Registró</th><th class="no-imprimir"></th></tr></thead>
          <tbody>${historial.map((p) => `
            <tr>
              <td>${fecha(p.fecha, { day: "numeric", month: "short", year: "numeric" })}</td>
              <td>${escapar(p.codigo || "")}</td>
              <td>${escapar(p.metodo || "")}</td>
              <td>${escapar(p.referencia || "")}</td>
              <td>${escapar(p.notas || "")}</td>
              <td class="num">${dinero(p.monto)}</td>
              <td><small>${escapar(nombrePerfil(p.registrado_por))}${p.creado_en ? ` · ${fechaHora(p.creado_en)}` : ""}</small></td>
              <td class="no-imprimir"><button type="button" class="enlace peligro" data-fin-accion="eliminar-pago" data-id="${p.id}">Eliminar</button></td>
            </tr>`).join("")}
          </tbody>
        </table>
      </details>` : ""}
    </section>`;
}

function finHtmlProximos(lista) {
  lista.sort((x, y) => x.a.fecha.localeCompare(y.a.fecha));
  return `
    <details class="det-seccion sin-margen fin-proximos">
      <summary><strong>Próximos servicios</strong> (${lista.length}) · aún no son deuda</summary>
      <div class="tabla-scroll">
        <table class="tabla fin-tabla">
          <thead><tr><th></th><th>Fecha del servicio</th><th>Referencia</th><th>Cliente</th><th>Servicio</th><th class="num">Pers.</th><th class="num">Monto</th><th class="num">Pagado</th><th class="num">Saldo</th><th>Estado</th></tr></thead>
          <tbody>${lista.map((i) => finFilaServicio(i, false)).join("")}</tbody>
        </table>
      </div>
      <p class="nota">Cada uno pasará a "Por pagar" el día en que se brinde el servicio.</p>
    </details>`;
}

// ---------- Registrar un pago: se reparte del servicio más antiguo al más reciente ----------
async function finPagar(btn) {
  const grupo = btn.closest("[data-fin-grupo]");
  const operadorId = Number(grupo.dataset.finGrupo);
  const v = (k) => grupo.querySelector(`[data-fin-pago="${k}"]`).value.trim();
  const monto = redondear(parseFloat(v("monto")) || 0);
  const fechaPago = v("fecha");
  if (monto <= 0) return avisar("Escribe el monto del pago.", "error");
  if (!fechaPago) return avisar("Indica la fecha del pago.", "error");

  const marcados = finCuentas()
    .filter((i) => !i.eliminado && i.operador_id === operadorId && fin.seleccion.has(i.a.id) && i.saldo > 0)
    .sort((x, y) => (x.a.fecha + (x.a.hora_inicio || "")).localeCompare(y.a.fecha + (y.a.hora_inicio || "")));
  const disponible = redondear(marcados.reduce((s, i) => s + i.saldo, 0));
  if (!marcados.length) return avisar("Marca al menos un servicio con saldo.", "error");
  if (monto > disponible + 0.001) return avisar(`El monto es mayor que el saldo de lo marcado (${dinero(disponible)}).`, "error");

  let resto = monto;
  const filas = [];
  for (const i of marcados) {
    if (resto <= 0) break;
    const parte = redondear(Math.min(resto, i.saldo));
    resto = redondear(resto - parte);
    filas.push({
      operador_id: operadorId, actividad_id: i.a.id, codigo: codigoDe(i.a, i.c), monto: parte, fecha: fechaPago,
      metodo: v("metodo") || null, referencia: v("referencia") || null, notas: v("notas") || null
    });
  }
  await conBoton(btn, async () => {
    const { error } = await db.from("pagos_proveedores").insert(filas);
    if (error) return fallo(error, "No se pudo registrar el pago.");
    fin.seleccion.clear();
    avisar(`Pago de ${dinero(monto)} registrado en ${filas.length} servicio(s).`);
    await finAbrir(true);
  });
}

// ---------- Eventos ----------
$("finContenido").addEventListener("change", (e) => {
  const el = e.target;
  if (el.dataset.finFiltro) { fin.filtros[el.dataset.finFiltro] = el.value; return finPintar(); }
  if (el.dataset.finCxp) { fin.cxp[el.dataset.finCxp] = el.value; return finPintar(); }
  if (el.dataset.finSel) {
    const id = Number(el.dataset.finSel);
    el.checked ? fin.seleccion.add(id) : fin.seleccion.delete(id);
    // Conserva lo escrito en el formulario de pago, salvo el monto
    const grupo = el.closest("[data-fin-grupo]");
    const previos = {};
    grupo.querySelectorAll("[data-fin-pago]").forEach((x) => (previos[x.dataset.finPago] = x.value));
    finPintar();
    const nuevo = document.querySelector(`[data-fin-grupo="${grupo.dataset.finGrupo}"]`);
    Object.entries(previos).forEach(([k, val]) => { if (k !== "monto") nuevo.querySelector(`[data-fin-pago="${k}"]`).value = val; });
  }
});

$("finContenido").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-fin-accion]");
  if (!btn) return;
  switch (btn.dataset.finAccion) {
    case "imprimir":
      window.print();
      break;
    case "abrir":
      await abrirDetalle(Number(btn.dataset.id));
      break;
    case "pagar":
      await finPagar(btn);
      break;
    case "eliminar-pago": {
      const p = fin.pagosProv.find((x) => x.id === Number(btn.dataset.id));
      if (!p || !confirm(`¿Eliminar el pago de ${dinero(p.monto)} del ${fecha(p.fecha)}${p.codigo ? ` (${p.codigo})` : ""}?`)) return;
      const { error } = await db.from("pagos_proveedores").delete().eq("id", p.id);
      if (error) return fallo(error, "No se pudo eliminar el pago.");
      avisar("Pago eliminado.");
      await finAbrir(true);
      break;
    }
  }
});

// Al cerrar una reserva abierta desde aquí, se recalculan los montos
document.addEventListener("detalle-cerrado", () => { if (!$("vistaFinanzas").hidden) finAbrir(true); });
