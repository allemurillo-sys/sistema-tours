// =====================================================
// STAFF › COMISIONES POR VENTAS
//  · Administración: un reporte por mes (importar Excel o agregar a mano),
//    ventas por revisar, resumen por vendedor, pagos y comprobantes.
//  · Vendedores: "Mis comisiones" (sin costos ni utilidad de la empresa)
//    y confirmación de cada pago recibido.
//  · Todos los montos los calcula la base de datos (vista com_ventas_calc):
//    IVA incluido en el precio (total − total ÷ 1,13), datáfono solo en TC,
//    vendedor = % de la ganancia.
// (usa utilidades de panel.js, staff.js y planilla.js)
// =====================================================

const COM_TIPOS = { cash: "Cash", cash_facturado: "Cash facturado", tc: "TC" };
const COM_FORMA = { efectivo: "💵 Efectivo", deposito: "🏦 Depósito" };
const COM_BUCKET = "comisiones-comprobantes";

const com = {
  cargado: false,
  meses: [],
  ventas: [],          // todas las ventas (vista calculada)
  pagos: [],
  alias: new Map(),    // texto normalizado → persona_id
  ajustes: { iva: 13, datafono: 2, vendedor: 20 },
  anio: null,
  actual: null,        // id del mes abierto
  filtroVend: "",
  importe: null,       // vista previa de importación
  mio: null            // datos del vendedor (vista "Mis comisiones")
};

const comAdmin = () => puede("comisiones");
const comVe = () => comAdmin() || puede("comisiones_propias");
const usd = (n) => colones(n, 2).replace("₡", "$");
const comNorm = (t) => String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const comMes = (id) => com.meses.find((m) => m.id === Number(id));
const comNombreMes = (m) => m ? `${MESES[m.mes - 1]} ${m.anio}` : "";
const comVentasMes = (id) => com.ventas.filter((v) => v.mes_id === Number(id));
const comNombrePersona = (id) => personaPorId(id)?.nombre || "Sin asignar";
const comEditable = (m) => m && m.estado === "abierto" && !m.historico;
const n2 = (x) => Number(x) || 0;

// Ventana con el formato del sistema: título arriba con sus botones, contenido abajo
function comModal(sub, titulo, cuerpo, botones, ancho = "") {
  stfAbrirModal(`
    <div class="det-cabeza" style="--c: var(--verde)">
      <div><p class="det-numero">${sub}</p><h2 id="stfModalTitulo">${titulo}</h2></div>
      <div class="det-acciones"><button type="button" class="btn" data-stf-accion="cerrar-modal">${botones ? "Cancelar" : "Cerrar"}</button>${botones}</div>
    </div>
    <div class="det-seccion">${cuerpo}</div>`, ancho);
}

// ---------- Carga ----------
async function comAbrir(recargar = false) {
  if (!comVe()) { $("staffContenido").innerHTML = ""; return; }
  if (recargar || !com.cargado) {
    $("staffContenido").innerHTML = `<p class="nota">Cargando comisiones…</p>`;
    try { await comCargar(); } catch (error) {
      $("staffContenido").innerHTML = "";
      return fallo(error, "No se pudieron cargar las comisiones.");
    }
  }
  comPintar();
}

async function comCargar() {
  if (!stf.cargado) await stfCargar();
  if (!comAdmin()) {
    const { data, error } = await db.rpc("com_mis_datos");
    if (error) throw error;
    com.mio = data;
    com.cargado = true;
    return;
  }
  const [m, v, p, a, al] = await Promise.all([
    db.from("com_meses").select("*").order("anio", { ascending: false }).order("mes", { ascending: false }),
    plaTodo(() => db.from("com_ventas_calc").select("*").order("fecha").order("id")),
    db.from("com_pagos").select("*"),
    db.from("com_ajustes").select("*").eq("clave", "calculo").maybeSingle(),
    db.from("com_alias").select("*")
  ]);
  const error = m.error || p.error || a.error || al.error;
  if (error) throw error;
  com.meses = m.data;
  com.ventas = v.map((x) => ({ ...x, total_rack: n2(x.total_rack), total_neto: n2(x.total_neto), iva: n2(x.iva), datafono: n2(x.datafono), sin_iva: n2(x.sin_iva), ganancia: n2(x.ganancia), com_vendedor: n2(x.com_vendedor), com_empresa: n2(x.com_empresa) }));
  com.pagos = p.data;
  if (a.data) com.ajustes = a.data.valor;
  com.alias = new Map(al.data.map((x) => [x.texto, x.persona_id]));
  if (!com.anio) com.anio = com.meses[0]?.anio || new Date().getFullYear();
  com.cargado = true;
}

// ---------- Totales ----------
function comTotales(ventas) {
  const t = { ventas: 0, ganancia: 0, vendedor: 0, empresa: 0, efectivo: 0, deposito: 0, revisar: 0, filas: 0 };
  for (const v of ventas) {
    if (v.estado === "revisar") { t.revisar++; continue; }
    if (v.estado !== "valida") continue;
    t.filas++;
    t.ventas += v.total_rack; t.ganancia += v.ganancia;
    t.vendedor += v.com_vendedor; t.empresa += v.com_empresa;
    t[v.forma] += v.com_vendedor;
  }
  return t;
}
function comPorVendedor(mesId) {
  const grupos = new Map();
  for (const v of comVentasMes(mesId)) {
    const k = v.persona_id ?? `?${v.vendedor_texto}`;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(v);
  }
  return [...grupos.entries()].map(([k, vs]) => ({ persona_id: typeof k === "number" ? k : null, texto: vs[0].vendedor_texto, ventas: vs, t: comTotales(vs) }))
    .sort((a, b) => b.t.vendedor - a.t.vendedor);
}
const comPago = (mesId, personaId, forma) => com.pagos.find((p) => p.mes_id === Number(mesId) && p.persona_id === Number(personaId) && p.forma === forma);

// =====================================================
// PINTAR
// =====================================================
function comPintar() {
  if (!comAdmin()) return stfRedibujar(htmlMisComisiones(), "comisiones-mias");
  const m = comMes(com.actual);
  stfRedibujar(m ? htmlComMes(m) : htmlComLista(), `comisiones-${com.actual || "lista"}`);
}

