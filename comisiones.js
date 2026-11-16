// =====================================================
// STAFF › COMISIONES POR VENTAS
//  · Administración: un reporte por mes (importar Excel o agregar a mano),
//    ventas por revisar, resumen por vendedor, pagos y comprobantes.
//  · Solo administradores (el reporte incluye la utilidad de la empresa).
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
  soloPendientes: false, // ver solo líneas sin revisar contra el sistema de ventas
  importe: null        // vista previa de importación
};

const comAdmin = () => puede("comisiones");
const comVe = () => comAdmin();
const usd = (n) => colones(n, 2).replace("₡", "$");
const comNorm = (t) => String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const comMes = (id) => com.meses.find((m) => m.id === Number(id));
const comNombreMes = (m) => m ? `${MESES[m.mes - 1]} ${m.anio}` : "";
const comVentasMes = (id) => com.ventas.filter((v) => v.mes_id === Number(id));
const comNombrePersona = (id) => personaPorId(id)?.nombre || "Sin asignar";
const comEditable = (m) => m && m.estado === "abierto" && !m.historico;
const n2 = (x) => Number(x) || 0;

// Ventana con el formato del sistema: título arriba con sus botones, contenido abajo
function comModal(sub, titulo, cuerpo, botones, ancho = "", cerrar = "") {
  stfAbrirModal(`
    <div class="det-cabeza" style="--c: var(--verde)">
      <div><p class="det-numero">${sub}</p><h2 id="stfModalTitulo">${titulo}</h2></div>
      <div class="det-acciones"><button type="button" class="btn" data-stf-accion="cerrar-modal">${cerrar || (botones ? "Cancelar" : "Cerrar")}</button>${botones}</div>
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
const comRevision = (ventas) => ({ total: ventas.length, listas: ventas.filter((v) => v.revisada_en).length });
const comNombreUsuario = (uid) => stf.personas.find((p) => p.perfil_id === uid)?.nombre || (uid === app.yo?.id ? app.yo?.nombre : "") || "";
const comPago = (mesId, personaId, forma) => com.pagos.find((p) => p.mes_id === Number(mesId) && p.persona_id === Number(personaId) && p.forma === forma);

// =====================================================
// PINTAR
// =====================================================
function comPintar() {
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
    const rv = comRevision(comVentasMes(m.id));
    const grupos = comPorVendedor(m.id).filter((g) => g.persona_id);
    const pend = m.historico ? null : grupos.reduce((s, g) => s + ["efectivo", "deposito"].filter((f) => g.t[f] > 0 && !comPago(m.id, g.persona_id, f)).length, 0);
    return `
      <tr>
        <td><button type="button" class="enlace" data-com-accion="abrir" data-id="${m.id}"><strong>${comNombreMes(m)}</strong></button>${m.historico ? `<small>Del Excel</small>` : ""}</td>
        <td>${comChipEstado(m)}${t.revisar ? ` <span class="stf-chip aviso">${t.revisar} por revisar</span>` : ""}${!m.historico && rv.total ? ` <span class="stf-chip ${rv.listas === rv.total ? "ok" : "gris"}">✔ ${rv.listas}/${rv.total}</span>` : ""}</td>
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
      if (pg) return `<td class="centro"><span class="stf-chip ok">✓ Pagado ${fechaCorta(pg.fecha)}</span><br><button type="button" class="enlace" data-com-accion="ver-pago" data-id="${pg.id}">Ver pago</button></td>`;
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
        <td class="pla-acc">${g.persona_id ? `<button type="button" class="enlace" data-com-accion="imagenes" data-persona="${g.persona_id}">Imágenes</button><button type="button" class="enlace" data-com-accion="comprobante" data-persona="${g.persona_id}">Comprobante</button>` : ""}</td>
      </tr>`;
  }).join("");

  const filtro = com.filtroVend;
  const revisable = !m.historico;
  const delVend = ventas.filter((v) => !filtro || String(v.persona_id ?? `?${v.vendedor_texto}`) === filtro);
  const lista = delVend.filter((v) => !(revisable && com.soloPendientes && v.revisada_en));
  const rev = comRevision(ventas), revVend = comRevision(delVend);
  const checkRev = (v) => {
    if (!revisable) return "";
    const quien = v.revisada_en ? `Revisada el ${fechaHora(v.revisada_en)}${v.revisada_por ? ` por ${escapar(comNombreUsuario(v.revisada_por))}` : ""}` : "Sin revisar contra el sistema";
    return `<td class="com-check"><label title="${quien}"><input type="checkbox" data-com-rev="${v.id}" ${v.revisada_en ? "checked" : ""} ${ed ? "" : "disabled"} aria-label="Línea ${escapar(v.orden || "")} revisada"></label></td>`;
  };
  const filasVentas = lista.map((v) => `
    <tr class="${v.estado !== "valida" ? "inactivo" : ""} ${revisable && v.revisada_en ? "com-ok" : ""}">
      ${checkRev(v)}
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
      ${revisable && rev.total ? `<span class="stf-chip ${rev.listas === rev.total ? "ok" : "aviso"}">✔ ${rev.listas} de ${rev.total} líneas revisadas</span>` : ""}
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
      ${revisable && revVend.total ? `
      <div class="com-progreso">
        <div class="com-barra" role="progressbar" aria-valuemin="0" aria-valuemax="${revVend.total}" aria-valuenow="${revVend.listas}"><span style="width:${Math.round(revVend.listas / revVend.total * 100)}%"></span></div>
        <span><strong>${revVend.listas} de ${revVend.total}</strong> líneas revisadas contra el sistema de ventas</span>
        <label class="stf-inline"><input type="checkbox" id="comSoloPend" ${com.soloPendientes ? "checked" : ""}> Ver solo las que faltan</label>
        ${ed && revVend.listas < revVend.total ? `<button type="button" class="btn chico" data-com-accion="revisar-todas">Marcar ${filtro ? "las de este vendedor" : "todas"} como revisadas</button>` : ""}
      </div>` : ""}
      ${noPagar.length && !filtro ? `<p class="nota">${noPagar.length} venta${noPagar.length > 1 ? "s" : ""} marcada${noPagar.length > 1 ? "s" : ""} “No se paga” (aparecen en gris).</p>` : ""}
      <div class="tabla-scroll"><table class="tabla pla-tabla com-ventas">
        <thead><tr>${revisable ? `<th class="com-check" title="Revisada contra el sistema de ventas">✔</th>` : ""}<th>Fecha</th><th>Orden</th><th>Actividad</th><th>Cliente</th><th>Vendedor</th><th>Tipo</th><th class="num">Pax</th><th class="num">Total</th><th class="num">IVA</th><th class="num">Datáfono</th><th class="num">Costo</th><th class="num">Ganancia</th><th class="num">Vendedor</th><th class="num">Empresa</th>${ed ? "<th></th>" : ""}</tr></thead>
        <tbody>${filasVentas || `<tr><td colspan="16" class="nota">${com.soloPendientes && delVend.length ? "✔ Todas las líneas están revisadas." : "Sin ventas."}</td></tr>`}</tbody>
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
  const rv = comRevision(comVentasMes(m.id));
  if (rv.listas < rv.total && !confirm(`Faltan ${rv.total - rv.listas} de ${rv.total} líneas por revisar contra el sistema de ventas. ¿Cerrar el mes de todos modos?`)) return;
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
  if (id) { fila.revisada_en = null; fila.revisada_por = null; }   // si cambió, hay que volver a revisarla
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
// Marca o desmarca líneas como revisadas contra el sistema de ventas (sin recargar todo)
async function comMarcarRevisadas(ids, marcar) {
  const cambios = marcar ? { revisada_en: new Date().toISOString(), revisada_por: app.yo.id } : { revisada_en: null, revisada_por: null };
  for (let i = 0; i < ids.length; i += 200) {
    const { error } = await db.from("com_ventas").update(cambios).in("id", ids.slice(i, i + 200));
    if (error) { fallo(error); return comPintar(); }
  }
  com.ventas.forEach((v) => { if (ids.includes(v.id)) Object.assign(v, cambios); });
  comPintar();
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
      <p class="nota ancho">Al guardar se abre el comprobante para imprimir y firmar.</p>`}
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
  avisar("Pago registrado.");
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
    </dl>`, `
      ${pg.archivo ? `<button type="button" class="btn" data-com-modal="ver-archivo" data-ruta="${escapar(pg.archivo)}">Ver comprobante</button>` : ""}
      <button type="button" class="btn" data-com-modal="imprimir-pago" data-persona="${pg.persona_id}" data-forma="${pg.forma}">Imprimir</button>
      <button type="button" class="btn peligro" data-com-modal="anular-pago" data-id="${pg.id}">Anular pago</button>`, "", "Cerrar");
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
        ${pg ? `<p>Fecha de pago: ${fechaAnio(pg.fecha)}${pg.banco ? ` · Banco: ${escapar(pg.banco)}` : ""}${pg.referencia ? ` · Comprobante: ${escapar(pg.referencia)}` : ""}</p>` : ""}
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
// =====================================================
// IMÁGENES PARA EL VENDEDOR
//  · Imagen 1: facturas Cash (comisión en efectivo)
//  · Imagen 2: facturas TC + Cash facturado (comisión por depósito)
//  Muestran cada línea revisada y cuánto generó; no muestran la utilidad de la empresa.
// =====================================================
const COM_IMG = {
  efectivo: { tipos: ["cash"], titulo: "Facturas Cash", sub: "Comisión pagada en efectivo", archivo: "Cash" },
  deposito: { tipos: ["cash_facturado", "tc"], titulo: "Facturas TC y Cash facturado", sub: "Comisión pagada por depósito bancario", archivo: "TC_y_Cash_facturado" }
};
const COM_TIPO_CORTO = { cash: "Cash", cash_facturado: "Cash facturado", tc: "TC" };
let comImgs = {};   // grupo → { blob, url, nombre }

async function comImagenesVendedor(personaId) {
  const m = comMes(com.actual);
  const g = comPorVendedor(m.id).find((x) => x.persona_id === Number(personaId));
  if (!g) return;
  Object.values(comImgs).forEach((i) => URL.revokeObjectURL(i.url));
  comImgs = {};
  try { await document.fonts?.ready; } catch { /* sin fuentes web: se usa la del sistema */ }
  const excluidas = g.ventas.filter((v) => v.estado !== "valida");
  const grupos = Object.keys(COM_IMG).filter((k) => g.ventas.some((v) => v.estado === "valida" && COM_IMG[k].tipos.includes(v.tipo)));
  if (!grupos.length) return avisar("Este vendedor no tiene ventas válidas en el mes.", "error");
  for (const k of grupos) {
    const blob = await comDibujarImagen(m, g, k, k === grupos[0] ? excluidas : []);
    const nombre = `Comisiones_${nombreArchivo(comNombreMes(m))}_${nombreArchivo(comNombrePersona(personaId))}_${COM_IMG[k].archivo}.png`;
    comImgs[k] = { blob, url: URL.createObjectURL(blob), nombre };
  }
  const compartir = !!navigator.canShare;
  comModal(comNombreMes(m), `Imágenes para ${escapar(comNombrePersona(personaId))}`, `
    <p class="nota">Descárguelas o compártalas para enviarlas al vendedor. Muestran cada factura revisada y cuánto generó; no incluyen la utilidad de la empresa.${m.estado === "abierto" ? " <strong>El mes está abierto: las imágenes dicen “preliminar”.</strong>" : ""}</p>
    <div class="com-imgs">${grupos.map((k) => `
      <figure class="com-img">
        <figcaption><strong>${COM_IMG[k].titulo}</strong><small>${COM_IMG[k].sub}</small></figcaption>
        <a href="${comImgs[k].url}" target="_blank" rel="noopener"><img src="${comImgs[k].url}" alt="${COM_IMG[k].titulo} de ${escapar(comNombrePersona(personaId))}"></a>
        <div class="com-img-btns">
          <button type="button" class="btn chico" data-com-modal="img-descargar" data-grupo="${k}">Descargar</button>
          ${compartir ? `<button type="button" class="btn chico" data-com-modal="img-compartir" data-grupo="${k}">Compartir</button>` : ""}
        </div>
      </figure>`).join("")}
    </div>`,
    grupos.length > 1 ? `<button type="button" class="btn primario" data-com-modal="img-todas">Descargar ambas</button>` : "", "", "Cerrar");
}
function comImgDescargar(grupo) {
  const lista = grupo ? [comImgs[grupo]] : Object.values(comImgs);
  lista.forEach((i, n) => setTimeout(() => stfDescargar(i.blob, i.nombre), n * 400));
}
async function comImgCompartir(grupo) {
  const i = comImgs[grupo];
  const archivo = new File([i.blob], i.nombre, { type: "image/png" });
  if (!navigator.canShare?.({ files: [archivo] })) { avisar("Este equipo no permite compartir imágenes. Se descargará."); return comImgDescargar(grupo); }
  try { await navigator.share({ files: [archivo], title: i.nombre }); } catch (e) { if (e.name !== "AbortError") throw e; }
}

function comDibujarImagen(m, g, grupo, excluidas) {
  const def = COM_IMG[grupo];
  const p = m.parametros || com.ajustes;
  const vs = g.ventas.filter((v) => v.estado === "valida" && def.tipos.includes(v.tipo))
    .sort((a, b) => def.tipos.indexOf(a.tipo) - def.tipos.indexOf(b.tipo) || String(a.fecha).localeCompare(String(b.fecha)));
  const dep = grupo === "deposito";
  const suma = (lista) => lista.reduce((s, v) => ({ n: s.n + 1, total: s.total + v.total_rack, iva: s.iva + v.iva, dat: s.dat + v.datafono, costo: s.costo + v.total_neto, gan: s.gan + v.ganancia, com: s.com + v.com_vendedor }), { n: 0, total: 0, iva: 0, dat: 0, costo: 0, gan: 0, com: 0 });
  const T = suma(vs);

  // Columnas: [título, ancho, alineación, valor de la venta, valor del subtotal]
  const cols = dep ? [
    ["Fecha", 64, "l", (v) => v.fecha ? fechaCorta(v.fecha) : "—"], ["Orden", 72, "l", (v) => v.orden || ""],
    ["Actividad", 226, "l", (v) => v.actividad || ""], ["Cliente", 150, "l", (v) => v.cliente || ""],
    ["Tipo", 126, "l", (v) => COM_TIPO_CORTO[v.tipo]], ["Pax", 46, "r", (v) => horasTxt(v.pax), (s) => ""],
    ["Total", 100, "r", (v) => usd(v.total_rack), (s) => usd(s.total)], ["IVA", 88, "r", (v) => v.iva ? usd(v.iva) : "", (s) => usd(s.iva)],
    ["Datáfono", 92, "r", (v) => v.datafono ? usd(v.datafono) : "", (s) => s.dat ? usd(s.dat) : ""], ["Costo", 100, "r", (v) => usd(v.total_neto), (s) => usd(s.costo)],
    ["Ganancia", 98, "r", (v) => usd(v.ganancia), (s) => usd(s.gan)], ["Comisión", 98, "r", (v) => usd(v.com_vendedor), (s) => usd(s.com)]
  ] : [
    ["Fecha", 70, "l", (v) => v.fecha ? fechaCorta(v.fecha) : "—"], ["Orden", 80, "l", (v) => v.orden || ""],
    ["Actividad", 300, "l", (v) => v.actividad || ""], ["Cliente", 190, "l", (v) => v.cliente || ""],
    ["Pax", 45, "r", (v) => horasTxt(v.pax), (s) => ""], ["Total", 85, "r", (v) => usd(v.total_rack), (s) => usd(s.total)],
    ["Costo", 85, "r", (v) => usd(v.total_neto), (s) => usd(s.costo)], ["Ganancia", 85, "r", (v) => usd(v.ganancia), (s) => usd(s.gan)],
    ["Comisión", 80, "r", (v) => usd(v.com_vendedor), (s) => usd(s.com)]
  ];

  // Lista de lo que se dibuja en la tabla
  const items = [];
  for (const tipo of def.tipos) {
    const delTipo = vs.filter((v) => v.tipo === tipo);
    if (!delTipo.length) continue;
    delTipo.forEach((v) => items.push({ k: "fila", v }));
    if (dep) items.push({ k: "sub", txt: `Subtotal ${COM_TIPOS[tipo]} (${delTipo.length})`, s: suma(delTipo) });
  }
  items.push({ k: "total", txt: `Total (${T.n} factura${T.n === 1 ? "" : "s"})`, s: T });

  const X = 40, W = 2 * X + cols.reduce((a, col) => a + col[1], 0), ALTO = { fila: 38, sub: 32, total: 38 };
  const pg = comPago(m.id, g.persona_id, grupo);
  const notas = excluidas.map((v) => `${v.orden || "s/n"} · ${v.actividad || ""} · ${v.cliente || ""} — ${v.estado === "no_pagar" ? "No se paga" : `Por revisar (${v.estado_original || "sin tipo"})`}`);
  const H = 92 + 96 + 96 + 34 + items.reduce((s, i) => s + ALTO[i.k], 0) + 24 + (notas.length ? 30 + notas.length * 22 + 8 : 0) + 30 + 54;

  const esc = 2;
  const lienzo = document.createElement("canvas");
  lienzo.width = W * esc; lienzo.height = H * esc;
  const c = lienzo.getContext("2d");
  c.scale(esc, esc);
  const F = (peso, tam) => `${peso} ${tam}px Karla, "Segoe UI", system-ui, sans-serif`;
  const FT = (tam) => `700 ${tam}px "Bricolage Grotesque", "Segoe UI", system-ui, sans-serif`;
  const recortar = (t, ancho) => {
    t = String(t ?? "");
    if (c.measureText(t).width <= ancho) return t;
    while (t.length > 1 && c.measureText(t + "…").width > ancho) t = t.slice(0, -1);
    return t + "…";
  };
  const texto = (t, x, y, ancho, alin = "l") => {
    const s = recortar(t, ancho);
    c.textAlign = alin === "r" ? "right" : "left";
    c.fillText(s, alin === "r" ? x + ancho : x, y);
  };

  // Fondo y encabezado
  c.fillStyle = "#FFFFFF"; c.fillRect(0, 0, W, H);
  c.fillStyle = "#2F6E4F"; c.fillRect(0, 0, W, 72);
  c.fillStyle = "#FFFFFF"; c.textBaseline = "middle";
  c.font = FT(24); texto("The House of Tours · Home Vacations CR", X, 36, 640);
  c.font = F(600, 16); texto(`Comisiones · ${comNombreMes(m)}`, W - X - 360, 36, 360, "r");
  let y = 92;

  // Título y vendedor
  c.textBaseline = "alphabetic"; c.fillStyle = "#23343D";
  c.font = FT(26); texto(def.titulo, X, y + 30, 640);
  c.font = F(400, 16); c.fillStyle = "#5B6B72"; texto(def.sub, X, y + 56, 640);
  c.font = F(700, 20); c.fillStyle = "#23343D"; texto(comNombrePersona(g.persona_id), W - X - 420, y + 30, 420, "r");
  c.font = F(400, 15); c.fillStyle = m.estado === "abierto" ? "#8A3B12" : "#5B6B72";
  texto(m.estado === "abierto" ? "Preliminar · mes abierto" : "Mes cerrado", W - X - 420, y + 56, 420, "r");
  c.fillStyle = "#5B6B72"; c.font = F(400, 13);
  texto(`IVA ${p.iva}% incluido en el precio${dep ? ` · datáfono ${p.datafono}% en TC` : ""} · comisión ${p.vendedor}% de la ganancia`, X, y + 80, W - 2 * X);
  y += 96;

  // Tarjetas
  const tarjetas = [["Facturas", String(T.n)], ["Total vendido", usd(T.total)], ["Ganancia", usd(T.gan)], ["Su comisión", usd(T.com)]];
  const tw = (W - 2 * X - 3 * 12) / 4;
  tarjetas.forEach(([et, val], i) => {
    const tx = X + i * (tw + 12), dest = i === 3;
    c.fillStyle = dest ? "#2F6E4F" : "#F1F5F3";
    c.beginPath(); c.roundRect ? c.roundRect(tx, y, tw, 78, 10) : c.rect(tx, y, tw, 78); c.fill();
    c.fillStyle = dest ? "#E4EFE8" : "#5B6B72"; c.font = F(400, 14); texto(et, tx + 16, y + 28, tw - 32);
    c.fillStyle = dest ? "#FFFFFF" : "#23343D"; c.font = F(700, 26); texto(val, tx + 16, y + 62, tw - 32);
  });
  y += 96;

  // Encabezado de la tabla
  c.fillStyle = "#E4EFE8"; c.fillRect(X, y, W - 2 * X, 34);
  c.fillStyle = "#1F4F38"; c.font = F(700, 13); c.textBaseline = "middle";
  let cx = X;
  cols.forEach(([t, w, al]) => { texto(t.toUpperCase(), cx + 6, y + 17, w - 12, al); cx += w; });
  y += 34;

  // Filas
  let par = false;
  for (const it of items) {
    const h = ALTO[it.k];
    cx = X;
    if (it.k === "fila") {
      if (par) { c.fillStyle = "#F7FAF8"; c.fillRect(X, y, W - 2 * X, h); }
      par = !par;
      cols.forEach(([t, w, al, fv]) => {
        if (t === "Actividad") {
          c.fillStyle = "#23343D"; c.font = F(400, 14); texto(fv(it.v), cx + 6, y + 14, w - 12);
          c.fillStyle = "#5B6B72"; c.font = F(400, 11.5); texto(it.v.proveedor || "", cx + 6, y + 29, w - 12);
        } else {
          c.fillStyle = "#23343D"; c.font = F(t === "Comisión" ? 700 : 400, 14); texto(fv(it.v), cx + 6, y + h / 2, w - 12, al);
        }
        cx += w;
      });
      c.strokeStyle = "#E3E9E6"; c.lineWidth = 1;
    } else {
      const total = it.k === "total";
      c.fillStyle = total ? "#2F6E4F" : "#EEF3F0"; c.fillRect(X, y, W - 2 * X, h);
      c.fillStyle = total ? "#FFFFFF" : "#23343D"; c.font = F(700, total ? 15 : 14);
      const primeras = cols.findIndex((col) => col[4]);
      const anchoEt = cols.slice(0, primeras).reduce((s, col) => s + col[1], 0);
      texto(it.txt, X + 6, y + h / 2, anchoEt - 12);
      cx = X + anchoEt;
      cols.slice(primeras).forEach(([, w, al, , fs]) => { texto(fs(it.s), cx + 6, y + h / 2, w - 12, al); cx += w; });
      par = false;
    }
    c.beginPath(); c.moveTo(X, y + h - 0.5); c.lineTo(W - X, y + h - 0.5); c.strokeStyle = "#D5DEDA"; c.stroke();
    y += h;
  }
  y += 24;

  // Ventas que no suman comisión
  c.textBaseline = "alphabetic";
  if (notas.length) {
    c.fillStyle = "#8A3B12"; c.font = F(700, 15);
    texto(`Revisadas que no suman comisión (${notas.length})`, X, y + 18, W - 2 * X);
    y += 30;
    c.fillStyle = "#5B6B72"; c.font = F(400, 13.5);
    notas.forEach((n) => { texto("• " + n, X, y + 14, W - 2 * X); y += 22; });
    y += 8;
  }

  // Estado del pago
  c.font = F(700, 15);
  c.fillStyle = pg ? "#2F6E4F" : "#8A3B12";
  texto(pg ? `✓ ${dep ? "Depositado" : "Pagado en efectivo"} el ${fechaAnio(pg.fecha)}: ${usd(pg.monto)}${pg.banco ? ` · ${pg.banco}` : ""}${pg.referencia ? ` · Comprobante ${pg.referencia}` : ""}` : `Pendiente de pago: ${usd(T.com)}`, X, y + 16, W - 2 * X);
  y += 30;

  // Pie
  c.fillStyle = "#D5DEDA"; c.fillRect(X, y + 10, W - 2 * X, 1);
  c.fillStyle = "#5B6B72"; c.font = F(400, 12);
  texto(`Generado el ${fechaHora(new Date().toISOString())} · THOT Sistema`, X, y + 34, W - 2 * X);

  return new Promise((ok, mal) => lienzo.toBlob((b) => (b ? ok(b) : mal(new Error("No se pudo crear la imagen."))), "image/png"));
}

// =====================================================
// EXCEL: hoja "Reporte general" (totales por tipo, por vendedor, pagos y utilidad)
// =====================================================
function comHojaReporte(wb, m) {
  const ws = wb.addWorksheet("Reporte general");
  const p = m.parametros || {};
  const validas = comVentasMes(m.id).filter((v) => v.estado === "valida");
  const fmt = "#,##0.00";
  const L = (n) => String.fromCharCode(64 + n);
  ws.columns = [{ width: 32 }, ...Array(11).fill({ width: 15 })];
  const tit = (t) => { const r = ws.addRow([t]); r.font = { bold: true, size: 12, color: { argb: "FF1F4F38" } }; return r; };
  const cab = (vals) => {
    const r = ws.addRow(vals);
    r.font = { bold: true, color: { argb: "FFFFFFFF" } };
    r.alignment = { wrapText: true, vertical: "middle" };
    r.height = 32;
    vals.forEach((_, i) => { r.getCell(i + 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2F6E4F" } }; });
    return r;
  };
  const fila = (vals, desde, negrita = false) => {
    const r = ws.addRow(vals);
    for (let i = desde; i <= vals.length; i++) r.getCell(i).numFmt = fmt;
    if (negrita) { r.font = { bold: true }; vals.forEach((_, i) => { r.getCell(i + 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE4EFE8" } }; r.getCell(i + 1).border = { top: { style: "thin" } }; }); }
    return r;
  };
  const sumas = (desde, hasta, primera, ultima) => {
    const out = [];
    for (let c = desde; c <= hasta; c++) out.push({ formula: `SUM(${L(c)}${primera}:${L(c)}${ultima})` });
    return out;
  };

  const r1 = ws.addRow([`Reporte general de comisiones · ${comNombreMes(m)}`]);
  r1.font = { bold: true, size: 15 };
  ws.addRow([`The House of Tours · Home Vacations CR · ${m.estado === "cerrado" ? "Mes cerrado" : "Mes abierto (preliminar)"}`]);
  if (!m.historico) ws.addRow([`Cálculo: IVA ${p.iva}% incluido en el precio · datáfono ${p.datafono}% (solo TC) · vendedor ${p.vendedor}% de la ganancia`]);
  ws.addRow([]);

  // 1. Por tipo de venta
  tit("1. Ventas por tipo de venta");
  cab(["Tipo de venta", "Facturas", "Total vendido", "IVA", "Datáfono", "Costo", "Ganancia", "Comisión vendedores", "Utilidad empresa", "Pago de comisión"]);
  const i1 = ws.rowCount + 1;
  for (const [k, nombre] of Object.entries(COM_TIPOS)) {
    const vs = validas.filter((v) => v.tipo === k);
    const s = (c) => vs.reduce((a, v) => a + v[c], 0);
    const r = fila([nombre, vs.length, s("total_rack"), s("iva"), s("datafono"), s("total_neto"), s("ganancia"), s("com_vendedor"), s("com_empresa"), k === "cash" ? "Efectivo" : "Depósito"], 3);
    r.getCell(10).numFmt = "@";
  }
  const f1 = ws.rowCount;
  fila(["Total", ...sumas(2, 9, i1, f1)], 3, true).getCell(2).numFmt = "0";
  const filaTotalTipos = ws.rowCount;
  ws.addRow([]);

  // 2. Por vendedor
  tit("2. Ventas y comisiones por vendedor");
  cab(["Vendedor", "Facturas", "Vendido Cash", "Vendido Cash facturado", "Vendido TC", "Total vendido", "Comisión efectivo", "Comisión depósito", "Total comisión", "Comisión pagada", "Pendiente de pagar", "Utilidad empresa"]);
  const i2 = ws.rowCount + 1;
  for (const g of comPorVendedor(m.id)) {
    const vs = g.ventas.filter((v) => v.estado === "valida");
    const vend = (t) => vs.filter((v) => v.tipo === t).reduce((a, v) => a + v.total_rack, 0);
    const pagado = com.pagos.filter((x) => x.mes_id === m.id && x.persona_id === g.persona_id).reduce((a, x) => a + n2(x.monto), 0);
    const n = ws.rowCount + 1;
    fila([g.persona_id ? comNombrePersona(g.persona_id) : g.texto, g.t.filas, vend("cash"), vend("cash_facturado"), vend("tc"),
      { formula: `SUM(C${n}:E${n})` }, g.t.efectivo, g.t.deposito, { formula: `G${n}+H${n}` }, pagado, { formula: `I${n}-J${n}` }, g.t.empresa], 3);
  }
  const f2 = ws.rowCount;
  if (f2 >= i2) fila(["Total", ...sumas(2, 12, i2, f2)], 3, true).getCell(2).numFmt = "0";
  const filaTotalVend = ws.rowCount;
  ws.addRow([]);

  // 3. Pagos registrados
  tit("3. Comisiones pagadas");
  cab(["Vendedor", "Forma de pago", "Fecha de pago", "Monto", "Banco", "Comprobante", "Nota"]);
  const pagos = com.pagos.filter((x) => x.mes_id === m.id).sort((a, b) => comNombrePersona(a.persona_id).localeCompare(comNombrePersona(b.persona_id)) || a.forma.localeCompare(b.forma));
  const i3 = ws.rowCount + 1;
  pagos.forEach((x) => {
    const r = ws.addRow([comNombrePersona(x.persona_id), x.forma === "efectivo" ? "Efectivo" : "Depósito", x.fecha ? new Date(x.fecha + "T12:00:00") : null, n2(x.monto), x.banco || "", x.referencia || "", x.nota || ""]);
    r.getCell(3).numFmt = "dd/mm/yyyy"; r.getCell(4).numFmt = fmt;
  });
  if (!pagos.length) ws.addRow(["Todavía no hay pagos registrados en este mes."]).font = { italic: true, color: { argb: "FF5B6B72" } };
  else { const r = fila(["Total pagado", "", "", { formula: `SUM(D${i3}:D${ws.rowCount})` }], 4, true); r.getCell(2).numFmt = "@"; }
  ws.addRow([]);

  // 4. Resumen
  tit("4. Resumen del mes");
  const res = [
    ["Total vendido", { formula: `C${filaTotalTipos}` }],
    ["  Cash", { formula: `C${i1}` }],
    ["  Cash facturado", { formula: `C${i1 + 1}` }],
    ["  TC", { formula: `C${i1 + 2}` }],
    ["Ganancia (sin impuestos − costo)", { formula: `G${filaTotalTipos}` }],
    ["Comisión total de vendedores", { formula: `H${filaTotalTipos}` }],
    ["Comisiones pagadas", f2 >= i2 ? { formula: `J${filaTotalVend}` } : 0],
    ["Comisiones pendientes de pagar", f2 >= i2 ? { formula: `K${filaTotalVend}` } : 0],
    ["Utilidad (comisión) para la empresa", { formula: `I${filaTotalTipos}` }]
  ];
  res.forEach(([et, val], i) => { const r = fila([et, val], 2, i === res.length - 1); if (i === 0) r.font = { bold: true }; });
  const excl = comVentasMes(m.id).filter((v) => v.estado !== "valida");
  if (excl.length) {
    ws.addRow([]);
    ws.addRow([`No incluidas: ${excl.filter((v) => v.estado === "no_pagar").length} venta(s) “No se paga” y ${excl.filter((v) => v.estado === "revisar").length} por revisar.`]).font = { italic: true, color: { argb: "FF5B6B72" } };
  }
  ws.views = [{ showGridLines: false }];
  ws.pageSetup = { paperSize: 1, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
}

async function comExcel() {
  const m = comMes(com.actual);
  const ExcelJS = await stfCargarExcel();
  const wb = new ExcelJS.Workbook();
  wb.calcProperties.fullCalcOnLoad = true;   // Excel recalcula los totales al abrir
  comHojaReporte(wb, m);
  const ws = wb.addWorksheet(comNombreMes(m));
  ws.columns = [
    ["Fecha", 12], ["Orden", 10], ["Proveedor", 24], ["Actividad", 32], ["Cliente", 22], ["Vendedor", 26], ["Tipo", 14], ["Estado", 12], ["Pax", 6],
    ["Rack", 10], ["Neto", 10], ["Total", 11], ["Costo", 11], ["IVA", 10], ["Datáfono", 10], ["Sin impuestos", 13], ["Ganancia", 11], ["Com. vendedor", 13], ["Utilidad empresa", 15], ["Forma de pago", 13], ["Revisada", 18]
  ].map(([header, width]) => ({ header, width }));
  ws.getRow(1).font = { bold: true };
  for (const v of comVentasMes(m.id)) {
    ws.addRow([v.fecha ? new Date(v.fecha + "T12:00:00") : null, v.orden, v.proveedor, v.actividad, v.cliente, v.persona_id ? comNombrePersona(v.persona_id) : v.vendedor_texto,
      COM_TIPOS[v.tipo] || v.estado_original || "", { valida: "Válida", revisar: "Por revisar", no_pagar: "No se paga" }[v.estado], n2(v.pax), n2(v.rack), n2(v.neto),
      v.total_rack, v.total_neto, v.iva, v.datafono, v.sin_iva, v.ganancia, v.com_vendedor, v.com_empresa, v.forma === "efectivo" ? "Efectivo" : v.forma === "deposito" ? "Depósito" : "", v.revisada_en ? fechaHora(v.revisada_en) : ""]);
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
    "revisar-todas": async () => {
      const f = com.filtroVend;
      const ids = comVentasMes(com.actual).filter((v) => !v.revisada_en && (!f || String(v.persona_id ?? `?${v.vendedor_texto}`) === f)).map((v) => v.id);
      if (!ids.length || !confirm(`¿Marcar ${ids.length} línea(s) como revisadas contra el sistema de ventas?`)) return;
      await comMarcarRevisadas(ids, true);
    },
    "filtrar": () => { com.filtroVend = b.dataset.persona || (b.dataset.texto ? `?${b.dataset.texto}` : ""); comPintar(); },
    "pagar": () => comFormPago(b.dataset.forma, b.dataset.persona),
    "ver-pago": () => comVerPago(b.dataset.id),
    "comprobante": () => comImprimirComprobante(b.dataset.persona),
    "imagenes": () => comImagenesVendedor(b.dataset.persona),
    "imprimir": () => comImprimirReporte(),
    "excel": () => comExcel().catch((err) => fallo(err, "No se pudo generar el Excel.")),
    "ver-archivo": () => comVerArchivo(b.dataset.ruta)
  };
  if (acciones[b.dataset.comAccion]) conBoton(b, async () => { await acciones[b.dataset.comAccion](); });
});
$("staffContenido").addEventListener("change", (e) => {
  if (stf.pestana !== "comisiones") return;
  const t = e.target;
  if (t.id === "comAnio") { com.anio = Number(t.value); return comPintar(); }
  if (t.id === "comSoloPend") { com.soloPendientes = t.checked; return comPintar(); }
  if (t.dataset.comRev) return comMarcarRevisadas([Number(t.dataset.comRev)], t.checked).catch((err) => fallo(err));
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
    "anular-pago": () => comAnularPago(b.dataset.id),
    "img-descargar": () => comImgDescargar(b.dataset.grupo),
    "img-compartir": () => comImgCompartir(b.dataset.grupo),
    "img-todas": () => comImgDescargar(null)
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
