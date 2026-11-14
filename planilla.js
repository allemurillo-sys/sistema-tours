// =====================================================
// STAFF › PLANILLA (solo administradores)
// Quincenas, comprobantes, aguinaldo, liquidaciones, respaldos y ajustes.
// La base de datos rechaza a cualquier usuario que no sea administrador.
// (usa utilidades de panel.js y staff.js)
// =====================================================

const BLOQUES = {
  HV: "Home Vacations",
  THT: "The House of Tours",
  HORA: "Trabajadores por hora",
  SOCIOS: "Socios (en dólares)"
};
const EMPRESA_RECIBO = { HV: "Home Vacations La Fortuna", THT: "The House of Tours" };
const MOTIVOS_SALIDA = [
  "Renuncia", "Despido con responsabilidad patronal", "Despido sin responsabilidad patronal",
  "Mutuo acuerdo", "Fin de contrato", "Otro"
];
const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Setiembre", "Octubre", "Noviembre", "Diciembre"];
const MES_CORTO = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Set", "Oct", "Nov", "Dic"];

const pla = {
  sub: "quincenas",
  cargado: false,
  quincenas: [],
  lineas: [],
  respaldos: [],
  liquidaciones: [],
  ajustes: {},
  actual: null,          // id de la quincena abierta
  anioAguinaldo: null,
  incluirBonif: false,
  liq: null              // formulario de liquidación en edición
};
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const plaQ = (id) => pla.quincenas.find((q) => q.id === Number(id));
const plaLineasDe = (qid) => pla.lineas.filter((l) => l.quincena_id === Number(qid)).sort((a, b) => a.orden - b.orden);
const sumaRebajos = (l) => Object.values(l.rebajos || {}).reduce((s, v) => s + (Number(v) || 0), 0);
const esCCSS = (l) => l.bloque === "HV" || l.bloque === "THT";
const plaEditable = (q) => q && q.estado !== "cerrada";

// ---------- Carga ----------
async function plaTodo(consulta) {
  const filas = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await consulta().range(desde, desde + 999);
    if (error) throw error;
    filas.push(...data);
    if (data.length < 1000) return filas;
  }
}

async function plaAbrir(recargar = false) {
  if (!stfEsAdmin()) { $("staffContenido").innerHTML = ""; return; }
  if (recargar || !pla.cargado) {
    $("staffContenido").innerHTML = `<p class="nota">Cargando planilla…</p>`;
    try { await plaCargar(); } catch (error) {
      $("staffContenido").innerHTML = "";
      return fallo(error, "No se pudo cargar la planilla.");
    }
  }
  plaPintar();
}

async function plaCargar() {
  if (!stf.cargado) await stfCargar();
  const [q, l, r, lq, a] = await Promise.all([
    plaTodo(() => db.from("pla_quincenas").select("*").order("desde", { ascending: false })),
    plaTodo(() => db.from("pla_lineas").select("*").order("id")),
    plaTodo(() => db.from("pla_respaldos").select("*").order("creado_en", { ascending: false })),
    plaTodo(() => db.from("pla_liquidaciones").select("*").order("fecha_salida", { ascending: false })),
    db.from("pla_ajustes").select("*")
  ]);
  if (a.error) throw a.error;
  pla.quincenas = q;
  pla.lineas = l.map(plaNormalizar);
  pla.respaldos = r;
  pla.liquidaciones = lq;
  pla.ajustes = Object.fromEntries((a.data || []).map((x) => [x.clave, x.valor]));
  stf.conceptos = pla.ajustes.conceptos || [];
  pla.cargado = true;
}
function plaNormalizar(l) {
  const n = { ...l };
  ["salario_mensual", "dias", "horas_extra", "tarifa_extra", "pago_extra", "feriados", "otros_pagos", "bruto", "ccss_obrera",
    "ccss_patronal", "rt", "cesantia", "aguinaldo_prov", "rebajos_total", "adicionales", "neto", "monto_usd", "tarifa_hora", "horas"]
    .forEach((k) => (n[k] = Number(n[k]) || 0));
  n.rebajos = n.rebajos || {};
  return n;
}

// ---------- Cálculo de una línea ----------
function plaParametros(q) {
  const base = { divisor: 30, jornada: 8, multiplicador: 1.5, obrera: 0.1083, patronal: 0.2683, rt: 0.01, cesantia: 0.03 };
  return { ...base, ...(pla.ajustes.calculo || {}), ...(pla.ajustes.porcentajes || {}), ...(q.parametros || {}) };
}
function plaCalcular(l, q) {
  const p = plaParametros(q);
  if (l.bloque === "HORA") {
    l.neto = r2(l.horas * l.tarifa_hora);
    return l;
  }
  if (l.bloque === "SOCIOS") {
    l.rebajos_total = r2(sumaRebajos(l));
    l.neto = r2((l.monto_usd - l.rebajos_total) * (Number(q.tipo_cambio) || 0));
    return l;
  }
  const normal = (l.salario_mensual / p.divisor) * l.dias;
  l.tarifa_extra = r2((l.salario_mensual / p.divisor / p.jornada) * p.multiplicador);
  l.pago_extra = r2(Math.max(0, l.horas_extra) * l.tarifa_extra);
  l.bruto = r2(normal + l.pago_extra + l.feriados + l.otros_pagos);
  l.ccss_obrera = r2(l.bruto * p.obrera);
  l.ccss_patronal = r2(l.bruto * p.patronal);
  l.rt = r2(l.bruto * p.rt);
  l.cesantia = r2(l.bruto * p.cesantia);
  l.aguinaldo_prov = r2(l.bruto / 12);
  l.rebajos_total = r2(sumaRebajos(l));
  l.neto = r2(l.bruto - l.ccss_obrera - l.rebajos_total);
  return l;
}
const salarioNormal = (l, q) => { const p = plaParametros(q); return r2((l.salario_mensual / p.divisor) * l.dias); };

function plaTotales(qid) {
  const t = { personas: { ccss: 0, hora: 0, socios: 0 }, salario: 0, normal: 0, extra: 0, feriados: 0, bruto: 0, obrera: 0, patronal: 0, rt: 0, cesantia: 0,
    aguinaldo: 0, rebajos: 0, netoCCSS: 0, hora: 0, socios: 0, usd: 0, bonif: 0, porBloque: {} };
  const q = plaQ(qid);
  plaLineasDe(qid).forEach((l) => {
    const b = (t.porBloque[l.bloque] ||= { salario: 0, normal: 0, extra: 0, feriados: 0, bruto: 0, obrera: 0, patronal: 0, rt: 0, cesantia: 0, aguinaldo: 0, rebajos: 0, neto: 0, bonif: 0, usd: 0, horas: 0 });
    b.neto += l.neto; b.bonif += l.adicionales; b.rebajos += l.rebajos_total;
    t.bonif += l.adicionales;
    if (esCCSS(l)) {
      t.personas.ccss++;
      const normal = salarioNormal(l, q);
      b.salario += l.salario_mensual; b.normal += normal; b.extra += l.pago_extra; b.feriados += l.feriados + l.otros_pagos; b.bruto += l.bruto;
      b.obrera += l.ccss_obrera; b.patronal += l.ccss_patronal; b.rt += l.rt; b.cesantia += l.cesantia; b.aguinaldo += l.aguinaldo_prov;
      t.salario += l.salario_mensual; t.normal += normal; t.extra += l.pago_extra; t.feriados += l.feriados + l.otros_pagos;
      t.bruto += l.bruto; t.obrera += l.ccss_obrera; t.patronal += l.ccss_patronal; t.rt += l.rt; t.cesantia += l.cesantia;
      t.aguinaldo += l.aguinaldo_prov; t.rebajos += l.rebajos_total; t.netoCCSS += l.neto;
    } else if (l.bloque === "HORA") { t.personas.hora++; t.hora += l.neto; b.horas += l.horas; }
    else { t.personas.socios++; t.socios += l.neto; t.usd += l.monto_usd - l.rebajos_total; b.usd += l.monto_usd - l.rebajos_total; }
  });
  t.cargas = t.patronal + t.rt + t.cesantia;
  t.total = t.netoCCSS + t.hora + t.socios + t.bonif;
  return t;
}

// =====================================================
// PINTAR
// =====================================================
function plaPintar() {
  const subs = [["quincenas", "Quincenas"], ["aguinaldo", "Aguinaldo"], ["liquidaciones", "Liquidaciones"], ["respaldos", "Respaldos"], ["ajustes", "Ajustes"]];
  const nav = `
    <div class="pla-nav no-imprimir">
      ${subs.map(([k, t]) => `<button type="button" class="stf-pill ${pla.sub === k ? "on oscuro" : ""}" data-pla-sub="${k}">${t}</button>`).join("")}
      <span class="stf-chip candado">🔒 Solo administradores</span>
    </div>`;
  let cuerpo = "";
  if (pla.sub === "quincenas") cuerpo = pla.actual ? htmlQuincena(plaQ(pla.actual)) : htmlQuincenas();
  if (pla.sub === "aguinaldo") cuerpo = htmlAguinaldo();
  if (pla.sub === "liquidaciones") cuerpo = pla.liq ? htmlLiquidacionForm() : htmlLiquidaciones();
  if (pla.sub === "respaldos") cuerpo = htmlRespaldos();
  if (pla.sub === "ajustes") cuerpo = htmlAjustes();
  stfRedibujar(nav + cuerpo, `planilla-${pla.sub}-${pla.actual || ""}-${pla.liq ? "liq" : ""}`);
}

// ---------- Lista de quincenas ----------
function sugerirQuincena() {
  const ultima = [...pla.quincenas].sort((a, b) => b.hasta.localeCompare(a.hasta))[0];
  const base = ultima ? new Date(ultima.hasta + "T12:00:00") : new Date();
  const dia = base.getDate();
  let desde, hasta;
  if (ultima && dia >= 13 && dia < 28) {
    desde = new Date(base); desde.setDate(dia + 1);
    hasta = new Date(base.getFullYear(), base.getMonth(), 28, 12);
  } else {
    desde = new Date(base); desde.setDate(dia + 1);
    hasta = new Date(desde.getFullYear(), desde.getMonth() + (desde.getDate() > 13 ? 1 : 0), 13, 12);
  }
  const mitad = hasta.getDate() <= 13 ? 1 : 2;
  return { desde: aTexto(desde), hasta: aTexto(hasta), nombre: `${MES_CORTO[hasta.getMonth()]} ${mitad} ${hasta.getFullYear()}` };
}