// ---------- Lista de meses ----------
function htmlComLista() {
  const anios = [...new Set([...com.meses.map((m) => m.anio), new Date().getFullYear()])].sort().reverse();
  const meses = com.meses.filter((m) => m.anio === Number(com.anio)).sort((a, b) => b.mes - a.mes);
  const anual = comTotales(com.ventas.filter((v) => meses.some((m) => m.id === v.mes_id)));
  const filas = meses.map((m) => {
    const t = comTotales(comVentasMes(m.id));
    const grupos = comPorVendedor(m.id).filter((g) => g.persona_id);
    const pend = m.historico ? null : grupos.reduce((s, g) => s + ["efectivo", "deposito"].filter((f) => g.t[f] > 0 && !comPago(m.id, g.persona_id, f)).length, 0);
    return `
      <tr>
        <td><button type="button" class="enlace" data-com-accion="abrir" data-id="${m.id}"><strong>${comNombreMes(m)}</strong></button>${m.historico ? `<small>Del Excel</small>` : ""}</td>
        <td>${comChipEstado(m)}${t.revisar ? ` <span class="stf-chip aviso">${t.revisar} por revisar</span>` : ""}</td>
        <td class="num">${t.filas}</td>
        <td class="num">${usd(t.ventas)}</td>
        <td class="num">${usd(t.efectivo)}</td>
        <td class="num">${usd(t.deposito)}</td>
        <td class="num"><strong>${usd(t.vendedor)}</strong></td>
        <td class="num">${usd(t.empresa)}</td>
        <td class="centro">${pend === null ? `<small>Antes del sistema</small>` : pend ? `<span class="stf-chip alerta">${pend} pendiente${pend > 1 ? "s" : ""}</span>` : t.vendedor ? `<span class="stf-chip ok">Pagado</span>` : ""}</td>
      </tr>`;
  }).join("");
  const sig = comMesSiguiente();
  return `
    <div class="stf-dos">
      <div class="det-seccion sin-margen stf-col">
        <div class="stf-fila-tit">
          <h3>Comisiones por ventas ${com.anio}</h3>
          <label class="stf-inline">Año <select id="comAnio">${anios.map((a) => `<option ${a === Number(com.anio) ? "selected" : ""}>${a}</option>`).join("")}</select></label>
        </div>
        <div class="pla-kpis com-kpis">
          <div><span>Ventas del año</span><b>${usd(anual.ventas)}</b></div>
          <div><span>Comisión vendedores</span><b>${usd(anual.vendedor)}</b></div>
          <div class="destacado"><span>Utilidad de la empresa</span><b>${usd(anual.empresa)}</b></div>
        </div>
        <div class="tabla-scroll">
          <table class="tabla pla-tabla">
            <thead><tr><th>Mes</th><th>Estado</th><th class="num">Ventas</th><th class="num">Total vendido</th><th class="num">💵 Efectivo</th><th class="num">🏦 Depósito</th><th class="num">Comisión vendedores</th><th class="num">Utilidad empresa</th><th class="centro">Pagos</th></tr></thead>
            <tbody>${filas || `<tr><td colspan="9" class="nota">No hay meses en ${com.anio}.</td></tr>`}</tbody>
          </table>
        </div>
        <p class="nota">💵 Efectivo = comisión de ventas Cash. 🏦 Depósito = comisión de ventas Cash facturado + TC.</p>
      </div>
      <aside class="det-seccion sin-margen stf-resumen">
        <h3>Nuevo mes</h3>
        <label>Mes <select id="comNMes">${MESES.map((n, i) => `<option value="${i + 1}" ${i + 1 === sig.mes ? "selected" : ""}>${n}</option>`).join("")}</select></label>
        <label>Año <input id="comNAnio" type="number" value="${sig.anio}"></label>
        <button type="button" class="btn primario" data-com-accion="crear-mes">Crear mes</button>
        <hr>
        <h3>Cálculo</h3>
        <p class="nota">Se aplica a los meses abiertos y a los nuevos. Los meses cerrados no cambian.</p>
        <label>IVA incluido en el precio (%) <input id="comAjIva" type="number" step="0.01" value="${com.ajustes.iva}"></label>
        <label>Datáfono, solo TC (%) <input id="comAjDat" type="number" step="0.01" value="${com.ajustes.datafono}"></label>
        <label>Comisión del vendedor (% de la ganancia) <input id="comAjVen" type="number" step="0.01" value="${com.ajustes.vendedor}"></label>
        <button type="button" class="btn" data-com-accion="guardar-ajustes">Guardar cálculo</button>
      </aside>
    </div>`;
}
function comMesSiguiente() {
  const u = [...com.meses].sort((a, b) => b.anio - a.anio || b.mes - a.mes)[0];
  if (!u) { const d = new Date(); return { anio: d.getFullYear(), mes: d.getMonth() + 1 }; }
  return u.mes === 12 ? { anio: u.anio + 1, mes: 1 } : { anio: u.anio, mes: u.mes + 1 };
}
function comChipEstado(m) {
  if (m.estado === "cerrado") return `<span class="stf-chip gris">Cerrado</span>`;
  return `<span class="stf-chip ok">Abierto</span>`;
}

// ---------- Detalle del mes ----------
function htmlComMes(m) {
  const ventas = comVentasMes(m.id);
  const t = comTotales(ventas);
  const grupos = comPorVendedor(m.id);
  const ed = comEditable(m);
  const p = m.parametros || {};
  const revisar = ventas.filter((v) => v.estado === "revisar");
  const noPagar = ventas.filter((v) => v.estado === "no_pagar");

  const filasVend = grupos.map((g) => {
    const celdaPago = (forma) => {
      if (m.historico) return `<td class="centro"><small>—</small></td>`;
      const monto = g.t[forma];
      if (!g.persona_id) return `<td class="centro"><small>Asigne el vendedor</small></td>`;
      const pg = comPago(m.id, g.persona_id, forma);
      if (pg) return `<td class="centro">${pg.confirmado_en ? `<span class="stf-chip ok">✓ Recibido</span>` : `<span class="stf-chip aviso">Pagado · falta confirmar</span>`}<br><button type="button" class="enlace" data-com-accion="ver-pago" data-id="${pg.id}">Ver pago</button></td>`;
      if (Math.abs(monto) < 0.005) return `<td class="centro"><small>Nada que pagar</small></td>`;
      return `<td class="centro"><button type="button" class="btn chico" data-com-accion="pagar" data-forma="${forma}" data-persona="${g.persona_id}">Registrar pago</button></td>`;
    };
    return `
      <tr>
        <th scope="row"><button type="button" class="enlace" data-com-accion="filtrar" data-persona="${g.persona_id ?? ""}" data-texto="${escapar(g.texto)}">${escapar(g.persona_id ? comNombrePersona(g.persona_id) : g.texto)}</button>${g.persona_id ? "" : ` <span class="stf-chip alerta">Sin ficha</span>`}<small>${g.t.filas} venta${g.t.filas === 1 ? "" : "s"}${g.t.revisar ? ` · ${g.t.revisar} por revisar` : ""}</small></th>
        <td class="num">${usd(g.t.ventas)}</td>
        <td class="num">${usd(g.t.efectivo)}</td>
        ${celdaPago("efectivo")}
        <td class="num">${usd(g.t.deposito)}</td>
        ${celdaPago("deposito")}
        <td class="num"><strong>${usd(g.t.vendedor)}</strong></td>
        <td class="num">${usd(g.t.empresa)}</td>
        <td class="pla-acc">${g.persona_id ? `<button type="button" class="enlace" data-com-accion="comprobante" data-persona="${g.persona_id}">Comprobante</button>` : ""}</td>
      </tr>`;
  }).join("");

  const filtro = com.filtroVend;
  const lista = ventas.filter((v) => !filtro || String(v.persona_id ?? `?${v.vendedor_texto}`) === filtro);
  const filasVentas = lista.map((v) => `
    <tr class="${v.estado !== "valida" ? "inactivo" : ""}">
      <td>${v.fecha ? fechaCorta(v.fecha) : "—"}</td>
      <td>${escapar(v.orden || "")}</td>
      <td>${escapar(v.actividad || "")}<small>${escapar(v.proveedor || "")}</small></td>
      <td>${escapar(v.cliente || "")}</td>
      <td>${escapar(v.persona_id ? comNombrePersona(v.persona_id) : v.vendedor_texto || "")}</td>
      <td>${v.estado === "revisar" ? `<span class="stf-chip aviso">${escapar(v.estado_original || "Revisar")}</span>` : v.estado === "no_pagar" ? `<span class="stf-chip gris">No se paga</span>` : COM_TIPOS[v.tipo] || ""}</td>
      <td class="num">${horasTxt(v.pax)}</td>
      <td class="num">${usd(v.total_rack)}</td>
      <td class="num">${v.iva ? usd(v.iva) : ""}</td>
      <td class="num">${v.datafono ? usd(v.datafono) : ""}</td>
      <td class="num">${usd(v.total_neto)}</td>
      <td class="num ${v.ganancia < 0 ? "pla-neg" : ""}">${usd(v.ganancia)}</td>
      <td class="num"><strong>${usd(v.com_vendedor)}</strong></td>
      <td class="num">${usd(v.com_empresa)}</td>
      ${ed ? `<td class="pla-acc"><button type="button" class="enlace" data-com-accion="editar-venta" data-id="${v.id}">Editar</button><button type="button" class="btn-icono" data-com-accion="borrar-venta" data-id="${v.id}" aria-label="Eliminar venta">×</button></td>` : ""}
    </tr>`).join("");

  const nombreFiltro = filtro ? (filtro.startsWith("?") ? filtro.slice(1) : comNombrePersona(filtro)) : "";
  return `
    <div class="pla-nav no-imprimir">
      <button type="button" class="stf-pill" data-com-accion="volver">← Todos los meses</button>
      <h3 class="com-titulo">${comNombreMes(m)}</h3> ${comChipEstado(m)}
      ${m.historico ? `<span class="stf-chip gris">Histórico: montos del Excel</span>` : ""}
      <span class="com-botones">
        ${ed ? `<label class="btn">📥 Importar Excel<input type="file" id="comArchivo" accept=".xlsx" hidden></label>
        <button type="button" class="btn" data-com-accion="nueva-venta">+ Agregar venta</button>` : ""}
        <button type="button" class="btn" data-com-accion="excel">Descargar Excel</button>
        <button type="button" class="btn" data-com-accion="imprimir">Imprimir reporte</button>
        ${m.historico ? "" : m.estado === "abierto"
          ? `<button type="button" class="btn primario" data-com-accion="cerrar">Cerrar mes</button>`
          : `<button type="button" class="btn" data-com-accion="reabrir">Reabrir</button>`}
      </span>
    </div>
    ${m.historico ? "" : `<p class="nota">Cálculo del mes: IVA ${p.iva}% incluido en el precio · datáfono ${p.datafono}% (TC) · vendedor ${p.vendedor}% de la ganancia.${m.estado === "cerrado" ? ` Cerrado el ${fechaHora(m.cerrado_en)}.` : ""}</p>`}
    <div class="pla-kpis">
      <div><span>Total vendido</span><b>${usd(t.ventas)}</b></div>
      <div><span>Ganancia (sin impuestos − costo)</span><b>${usd(t.ganancia)}</b></div>
      <div><span>Comisión vendedores</span><b>${usd(t.vendedor)}</b><small>💵 ${usd(t.efectivo)} · 🏦 ${usd(t.deposito)}</small></div>
      <div class="destacado"><span>Utilidad de la empresa</span><b>${usd(t.empresa)}</b></div>
    </div>
    ${revisar.length ? `
    <div class="det-seccion sin-margen com-revisar">
      <h3>⚠️ Ventas por revisar (${revisar.length})</h3>
      <p class="nota">El reporte las marcó como no pagadas o canceladas. No suman comisión hasta que confirme que se cobraron.</p>
      <div class="tabla-scroll"><table class="tabla pla-tabla">
        <thead><tr><th>Orden</th><th>Actividad</th><th>Cliente</th><th>Vendedor</th><th>Decía</th><th class="num">Total</th><th>¿Qué pasó?</th></tr></thead>
        <tbody>${revisar.map((v) => `
          <tr><td>${escapar(v.orden || "")}</td><td>${escapar(v.actividad || "")}</td><td>${escapar(v.cliente || "")}</td>
          <td>${escapar(v.persona_id ? comNombrePersona(v.persona_id) : v.vendedor_texto || "")}</td>
          <td><span class="stf-chip aviso">${escapar(v.estado_original || "")}</span></td><td class="num">${usd(v.total_rack)}</td>
          <td class="com-decidir">${ed ? `<select data-com-cobro="${v.id}" aria-label="Forma de cobro"><option value="">Se cobró como…</option>${Object.entries(COM_TIPOS).map(([k, n]) => `<option value="${k}">${n}</option>`).join("")}</select>
            <button type="button" class="btn chico" data-com-accion="no-pagar" data-id="${v.id}">No se paga</button>` : `<small>Reabra el mes para decidir</small>`}</td></tr>`).join("")}</tbody>
      </table></div>
    </div>` : ""}
    <div class="det-seccion sin-margen">
      <h3>Resumen por vendedor</h3>
      <div class="tabla-scroll"><table class="tabla pla-tabla">
        <thead><tr><th>Vendedor</th><th class="num">Vendido</th><th class="num">💵 Efectivo</th><th class="centro">Pago efectivo</th><th class="num">🏦 Depósito</th><th class="centro">Pago depósito</th><th class="num">Total comisión</th><th class="num">Utilidad empresa</th><th></th></tr></thead>
        <tbody>${filasVend || `<tr><td colspan="9" class="nota">Todavía no hay ventas. Importe el Excel del mes o agregue una venta.</td></tr>`}</tbody>
        ${grupos.length > 1 ? `<tfoot><tr><th>Total</th><td class="num">${usd(t.ventas)}</td><td class="num">${usd(t.efectivo)}</td><td></td><td class="num">${usd(t.deposito)}</td><td></td><td class="num">${usd(t.vendedor)}</td><td class="num">${usd(t.empresa)}</td><td></td></tr></tfoot>` : ""}
      </table></div>
    </div>
    <div class="det-seccion sin-margen">
      <div class="stf-fila-tit">
        <h3>Ventas${nombreFiltro ? ` de ${escapar(nombreFiltro)}` : ""} (${lista.length})</h3>
        ${filtro ? `<button type="button" class="stf-pill" data-com-accion="filtrar" data-persona="" data-texto="">Ver todas</button>` : ""}
      </div>
      ${noPagar.length && !filtro ? `<p class="nota">${noPagar.length} venta${noPagar.length > 1 ? "s" : ""} marcada${noPagar.length > 1 ? "s" : ""} “No se paga” (aparecen en gris).</p>` : ""}
      <div class="tabla-scroll"><table class="tabla pla-tabla com-ventas">
        <thead><tr><th>Fecha</th><th>Orden</th><th>Actividad</th><th>Cliente</th><th>Vendedor</th><th>Tipo</th><th class="num">Pax</th><th class="num">Total</th><th class="num">IVA</th><th class="num">Datáfono</th><th class="num">Costo</th><th class="num">Ganancia</th><th class="num">Vendedor</th><th class="num">Empresa</th>${ed ? "<th></th>" : ""}</tr></thead>
        <tbody>${filasVentas || `<tr><td colspan="15" class="nota">Sin ventas.</td></tr>`}</tbody>
      </table></div>
    </div>`;
}