function htmlQuincenas() {
  const anios = [...new Set(pla.quincenas.map((q) => q.hasta.slice(0, 4)))].sort().reverse();
  const anio = pla.anioLista || anios[0] || String(new Date().getFullYear());
  const lista = pla.quincenas.filter((q) => q.hasta.startsWith(anio));
  const filas = lista.map((q) => {
    const t = plaTotales(q.id);
    const respaldo = pla.respaldos.some((r) => r.quincena_id === q.id);
    return `
      <tr>
        <td><button type="button" class="enlace" data-pla-accion="abrir" data-id="${q.id}"><strong>${escapar(q.nombre)}</strong></button><br><small>${fechaCorta(q.desde)} – ${fechaAnio(q.hasta)}</small></td>
        <td>${plaChipEstado(q)}${q.importada ? `<br><small>Del Excel</small>` : ""}</td>
        <td class="num">${t.personas.ccss} + ${t.personas.hora} + ${t.personas.socios}</td>
        <td class="num">${colones(t.bruto)}</td>
        <td class="num">${colones(t.cargas)}</td>
        <td class="num">${colones(t.netoCCSS)}</td>
        <td class="num">${colones(t.hora)}</td>
        <td class="num"><strong>${colones(t.total)}</strong></td>
        <td class="centro">${respaldo ? "✓" : q.estado === "cerrada" ? `<small>Sin respaldo</small>` : ""}</td>
      </tr>`;
  }).join("");
  const s = sugerirQuincena();
  const qs = pla.ajustes.quincenas || {};
  return `
    <div class="stf-dos">
      <div class="det-seccion sin-margen stf-col">
        <div class="stf-fila-tit">
          <h3>Quincenas ${anio}</h3>
          ${anios.length > 1 ? `<label class="stf-inline">Año <select id="plaAnioLista">${anios.map((a) => `<option ${a === anio ? "selected" : ""}>${a}</option>`).join("")}</select></label>` : ""}
        </div>
        <div class="tabla-scroll">
          <table class="tabla pla-tabla">
            <thead><tr><th>Quincena</th><th>Estado</th><th class="num">Personas</th><th class="num">Salario bruto</th><th class="num">Cargas patronales</th><th class="num">Neto con CCSS</th><th class="num">Por hora</th><th class="num">Total a pagar</th><th class="centro">Respaldo</th></tr></thead>
            <tbody>${filas || `<tr><td colspan="9" class="nota">No hay quincenas en ${anio}.</td></tr>`}</tbody>
          </table>
        </div>
        <p class="nota">Personas: con CCSS + por hora + socios. El total a pagar suma el neto con CCSS, los trabajadores por hora, los socios (al tipo de cambio de la quincena) y las bonificaciones.</p>
      </div>
      <aside class="det-seccion sin-margen stf-resumen">
        <h3>Nueva quincena</h3>
        <p class="nota">Se propone el siguiente corte. Puedes cambiar los días.</p>
        <label>Desde <input id="plaNDesde" type="date" value="${s.desde}"></label>
        <label>Hasta <input id="plaNHasta" type="date" value="${s.hasta}"></label>
        <label>Nombre <input id="plaNNombre" value="${escapar(s.nombre)}"></label>
        <label>Tipo de cambio (₡ por $) <input id="plaNTC" type="number" step="0.01" value="${Number(qs.tipo_cambio) || 460}"></label>
        <p class="nota">Se agregan los colaboradores activos con su salario, sus rebajos fijos y 15 días laborados.</p>
        <button type="button" class="btn primario" data-pla-accion="crear-quincena">Crear quincena</button>
      </aside>
    </div>`;
}
function plaChipEstado(q) {
  if (q.estado === "cerrada") return `<span class="stf-chip gris">Cerrada</span>`;
  if (q.estado === "revision") return `<span class="stf-chip aviso">Reabierta</span>`;
  return `<span class="stf-chip ok">En curso</span>`;
}

async function plaCrearQuincena() {
  const desde = $("plaNDesde").value, hasta = $("plaNHasta").value;
  const nombre = $("plaNNombre").value.trim();
  const tc = Number($("plaNTC").value) || 0;
  if (!desde || !hasta || hasta < desde) return avisar("Revisa las fechas de la quincena.", "error");
  if (!nombre) return avisar("Escribe un nombre para la quincena.", "error");
  if (pla.quincenas.some((q) => !(hasta < q.desde || desde > q.hasta)) &&
      !confirm("Esas fechas se cruzan con otra quincena. ¿Crearla de todos modos?")) return;
  const p = plaParametros({});
  const parametros = { obrera: p.obrera, patronal: p.patronal, rt: p.rt, cesantia: p.cesantia, divisor: p.divisor, jornada: p.jornada, multiplicador: p.multiplicador };
  const { data: q, error } = await db.from("pla_quincenas").insert({ nombre, desde, hasta, tipo_cambio: tc, parametros, estado: "borrador" }).select().single();
  if (error) return fallo(error, "No se pudo crear la quincena.");

  const orden = { HV: 1, THT: 2, HORA: 3, SOCIOS: 4 };
  const activos = stf.personas.filter((x) => x.activo && stf.privado.has(x.id))
    .sort((a, b) => (orden[stf.privado.get(a.id).bloque] - orden[stf.privado.get(b.id).bloque]) || (stf.privado.get(a.id).orden - stf.privado.get(b.id).orden));
  const lineas = activos.map((x, i) => {
    const pr = stf.privado.get(x.id);
    const l = plaNormalizar({
      quincena_id: q.id, persona_id: x.id, bloque: pr.bloque, orden: i + 1, nombre: x.nombre,
      puesto: { SOCIOS: "Socio", HORA: "Por horas" }[pr.bloque] || x.puesto,
      salario_mensual: pr.salario_mensual, dias: esCCSS(pr) ? 15 : 0, tarifa_hora: pr.tarifa_hora, monto_usd: pr.monto_usd,
      rebajos: pr.bloque === "SOCIOS" ? {} : { ...(pr.rebajos_fijos || {}) }
    });
    return plaCalcular(l, q);
  });
  if (lineas.length) {
    const { error: e2 } = await db.from("pla_lineas").insert(lineas);
    if (e2) return fallo(e2, "La quincena se creó, pero no se pudieron agregar los colaboradores.");
  }
  await plaCargar();
  pla.actual = q.id;
  plaPintar();
  avisar("Quincena creada.");
}

// ---------- Detalle de una quincena ----------
function campo(l, k, editable, paso = "0.5", ancho = "") {
  const v = l[k];
  if (!editable) return k === "dias" || k === "horas" || k === "horas_extra" ? `${v}` : colones(v);
  return `<input class="pla-input ${ancho}" type="number" step="${paso}" value="${v}" data-pla-campo="${k}" data-linea="${l.id}" aria-label="${k.replace("_", " ")} de ${escapar(l.nombre)}">`;
}