// ---------- Mis comisiones (vendedor) ----------
function htmlMisComisiones() {
  const d = com.mio || { meses: [], ventas: [], pagos: [] };
  if (!d.meses.length) return `<div class="det-seccion sin-margen"><h3>Mis comisiones</h3><p class="nota">Todavía no tiene ventas registradas.</p></div>`;
  if (!com.actual || !d.meses.some((m) => m.id === com.actual)) com.actual = d.meses[0].id;
  const m = d.meses.find((x) => x.id === com.actual);
  const ventas = d.ventas.filter((v) => v.mes_id === m.id).map((v) => ({ ...v, total_rack: n2(v.total_rack), com_vendedor: n2(v.com_vendedor) }));
  const t = { efectivo: 0, deposito: 0, total: 0, vendido: 0 };
  ventas.filter((v) => v.estado === "valida").forEach((v) => { t[v.forma] += v.com_vendedor; t.total += v.com_vendedor; t.vendido += v.total_rack; });
  const pagos = d.pagos.filter((p) => p.mes_id === m.id);
  const tarjeta = (forma) => {
    const pg = pagos.find((p) => p.forma === forma);
    let estado = "";
    if (m.historico) estado = `<small>Pagado antes del sistema</small>`;
    else if (!pg) estado = t[forma] ? `<span class="stf-chip gris">Pendiente de pago</span>` : `<small>Nada que pagar</small>`;
    else if (pg.confirmado_en) estado = `<span class="stf-chip ok">✓ Recibido el ${fechaHora(pg.confirmado_en)}</span>`;
    else estado = `<button type="button" class="btn primario" data-com-accion="confirmar" data-id="${pg.id}">Recibí conforme</button>`;
    return `
      <div class="com-tarjeta">
        <span>${COM_FORMA[forma]}</span>
        <b>${usd(pg ? pg.monto : t[forma])}</b>
        ${pg ? `<small>Pagado el ${fechaAnio(pg.fecha)}${pg.referencia ? ` · Ref. ${escapar(pg.referencia)}` : ""}${pg.banco ? ` · ${escapar(pg.banco)}` : ""}</small>` : ""}
        ${pg?.archivo ? `<button type="button" class="enlace" data-com-accion="ver-archivo" data-ruta="${escapar(pg.archivo)}">Ver comprobante</button>` : ""}
        ${estado}
      </div>`;
  };
  return `
    <div class="pla-nav">
      <h3 class="com-titulo">Mis comisiones</h3>
      <label class="stf-inline">Mes <select id="comMiMes">${d.meses.map((x) => `<option value="${x.id}" ${x.id === m.id ? "selected" : ""}>${comNombreMes(x)}</option>`).join("")}</select></label>
      ${comChipEstado(m)}
    </div>
    <div class="pla-kpis">
      <div><span>Vendido en el mes</span><b>${usd(t.vendido)}</b></div>
      <div class="destacado"><span>Mi comisión</span><b>${usd(t.total)}</b></div>
    </div>
    <div class="com-tarjetas">${tarjeta("efectivo")}${tarjeta("deposito")}</div>
    <p class="nota">Cuando la administración registra un pago, toque <strong>Recibí conforme</strong> para confirmar que lo recibió.</p>
    <div class="det-seccion sin-margen">
      <h3>Mis ventas (${ventas.length})</h3>
      <div class="tabla-scroll"><table class="tabla pla-tabla">
        <thead><tr><th>Fecha</th><th>Orden</th><th>Actividad</th><th>Cliente</th><th>Tipo</th><th class="num">Pax</th><th class="num">Total</th><th class="num">Mi comisión</th></tr></thead>
        <tbody>${ventas.map((v) => `
          <tr class="${v.estado !== "valida" ? "inactivo" : ""}"><td>${v.fecha ? fechaCorta(v.fecha) : "—"}</td><td>${escapar(v.orden || "")}</td><td>${escapar(v.actividad || "")}</td><td>${escapar(v.cliente || "")}</td>
          <td>${v.estado === "revisar" ? `<span class="stf-chip aviso">En revisión</span>` : v.estado === "no_pagar" ? `<span class="stf-chip gris">No aplica</span>` : COM_TIPOS[v.tipo]}</td>
          <td class="num">${horasTxt(v.pax)}</td><td class="num">${usd(v.total_rack)}</td><td class="num"><strong>${usd(v.com_vendedor)}</strong></td></tr>`).join("")}</tbody>
      </table></div>
    </div>`;
}

// =====================================================
// ACCIONES
// =====================================================
async function comCrearMes() {
  const mes = Number($("comNMes").value), anio = Number($("comNAnio").value);
  if (com.meses.some((m) => m.anio === anio && m.mes === mes)) return avisar("Ese mes ya existe.", "error");
  const { data, error } = await db.from("com_meses").insert({ anio, mes, parametros: { ...com.ajustes } }).select().single();
  if (error) return fallo(error, "No se pudo crear el mes.");
  com.actual = data.id; com.anio = anio;
  await comCargar(); comPintar();
}
async function comGuardarAjustes() {
  const valor = { iva: Number($("comAjIva").value), datafono: Number($("comAjDat").value), vendedor: Number($("comAjVen").value) };
  if (Object.values(valor).some((x) => !(x >= 0 && x < 100))) return avisar("Revise los porcentajes.", "error");
  if (!confirm(`Se aplicará IVA ${valor.iva}%, datáfono ${valor.datafono}% y vendedor ${valor.vendedor}% a los meses abiertos y a los nuevos. ¿Continuar?`)) return;
  const { error } = await db.from("com_ajustes").upsert({ clave: "calculo", valor });
  if (error) return fallo(error);
  for (const m of com.meses.filter((x) => comEditable(x))) {
    const r = await db.from("com_meses").update({ parametros: valor }).eq("id", m.id);
    if (r.error) return fallo(r.error);
  }
  avisar("Cálculo guardado.");
  await comCargar(); comPintar();
}
async function comCerrar(m) {
  const t = comTotales(comVentasMes(m.id));
  if (t.revisar) return avisar(`Hay ${t.revisar} venta(s) por revisar. Decida qué pasó con cada una antes de cerrar.`, "error");
  if (comPorVendedor(m.id).some((g) => !g.persona_id)) return avisar("Hay ventas sin vendedor asignado. Edítelas antes de cerrar.", "error");
  if (!confirm(`¿Cerrar ${comNombreMes(m)}? Ya no se podrán cambiar las ventas. Los pagos sí se pueden registrar.`)) return;
  const { error } = await db.from("com_meses").update({ estado: "cerrado", cerrado_en: new Date().toISOString(), cerrado_por: app.yo.id }).eq("id", m.id);
  if (error) return fallo(error);
  await comCargar(); comPintar();
}
async function comReabrir(m) {
  if (!confirm(`¿Reabrir ${comNombreMes(m)} para hacer cambios?`)) return;
  const { error } = await db.from("com_meses").update({ estado: "abierto", cerrado_en: null, cerrado_por: null }).eq("id", m.id);
  if (error) return fallo(error);
  await comCargar(); comPintar();
}