function htmlQuincena(q) {
  if (!q) { pla.actual = null; return htmlQuincenas(); }
  const ed = plaEditable(q);
  const t = plaTotales(q.id);
  const lineas = plaLineasDe(q.id);
  const p = plaParametros(q);
  const pct = (x) => `${(x * 100).toFixed(2).replace(/\.?0+$/, "").replace(".", ",")} %`;
  const enQuincena = new Set(lineas.map((l) => l.persona_id));
  const disponibles = stf.personas.filter((x) => x.activo && !enQuincena.has(x.id) && stf.privado.has(x.id));
  const respaldos = pla.respaldos.filter((r) => r.quincena_id === q.id);

  const filaCCSS = (l) => {
    const neg = l.horas_extra < 0;
    return `
      <tr>
        <th scope="row"><strong>${escapar(l.nombre)}</strong><small>${escapar(l.puesto || "")}</small></th>
        <td class="num">${colones(l.salario_mensual)}</td>
        <td class="num">${campo(l, "dias", ed, "1", "corto")}</td>
        <td class="num">${colones(salarioNormal(l, q))}</td>
        <td class="num ${neg ? "pla-neg" : ""}">${campo(l, "horas_extra", ed, "0.5", "corto")}</td>
        <td class="num">${colones(l.pago_extra)}<small>${l.tarifa_extra ? colones(l.tarifa_extra) + "/h" : ""}</small></td>
        <td class="num">${campo(l, "feriados", ed, "100")}</td>
        <td class="num"><strong>${colones(l.bruto)}</strong></td>
        <td class="num">${colones(l.ccss_obrera)}</td>
        <td class="num">${ed ? `<button type="button" class="enlace" data-pla-accion="rebajos" data-linea="${l.id}">${colones(l.rebajos_total)}</button>` : colones(l.rebajos_total)}${l.adicionales ? `<small>+ bonif. ${colones(l.adicionales)}</small>` : ""}</td>
        <td class="num"><strong>${colones(l.neto)}</strong></td>
        <td class="pla-acc">
          <button type="button" class="enlace" data-pla-accion="comprobante" data-linea="${l.id}" title="Imprimir comprobante">Recibo</button>
          ${ed ? `<button type="button" class="btn-icono" data-pla-accion="quitar-linea" data-linea="${l.id}" aria-label="Quitar a ${escapar(l.nombre)} de la quincena" title="Quitar">×</button>` : ""}
        </td>
      </tr>`;
  };
  const bloqueCCSS = (b) => {
    const ls = lineas.filter((l) => l.bloque === b);
    if (!ls.length) return "";
    const s = t.porBloque[b];
    return `
      <tr class="pla-bloque"><th colspan="12">${BLOQUES[b].toUpperCase()}</th></tr>
      ${ls.map(filaCCSS).join("")}
      <tr class="pla-sub"><th scope="row">Subtotal ${BLOQUES[b]}</th><td class="num">${colones(s.salario)}</td><td></td><td class="num">${colones(s.normal)}</td><td></td><td class="num">${colones(s.extra)}</td><td class="num">${colones(s.feriados)}</td><td class="num">${colones(s.bruto)}</td><td class="num">${colones(s.obrera)}</td><td class="num">${colones(s.rebajos)}</td><td class="num">${colones(s.neto)}</td><td></td></tr>`;
  };
  const hora = lineas.filter((l) => l.bloque === "HORA");
  const socios = lineas.filter((l) => l.bloque === "SOCIOS");
  const costo = (k) => ["HV", "THT"].map((b) => colones(t.porBloque[b]?.[k] || 0));

  return `
    <div class="stf-horario-cab">
      <div>
        <button type="button" class="enlace" data-pla-accion="volver">‹ Quincenas</button>
        <h2 class="stf-h2">${escapar(q.nombre)} · ${fechaCorta(q.desde)} al ${fechaAnio(q.hasta)} ${plaChipEstado(q)}</h2>
        <p class="nota">Tipo de cambio ${ed ? `<input class="pla-input corto" type="number" step="0.01" value="${q.tipo_cambio}" data-pla-q="tipo_cambio" aria-label="Tipo de cambio">` : `₡${q.tipo_cambio}`}
          · CCSS obrera ${pct(p.obrera)} · patronal ${pct(p.patronal)} · RT ${pct(p.rt)} · cesantía ${pct(p.cesantia)} · hora extra = salario ÷ ${p.divisor} ÷ ${p.jornada} × ${String(p.multiplicador).replace(".", ",")}</p>
        ${q.importada ? `<p class="nota">Importada del Excel original (${escapar(q.etiqueta || "")}). Los montos se conservan tal como estaban en el archivo.</p>` : ""}
        ${q.motivo_reapertura ? `<p class="nota">Reabierta: ${escapar(q.motivo_reapertura)}</p>` : ""}
      </div>
      <div class="stf-botones">
        ${ed ? `<button type="button" class="btn" data-pla-accion="reloj">⏱ Importar reloj marcador</button>` : ""}
        <button type="button" class="btn" data-pla-accion="comprobantes">Comprobantes</button>
        <button type="button" class="btn" data-pla-accion="excel">Descargar Excel</button>
        ${q.estado === "cerrada"
          ? `<button type="button" class="btn" data-pla-accion="reabrir">Reabrir</button>`
          : `${!respaldos.length && !q.importada ? `<button type="button" class="btn peligro" data-pla-accion="eliminar-quincena">Eliminar</button>` : ""}
             <button type="button" class="btn primario" data-pla-accion="cerrar">Cerrar quincena y respaldar</button>`}
      </div>
    </div>

    <div class="pla-kpis">
      <div><span>Salario bruto (con CCSS)</span><b>${colones(t.bruto)}</b></div>
      <div><span>Neto a pagar con CCSS</span><b>${colones(t.netoCCSS)}</b></div>
      <div><span>Por hora + socios${t.bonif ? " + bonificaciones" : ""}</span><b>${colones(t.hora + t.socios + t.bonif)}</b></div>
      <div class="destacado"><span>Total a pagar</span><b>${colones(t.total)}</b></div>
      <div><span>Costo patronal (CCSS + RT + cesantía)</span><b>${colones(t.cargas)}</b></div>
    </div>

    <div class="det-seccion sin-margen tabla-scroll">
      <h3>Colaboradores con CCSS</h3>
      <table class="tabla pla-tabla pla-detalle">
        <thead><tr><th>Colaborador</th><th class="num">Salario<br>mensual</th><th class="num">Días<br>laborados</th><th class="num">Salario<br>normal</th><th class="num">Horas<br>extra</th><th class="num">Pago<br>extra</th><th class="num">Feriados /<br>otros</th><th class="num">Salario<br>bruto</th><th class="num">CCSS<br>obrera</th><th class="num">Rebajos</th><th class="num">Neto a<br>recibir</th><th></th></tr></thead>
        <tbody>${bloqueCCSS("HV")}${bloqueCCSS("THT")}</tbody>
        <tfoot><tr><th scope="row">Total con CCSS</th><td class="num">${colones(t.salario)}</td><td></td><td class="num">${colones(t.normal)}</td><td></td><td class="num">${colones(t.extra)}</td><td class="num">${colones(t.feriados)}</td><td class="num">${colones(t.bruto)}</td><td class="num">${colones(t.obrera)}</td><td class="num">${colones(t.rebajos)}</td><td class="num">${colones(t.netoCCSS)}</td><td></td></tr></tfoot>
      </table>
      <p class="nota">Las horas extra negativas (en naranja) solo quedan registradas: no se rebajan del salario. ${ed ? "Toca el monto de “Rebajos” para editar adelantos, Sanar, Gym, ahorro, embargos o una bonificación." : ""}</p>
    </div>

    <div class="stf-dos">
      <div class="det-seccion sin-margen stf-col">
        <h3>Trabajadores por hora <small class="nota">sin CCSS</small></h3>
        <table class="tabla pla-tabla">
          <thead><tr><th>Nombre</th><th class="num">Tarifa por hora</th><th class="num">Horas</th><th class="num">A pagar</th>${ed ? "<th></th>" : ""}</tr></thead>
          <tbody>${hora.map((l) => `<tr><th scope="row">${escapar(l.nombre)}</th><td class="num">${campo(l, "tarifa_hora", ed, "25")}</td><td class="num">${campo(l, "horas", ed, "0.5", "corto")}</td><td class="num"><strong>${colones(l.neto)}</strong></td>${ed ? `<td><button type="button" class="btn-icono" data-pla-accion="quitar-linea" data-linea="${l.id}" aria-label="Quitar a ${escapar(l.nombre)}">×</button></td>` : ""}</tr>`).join("") || `<tr><td colspan="4" class="nota">Sin trabajadores por hora.</td></tr>`}</tbody>
          <tfoot><tr><th scope="row">Subtotal</th><td></td><td class="num">${t.porBloque.HORA?.horas || 0}</td><td class="num">${colones(t.hora)}</td>${ed ? "<td></td>" : ""}</tr></tfoot>
        </table>
      </div>
      <div class="det-seccion sin-margen stf-col">
        <h3>Socios <small class="nota">en dólares, sin CCSS · TC ₡${q.tipo_cambio}</small></h3>
        <table class="tabla pla-tabla">
          <thead><tr><th>Nombre</th><th class="num">Quincenal</th><th class="num">Rebajos ($)</th><th class="num">En colones</th>${ed ? "<th></th>" : ""}</tr></thead>
          <tbody>${socios.map((l) => `<tr><th scope="row">${escapar(l.nombre)}</th><td class="num">${ed ? campo(l, "monto_usd", ed, "10") : dolares(l.monto_usd)}</td><td class="num">${ed ? `<input class="pla-input corto" type="number" step="1" value="${l.rebajos_total}" data-pla-campo="rebajo_usd" data-linea="${l.id}" aria-label="Rebajos en dólares de ${escapar(l.nombre)}">` : dolares(l.rebajos_total)}</td><td class="num"><strong>${colones(l.neto)}</strong></td>${ed ? `<td><button type="button" class="btn-icono" data-pla-accion="quitar-linea" data-linea="${l.id}" aria-label="Quitar a ${escapar(l.nombre)}">×</button></td>` : ""}</tr>`).join("") || `<tr><td colspan="4" class="nota">Sin socios.</td></tr>`}</tbody>
          <tfoot><tr><th scope="row">Subtotal</th><td class="num">${dolares(t.usd)}</td><td></td><td class="num">${colones(t.socios)}</td>${ed ? "<td></td>" : ""}</tr></tfoot>
        </table>
      </div>
    </div>

    <div class="stf-dos">
      <div class="det-seccion sin-margen stf-col">
        <h3>Costo para la empresa <small class="nota">no se rebaja al colaborador</small></h3>
        <table class="tabla pla-tabla">
          <thead><tr><th>Concepto</th><th class="num">Home Vacations</th><th class="num">The House of Tours</th><th class="num">Total</th></tr></thead>
          <tbody>
            <tr><th scope="row">CCSS patronal ${pct(p.patronal)}</th><td class="num">${costo("patronal")[0]}</td><td class="num">${costo("patronal")[1]}</td><td class="num">${colones(t.patronal)}</td></tr>
            <tr><th scope="row">Riesgos del trabajo ${pct(p.rt)}</th><td class="num">${costo("rt")[0]}</td><td class="num">${costo("rt")[1]}</td><td class="num">${colones(t.rt)}</td></tr>
            <tr><th scope="row">Cesantía ${pct(p.cesantia)} (provisión)</th><td class="num">${costo("cesantia")[0]}</td><td class="num">${costo("cesantia")[1]}</td><td class="num">${colones(t.cesantia)}</td></tr>
            <tr><th scope="row">Aguinaldo 1/12 (provisión)</th><td class="num">${costo("aguinaldo")[0]}</td><td class="num">${costo("aguinaldo")[1]}</td><td class="num">${colones(t.aguinaldo)}</td></tr>
          </tbody>
          <tfoot><tr><th scope="row">Total cargas y provisiones</th><td class="num">${colones((t.porBloque.HV?.patronal || 0) + (t.porBloque.HV?.rt || 0) + (t.porBloque.HV?.cesantia || 0) + (t.porBloque.HV?.aguinaldo || 0))}</td><td class="num">${colones((t.porBloque.THT?.patronal || 0) + (t.porBloque.THT?.rt || 0) + (t.porBloque.THT?.cesantia || 0) + (t.porBloque.THT?.aguinaldo || 0))}</td><td class="num">${colones(t.cargas + t.aguinaldo)}</td></tr></tfoot>
        </table>
      </div>
      <div class="det-seccion sin-margen stf-col pla-puntualidad">
        <h3>Nota informativa de puntualidad <small class="nota">no afecta el pago</small></h3>
        ${lineas.some((l) => l.reloj) ? `
          <p class="stf-subtitulo">Horas tomadas del reloj marcador</p>
          <ul class="pla-lista">${lineas.filter((l) => l.reloj).map((l) => {
            const r = l.reloj;
            return `<li><strong>${escapar(l.nombre)}</strong>: ${r.dias} días · ${String(r.horas).replace(".", ",")} h trabajadas${l.bloque === "HORA" ? "" : ` · extra ${String(r.extra).replace(".", ",")} h${r.faltante ? ` · faltantes ${String(r.faltante).replace(".", ",")} h` : ""}`}${r.una_marca ? ` · ${r.una_marca} día(s) con una sola marca` : ""}${r.corregidos?.length ? ` · ${r.corregidos.length} corregido(s)` : ""}</li>`;
          }).join("")}</ul>
          <p class="nota">Rango ${fechaCorta(lineas.find((l) => l.reloj).reloj.desde)} al ${fechaCorta(lineas.find((l) => l.reloj).reloj.hasta)}. Extra calculada por semana (lunes a domingo), sin rebajar almuerzo.</p>`
          : `<p class="nota">Use “⏱ Importar reloj marcador” para tomar las horas del archivo del reloj.</p>`}
        ${lineas.filter((l) => esCCSS(l) && l.horas_extra < 0).length ? `
          <p class="stf-subtitulo">Horas faltantes registradas en esta quincena</p>
          <ul class="pla-lista">${lineas.filter((l) => esCCSS(l) && l.horas_extra < 0).map((l) => `<li>${escapar(l.nombre)}: <strong>${l.horas_extra} h</strong></li>`).join("")}</ul>` : ""}
      </div>
    </div>

    ${ed && disponibles.length ? `
      <div class="stf-agregar">
        <label>Agregar colaborador a la quincena <select id="plaAgregar"><option value="">Elegir…</option>${disponibles.map((x) => `<option value="${x.id}">${escapar(x.nombre)}</option>`).join("")}</select></label>
        <button type="button" class="btn" data-pla-accion="agregar-linea">Agregar</button>
      </div>` : ""}`;
}

// Guarda una línea después de recalcularla
async function plaGuardarLinea(l) {
  const q = plaQ(l.quincena_id);
  plaCalcular(l, q);
  const { id, quincena_id, persona_id, ...datos } = l;
  const { error } = await db.from("pla_lineas").update(datos).eq("id", id);
  if (error) fallo(error);
}

function htmlRebajos(l) {
  const conceptos = (pla.ajustes.conceptos || []).filter((c) => c.tipo === "rebajo");
  const extra = Object.keys(l.rebajos || {}).filter((k) => !conceptos.some((c) => c.clave === k));
  return `
    <div class="det-cabeza" style="--c: var(--verde)">
      <div><p class="det-numero">Rebajos y bonificación</p><h2 id="stfModalTitulo">${escapar(l.nombre)}</h2></div>
      <div class="det-acciones">
        <button type="button" class="btn" data-stf-accion="cerrar-modal">Cancelar</button>
        <button type="button" class="btn primario" data-pla-modal="guardar-rebajos" data-linea="${l.id}">Guardar</button>
      </div>
    </div>
    <form id="plaRebajos" class="det-seccion">
      <div class="fila">
        ${conceptos.map((c) => `<label>${escapar(c.nombre)} (₡) <input name="${escapar(c.clave)}" type="number" min="0" step="100" value="${Number(l.rebajos?.[c.clave]) || 0}"></label>`).join("")}
        ${extra.map((k) => `<label>${escapar(k)} (₡) <input name="${escapar(k)}" type="number" min="0" step="100" value="${Number(l.rebajos[k]) || 0}"></label>`).join("")}
      </div>
      <label>Bonificación (₡, se paga aparte, sin cargas sociales) <input name="__bonif" type="number" min="0" step="100" value="${l.adicionales || 0}"></label>
      <label>Otros pagos que sí llevan CCSS (₡) <input name="__otros" type="number" min="0" step="100" value="${l.otros_pagos || 0}"></label>
      <label>Nota <input name="__nota" value="${escapar(l.notas || "")}"></label>
    </form>`;
}

async function plaGuardarRebajos(lineaId) {
  const l = pla.lineas.find((x) => x.id === Number(lineaId));
  const d = Object.fromEntries(new FormData($("plaRebajos")).entries());
  const reb = {};
  Object.entries(d).forEach(([k, v]) => { if (!k.startsWith("__") && Number(v)) reb[k] = Number(v); });
  l.rebajos = reb;
  l.adicionales = Number(d.__bonif) || 0;
  l.otros_pagos = Number(d.__otros) || 0;
  l.notas = d.__nota || null;
  await plaGuardarLinea(l);
  stfCerrarModal();
  plaPintar();
}