// ---------- Venta (agregar / editar) ----------
function comFormVenta(v = null) {
  const m = comMes(com.actual);
  const vendedores = stf.personas.filter((p) => p.activo || p.id === v?.persona_id).sort((a, b) => a.nombre.localeCompare(b.nombre));
  const val = (k, d = "") => escapar(v?.[k] ?? d);
  comModal(comNombreMes(m), v ? "Editar venta" : "Agregar venta", `
    <div class="com-form">
      <label>Fecha <input id="cvFecha" type="date" value="${val("fecha")}"></label>
      <label>Orden <input id="cvOrden" value="${val("orden")}"></label>
      <label class="ancho">Actividad <input id="cvActividad" value="${val("actividad")}"></label>
      <label>Proveedor <input id="cvProveedor" value="${val("proveedor")}"></label>
      <label>Cliente <input id="cvCliente" value="${val("cliente")}"></label>
      <label>Vendedor <select id="cvPersona"><option value="">— Elija —</option>${vendedores.map((p) => `<option value="${p.id}" ${p.id === v?.persona_id ? "selected" : ""}>${escapar(p.nombre)}</option>`).join("")}</select></label>
      <label>Tipo de venta <select id="cvTipo">${Object.entries(COM_TIPOS).map(([k, n]) => `<option value="${k}" ${k === (v?.tipo || "cash") ? "selected" : ""}>${n}</option>`).join("")}</select></label>
      <label>Personas (pax) <input id="cvPax" type="number" step="1" min="0" value="${val("pax", 1)}"></label>
      <label>Precio de venta por persona (Rack) <input id="cvRack" type="number" step="0.01" value="${val("rack", 0)}"></label>
      <label>Costo por persona (Neto) <input id="cvNeto" type="number" step="0.01" value="${val("neto", 0)}"></label>
      <label class="ancho">Nota <input id="cvNota" value="${val("nota")}"></label>
    </div>
    <p class="nota" id="cvCalculo"></p>`,
    `<button type="button" class="btn primario" data-com-modal="guardar-venta" data-id="${v?.id || ""}">Guardar</button>`);
  comPrevisualizarVenta();
}
function comPrevisualizarVenta() {
  const el = $("cvCalculo"); if (!el) return;
  const p = comMes(com.actual)?.parametros || com.ajustes;
  const tipo = $("cvTipo").value, pax = Number($("cvPax").value) || 0;
  const total = (Number($("cvRack").value) || 0) * pax, costo = (Number($("cvNeto").value) || 0) * pax;
  const iva = tipo === "cash" ? 0 : total - total / (1 + p.iva / 100);
  const dat = tipo === "tc" ? total * p.datafono / 100 : 0;
  const gan = total - iva - dat - costo;
  el.innerHTML = `Total ${usd(total)} − IVA ${usd(iva)}${dat ? ` − datáfono ${usd(dat)}` : ""} − costo ${usd(costo)} = ganancia <strong>${usd(gan)}</strong> → vendedor <strong>${usd(gan * p.vendedor / 100)}</strong> · empresa ${usd(gan - gan * p.vendedor / 100)}`;
}
async function comGuardarVenta(id) {
  const fila = {
    fecha: $("cvFecha").value || null, orden: $("cvOrden").value.trim() || null, actividad: $("cvActividad").value.trim() || null,
    proveedor: $("cvProveedor").value.trim() || null, cliente: $("cvCliente").value.trim() || null,
    persona_id: Number($("cvPersona").value) || null, tipo: $("cvTipo").value, estado: "valida",
    pax: Number($("cvPax").value) || 0, rack: Number($("cvRack").value) || 0, neto: Number($("cvNeto").value) || 0, nota: $("cvNota").value.trim() || null
  };
  if (!fila.persona_id) return avisar("Elija el vendedor.", "error");
  if (!fila.actividad) return avisar("Escriba la actividad.", "error");
  fila.vendedor_texto = comNombrePersona(fila.persona_id);
  const r = id ? await db.from("com_ventas").update(fila).eq("id", id)
    : await db.from("com_ventas").insert({ ...fila, mes_id: com.actual, creado_por: app.yo.id });
  if (r.error) return fallo(r.error);
  stfCerrarModal();
  await comCargar(); comPintar();
}
async function comBorrarVenta(id) {
  const v = com.ventas.find((x) => x.id === Number(id));
  if (!confirm(`¿Eliminar la venta ${v?.orden || ""} · ${v?.actividad || ""}?`)) return;
  const { error } = await db.from("com_ventas").delete().eq("id", id);
  if (error) return fallo(error);
  await comCargar(); comPintar();
}
async function comDecidir(id, cambios) {
  const { error } = await db.from("com_ventas").update(cambios).eq("id", id);
  if (error) return fallo(error);
  await comCargar(); comPintar();
}

// ---------- Pagos ----------
function comFormPago(forma, personaId) {
  const m = comMes(com.actual);
  const g = comPorVendedor(m.id).find((x) => x.persona_id === Number(personaId));
  const monto = Math.round(g.t[forma] * 100) / 100;
  comModal(`Registrar pago · ${COM_FORMA[forma]}`, escapar(comNombrePersona(personaId)), `
    <p class="nota">Comisión de ${comNombreMes(m)} por ${forma === "efectivo" ? "ventas Cash" : "ventas Cash facturado + TC"}: <strong>${usd(monto)}</strong></p>
    <div class="com-form">
      <label>Monto pagado ($) <input id="cpMonto" type="number" step="0.01" value="${monto.toFixed(2)}"></label>
      <label>Fecha del pago <input id="cpFecha" type="date" value="${aTexto(new Date())}"></label>
      ${forma === "deposito" ? `
      <label>Banco <input id="cpBanco" placeholder="BAC, BN, BCR…"></label>
      <label>Número de comprobante <input id="cpRef"></label>
      <label class="ancho">Comprobante de la transferencia (foto o PDF) <input id="cpArchivo" type="file" accept="image/*,application/pdf"></label>` : `
      <p class="nota ancho">Al guardar se abre el comprobante para imprimir y firmar. Además, ${escapar(comNombrePersona(personaId).split(" ")[0])} debe tocar <strong>Recibí conforme</strong> en su usuario.</p>`}
      <label class="ancho">Nota <input id="cpNota"></label>
    </div>`,
    `<button type="button" class="btn primario" data-com-modal="guardar-pago" data-forma="${forma}" data-persona="${personaId}">Guardar pago</button>`);
}
async function comGuardarPago(forma, personaId) {
  const monto = Number($("cpMonto").value);
  if (!(monto > 0)) return avisar("Escriba el monto pagado.", "error");
  const fila = { mes_id: com.actual, persona_id: Number(personaId), forma, monto, fecha: $("cpFecha").value || aTexto(new Date()), nota: $("cpNota").value.trim() || null };
  if (forma === "deposito") {
    fila.banco = $("cpBanco").value.trim() || null;
    fila.referencia = $("cpRef").value.trim() || null;
    const archivo = $("cpArchivo").files[0];
    if (!fila.referencia && !archivo) return avisar("Escriba el número de comprobante o adjunte la foto de la transferencia.", "error");
    if (archivo) {
      if (archivo.size > 10 * 1024 * 1024) return avisar("El archivo pesa más de 10 MB.", "error");
      const ruta = `${com.actual}/${personaId}/${Date.now()}_${nombreArchivo(archivo.name)}`;
      const up = await db.storage.from(COM_BUCKET).upload(ruta, archivo, { contentType: archivo.type });
      if (up.error) return fallo(up.error, "No se pudo subir el comprobante.");
      fila.archivo = ruta; fila.nombre_archivo = archivo.name;
    }
  }
  const { error } = await db.from("com_pagos").insert(fila);
  if (error) return fallo(error);
  stfCerrarModal();
  avisar("Pago registrado. El vendedor debe confirmarlo en su usuario.");
  await comCargar(); comPintar();
  if (forma === "efectivo") comImprimirComprobante(personaId, "efectivo");
}
function comVerPago(id) {
  const pg = com.pagos.find((p) => p.id === Number(id));
  const m = comMes(pg.mes_id);
  comModal(`Pago · ${COM_FORMA[pg.forma]}`, escapar(comNombrePersona(pg.persona_id)), `
    <dl class="com-dl">
      <dt>Mes</dt><dd>${comNombreMes(m)}</dd>
      <dt>Monto</dt><dd><strong>${usd(pg.monto)}</strong></dd>
      <dt>Fecha del pago</dt><dd>${fechaAnio(pg.fecha)}</dd>
      ${pg.banco ? `<dt>Banco</dt><dd>${escapar(pg.banco)}</dd>` : ""}
      ${pg.referencia ? `<dt>Comprobante</dt><dd>${escapar(pg.referencia)}</dd>` : ""}
      ${pg.nota ? `<dt>Nota</dt><dd>${escapar(pg.nota)}</dd>` : ""}
      <dt>Registrado</dt><dd>${fechaHora(pg.registrado_en)}</dd>
      <dt>Vendedor</dt><dd>${pg.confirmado_en ? `<span class="stf-chip ok">✓ Confirmó que lo recibió el ${fechaHora(pg.confirmado_en)}</span>` : `<span class="stf-chip aviso">Todavía no ha confirmado</span>`}</dd>
    </dl>`, `
      ${pg.archivo ? `<button type="button" class="btn" data-com-modal="ver-archivo" data-ruta="${escapar(pg.archivo)}">Ver comprobante</button>` : ""}
      <button type="button" class="btn" data-com-modal="imprimir-pago" data-persona="${pg.persona_id}" data-forma="${pg.forma}">Imprimir</button>
      ${pg.confirmado_en ? "" : `<button type="button" class="btn peligro" data-com-modal="anular-pago" data-id="${pg.id}">Anular pago</button>`}`);
}
async function comAnularPago(id) {
  if (!confirm("¿Anular este pago? Use esto solo si se registró por error.")) return;
  const pg = com.pagos.find((p) => p.id === Number(id));
  const { error } = await db.from("com_pagos").delete().eq("id", id);
  if (error) return fallo(error);
  if (pg?.archivo) await db.storage.from(COM_BUCKET).remove([pg.archivo]);
  stfCerrarModal();
  await comCargar(); comPintar();
}
async function comVerArchivo(ruta) {
  const { data, error } = await db.storage.from(COM_BUCKET).createSignedUrl(ruta, 300);
  if (error) return fallo(error, "No se pudo abrir el comprobante.");
  window.open(data.signedUrl, "_blank", "noopener");
}

// ---------- Comprobante imprimible ----------
function comImprimirComprobante(personaId, soloForma = null) {
  const m = comMes(com.actual);
  const g = comPorVendedor(m.id).find((x) => x.persona_id === Number(personaId));
  if (!g) return;
  const formas = soloForma ? [soloForma] : ["efectivo", "deposito"].filter((f) => Math.abs(g.t[f]) >= 0.005);
  const hoja = (forma) => {
    const vs = g.ventas.filter((v) => v.estado === "valida" && v.forma === forma);
    const pg = comPago(m.id, personaId, forma);
    const total = vs.reduce((s, v) => s + v.com_vendedor, 0);
    const copia = (etiqueta) => `
      <div class="pla-recibo com-recibo">
        <div class="pla-recibo-cab"><div><strong>The House of Tours · Home Vacations CR</strong><br>Comprobante de pago de comisiones</div><div class="der">${etiqueta}<br>${comNombreMes(m)}</div></div>
        <p><strong>Vendedor:</strong> ${escapar(comNombrePersona(personaId))} &nbsp;·&nbsp; <strong>Forma de pago:</strong> ${forma === "efectivo" ? "Efectivo (ventas Cash)" : "Depósito bancario (ventas Cash facturado + TC)"}</p>
        <table class="com-recibo-tabla"><thead><tr><th>Fecha</th><th>Orden</th><th>Actividad</th><th>Cliente</th><th>Tipo</th><th class="num">Comisión</th></tr></thead>
          <tbody>${vs.map((v) => `<tr><td>${v.fecha ? fechaCorta(v.fecha) : ""}</td><td>${escapar(v.orden || "")}</td><td>${escapar(v.actividad || "")}</td><td>${escapar(v.cliente || "")}</td><td>${COM_TIPOS[v.tipo]}</td><td class="num">${usd(v.com_vendedor)}</td></tr>`).join("")}</tbody></table>
        <p class="pla-recibo-neto"><span>Total ${forma === "efectivo" ? "entregado en efectivo" : "depositado"}</span><strong>${usd(pg ? pg.monto : total)}</strong></p>
        ${pg ? `<p>Fecha de pago: ${fechaAnio(pg.fecha)}${pg.banco ? ` · Banco: ${escapar(pg.banco)}` : ""}${pg.referencia ? ` · Comprobante: ${escapar(pg.referencia)}` : ""}${pg.confirmado_en ? ` · Confirmado por el vendedor en el sistema el ${fechaHora(pg.confirmado_en)}` : ""}</p>` : ""}
        <div class="pla-firmas"><span>Entregado por</span><span>Recibido conforme</span></div>
      </div>`;
    return `<div class="pla-hoja">${copia("Copia empresa")}${copia("Copia vendedor")}</div>`;
  };
  stfImprimir(formas.map(hoja).join(""));
}
function comImprimirReporte() {
  const m = comMes(com.actual);
  const t = comTotales(comVentasMes(m.id));
  const filas = comPorVendedor(m.id).map((g) => `<tr><td>${escapar(g.persona_id ? comNombrePersona(g.persona_id) : g.texto)}</td><td class="num">${g.t.filas}</td><td class="num">${usd(g.t.ventas)}</td><td class="num">${usd(g.t.efectivo)}</td><td class="num">${usd(g.t.deposito)}</td><td class="num">${usd(g.t.vendedor)}</td><td class="num">${usd(g.t.empresa)}</td></tr>`).join("");
  stfImprimir(`
    <div class="com-reporte">
      <h1>Reporte de comisiones · ${comNombreMes(m)}</h1>
      <p>The House of Tours · Home Vacations CR · ${m.estado === "cerrado" ? "Mes cerrado" : "Mes abierto (preliminar)"}</p>
      <table class="com-recibo-tabla"><thead><tr><th>Vendedor</th><th class="num">Ventas</th><th class="num">Total vendido</th><th class="num">Efectivo</th><th class="num">Depósito</th><th class="num">Comisión</th><th class="num">Utilidad empresa</th></tr></thead>
        <tbody>${filas}</tbody>
        <tfoot><tr><th>Total</th><th class="num">${t.filas}</th><th class="num">${usd(t.ventas)}</th><th class="num">${usd(t.efectivo)}</th><th class="num">${usd(t.deposito)}</th><th class="num">${usd(t.vendedor)}</th><th class="num">${usd(t.empresa)}</th></tr></tfoot></table>
      <p>Ganancia total: ${usd(t.ganancia)}${t.revisar ? ` · ${t.revisar} venta(s) por revisar no incluidas` : ""}</p>
    </div>`);
}
async function comExcel() {
  const m = comMes(com.actual);
  const ExcelJS = await stfCargarExcel();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(comNombreMes(m));
  ws.columns = [
    ["Fecha", 12], ["Orden", 10], ["Proveedor", 24], ["Actividad", 32], ["Cliente", 22], ["Vendedor", 26], ["Tipo", 14], ["Estado", 12], ["Pax", 6],
    ["Rack", 10], ["Neto", 10], ["Total", 11], ["Costo", 11], ["IVA", 10], ["Datáfono", 10], ["Sin impuestos", 13], ["Ganancia", 11], ["Com. vendedor", 13], ["Utilidad empresa", 15], ["Forma de pago", 13]
  ].map(([header, width]) => ({ header, width }));
  ws.getRow(1).font = { bold: true };
  for (const v of comVentasMes(m.id)) {
    ws.addRow([v.fecha ? new Date(v.fecha + "T12:00:00") : null, v.orden, v.proveedor, v.actividad, v.cliente, v.persona_id ? comNombrePersona(v.persona_id) : v.vendedor_texto,
      COM_TIPOS[v.tipo] || v.estado_original || "", { valida: "Válida", revisar: "Por revisar", no_pagar: "No se paga" }[v.estado], n2(v.pax), n2(v.rack), n2(v.neto),
      v.total_rack, v.total_neto, v.iva, v.datafono, v.sin_iva, v.ganancia, v.com_vendedor, v.com_empresa, v.forma === "efectivo" ? "Efectivo" : v.forma === "deposito" ? "Depósito" : ""]);
  }
  ws.getColumn(1).numFmt = "dd/mm/yyyy";
  for (let c = 10; c <= 19; c++) ws.getColumn(c).numFmt = "#,##0.00";
  ws.views = [{ state: "frozen", ySplit: 1 }];
  const r = wb.addWorksheet("Resumen");
  r.columns = [["Vendedor", 30], ["Ventas", 8], ["Total vendido", 14], ["Efectivo", 12], ["Depósito", 12], ["Comisión", 12], ["Utilidad empresa", 16]].map(([header, width]) => ({ header, width }));
  r.getRow(1).font = { bold: true };
  comPorVendedor(m.id).forEach((g) => r.addRow([g.persona_id ? comNombrePersona(g.persona_id) : g.texto, g.t.filas, g.t.ventas, g.t.efectivo, g.t.deposito, g.t.vendedor, g.t.empresa]));
  for (let c = 3; c <= 7; c++) r.getColumn(c).numFmt = "#,##0.00";
  stfDescargar(new Blob([await wb.xlsx.writeBuffer()]), `Comisiones_${nombreArchivo(comNombreMes(m))}.xlsx`);
}