async function plaAgregarLinea() {
  const id = Number($("plaAgregar").value);
  if (!id) return;
  const q = plaQ(pla.actual);
  const x = personaPorId(id);
  const pr = stf.privado.get(id);
  const max = Math.max(0, ...plaLineasDe(q.id).map((l) => l.orden));
  const l = plaCalcular(plaNormalizar({
    quincena_id: q.id, persona_id: id, bloque: pr.bloque, orden: max + 1, nombre: x.nombre,
    puesto: { SOCIOS: "Socio", HORA: "Por horas" }[pr.bloque] || x.puesto,
    salario_mensual: pr.salario_mensual, dias: esCCSS(pr) ? 15 : 0, tarifa_hora: pr.tarifa_hora, monto_usd: pr.monto_usd,
    rebajos: pr.bloque === "SOCIOS" ? {} : { ...(pr.rebajos_fijos || {}) }
  }), q);
  const { data, error } = await db.from("pla_lineas").insert(l).select().single();
  if (error) return fallo(error);
  pla.lineas.push(plaNormalizar(data));
  plaPintar();
}

async function plaQuitarLinea(id) {
  const l = pla.lineas.find((x) => x.id === Number(id));
  if (!l || !confirm(`¿Quitar a ${l.nombre} de esta quincena?`)) return;
  const { error } = await db.from("pla_lineas").delete().eq("id", l.id);
  if (error) return fallo(error);
  pla.lineas = pla.lineas.filter((x) => x.id !== l.id);
  plaPintar();
}

async function plaEliminarQuincena() {
  const q = plaQ(pla.actual);
  if (!confirm(`¿Eliminar la quincena ${q.nombre}? Se borran sus líneas. No se puede deshacer.`)) return;
  const { error } = await db.from("pla_quincenas").delete().eq("id", q.id);
  if (error) return fallo(error);
  pla.actual = null;
  await plaCargar();
  plaPintar();
  avisar("Quincena eliminada.");
}

// ---------- Cerrar, reabrir y respaldar ----------
async function plaRespaldar(q, motivo = null) {
  const { blob, nombre } = await plaExcelQuincena(q);
  const ruta = `${q.hasta.slice(0, 4)}/${nombreArchivo(q.nombre)}_v${q.version}_${Date.now()}.xlsx`;
  const { error } = await db.storage.from("planilla-respaldos").upload(ruta, blob, {
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", upsert: false
  });
  if (error) throw error;
  const { error: e2 } = await db.from("pla_respaldos").insert({ quincena_id: q.id, version: q.version, archivo: ruta, nombre_archivo: nombre, motivo });
  if (e2) throw e2;
  stfDescargar(blob, nombre);
}

async function plaCerrar() {
  const q = plaQ(pla.actual);
  if (!confirm(`¿Cerrar la quincena ${q.nombre}? Quedará bloqueada, se guardará el respaldo en Excel y se descargará una copia a esta computadora.`)) return;
  const { error } = await db.from("pla_quincenas")
    .update({ estado: "cerrada", cerrada_por: app.yo.id, cerrada_en: new Date().toISOString() }).eq("id", q.id);
  if (error) return fallo(error);
  Object.assign(q, { estado: "cerrada", cerrada_por: app.yo.id, cerrada_en: new Date().toISOString() });
  try {
    await plaRespaldar(q, q.motivo_reapertura ? `Reapertura: ${q.motivo_reapertura}` : null);
    avisar("Quincena cerrada y respaldada.");
  } catch (e) {
    fallo(e, "La quincena se cerró, pero no se pudo guardar el respaldo. Vuelve a intentarlo desde Respaldos.");
  }
  await plaCargar();
  plaPintar();
}

async function plaReabrir() {
  const q = plaQ(pla.actual);
  const motivo = prompt(`¿Por qué se reabre la quincena ${q.nombre}? (queda registrado en el respaldo)`);
  if (!motivo?.trim()) return;
  const { error } = await db.from("pla_quincenas")
    .update({ estado: "revision", version: q.version + 1, motivo_reapertura: motivo.trim(), cerrada_en: null }).eq("id", q.id);
  if (error) return fallo(error);
  await plaCargar();
  plaPintar();
  avisar("Quincena reabierta. Al cerrarla de nuevo se guardará una versión nueva del respaldo.");
}