// =====================================================
// IMPORTAR EXCEL DEL SISTEMA DE VENTAS
// =====================================================
const COM_COLUMNAS = {
  fecha: ["fecha", "date"],
  proveedor: ["proveedor", "vendor", "supplier"],
  actividad: ["actividad", "activity", "servicio", "service"],
  cliente: ["cliente", "client", "customer"],
  vendedor: ["vendedor", "salesperson", "seller", "agente", "agent"],
  orden: ["orden", "purchaseorder", "order", "po", "ordendecompra"],
  tipo: ["tipo", "type", "paymenttype", "tipodepago"],
  pax: ["pax", "paxnumber", "personas", "cantidad"],
  rack: ["rack", "precio", "price"],
  neto: ["neto", "net", "netotc", "costo", "cost"],
  totalrack: ["totalrack"]
};
const comClave = (t) => comNorm(t).replace(/[^a-z0-9]/g, "");
function comValorCelda(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    if ("result" in v) return comValorCelda(v.result);
    if (v.richText) return v.richText.map((x) => x.text).join("");
    if ("text" in v) return v.text;
    if (v.error) return null;
  }
  return v;
}
function comNumero(v) {
  if (typeof v === "number") return v;
  const t = String(v ?? "").replace(/[$₡\s]/g, "");
  if (!t) return 0;
  // 1.234,56 o 1,234.56
  const n = /,\d{1,2}$/.test(t) ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  return Number(n) || 0;
}
function comFecha(v, mes, anio) {
  if (v instanceof Date) return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
  if (typeof v === "number" && v > 30000) { const d = new Date(Date.UTC(1899, 11, 30) + v * 864e5); return comFecha(d); }
  const m = String(v ?? "").match(/(\d{1,4})[/-](\d{1,2})[/-](\d{1,4})/);
  if (!m) return null;
  let [a, b, c] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (a > 31) return `${a}-${pad(b)}-${pad(c)}`;   // 2026-10-31
  // mes/día o día/mes: se elige el que coincide con el mes del reporte
  let mesF = a, dia = b;
  if (a > 12 || (b === mes && a !== mes)) { mesF = b; dia = a; }
  const d = new Date(c, mesF - 1, dia);
  return d.getMonth() === mesF - 1 ? `${c}-${pad(mesF)}-${pad(dia)}` : null;
}
function comTipoDe(t) {
  const k = comNorm(t);
  if (k === "cash" || k === "efectivo") return "cash";
  if (["cash invoiced", "cash facturado", "efectivo facturado", "invoiced"].includes(k)) return "cash_facturado";
  if (["tc", "tarjeta", "credit card", "card", "tarjeta de credito"].includes(k)) return "tc";
  return null;
}
function comBuscarPersona(texto) {
  const k = comNorm(texto);
  if (!k) return null;
  if (com.alias.has(k)) return com.alias.get(k);
  const pal = k.split(" ");
  const candidatos = stf.personas.filter((p) => {
    const q = comNorm(p.nombre).split(" ");
    return pal.length >= 2 && pal.every((w) => q.includes(w)) || q.length >= 2 && q.every((w) => pal.includes(w));
  });
  return candidatos.length === 1 ? candidatos[0].id : null;
}

async function comLeerArchivo(archivo) {
  const m = comMes(com.actual);
  const ExcelJS = await stfCargarExcel();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await archivo.arrayBuffer());
  const hojas = [];
  wb.eachSheet((ws) => {
    for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
      const cab = (ws.getRow(r).values || []).map((x) => comClave(comValorCelda(x)));
      const col = {};
      for (const [k, sin] of Object.entries(COM_COLUMNAS)) { const i = cab.findIndex((c) => sin.includes(c)); if (i > 0) col[k] = i; }
      if (col.vendedor && col.tipo && (col.rack || col.totalrack)) { hojas.push({ ws, fila: r, col }); break; }
    }
  });
  if (!hojas.length) return avisar("No encontré las columnas del reporte (Vendedor, Tipo, Rack, Neto…). Revise el archivo.", "error");
  com.importe = { archivo: archivo.name, hojas: hojas.map((h) => h.ws.name), hoja: 0, datos: hojas, filas: [] };
  // Si hay varias hojas, se propone la del mes del reporte
  const iMes = hojas.findIndex((h) => comNorm(h.ws.name).startsWith(comNorm(MESES[m.mes - 1]).slice(0, 3)));
  com.importe.hoja = iMes >= 0 ? iMes : 0;
  comArmarImporte();
  comFormImporte();
}
function comArmarImporte() {
  const m = comMes(com.actual);
  const { ws, fila, col } = com.importe.datos[com.importe.hoja];
  const existentes = new Set(comVentasMes(m.id).map((v) => [v.orden, v.actividad, v.cliente, n2(v.pax), n2(v.rack)].map(comNorm).join("|")));
  const filas = [];
  for (let r = fila + 1; r <= ws.rowCount; r++) {
    const vals = ws.getRow(r).values || [];
    const c = (k) => (col[k] ? comValorCelda(vals[col[k]]) : null);
    const vendedor = String(c("vendedor") ?? "").trim();
    if (!vendedor) continue;
    const pax = comNumero(c("pax")) || 1;
    const rack = col.rack ? comNumero(c("rack")) : comNumero(c("totalrack")) / pax;
    const tipoTxt = String(c("tipo") ?? "").trim();
    const tipo = comTipoDe(tipoTxt);
    const v = {
      fecha: comFecha(c("fecha"), m.mes, m.anio), proveedor: c("proveedor") ? String(c("proveedor")).trim() : null,
      actividad: c("actividad") ? String(c("actividad")).trim() : null, cliente: c("cliente") ? String(c("cliente")).trim() : null,
      vendedor_texto: vendedor, persona_id: comBuscarPersona(vendedor), orden: c("orden") ? String(c("orden")).trim() : null,
      tipo, estado: tipo ? "valida" : "revisar", estado_original: tipoTxt || null, pax, rack: Math.round(rack * 10000) / 10000, neto: comNumero(c("neto"))
    };
    v.duplicada = existentes.has([v.orden, v.actividad, v.cliente, v.pax, v.rack].map(comNorm).join("|"));
    v.otroMes = v.fecha && Number(v.fecha.slice(5, 7)) !== m.mes;
    filas.push(v);
  }
  com.importe.filas = filas;
}
function comFormImporte() {
  const I = com.importe, m = comMes(com.actual);
  const nuevas = I.filas.filter((f) => !f.duplicada);
  const sinPersona = [...new Set(nuevas.filter((f) => !f.persona_id).map((f) => f.vendedor_texto))];
  const porTipo = (t) => nuevas.filter((f) => f.tipo === t).length;
  const revisar = nuevas.filter((f) => f.estado === "revisar");
  const otroMes = nuevas.filter((f) => f.otroMes).length;
  const vendedores = stf.personas.filter((p) => p.departamento === "Operaciones" || p.departamento === "Administración").sort((a, b) => a.nombre.localeCompare(b.nombre));
  comModal(comNombreMes(m), "Importar ventas", `
    <p class="nota">Archivo: <strong>${escapar(I.archivo)}</strong></p>
    ${I.hojas.length > 1 ? `<label>Hoja del archivo <select id="comImpHoja">${I.hojas.map((h, i) => `<option value="${i}" ${i === I.hoja ? "selected" : ""}>${escapar(h)}</option>`).join("")}</select></label>` : ""}
    <ul class="pla-lista">
      <li><strong>${nuevas.length}</strong> ventas nuevas: ${porTipo("cash")} Cash · ${porTipo("cash_facturado")} Cash facturado · ${porTipo("tc")} TC</li>
      ${I.filas.length - nuevas.length ? `<li>${I.filas.length - nuevas.length} ya estaban en el mes y no se vuelven a agregar.</li>` : ""}
      ${revisar.length ? `<li>⚠️ <strong>${revisar.length}</strong> quedan <strong>por revisar</strong> (${[...new Set(revisar.map((f) => f.estado_original || "sin tipo"))].map(escapar).join(", ")}): no suman comisión hasta que usted decida.</li>` : ""}
      ${otroMes ? `<li>⚠️ ${otroMes} venta(s) tienen fecha de otro mes. Revise que sea el archivo correcto.</li>` : ""}
    </ul>
    ${sinPersona.length ? `
      <h3>¿Quién es cada vendedor?</h3>
      <p class="nota">Estos nombres no coinciden con ninguna ficha. El sistema lo recordará para los próximos meses.</p>
      <div class="com-form">${sinPersona.map((n) => `<label>${escapar(n)} <select data-com-alias="${escapar(n)}"><option value="">— Elija —</option>${vendedores.map((p) => `<option value="${p.id}">${escapar(p.nombre)}</option>`).join("")}</select></label>`).join("")}</div>` : ""}`,
    `<button type="button" class="btn primario" data-com-modal="importar" ${nuevas.length ? "" : "disabled"}>Importar ${nuevas.length} ventas</button>`);
}
async function comConfirmarImporte() {
  const I = com.importe;
  const elegidos = [...document.querySelectorAll("[data-com-alias]")].map((s) => [s.dataset.comAlias, Number(s.value) || null]);
  if (elegidos.some(([, id]) => !id)) return avisar("Elija la ficha de cada vendedor.", "error");
  if (elegidos.length) {
    const { error } = await db.from("com_alias").upsert(elegidos.map(([t, id]) => ({ texto: comNorm(t), persona_id: id })));
    if (error) return fallo(error);
    elegidos.forEach(([t, id]) => com.alias.set(comNorm(t), id));
  }
  const filas = I.filas.filter((f) => !f.duplicada).map(({ duplicada, otroMes, ...f }) => ({
    ...f, persona_id: f.persona_id || com.alias.get(comNorm(f.vendedor_texto)) || null, mes_id: com.actual, creado_por: app.yo.id
  }));
  for (let i = 0; i < filas.length; i += 200) {
    const { error } = await db.from("com_ventas").insert(filas.slice(i, i + 200));
    if (error) return fallo(error, "No se pudieron importar las ventas.");
  }
  stfCerrarModal();
  com.importe = null;
  avisar(`Se importaron ${filas.length} ventas.`);
  await comCargar(); comPintar();
}