// =====================================================
// EXCEL DE LA QUINCENA (también es el respaldo)
// =====================================================
async function plaExcelQuincena(q) {
  const ExcelJS = await stfCargarExcel();
  const t = plaTotales(q.id);
  const lineas = plaLineasDe(q.id);
  const p = plaParametros(q);
  const wb = new ExcelJS.Workbook();
  wb.creator = "THOT Sistema";
  const MON = '"₡"#,##0';
  const USD = '"$"#,##0';
  const relleno = (argb) => ({ type: "pattern", pattern: "solid", fgColor: { argb } });

  // Hoja 1: Planilla
  const ws = wb.addWorksheet("Planilla", { pageSetup: { paperSize: 1, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  const cols = ["Colaborador", "Puesto", "Salario mensual", "Días laborados", "Salario normal", "Horas extra", "Tarifa extra", "Pago extra", "Feriados / otros", "Salario bruto",
    "CCSS obrera", "Rebajos", "Neto a recibir", "CCSS patronal", "Riesgos trabajo", "Cesantía", "Aguinaldo prov.", "Bonificación"];
  ws.mergeCells(1, 1, 1, cols.length);
  ws.getCell(1, 1).value = `Planilla ${q.nombre} — ${fechaCorta(q.desde)} al ${fechaAnio(q.hasta)}`;
  ws.getCell(1, 1).font = { bold: true, size: 14, color: { argb: "FF1F4F38" } };
  ws.mergeCells(2, 1, 2, cols.length);
  ws.getCell(2, 1).value = `Estado: ${q.estado === "cerrada" ? "cerrada" : "abierta"} · versión ${q.version} · tipo de cambio ₡${q.tipo_cambio} · CCSS obrera ${(p.obrera * 100).toFixed(2)} % · patronal ${(p.patronal * 100).toFixed(2)} % · RT ${(p.rt * 100).toFixed(2)} % · cesantía ${(p.cesantia * 100).toFixed(2)} % · generado ${fechaHora(new Date())}`;
  ws.getCell(2, 1).font = { size: 9, color: { argb: "FF5B6B72" } };
  let fila = 4;
  const cabecera = (valores) => {
    const r = ws.getRow(fila++);
    r.values = valores;
    r.font = { bold: true, color: { argb: "FFFFFFFF" } };
    r.alignment = { wrapText: true, vertical: "middle", horizontal: "center" };
    r.eachCell((c) => { c.fill = relleno("FF23343D"); c.border = excelBorde; });
    r.height = 30;
  };
  const titulo = (txt) => {
    ws.mergeCells(fila, 1, fila, cols.length);
    const c = ws.getCell(fila, 1); c.value = txt; c.font = { bold: true, color: { argb: "FF1F4F38" } }; c.fill = relleno("FFE4EFE8");
    fila++;
  };
  cabecera(cols);
  ["HV", "THT"].forEach((b) => {
    const ls = lineas.filter((l) => l.bloque === b);
    if (!ls.length) return;
    titulo(BLOQUES[b].toUpperCase());
    ls.forEach((l) => {
      const r = ws.getRow(fila++);
      r.values = [l.nombre, l.puesto || "", l.salario_mensual, l.dias, salarioNormal(l, q), l.horas_extra, l.tarifa_extra, l.pago_extra, l.feriados + l.otros_pagos, l.bruto,
        l.ccss_obrera, l.rebajos_total, l.neto, l.ccss_patronal, l.rt, l.cesantia, l.aguinaldo_prov, l.adicionales];
      [3, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18].forEach((i) => (r.getCell(i).numFmt = MON));
      if (l.horas_extra < 0) r.getCell(6).font = { color: { argb: "FF8A3B12" }, bold: true };
      r.eachCell({ includeEmpty: true }, (c) => (c.border = excelBorde));
    });
    const s = t.porBloque[b];
    const r = ws.getRow(fila++);
    r.values = [`Subtotal ${BLOQUES[b]}`, "", s.salario, "", s.normal, "", "", s.extra, s.feriados, s.bruto, s.obrera, s.rebajos, s.neto, s.patronal, s.rt, s.cesantia, s.aguinaldo, s.bonif];
    r.font = { bold: true };
    [3, 5, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18].forEach((i) => (r.getCell(i).numFmt = MON));
    r.eachCell({ includeEmpty: true }, (c) => { c.border = excelBorde; c.fill = relleno("FFF7FAF8"); });
  });
  fila++;
  titulo("TRABAJADORES POR HORA (sin CCSS)");
  cabecera(["Nombre", "", "Tarifa por hora", "Horas", "A pagar"]);
  lineas.filter((l) => l.bloque === "HORA").forEach((l) => {
    const r = ws.getRow(fila++);
    r.values = [l.nombre, "", l.tarifa_hora, l.horas, l.neto];
    r.getCell(3).numFmt = MON; r.getCell(5).numFmt = MON;
  });
  fila++;
  titulo(`SOCIOS (en dólares, sin CCSS) · tipo de cambio ₡${q.tipo_cambio}`);
  cabecera(["Nombre", "", "Quincenal ($)", "Rebajos ($)", "En colones"]);
  lineas.filter((l) => l.bloque === "SOCIOS").forEach((l) => {
    const r = ws.getRow(fila++);
    r.values = [l.nombre, "", l.monto_usd, l.rebajos_total, l.neto];
    r.getCell(3).numFmt = USD; r.getCell(4).numFmt = USD; r.getCell(5).numFmt = MON;
  });
  fila++;
  [["Neto a pagar con CCSS", t.netoCCSS], ["Trabajadores por hora", t.hora], ["Socios", t.socios], ["Bonificaciones", t.bonif], ["TOTAL A PAGAR", t.total],
    ["Costo patronal (CCSS + RT + cesantía)", t.cargas], ["Provisión de aguinaldo", t.aguinaldo]].forEach(([k, v], i) => {
    const r = ws.getRow(fila++);
    r.getCell(1).value = k; r.getCell(5).value = v; r.getCell(5).numFmt = MON;
    if (i === 4) r.font = { bold: true, size: 12, color: { argb: "FF1F4F38" } };
  });
  ws.getColumn(1).width = 30; ws.getColumn(2).width = 14;
  for (let i = 3; i <= cols.length; i++) ws.getColumn(i).width = 13;
  ws.views = [{ state: "frozen", xSplit: 1, ySplit: 4 }];

  // Hoja 2: Comprobantes
  const wc = wb.addWorksheet("Comprobantes", { pageSetup: { paperSize: 1, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  const rc = pla.ajustes.recibo || {};
  let f2 = 1;
  lineas.filter(esCCSS).forEach((l) => {
    const linea = (vals, negrita = false, formato = []) => {
      const r = wc.getRow(f2++); r.values = vals; if (negrita) r.font = { bold: true };
      formato.forEach((i) => (r.getCell(i).numFmt = MON));
    };
    linea([EMPRESA_RECIBO[l.bloque] || "", "", "", "", "", ""], true);
    linea([`${rc.patrono || ""}${rc.cedula ? " · " + rc.cedula : ""} · ${rc.lugar || ""}`]);
    linea(["Colaborador", l.nombre, "", "Periodo", `${fechaCorta(q.desde)} al ${fechaAnio(q.hasta)}`]);
    linea(["Días laborados", "Salario ordinario", "Feriados / otros", "Extras", "Total devengado"], true);
    linea([l.dias, salarioNormal(l, q), l.feriados + l.otros_pagos, l.pago_extra, l.bruto], false, [2, 3, 4, 5]);
    linea(["CCSS", "Adelantos", "Embargos", "Otros", "Total rebajos"], true);
    const otros = l.rebajos_total - (Number(l.rebajos.adelantos) || 0) - (Number(l.rebajos.embargos) || 0);
    linea([l.ccss_obrera, Number(l.rebajos.adelantos) || 0, Number(l.rebajos.embargos) || 0, otros, l.ccss_obrera + l.rebajos_total], false, [1, 2, 3, 4, 5]);
    linea(["Total neto a pagar", "", "", "", l.neto], true, [5]);
    if (l.adicionales) linea(["Bonificación (aparte)", "", "", "", l.adicionales], false, [5]);
    linea([""]); linea(["Patrono: ____________________", "", "", "Colaborador: ____________________"]);
    f2 += 2;
  });
  for (let i = 1; i <= 6; i++) wc.getColumn(i).width = 18;

  // Hoja 3: Parámetros
  const wp = wb.addWorksheet("Parámetros");
  [["Quincena", q.nombre], ["Desde", q.desde], ["Hasta", q.hasta], ["Tipo de cambio", q.tipo_cambio], ["Versión", q.version],
    ["Estado", q.estado], ["Motivo de reapertura", q.motivo_reapertura || ""], ["CCSS obrera", p.obrera], ["CCSS patronal", p.patronal],
    ["Riesgos del trabajo", p.rt], ["Cesantía", p.cesantia], ["Divisor salario diario", p.divisor], ["Jornada (horas)", p.jornada],
    ["Multiplicador hora extra", p.multiplicador], ["Importada del Excel", q.importada ? "Sí" : "No"], ["Generado", new Date().toLocaleString("es-CR")],
    ["Generado por", app.yo?.nombre || ""]].forEach((v) => wp.addRow(v));
  wp.getColumn(1).width = 28; wp.getColumn(2).width = 30;

  const buf = await wb.xlsx.writeBuffer();
  return {
    blob: new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    nombre: `Planilla_${nombreArchivo(q.nombre)}_v${q.version}.xlsx`
  };
}

// ---------- Comprobantes impresos ----------
function htmlRecibo(l, q, copia) {
  const rc = pla.ajustes.recibo || {};
  const otros = l.rebajos_total - (Number(l.rebajos.adelantos) || 0) - (Number(l.rebajos.embargos) || 0);
  return `
    <div class="pla-recibo">
      <div class="pla-recibo-cab">
        <div><strong>${escapar(EMPRESA_RECIBO[l.bloque] || "")}</strong><br>${escapar(rc.patrono || "")}${rc.cedula ? " · " + escapar(rc.cedula) : ""}<br>${escapar(rc.lugar || "")}</div>
        <div class="der"><strong>${copia}</strong><br>${escapar(q.nombre)}</div>
      </div>
      <p><strong>Colaborador:</strong> ${escapar(l.nombre)}${l.puesto ? " · " + escapar(l.puesto) : ""}<br><strong>Periodo de pago:</strong> ${fechaCorta(q.desde)} al ${fechaAnio(q.hasta)}</p>
      <table><thead><tr><th>Días laborados</th><th>Salario ordinario</th><th>Feriados / otros</th><th>Extras (${l.horas_extra > 0 ? l.horas_extra : 0} h)</th><th>Total</th></tr></thead>
        <tbody><tr><td>${l.dias}</td><td>${colones(salarioNormal(l, q))}</td><td>${colones(l.feriados + l.otros_pagos)}</td><td>${colones(l.pago_extra)}</td><td><strong>${colones(l.bruto)}</strong></td></tr></tbody></table>
      <table><thead><tr><th>CCSS</th><th>Adelantos</th><th>Embargos</th><th>Otros</th><th>Total rebajos</th></tr></thead>
        <tbody><tr><td>${colones(l.ccss_obrera)}</td><td>${colones(l.rebajos.adelantos || 0)}</td><td>${colones(l.rebajos.embargos || 0)}</td><td>${colones(otros)}</td><td><strong>${colones(l.ccss_obrera + l.rebajos_total)}</strong></td></tr></tbody></table>
      <p class="pla-recibo-neto"><span>Total neto a pagar</span><strong>${colones(l.neto)}</strong></p>
      ${l.adicionales ? `<p class="pla-recibo-bonif">Bonificación pagada aparte: ${colones(l.adicionales)}</p>` : ""}
      <div class="pla-firmas"><span>Patrono</span><span>Colaborador</span></div>
    </div>`;
}
function plaImprimirComprobantes(q, lineaId = null) {
  const ls = plaLineasDe(q.id).filter((l) => esCCSS(l) && (!lineaId || l.id === Number(lineaId)));
  stfImprimir(ls.map((l) => `<div class="pla-hoja">${htmlRecibo(l, q, "Copia patrono")}${htmlRecibo(l, q, "Copia colaborador")}</div>`).join(""));
}

// =====================================================
// AGUINALDO
// =====================================================
function periodoAguinaldo(anio) { return { desde: `${anio - 1}-12-01`, hasta: `${anio}-11-30` }; }
function anioAguinaldoDe(hasta) { const y = Number(hasta.slice(0, 4)); return hasta.slice(5, 7) === "12" ? y + 1 : y; }

function datosAguinaldo(anio) {
  const per = periodoAguinaldo(anio);
  const qs = pla.quincenas.filter((q) => q.hasta >= per.desde && q.hasta <= per.hasta);
  const ids = new Set(qs.map((q) => q.id));
  const restantes = Math.max(0, 24 - qs.length);
  const porPersona = new Map();
  pla.lineas.filter((l) => ids.has(l.quincena_id) && esCCSS(l)).forEach((l) => {
    const k = l.persona_id || l.nombre;
    const x = porPersona.get(k) || { persona_id: l.persona_id, nombre: l.nombre, bruto: 0, bonif: 0, quincenas: 0, porMes: {} };
    x.bruto += l.bruto; x.bonif += l.adicionales; x.quincenas++;
    const q = plaQ(l.quincena_id);
    const mes = Number(q.hasta.slice(5, 7)) - 1;
    x.porMes[mes] = (x.porMes[mes] || 0) + l.bruto;
    porPersona.set(k, x);
  });
  const filas = [...porPersona.values()].map((x) => {
    const persona = x.persona_id ? personaPorId(x.persona_id) : null;
    const pr = x.persona_id ? stf.privado.get(x.persona_id) : null;
    const base = x.bruto + (pla.incluirBonif ? x.bonif : 0);
    const activo = persona?.activo ?? false;
    const proyeccion = activo && pr?.tipo_pago === "mensual" ? restantes * (Number(pr.salario_mensual) || 0) / 2 : 0;
    return { ...x, activo, empresa: persona?.empresa, base, acumulado: base / 12, proyectado: (base + proyeccion) / 12, proyeccion };
  }).sort((a, b) => (b.activo - a.activo) || a.nombre.localeCompare(b.nombre));
  return { per, qs, restantes, filas };
}

function htmlAguinaldo() {
  const anios = [...new Set(pla.quincenas.map((q) => anioAguinaldoDe(q.hasta)))].sort().reverse();
  const anio = pla.anioAguinaldo || anios[0] || new Date().getFullYear();
  const d = datosAguinaldo(anio);
  const tot = d.filas.reduce((s, f) => ({ base: s.base + f.base, acum: s.acum + f.acumulado, proy: s.proy + f.proyectado, proyeccion: s.proyeccion + f.proyeccion }), { base: 0, acum: 0, proy: 0, proyeccion: 0 });
  return `
    <div class="stf-horario-cab">
      <div>
        <h2 class="stf-h2">Aguinaldo ${anio}</h2>
        <p class="nota">Periodo del 1 de diciembre de ${anio - 1} al 30 de noviembre de ${anio} · suma de salarios brutos ÷ 12 · ${d.qs.length} de 24 quincenas registradas. La fecha límite de pago es el 20 de diciembre.</p>
      </div>
      <div class="stf-botones">
        ${anios.length > 1 ? `<label class="stf-inline">Año <select id="plaAnioAg">${anios.map((a) => `<option ${a === anio ? "selected" : ""}>${a}</option>`).join("")}</select></label>` : ""}
        <label class="check-linea chico"><input type="checkbox" id="plaBonif" ${pla.incluirBonif ? "checked" : ""}> Incluir bonificaciones</label>
        <button type="button" class="btn" data-pla-accion="excel-aguinaldo">Descargar Excel</button>
        <button type="button" class="btn" data-pla-accion="imprimir-aguinaldo">Imprimir</button>
      </div>
    </div>
    <div class="det-seccion sin-margen tabla-scroll">
      <table class="tabla pla-tabla">
        <thead><tr><th>Colaborador</th><th class="num">Salarios del periodo</th><th class="num">Quincenas</th><th class="num">Aguinaldo acumulado</th><th class="num">Quincenas por venir (proyección)</th><th class="num">Aguinaldo proyectado</th></tr></thead>
        <tbody>${d.filas.map((f) => `
          <tr class="${f.activo ? "" : "inactivo"}">
            <th scope="row"><strong>${escapar(f.nombre)}</strong><small>${f.activo ? escapar(EMPRESAS[f.empresa] || "") : "Inactivo · revisar si ya se pagó en la liquidación"}</small></th>
            <td class="num">${colones(f.base)}</td><td class="num">${f.quincenas}</td>
            <td class="num"><strong>${colones(f.acumulado)}</strong></td>
            <td class="num">${f.proyeccion ? colones(f.proyeccion) : "—"}</td>
            <td class="num"><strong>${colones(f.proyectado)}</strong></td>
          </tr>`).join("") || `<tr><td colspan="6" class="nota">No hay quincenas en este periodo.</td></tr>`}</tbody>
        <tfoot><tr><th scope="row">Total</th><td class="num">${colones(tot.base)}</td><td></td><td class="num">${colones(tot.acum)}</td><td class="num">${colones(tot.proyeccion)}</td><td class="num">${colones(tot.proy)}</td></tr></tfoot>
      </table>
      <p class="nota">La proyección supone que las quincenas que faltan se pagan con el salario normal, sin extras; el monto final se ajusta solo al cerrar cada quincena. ${pla.incluirBonif ? "Las bonificaciones se están sumando al aguinaldo." : "Las bonificaciones no se están sumando; marca la casilla si deben incluirse."}</p>
    </div>`;
}

async function plaExcelAguinaldo() {
  const ExcelJS = await stfCargarExcel();
  const anio = pla.anioAguinaldo || anioAguinaldoDe(pla.quincenas[0]?.hasta || aTexto(new Date()));
  const d = datosAguinaldo(anio);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(`Aguinaldo ${anio}`, { pageSetup: { paperSize: 1, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  const meses = [11, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  ws.addRow([`Aguinaldo ${anio} (1 dic ${anio - 1} – 30 nov ${anio})`]).font = { bold: true, size: 14 };
  ws.addRow([]);
  const cab = ws.addRow(["Colaborador", ...meses.map((m) => MESES[m]), "Total salarios", "Aguinaldo acumulado", "Aguinaldo proyectado"]);
  cab.font = { bold: true, color: { argb: "FFFFFFFF" } };
  cab.eachCell((c) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF23343D" } }));
  d.filas.forEach((f) => {
    const r = ws.addRow([f.nombre + (f.activo ? "" : " (inactivo)"), ...meses.map((m) => f.porMes[m] || 0), f.base, f.acumulado, f.proyectado]);
    for (let i = 2; i <= 16; i++) r.getCell(i).numFmt = '"₡"#,##0';
  });
  ws.getColumn(1).width = 32;
  for (let i = 2; i <= 16; i++) ws.getColumn(i).width = 13;
  const buf = await wb.xlsx.writeBuffer();
  stfDescargar(new Blob([buf]), `Aguinaldo_${anio}.xlsx`);
}

// =====================================================
// LIQUIDACIONES
// =====================================================
function htmlLiquidaciones() {
  return `
    <div class="stf-horario-cab">
      <div><h2 class="stf-h2">Liquidaciones</h2><p class="nota">Cálculo de lo que se paga a un colaborador al terminar la relación laboral.</p></div>
      <div class="stf-botones"><button type="button" class="btn primario" data-pla-accion="nueva-liquidacion">+ Nueva liquidación</button></div>
    </div>
    <div class="det-seccion sin-margen tabla-scroll">
      <table class="tabla pla-tabla">
        <thead><tr><th>Colaborador</th><th>Ingreso</th><th>Salida</th><th>Motivo</th><th class="num">Total pagado</th><th></th></tr></thead>
        <tbody>${pla.liquidaciones.map((x) => `
          <tr>
            <th scope="row"><strong>${escapar(x.nombre)}</strong><small>${escapar(x.antiguedad || "")}${x.importada ? " · del Excel" : ""}</small></th>
            <td>${x.fecha_ingreso ? fechaAnio(x.fecha_ingreso) : "—"}</td><td>${x.fecha_salida ? fechaAnio(x.fecha_salida) : "—"}</td>
            <td>${escapar(x.motivo || "")}</td><td class="num"><strong>${colones(x.total)}</strong></td>
            <td class="pla-acc"><button type="button" class="enlace" data-pla-accion="imprimir-liq" data-id="${x.id}">Imprimir</button>
              <button type="button" class="enlace" data-pla-accion="editar-liq" data-id="${x.id}">Ver / editar</button></td>
          </tr>`).join("") || `<tr><td colspan="6" class="nota">No hay liquidaciones registradas.</td></tr>`}</tbody>
      </table>
    </div>`;
}

function antiguedadTexto(ingreso, salida) {
  if (!ingreso || !salida) return { texto: "", meses: 0, anios: 0 };
  const a = new Date(ingreso + "T12:00:00"), b = new Date(salida + "T12:00:00");
  let y = b.getFullYear() - a.getFullYear(), m = b.getMonth() - a.getMonth(), d = b.getDate() - a.getDate();
  if (d < 0) { m--; d += new Date(b.getFullYear(), b.getMonth(), 0).getDate(); }
  if (m < 0) { y--; m += 12; }
  return { texto: `${y} año(s), ${m} mes(es), ${d} día(s)`, meses: y * 12 + m + d / 30, anios: y + m / 12 + d / 365 };
}
// Días sugeridos según el Código de Trabajo (art. 28 y 29). Verificar siempre con el contador.
function diasSugeridos(meses) {
  let preaviso = 0, cesantia = 0;
  if (meses >= 3 && meses < 6) { preaviso = 7; cesantia = 7; }
  else if (meses >= 6 && meses < 12) { preaviso = 15; cesantia = 14; }
  else if (meses >= 12) {
    preaviso = 30;
    const tabla = [19.5, 20, 20.5, 21, 21.24, 21.5, 22, 22];
    const anios = Math.min(8, Math.floor(meses / 12));
    cesantia = r2(tabla[anios - 1] * anios);
  }
  return { preaviso, cesantia, vacaciones: Math.floor(meses) };
}

function plaNuevaLiquidacion(existente = null) {
  if (existente) {
    pla.liq = { ...existente, salarios: [...(existente.salarios || [])] };
  } else {
    pla.liq = { id: null, persona_id: "", nombre: "", empresa: "", fecha_ingreso: "", fecha_salida: aTexto(new Date()), motivo: MOTIVOS_SALIDA[0],
      salarios: [], aguinaldo: 0, preaviso_dias: 0, vacaciones_dias: 0, cesantia_dias: 0, otros: 0, notas: "" };
  }
  plaPintar();
}

// Llena los salarios de los últimos 6 meses y el aguinaldo a partir de las quincenas
function plaLiqDesdeQuincenas() {
  const L = pla.liq;
  if (!L.persona_id || !L.fecha_salida) return;
  const lineas = pla.lineas.filter((l) => l.persona_id === Number(L.persona_id) && esCCSS(l));
  const porMes = new Map();
  lineas.forEach((l) => {
    const q = plaQ(l.quincena_id);
    if (!q || q.desde > L.fecha_salida) return;
    const k = q.hasta.slice(0, 7);
    porMes.set(k, (porMes.get(k) || 0) + l.bruto);
  });
  const limite = new Date(L.fecha_salida + "T12:00:00"); limite.setMonth(limite.getMonth() - 5); limite.setDate(1);
  const desde = aTexto(limite).slice(0, 7);
  L.salarios = [...porMes.entries()].filter(([k]) => k >= desde && k <= L.fecha_salida.slice(0, 7)).sort()
    .map(([k, v]) => ({ mes: `${MESES[Number(k.slice(5, 7)) - 1]} ${k.slice(0, 4)}`, monto: r2(v) }));
  const anio = anioAguinaldoDe(L.fecha_salida);
  const per = periodoAguinaldo(anio);
  const totalAg = lineas.filter((l) => { const q = plaQ(l.quincena_id); return q && q.hasta >= per.desde && q.desde <= L.fecha_salida; })
    .reduce((s, l) => s + l.bruto, 0);
  L.aguinaldo = r2(totalAg / 12);
  const ant = antiguedadTexto(L.fecha_ingreso, L.fecha_salida);
  const sug = diasSugeridos(ant.meses);
  const conResp = /con responsabilidad|mutuo/i.test(L.motivo);
  L.preaviso_dias = conResp ? sug.preaviso : 0;
  L.cesantia_dias = conResp ? sug.cesantia : 0;
  L.vacaciones_dias = sug.vacaciones;
}

function liqCalculos(L) {
  const total = L.salarios.reduce((s, x) => s + (Number(x.monto) || 0), 0);
  const meses = L.salarios.filter((x) => Number(x.monto)).length || 1;
  const promedio = total / meses;
  const diario = promedio / 30;
  const preaviso = diario * (Number(L.preaviso_dias) || 0);
  const vacaciones = diario * (Number(L.vacaciones_dias) || 0);
  const cesantia = diario * (Number(L.cesantia_dias) || 0);
  const totalPagar = (Number(L.aguinaldo) || 0) + preaviso + vacaciones + cesantia + (Number(L.otros) || 0);
  return { total, meses, promedio: r2(promedio), diario: r2(diario), preaviso: r2(preaviso), vacaciones: r2(vacaciones), cesantia: r2(cesantia), totalPagar: r2(totalPagar) };
}

function htmlLiquidacionForm() {
  const L = pla.liq;
  const c = liqCalculos(L);
  const ant = antiguedadTexto(L.fecha_ingreso, L.fecha_salida);
  const sug = diasSugeridos(ant.meses);
  return `
    <div class="stf-horario-cab">
      <div><button type="button" class="enlace" data-pla-accion="volver-liq">‹ Liquidaciones</button>
        <h2 class="stf-h2">${L.id ? "Liquidación de " + escapar(L.nombre) : "Nueva liquidación"}</h2></div>
      <div class="stf-botones">
        ${L.id ? `<button type="button" class="btn peligro" data-pla-accion="eliminar-liq">Eliminar</button>` : ""}
        <button type="button" class="btn primario" data-pla-accion="guardar-liq">Guardar</button>
      </div>
    </div>
    <div class="stf-dos">
      <div class="stf-col">
        <div class="det-seccion sin-margen">
          <h3>Datos</h3>
          <div class="fila">
            <label>Colaborador <select data-liq="persona_id"><option value="">Elegir…</option>${stf.personas.filter((x) => stf.privado.get(x.id)?.tipo_pago === "mensual").map((x) => `<option value="${x.id}" ${Number(L.persona_id) === x.id ? "selected" : ""}>${escapar(x.nombre)}${x.activo ? "" : " (inactivo)"}</option>`).join("")}</select></label>
            <label>Motivo <select data-liq="motivo">${MOTIVOS_SALIDA.map((m) => `<option ${m === L.motivo ? "selected" : ""}>${m}</option>`).join("")}</select></label>
          </div>
          <div class="fila">
            <label>Fecha de ingreso <input type="date" data-liq="fecha_ingreso" value="${L.fecha_ingreso || ""}"></label>
            <label>Fecha de salida <input type="date" data-liq="fecha_salida" value="${L.fecha_salida || ""}"></label>
          </div>
          <p class="nota">Antigüedad: <strong>${ant.texto || "—"}</strong></p>
          <button type="button" class="btn" data-pla-accion="liq-recalcular">Traer salarios y aguinaldo de las quincenas</button>
        </div>
        <div class="det-seccion sin-margen">
          <h3>Salarios de los últimos meses</h3>
          <table class="tabla pla-tabla">
            <tbody>${L.salarios.map((x, i) => `<tr><td><input data-liq-mes="${i}" value="${escapar(x.mes)}" aria-label="Mes"></td><td class="num"><input class="pla-input" type="number" step="1" data-liq-monto="${i}" value="${x.monto}" aria-label="Salario de ${escapar(x.mes)}"></td><td><button type="button" class="btn-icono" data-pla-accion="liq-quitar-mes" data-i="${i}" aria-label="Quitar mes">×</button></td></tr>`).join("")}</tbody>
            <tfoot><tr><th>Total (${c.meses} ${c.meses === 1 ? "mes" : "meses"})</th><td class="num">${colones(c.total)}</td><td></td></tr></tfoot>
          </table>
          <button type="button" class="enlace" data-pla-accion="liq-agregar-mes">+ Agregar mes</button>
          <p class="nota">Promedio mensual ${colones(c.promedio)} · promedio diario ${colones(c.diario, 2)}</p>
        </div>
      </div>
      <aside class="det-seccion sin-margen stf-resumen">
        <h3>Montos</h3>
        <label>Aguinaldo proporcional (₡) <input type="number" step="1" data-liq="aguinaldo" value="${L.aguinaldo}"></label>
        <div class="fila tres">
          <label>Preaviso (días) <input type="number" step="0.5" data-liq="preaviso_dias" value="${L.preaviso_dias}"></label>
          <label>Vacaciones (días) <input type="number" step="0.5" data-liq="vacaciones_dias" value="${L.vacaciones_dias}"></label>
          <label>Cesantía (días) <input type="number" step="0.5" data-liq="cesantia_dias" value="${L.cesantia_dias}"></label>
        </div>
        <p class="nota">Sugerido por antigüedad: preaviso ${sug.preaviso} días, cesantía ${sug.cesantia} días (solo con responsabilidad patronal), vacaciones ${sug.vacaciones} días (resta los ya disfrutados). Verifícalo con el contador.</p>
        <label>Otros montos (₡) <input type="number" step="1" data-liq="otros" value="${L.otros || 0}"></label>
        <dl class="stf-dl">
          <dt>Aguinaldo</dt><dd>${colones(L.aguinaldo)}</dd>
          <dt>Preaviso</dt><dd>${colones(c.preaviso)}</dd>
          <dt>Vacaciones</dt><dd>${colones(c.vacaciones)}</dd>
          <dt>Cesantía</dt><dd>${colones(c.cesantia)}</dd>
          <dt>Otros</dt><dd>${colones(L.otros || 0)}</dd>
          <dt><strong>Total a pagar</strong></dt><dd><strong>${colones(c.totalPagar)}</strong></dd>
        </dl>
        <label>Notas <textarea data-liq="notas" rows="2">${escapar(L.notas || "")}</textarea></label>
      </aside>
    </div>`;
}

async function plaGuardarLiquidacion() {
  const L = pla.liq;
  if (!L.persona_id && !L.nombre) return avisar("Elige el colaborador.", "error");
  const persona = personaPorId(L.persona_id);
  const c = liqCalculos(L);
  const datos = {
    persona_id: L.persona_id ? Number(L.persona_id) : null, nombre: persona?.nombre || L.nombre, empresa: persona?.empresa || L.empresa || null,
    fecha_ingreso: L.fecha_ingreso || null, fecha_salida: L.fecha_salida || null, motivo: L.motivo,
    antiguedad: antiguedadTexto(L.fecha_ingreso, L.fecha_salida).texto, salarios: L.salarios,
    promedio_mensual: c.promedio, promedio_diario: c.diario, aguinaldo: Number(L.aguinaldo) || 0,
    preaviso_dias: Number(L.preaviso_dias) || 0, preaviso: c.preaviso, vacaciones_dias: Number(L.vacaciones_dias) || 0, vacaciones: c.vacaciones,
    cesantia_dias: Number(L.cesantia_dias) || 0, cesantia: c.cesantia, otros: Number(L.otros) || 0, total: c.totalPagar, notas: L.notas || null
  };
  const r = L.id ? await db.from("pla_liquidaciones").update(datos).eq("id", L.id) : await db.from("pla_liquidaciones").insert(datos);
  if (r.error) return fallo(r.error);
  if (persona && persona.activo && confirm(`¿Inactivar también la ficha de ${persona.nombre} con fecha de salida ${fechaAnio(L.fecha_salida)}?`)) {
    await db.from("staff_personas").update({ activo: false, fecha_salida: L.fecha_salida }).eq("id", persona.id);
    await stfCargar();
  }
  pla.liq = null;
  await plaCargar();
  plaPintar();
  avisar("Liquidación guardada.");
}

function plaImprimirLiquidacion(x) {
  const rc = pla.ajustes.recibo || {};
  stfImprimir(`
    <div class="imp-cabeza"><p class="imp-marca">${escapar(EMPRESA_RECIBO[x.empresa] || "The House of Tours · Home Vacations")}</p><p class="imp-titulo">Liquidación laboral</p></div>
    <dl class="imp-datos">
      <div><dt>Colaborador</dt><dd>${escapar(x.nombre)}</dd></div>
      <div><dt>Fecha de ingreso</dt><dd>${x.fecha_ingreso ? fechaAnio(x.fecha_ingreso) : "—"}</dd></div>
      <div><dt>Fecha de salida</dt><dd>${x.fecha_salida ? fechaAnio(x.fecha_salida) : "—"}</dd></div>
      <div><dt>Antigüedad</dt><dd>${escapar(x.antiguedad || "")}</dd></div>
      <div><dt>Motivo</dt><dd>${escapar(x.motivo || "")}</dd></div>
    </dl>
    <h3>Salarios de los últimos meses</h3>
    <table class="pla-imp-tabla">${(x.salarios || []).map((s) => `<tr><td>${escapar(s.mes)}</td><td class="num">${colones(s.monto)}</td></tr>`).join("")}
      <tr><th>Salario promedio mensual</th><td class="num">${colones(x.promedio_mensual)}</td></tr>
      <tr><th>Salario promedio diario</th><td class="num">${colones(x.promedio_diario, 2)}</td></tr></table>
    <h3>Detalle</h3>
    <table class="pla-imp-tabla">
      <tr><td>Aguinaldo proporcional</td><td class="num">${colones(x.aguinaldo)}</td></tr>
      <tr><td>Preaviso (${x.preaviso_dias} días)</td><td class="num">${colones(x.preaviso)}</td></tr>
      <tr><td>Vacaciones (${x.vacaciones_dias} días)</td><td class="num">${colones(x.vacaciones)}</td></tr>
      <tr><td>Cesantía (${x.cesantia_dias} días)</td><td class="num">${colones(x.cesantia)}</td></tr>
      ${Number(x.otros) ? `<tr><td>Otros</td><td class="num">${colones(x.otros)}</td></tr>` : ""}
      <tr><th>Total a pagar</th><td class="num"><strong>${colones(x.total)}</strong></td></tr>
    </table>
    <div class="pla-firmas grande"><span>Recibido conforme<br>${escapar(x.nombre)}</span><span>Autorizado por<br>${escapar(rc.patrono || "")}</span></div>`);
}

// =====================================================
// RESPALDOS
// =====================================================
function htmlRespaldos() {
  const sinRespaldo = pla.quincenas.filter((q) => q.estado === "cerrada" && !pla.respaldos.some((r) => r.quincena_id === q.id));
  return `
    <div class="stf-horario-cab">
      <div><h2 class="stf-h2">Respaldos de planilla</h2>
        <p class="nota">Se crea uno automáticamente cada vez que se cierra una quincena (y se descarga una copia en la computadora de quien la cierra). No se pueden borrar ni modificar desde el sistema.</p></div>
    </div>
    <div class="stf-dos">
      <div class="det-seccion sin-margen stf-col tabla-scroll">
        <table class="tabla pla-tabla">
          <thead><tr><th>Quincena</th><th>Archivo</th><th>Versión</th><th>Creado</th><th></th></tr></thead>
          <tbody>${pla.respaldos.map((r) => {
            const q = plaQ(r.quincena_id);
            return `<tr><th scope="row">${escapar(q?.nombre || "")}<small>${q ? `${fechaCorta(q.desde)} – ${fechaAnio(q.hasta)}` : ""}</small></th>
              <td>${escapar(r.nombre_archivo)}${r.motivo ? `<small>${escapar(r.motivo)}</small>` : ""}</td>
              <td><span class="stf-chip ${r.version > 1 ? "ok" : "gris"}">Versión ${r.version}</span></td>
              <td>${fechaHora(r.creado_en)}<small>${escapar(nombrePerfil(r.creado_por))}</small></td>
              <td><button type="button" class="btn chico" data-pla-accion="descargar-respaldo" data-id="${r.id}">Descargar</button></td></tr>`;
          }).join("") || `<tr><td colspan="5" class="nota">Todavía no hay respaldos.</td></tr>`}</tbody>
        </table>
      </div>
      <aside class="det-seccion sin-margen stf-resumen">
        <h3>Qué trae cada Excel</h3>
        <ol class="pla-lista">
          <li><strong>Planilla:</strong> los cuatro bloques, el costo para la empresa y los totales.</li>
          <li><strong>Comprobantes:</strong> uno por colaborador.</li>
          <li><strong>Parámetros:</strong> porcentajes, tipo de cambio, fechas y versión.</li>
        </ol>
        <p class="nota">Son valores fijos (sin fórmulas que se rompan) y se abren sin internet. Guarda las descargas en una carpeta protegida: contienen salarios.</p>
        ${sinRespaldo.length ? `
          <h3>Quincenas cerradas sin respaldo</h3>
          <p class="nota">Son las que vinieron del Excel original. Puedes generar su respaldo ahora.</p>
          <button type="button" class="btn" data-pla-accion="respaldar-todas">Generar ${sinRespaldo.length} respaldos</button>` : ""}
      </aside>
    </div>`;
}

async function plaDescargarRespaldo(id) {
  const r = pla.respaldos.find((x) => x.id === Number(id));
  const { data, error } = await db.storage.from("planilla-respaldos").download(r.archivo);
  if (error) return fallo(error, "No se pudo descargar el respaldo.");
  stfDescargar(data, r.nombre_archivo);
}

async function plaRespaldarTodas() {
  const lista = pla.quincenas.filter((q) => q.estado === "cerrada" && !pla.respaldos.some((r) => r.quincena_id === q.id));
  if (!confirm(`Se generarán ${lista.length} respaldos y se descargarán a esta computadora. ¿Continuar?`)) return;
  let ok = 0;
  for (const q of lista) {
    try { await plaRespaldar(q, q.importada ? "Respaldo de quincena importada del Excel" : null); ok++; }
    catch (e) { fallo(e, `No se pudo respaldar ${q.nombre}.`); break; }
  }
  await plaCargar();
  plaPintar();
  avisar(`${ok} respaldos generados.`);
}

// =====================================================
// AJUSTES
// =====================================================
function htmlAjustes() {
  const a = pla.ajustes;
  const pc = a.porcentajes || {}, ca = a.calculo || {}, qs = a.quincenas || {}, rc = a.recibo || {};
  const pct = (x) => r2((Number(x) || 0) * 100);
  return `
    <div class="stf-horario-cab"><div><h2 class="stf-h2">Ajustes de planilla</h2><p class="nota">Los cambios aplican a las quincenas nuevas. Cada quincena guarda los porcentajes con que se creó.</p></div></div>
    <div class="stf-dos">
      <div class="stf-col">
        <form class="det-seccion sin-margen" id="plaAjPorc">
          <h3>Porcentajes de ley</h3>
          <div class="fila">
            <label>CCSS obrera (%) <input name="obrera" type="number" step="0.01" value="${pct(pc.obrera)}"></label>
            <label>CCSS patronal (%) <input name="patronal" type="number" step="0.01" value="${pct(pc.patronal)}"></label>
          </div>
          <div class="fila">
            <label>Riesgos del trabajo (%) <input name="rt" type="number" step="0.01" value="${pct(pc.rt)}"></label>
            <label>Cesantía (%) <input name="cesantia" type="number" step="0.01" value="${pct(pc.cesantia)}"></label>
            <label>Vigente desde <input name="desde" type="date" value="${pc.desde || ""}"></label>
          </div>
          ${pc.anterior ? `<p class="nota">Anterior: obrera ${pct(pc.anterior.obrera)} %, patronal ${pct(pc.anterior.patronal)} %.</p>` : ""}
          <button type="button" class="btn primario" data-pla-accion="guardar-ajuste" data-clave="porcentajes">Guardar porcentajes</button>
        </form>
        <form class="det-seccion sin-margen" id="plaAjCalc">
          <h3>Cálculo del salario y quincenas</h3>
          <div class="fila">
            <label>Divisor del salario diario <input name="divisor" type="number" step="1" value="${ca.divisor ?? 30}"></label>
            <label>Jornada diaria (horas) <input name="jornada" type="number" step="0.5" value="${ca.jornada ?? 8}"></label>
            <label>Multiplicador hora extra <input name="multiplicador" type="number" step="0.1" value="${ca.multiplicador ?? 1.5}"></label>
          </div>
          <div class="fila">
            <label>Tipo de cambio por defecto <input name="tipo_cambio" type="number" step="0.01" value="${qs.tipo_cambio ?? 460}"></label>
            <label>Tolerancia de llegada (minutos) <input name="tolerancia" type="number" step="1" value="${qs.tolerancia ?? 5}"></label>
          </div>
          <p class="nota">Hora extra = salario ÷ ${ca.divisor ?? 30} ÷ ${ca.jornada ?? 8} × ${ca.multiplicador ?? 1.5}. Ejemplo: ₡520.000 → ${colones((520000 / (ca.divisor || 30) / (ca.jornada || 8)) * (ca.multiplicador || 1.5))} por hora.</p>
          <button type="button" class="btn primario" data-pla-accion="guardar-ajuste" data-clave="calculo">Guardar</button>
        </form>
        <form class="det-seccion sin-margen" id="plaAjRecibo">
          <h3>Datos del comprobante</h3>
          <div class="fila">
            <label>Patrono <input name="patrono" value="${escapar(rc.patrono || "")}"></label>
            <label>Cédula <input name="cedula" value="${escapar(rc.cedula || "")}"></label>
            <label>Lugar <input name="lugar" value="${escapar(rc.lugar || "")}"></label>
          </div>
          <button type="button" class="btn primario" data-pla-accion="guardar-ajuste" data-clave="recibo">Guardar</button>
        </form>
      </div>
      <div class="stf-col">
        <div class="det-seccion sin-margen">
          <h3>Feriados</h3>
          <table class="tabla pla-tabla"><tbody>${(a.feriados || []).slice().sort((x, y) => x.fecha.localeCompare(y.fecha)).map((f) => `
            <tr><td>${fechaAnio(f.fecha)}</td><td>${escapar(f.nombre)}</td><td><button type="button" class="btn-icono" data-pla-accion="quitar-feriado" data-fecha="${f.fecha}" aria-label="Quitar ${escapar(f.nombre)}">×</button></td></tr>`).join("")}</tbody></table>
          <div class="fila"><label>Fecha <input id="plaFerFecha" type="date"></label><label>Nombre <input id="plaFerNombre"></label></div>
          <button type="button" class="btn" data-pla-accion="agregar-feriado">+ Agregar feriado</button>
          <p class="nota">Verifica la lista con el calendario oficial cada año.</p>
        </div>
        <div class="det-seccion sin-margen">
          <h3>Tipos de rebajo</h3>
          <table class="tabla pla-tabla"><tbody>${(a.conceptos || []).map((c) => `
            <tr><td>${escapar(c.nombre)}</td><td><button type="button" class="btn-icono" data-pla-accion="quitar-concepto" data-clave="${escapar(c.clave)}" aria-label="Quitar ${escapar(c.nombre)}">×</button></td></tr>`).join("")}</tbody></table>
          <div class="fila"><label>Nuevo tipo de rebajo <input id="plaConNombre"></label></div>
          <button type="button" class="btn" data-pla-accion="agregar-concepto">+ Agregar</button>
        </div>
      </div>
    </div>`;
}

async function plaGuardarAjuste(clave, valor) {
  const { error } = await db.from("pla_ajustes").upsert({ clave, valor });
  if (error) return fallo(error);
  pla.ajustes[clave] = valor;
  if (clave === "conceptos") stf.conceptos = valor;
  plaPintar();
  avisar("Ajustes guardados.");
}

async function plaGuardarFormAjuste(clave) {
  const leer = (id) => Object.fromEntries(new FormData($(id)).entries());
  if (clave === "porcentajes") {
    const d = leer("plaAjPorc");
    const ant = pla.ajustes.porcentajes || {};
    const nuevo = { obrera: r2(d.obrera) / 100, patronal: r2(d.patronal) / 100, rt: r2(d.rt) / 100, cesantia: r2(d.cesantia) / 100, desde: d.desde || null };
    if (ant.obrera !== nuevo.obrera || ant.patronal !== nuevo.patronal) nuevo.anterior = { obrera: ant.obrera, patronal: ant.patronal };
    else if (ant.anterior) nuevo.anterior = ant.anterior;
    return plaGuardarAjuste("porcentajes", nuevo);
  }
  if (clave === "calculo") {
    const d = leer("plaAjCalc");
    await plaGuardarAjuste("quincenas", { tipo_cambio: Number(d.tipo_cambio) || 0, tolerancia: Number(d.tolerancia) || 0 });
    return plaGuardarAjuste("calculo", { divisor: Number(d.divisor) || 30, jornada: Number(d.jornada) || 8, multiplicador: Number(d.multiplicador) || 1.5 });
  }
  if (clave === "recibo") return plaGuardarAjuste("recibo", leer("plaAjRecibo"));
}

// =====================================================
// EVENTOS
// =====================================================
$("staffContenido").addEventListener("click", (e) => {
  if (stf.pestana !== "planilla") return;
  const sub = e.target.closest("[data-pla-sub]");
  if (sub) { pla.sub = sub.dataset.plaSub; pla.actual = null; pla.liq = null; return plaPintar(); }
  const b = e.target.closest("[data-pla-accion]");
  if (!b) return;
  const a = b.dataset.plaAccion;
  const q = plaQ(pla.actual);
  const L = pla.liq;
  const acciones = {
    "abrir": () => { pla.actual = Number(b.dataset.id); plaPintar(); window.scrollTo(0, 0); },
    "volver": () => { pla.actual = null; plaPintar(); },
    "crear-quincena": () => plaCrearQuincena(),
    "rebajos": () => stfAbrirModal(htmlRebajos(pla.lineas.find((x) => x.id === Number(b.dataset.linea)))),
    "agregar-linea": () => plaAgregarLinea(),
    "quitar-linea": () => plaQuitarLinea(b.dataset.linea),
    "eliminar-quincena": () => plaEliminarQuincena(),
    "cerrar": () => plaCerrar(),
    "reabrir": () => plaReabrir(),
    "excel": async () => { try { const x = await plaExcelQuincena(q); stfDescargar(x.blob, x.nombre); } catch (err) { fallo(err, "No se pudo generar el Excel."); } },
    "comprobantes": () => plaImprimirComprobantes(q),
    "reloj": () => relAbrir(),
    "comprobante": () => plaImprimirComprobantes(q, b.dataset.linea),
    "excel-aguinaldo": () => plaExcelAguinaldo().catch((err) => fallo(err, "No se pudo generar el Excel.")),
    "imprimir-aguinaldo": () => window.print(),
    "nueva-liquidacion": () => plaNuevaLiquidacion(),
    "editar-liq": () => plaNuevaLiquidacion(pla.liquidaciones.find((x) => x.id === Number(b.dataset.id))),
    "imprimir-liq": () => plaImprimirLiquidacion(pla.liquidaciones.find((x) => x.id === Number(b.dataset.id))),
    "volver-liq": () => { pla.liq = null; plaPintar(); },
    "liq-recalcular": () => { if (!L.persona_id) return avisar("Elige el colaborador.", "error"); plaLiqDesdeQuincenas(); plaPintar(); },
    "liq-agregar-mes": () => { L.salarios.push({ mes: "", monto: 0 }); plaPintar(); },
    "liq-quitar-mes": () => { L.salarios.splice(Number(b.dataset.i), 1); plaPintar(); },
    "guardar-liq": () => plaGuardarLiquidacion(),
    "eliminar-liq": async () => {
      if (!confirm("¿Eliminar esta liquidación?")) return;
      const { error } = await db.from("pla_liquidaciones").delete().eq("id", L.id);
      if (error) return fallo(error);
      pla.liq = null; await plaCargar(); plaPintar();
    },
    "descargar-respaldo": () => plaDescargarRespaldo(b.dataset.id),
    "respaldar-todas": () => plaRespaldarTodas(),
    "guardar-ajuste": () => plaGuardarFormAjuste(b.dataset.clave),
    "agregar-feriado": () => {
      const f = $("plaFerFecha").value, n = $("plaFerNombre").value.trim();
      if (!f || !n) return avisar("Escribe la fecha y el nombre del feriado.", "error");
      return plaGuardarAjuste("feriados", [...(pla.ajustes.feriados || []).filter((x) => x.fecha !== f), { fecha: f, nombre: n }]);
    },
    "quitar-feriado": () => plaGuardarAjuste("feriados", (pla.ajustes.feriados || []).filter((x) => x.fecha !== b.dataset.fecha)),
    "agregar-concepto": () => {
      const n = $("plaConNombre").value.trim();
      if (!n) return;
      const clave = nombreArchivo(n).toLowerCase();
      if ((pla.ajustes.conceptos || []).some((c) => c.clave === clave)) return avisar("Ese tipo de rebajo ya existe.");
      return plaGuardarAjuste("conceptos", [...(pla.ajustes.conceptos || []), { clave, nombre: n, tipo: "rebajo" }]);
    },
    "quitar-concepto": () => plaGuardarAjuste("conceptos", (pla.ajustes.conceptos || []).filter((c) => c.clave !== b.dataset.clave))
  };
  if (acciones[a]) conBoton(b, async () => { await acciones[a](); });
});

$("staffContenido").addEventListener("change", async (e) => {
  if (stf.pestana !== "planilla") return;
  const t = e.target;
  if (t.id === "plaAnioLista") { pla.anioLista = t.value; return plaPintar(); }
  if (t.id === "plaAnioAg") { pla.anioAguinaldo = Number(t.value); return plaPintar(); }
  if (t.id === "plaBonif") { pla.incluirBonif = t.checked; return plaPintar(); }

  // Edición de líneas de la quincena
  if (t.dataset.plaCampo) {
    const l = pla.lineas.find((x) => x.id === Number(t.dataset.linea));
    const v = Number(t.value) || 0;
    if (t.dataset.plaCampo === "rebajo_usd") l.rebajos = v ? { adelantos: v } : {};
    else l[t.dataset.plaCampo] = v;
    await plaGuardarLinea(l);
    const sig = { campo: t.dataset.plaCampo, linea: t.dataset.linea };
    plaPintar();
    $("staffContenido").querySelector(`[data-pla-campo="${sig.campo}"][data-linea="${sig.linea}"]`)?.focus();
    return;
  }
  if (t.dataset.plaQ === "tipo_cambio") {
    const q = plaQ(pla.actual);
    q.tipo_cambio = Number(t.value) || 0;
    const { error } = await db.from("pla_quincenas").update({ tipo_cambio: q.tipo_cambio }).eq("id", q.id);
    if (error) return fallo(error);
    for (const l of plaLineasDe(q.id).filter((x) => x.bloque === "SOCIOS")) await plaGuardarLinea(l);
    return plaPintar();
  }

  // Formulario de liquidación
  const L = pla.liq;
  if (!L) return;
  if (t.dataset.liq) {
    const k = t.dataset.liq;
    L[k] = t.value;
    if (k === "persona_id") {
      const p = personaPorId(t.value);
      if (p) { L.nombre = p.nombre; L.empresa = p.empresa; L.fecha_ingreso = p.fecha_ingreso || L.fecha_ingreso; if (p.fecha_salida) L.fecha_salida = p.fecha_salida; }
      plaLiqDesdeQuincenas();
    }
    if (k === "fecha_salida" || k === "fecha_ingreso" || k === "motivo") plaLiqDesdeQuincenas();
    return plaPintar();
  }
  if (t.dataset.liqMes != null) { L.salarios[Number(t.dataset.liqMes)].mes = t.value; return; }
  if (t.dataset.liqMonto != null) { L.salarios[Number(t.dataset.liqMonto)].monto = Number(t.value) || 0; return plaPintar(); }
});

// Botones del modal (rebajos)
function plaModalClick(e, b) {
  if (b.dataset.plaModal === "guardar-rebajos") conBoton(b, () => plaGuardarRebajos(b.dataset.linea));
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-pla-modal]");
  if (b && !$("staffModal").hidden) plaModalClick(e, b);
});