// =====================================================
// EVENTOS
// =====================================================
$("staffContenido").addEventListener("click", (e) => {
  if (stf.pestana !== "comisiones") return;
  const b = e.target.closest("[data-com-accion]");
  if (!b) return;
  const m = comMes(com.actual);
  const acciones = {
    "abrir": () => { com.actual = Number(b.dataset.id); com.filtroVend = ""; comPintar(); window.scrollTo(0, 0); },
    "volver": () => { com.actual = null; comPintar(); },
    "crear-mes": () => comCrearMes(),
    "guardar-ajustes": () => comGuardarAjustes(),
    "cerrar": () => comCerrar(m),
    "reabrir": () => comReabrir(m),
    "nueva-venta": () => comFormVenta(),
    "editar-venta": () => comFormVenta(com.ventas.find((v) => v.id === Number(b.dataset.id))),
    "borrar-venta": () => comBorrarVenta(b.dataset.id),
    "no-pagar": () => comDecidir(b.dataset.id, { estado: "no_pagar" }),
    "filtrar": () => { com.filtroVend = b.dataset.persona || (b.dataset.texto ? `?${b.dataset.texto}` : ""); comPintar(); },
    "pagar": () => comFormPago(b.dataset.forma, b.dataset.persona),
    "ver-pago": () => comVerPago(b.dataset.id),
    "comprobante": () => comImprimirComprobante(b.dataset.persona),
    "imprimir": () => comImprimirReporte(),
    "excel": () => comExcel().catch((err) => fallo(err, "No se pudo generar el Excel.")),
    "confirmar": async () => {
      if (!confirm("¿Confirma que recibió este pago?")) return;
      const { error } = await db.rpc("com_confirmar_pago", { p_id: Number(b.dataset.id) });
      if (error) return fallo(error);
      avisar("¡Gracias! Pago confirmado.");
      await comCargar(); comPintar();
    },
    "ver-archivo": () => comVerArchivo(b.dataset.ruta)
  };
  if (acciones[b.dataset.comAccion]) conBoton(b, async () => { await acciones[b.dataset.comAccion](); });
});
$("staffContenido").addEventListener("change", (e) => {
  if (stf.pestana !== "comisiones") return;
  const t = e.target;
  if (t.id === "comAnio") { com.anio = Number(t.value); return comPintar(); }
  if (t.id === "comMiMes") { com.actual = Number(t.value); return comPintar(); }
  if (t.id === "comArchivo" && t.files[0]) {
    const f = t.files[0]; t.value = "";
    return comLeerArchivo(f).catch((err) => fallo(err, "No se pudo leer el archivo."));
  }
  if (t.dataset.comCobro && t.value) {
    if (!confirm(`¿El cliente pagó y la venta se cobró como ${COM_TIPOS[t.value]}? Pasará a sumar comisión.`)) { t.value = ""; return; }
    return comDecidir(t.dataset.comCobro, { tipo: t.value, estado: "valida" });
  }
});
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-com-modal]");
  if (!b || $("staffModal").hidden) return;
  const a = b.dataset.comModal;
  const acciones = {
    "guardar-venta": () => comGuardarVenta(b.dataset.id ? Number(b.dataset.id) : null),
    "guardar-pago": () => comGuardarPago(b.dataset.forma, b.dataset.persona),
    "importar": () => comConfirmarImporte(),
    "ver-archivo": () => comVerArchivo(b.dataset.ruta),
    "imprimir-pago": () => { stfCerrarModal(); comImprimirComprobante(b.dataset.persona, b.dataset.forma); },
    "anular-pago": () => comAnularPago(b.dataset.id)
  };
  if (acciones[a]) conBoton(b, async () => { await acciones[a](); });
});
document.addEventListener("input", (e) => {
  if ($("staffModal").hidden) return;
  if (["cvTipo", "cvPax", "cvRack", "cvNeto"].includes(e.target.id)) comPrevisualizarVenta();
});
document.addEventListener("change", (e) => {
  if (e.target.id === "cvTipo") comPrevisualizarVenta();
  if (e.target.id === "comImpHoja") { com.importe.hoja = Number(e.target.value); comArmarImporte(); comFormImporte(); }
});
