// =====================================================
// PLANILLA › IMPORTAR RELOJ MARCADOR
//  · Lee el Excel del reloj (hoja recordList: sName, sJobNo, Date, Time…),
//    que trae todas las marcas desde 2024.
//  · El operador elige el rango de fechas y el personal activo.
//  · Reglas (definidas por la administración):
//     - El reloj no distingue entrada/salida: las horas del día son
//       de la PRIMERA a la ÚLTIMA marca. No se rebaja almuerzo.
//     - Marcas repetidas con menos de 2 minutos de diferencia cuentan una vez.
//     - Día con una sola marca: se cuenta la jornada (8 h; 4 h medio tiempo),
//       salvo que el operador agregue la marca que falta.
//  · Paso intermedio: las marcas se muestran tal como vienen del archivo y el
//    operador puede cambiar horas, agregar o eliminar marcas antes de cargar.
//    Al cargar se pide confirmación; si dice que no, sigue editando.
//     - Los minutos se acumulan exactos.
//     - Horas extra: por SEMANA (lunes a domingo). Cada día suma o resta lo
//       que pasa o le falta para su jornada; lo que sobra en la semana es extra.
//       Una semana en negativo queda como horas faltantes (no se rebajan).
//     - Trabajadores por hora: se pagan todas las horas trabajadas.
// (usa utilidades de panel.js, staff.js y planilla.js)
// =====================================================

const rel = {
  archivo: "",
  marcas: null,      // Map codigo → { codigo, nombre, dias: Map(fecha → [minutos]) , ultima }
  desde: "", hasta: "",
  sel: new Set(),    // persona_id elegidos
  mapa: new Map(),   // persona_id → codigo del reloj
  trabajo: new Map(),  // persona_id → Map(fecha → [{ id, min, orig, borrada }])  (copia editable)
  trabajoClave: "",    // rango con el que se armó la copia
  ver: null,           // persona que se está revisando en el paso 2 (null = todas)
  soloAvisos: false,
  resultado: null,
  paso: 1,
  sec: 0
};

const relLimpio = (v) => String(comValorCeldaRel(v) ?? "").replace(/^'+/, "").trim();
function comValorCeldaRel(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    if ("result" in v) return comValorCeldaRel(v.result);
    if (v.richText) return v.richText.map((x) => x.text).join("");
    if ("text" in v) return v.text;
    return null;
  }
  return v;
}
const relNorm = (t) => String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const hm = (horas) => {
  const neg = horas < 0, m = Math.round(Math.abs(horas) * 60);
  return `${neg ? "−" : ""}${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
};
const horaTxt = (min) => `${pad(Math.floor(min / 60))}:${pad(Math.floor(min % 60))}`;
const relJornada = (personaId) => horasJornada(personaPorId(personaId));
function relLunes(fecha) {
  const d = new Date(fecha + "T12:00:00");
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return aTexto(d);
}
// Personas que se pueden importar: activas y con datos de pago (CCSS o por hora)
const relCandidatos = () => stf.personas
  .filter((p) => p.activo && ["HV", "THT", "HORA"].includes(stf.privado.get(p.id)?.bloque))
  .sort((a, b) => a.nombre.localeCompare(b.nombre));

// ---------- Leer el archivo ----------
async function relLeer(archivo) {
  const ExcelJS = await stfCargarExcel();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await archivo.arrayBuffer());
  let hoja = null, cab = null, filaCab = 0;
  wb.eachSheet((ws) => {
    if (hoja) return;
    for (let r = 1; r <= Math.min(5, ws.rowCount); r++) {
      const c = (ws.getRow(r).values || []).map((x) => relNorm(relLimpio(x)));
      if (c.includes("sjobno") && c.includes("date") && c.includes("time")) { hoja = ws; cab = c; filaCab = r; break; }
    }
  });
  if (!hoja) throw new Error("No encontré las columnas del reloj (sName, sJobNo, Date, Time). Revise que sea el archivo del reloj marcador.");
  const i = (n) => cab.indexOf(n);
  const iNom = i("sname"), iCod = i("sjobno"), iFec = i("date"), iHor = i("time");
  const marcas = new Map();
  for (let r = filaCab + 1; r <= hoja.rowCount; r++) {
    const v = hoja.getRow(r).values || [];
    const codigo = relLimpio(v[iCod]);
    if (!codigo || codigo.toUpperCase() === "NULL") continue;          // huella no reconocida
    const f = comValorCeldaRel(v[iFec]), t = comValorCeldaRel(v[iHor]);
    const fecha = relFecha(f);
    const min = relMinutos(t);
    if (!fecha || min === null) continue;
    if (!marcas.has(codigo)) marcas.set(codigo, { codigo, nombre: "", dias: new Map(), ultima: "" });
    const m = marcas.get(codigo);
    const nom = relLimpio(v[iNom]);
    if (nom && nom.toUpperCase() !== "NULL") m.nombre = nom;
    if (!m.dias.has(fecha)) m.dias.set(fecha, []);
    m.dias.get(fecha).push(min);
    if (fecha > m.ultima) m.ultima = fecha;
  }
  return marcas;
}
function relFecha(f) {
  if (f instanceof Date) return `${f.getUTCFullYear()}-${pad(f.getUTCMonth() + 1)}-${pad(f.getUTCDate())}`;
  if (typeof f === "number") { const d = new Date(Date.UTC(1899, 11, 30) + f * 864e5); return relFecha(d); }
  const m = String(f ?? "").match(/(\d{4})-(\d{1,2})-(\d{1,2})/) || String(f ?? "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  return m[1].length === 4 ? `${m[1]}-${pad(m[2])}-${pad(m[3])}` : `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
}
function relMinutos(t) {
  if (t instanceof Date) return t.getUTCHours() * 60 + t.getUTCMinutes() + t.getUTCSeconds() / 60;
  if (typeof t === "number") return (t % 1) * 1440;
  const m = String(t ?? "").match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  return m ? Number(m[1]) * 60 + Number(m[2]) + (Number(m[3]) || 0) / 60 : null;
}
// Persona ↔ número del reloj: primero el número guardado en la ficha, luego el nombre en el reloj
function relSugerirCodigo(p) {
  if (!rel.marcas) return "";
  if (p.codigo_reloj && rel.marcas.has(String(p.codigo_reloj))) return String(p.codigo_reloj);
  const objetivo = relNorm(p.nombre_reloj || "");
  if (objetivo) for (const m of rel.marcas.values()) if (relNorm(m.nombre) === objetivo) return m.codigo;
  const pal = relNorm(p.nombre).split(" ");
  const cand = [...rel.marcas.values()].filter((m) => {
    const q = relNorm(m.nombre).split(" ").filter(Boolean);
    return q.length && q.every((w) => pal.includes(w)) && (q.length > 1 || q[0] === pal[0]);
  });
  return cand.length === 1 ? cand[0].codigo : "";
}

// ---------- Copia editable de las marcas ----------
// Se arma al pasar al paso 2 con las marcas del rango, tal como vienen del archivo.
function relArmarTrabajo() {
  const clave = `${rel.desde}|${rel.hasta}|${rel.archivo}`;
  if (rel.trabajoClave !== clave) { rel.trabajo = new Map(); rel.trabajoClave = clave; }
  for (const pid of [...rel.trabajo.keys()]) if (!rel.sel.has(pid)) rel.trabajo.delete(pid);
  for (const pid of rel.sel) {
    const cod = rel.mapa.get(pid) || "";
    const previo = rel.trabajo.get(pid);
    if (previo && previo.codigo === cod) continue;            // conserva lo ya editado
    const dias = new Map();
    const m = cod ? rel.marcas.get(cod) : null;
    if (m) for (const [fecha, lista] of [...m.dias.entries()].sort()) {
      if (fecha < rel.desde || fecha > rel.hasta) continue;
      dias.set(fecha, [...lista].sort((a, b) => a - b).map((min) => ({ id: ++rel.sec, min, orig: min, borrada: false })));
    }
    dias.codigo = cod;
    rel.trabajo.set(pid, dias);
  }
}
const relDiaVivas = (lista) => lista.filter((x) => !x.borrada).map((x) => x.min).sort((a, b) => a - b);
function relEstadoMarca(x) {
  if (x.borrada) return "borrada";
  if (x.orig === null) return "agregada";
  if (Math.abs(x.min - x.orig) >= 1 / 60) return "editada";
  return "original";
}
function relCambios(pid) {
  const out = [];
  for (const [fecha, lista] of rel.trabajo.get(pid) || []) for (const x of lista) {
    const e = relEstadoMarca(x);
    if (e !== "original") out.push({ fecha, estado: e, antes: x.orig === null ? null : horaTxt(x.orig), despues: x.borrada ? null : horaTxt(x.min) });
  }
  return out;
}

// ---------- Calcular (con la copia editada) ----------
function relCalcular() {
  const res = [];
  for (const pid of rel.sel) {
    const p = personaPorId(pid);
    const pr = stf.privado.get(pid);
    const codigo = rel.mapa.get(pid);
    const jornada = relJornada(pid);
    const porHora = pr?.bloque === "HORA";
    const dias = [];
    for (const [fecha, lista] of [...(rel.trabajo.get(pid) || new Map()).entries()].sort()) {
      const ord = relDiaVivas(lista);
      if (!ord.length) continue;                                   // todas eliminadas: no trabajó
      const unicas = ord.filter((x, i) => i === 0 || x - ord[i - 1] >= 2);   // repetidas < 2 min
      const una = unicas.length === 1;
      const horas = una ? jornada : (unicas[unicas.length - 1] - unicas[0]) / 60;
      dias.push({ fecha, entrada: unicas[0], salida: una ? null : unicas[unicas.length - 1], marcas: unicas.length, repetidas: ord.length - unicas.length, una, horas });
    }
    const semanas = new Map();
    for (const d of dias) {
      const s = relLunes(d.fecha);
      if (!semanas.has(s)) semanas.set(s, { lunes: s, dias: 0, horas: 0, esperado: 0 });
      const w = semanas.get(s);
      w.dias++; w.horas += d.horas; w.esperado += jornada;
    }
    const sem = [...semanas.values()].map((w) => ({ ...w, diferencia: w.horas - w.esperado }));
    const total = dias.reduce((s, d) => s + d.horas, 0);
    const extra = sem.reduce((s, w) => s + Math.max(0, w.diferencia), 0);
    const faltante = sem.reduce((s, w) => s + Math.min(0, w.diferencia), 0);
    res.push({ pid, nombre: p.nombre, bloque: pr?.bloque, porHora, jornada, codigo, sinCodigo: !codigo || !rel.marcas.get(codigo),
      dias, semanas: sem, total, extra, faltante, incompletos: dias.filter((d) => d.una).length, cambios: relCambios(pid).length });
  }
  rel.resultado = res.sort((a, b) => a.nombre.localeCompare(b.nombre));
}

// ---------- Ventana ----------
function relAbrir() {
  const q = plaQ(pla.actual);
  if (!rel.archivo) { rel.desde = q.desde; rel.hasta = q.hasta; }
  if (!rel.sel.size) {
    const enQ = new Set(plaLineasDe(q.id).map((l) => l.persona_id));
    relCandidatos().forEach((p) => { if (enQ.has(p.id)) rel.sel.add(p.id); });
  }
  if (!rel.marcas) rel.paso = 1;
  relPintar();
}
function relPintar() {
  const q = plaQ(pla.actual);
  const caja = document.querySelector("#staffModal .rel-scroll");
  const scroll = caja ? caja.scrollTop : 0;
  const enRevision = rel.paso === 2 && rel.resultado;
  const cuerpo = enRevision ? htmlRelRevision(q) : htmlRelElegir(q);
  const botones = enRevision
    ? `<button type="button" class="btn" data-rel="volver">‹ Cambiar selección</button><button type="button" class="btn primario" data-rel="cargar">Cargar a la planilla</button>`
    : `<button type="button" class="btn primario" data-rel="siguiente" ${rel.marcas ? "" : "disabled"}>Ver marcas ›</button>`;
  stfAbrirModal(`
    <div class="det-cabeza" style="--c: var(--verde)">
      <div><p class="det-numero">${escapar(q.nombre)} · Reloj marcador · paso ${enRevision ? 2 : 1} de 2</p><h2 id="stfModalTitulo">${enRevision ? "Revisar y ajustar marcas" : "Importar reloj marcador"}</h2></div>
      <div class="det-acciones"><button type="button" class="btn" data-rel="cerrar">Cerrar</button>${botones}</div>
    </div>
    <div class="det-seccion">${cuerpo}</div>`, "ancho");
  const nueva = document.querySelector("#staffModal .rel-scroll");
  if (nueva) nueva.scrollTop = scroll;
}

function htmlRelElegir(q) {
  const cand = relCandidatos();
  const opciones = rel.marcas ? [...rel.marcas.values()].sort((a, b) => Number(a.codigo) - Number(b.codigo)) : [];
  const usados = new Map([...rel.mapa.entries()].map(([pid, c]) => [c, pid]));
  const fila = (p) => {
    const pr = stf.privado.get(p.id);
    const cod = rel.mapa.get(p.id) || "";
    const m = cod ? rel.marcas?.get(cod) : null;
    return `
      <tr>
        <td class="com-check"><input type="checkbox" data-rel-sel="${p.id}" ${rel.sel.has(p.id) ? "checked" : ""} aria-label="Incluir a ${escapar(p.nombre)}"></td>
        <th scope="row">${escapar(p.nombre)}<small>${pr.bloque === "HORA" ? "Por horas" : `${BLOQUES[pr.bloque] || pr.bloque} · jornada ${relJornada(p.id)} h`}</small></th>
        <td>${rel.marcas ? `<select data-rel-cod="${p.id}" aria-label="Número en el reloj de ${escapar(p.nombre)}">
            <option value="">— Sin asignar —</option>
            ${opciones.map((o) => `<option value="${o.codigo}" ${o.codigo === cod ? "selected" : ""} ${usados.has(o.codigo) && usados.get(o.codigo) !== p.id ? "disabled" : ""}>N.º ${o.codigo} · ${escapar(o.nombre || "sin nombre")}</option>`).join("")}
          </select>` : `<small>Cargue el archivo</small>`}</td>
        <td><small>${m ? `Última marca: ${fechaAnio(m.ultima)}` : rel.marcas && rel.sel.has(p.id) ? `<span class="pla-neg">Elija su número</span>` : ""}</small></td>
      </tr>`;
  };
  return `
    <div class="rel-paso">
      <label class="btn">📂 ${rel.archivo ? "Cambiar archivo" : "Elegir archivo del reloj (.xlsx)"}<input type="file" id="relArchivo" accept=".xlsx" hidden></label>
      ${rel.archivo ? `<span class="nota">✓ <strong>${escapar(rel.archivo)}</strong> · ${rel.marcas.size} números con marcas</span>` : `<span class="nota">El archivo con todas las marcas desde 2024. Solo se usa el rango de fechas elegido.</span>`}
    </div>
    <div class="rel-fechas">
      <label>Desde <input type="date" id="relDesde" value="${rel.desde}"></label>
      <label>Hasta <input type="date" id="relHasta" value="${rel.hasta}"></label>
      <button type="button" class="stf-pill" data-rel="rango-quincena">Rango de la quincena (${fechaCorta(q.desde)} al ${fechaCorta(q.hasta)})</button>
    </div>
    <h3>Personal activo <small class="nota">${rel.sel.size} seleccionado${rel.sel.size === 1 ? "" : "s"}</small></h3>
    <p class="nota">Marque a quiénes se les toman las horas. El número del reloj se guarda en la ficha y la próxima vez se elige solo.</p>
    <div class="tabla-scroll"><table class="tabla pla-tabla">
      <thead><tr><th class="com-check"><input type="checkbox" data-rel="todos" ${rel.sel.size === cand.length ? "checked" : ""} aria-label="Seleccionar todos"></th><th>Colaborador</th><th>Número en el reloj</th><th></th></tr></thead>
      <tbody>${cand.map(fila).join("")}</tbody>
    </table></div>`;
}


// ---------- Paso 2: marcas tal como vienen del archivo, editables ----------
function htmlRelRevision(q) {
  const lineas = plaLineasDe(q.id);
  const res = rel.resultado;
  const totales = `
    <div class="tabla-scroll"><table class="tabla pla-tabla rel-tabla">
      <thead><tr><th>Colaborador</th><th class="num">Días</th><th class="num">Horas trabajadas</th><th>Semanas (diferencia con la jornada)</th><th class="num">Extra a pagar</th><th class="num">Faltantes</th><th class="centro">Revisión</th></tr></thead>
      <tbody>${res.map((r) => {
        const semanas = r.semanas.map((w) => `<span class="rel-sem ${w.diferencia > 0.005 ? "mas" : w.diferencia < -0.005 ? "menos" : ""}" title="Semana del ${fechaCorta(w.lunes)}: ${hm(w.horas)} de ${hm(w.esperado)}">${fechaCorta(w.lunes)} ${w.diferencia >= 0 ? "+" : ""}${hm(w.diferencia)}</span>`).join(" ");
        const tieneLinea = lineas.some((l) => l.persona_id === r.pid);
        return `<tr class="${rel.ver === r.pid ? "rel-actual" : ""}">
          <th scope="row"><button type="button" class="enlace" data-rel="ver" data-p="${r.pid}">${escapar(r.nombre)}</button><small>${r.porHora ? "Por horas" : `Jornada ${r.jornada} h`}${r.codigo ? ` · reloj n.º ${r.codigo}` : ""}${tieneLinea ? "" : " · no está en esta quincena"}</small></th>
          <td class="num">${r.dias.length}</td>
          <td class="num"><strong>${hm(r.total)}</strong></td>
          <td>${r.porHora ? `<small>Se pagan todas las horas</small>` : semanas || "—"}</td>
          <td class="num">${r.porHora ? "—" : `<strong>${hm(r.extra)}</strong>`}</td>
          <td class="num ${r.faltante < 0 ? "pla-neg" : ""}">${r.porHora || !r.faltante ? "—" : hm(r.faltante)}</td>
          <td class="centro">${r.sinCodigo ? `<span class="stf-chip alerta">Sin número de reloj</span>` : `${r.incompletos ? `<span class="stf-chip aviso">${r.incompletos} con una marca</span>` : ""}${r.cambios ? ` <span class="stf-chip">${r.cambios} ajuste${r.cambios > 1 ? "s" : ""}</span>` : ""}${!r.incompletos && !r.cambios ? `<span class="stf-chip ok">Sin cambios</span>` : ""}`}</td>
        </tr>`;
      }).join("")}</tbody>
    </table></div>`;

  // Tabla de marcas como en el archivo original: una fila por marca
  const personas = res.filter((r) => rel.ver === null || r.pid === rel.ver);
  let filas = "";
  for (const r of personas) {
    const dias = rel.trabajo.get(r.pid) || new Map();
    const calc = new Map(r.dias.map((d) => [d.fecha, d]));
    const fechas = [...dias.keys()].sort();
    filas += `<tr class="rel-persona"><th colspan="6">${escapar(r.nombre)} <small>${r.codigo ? `n.º ${r.codigo} en el reloj` : "sin número de reloj"}</small></th></tr>`;
    if (!fechas.length) filas += `<tr><td colspan="6" class="nota">Sin marcas en el rango.</td></tr>`;
    for (const fecha of fechas) {
      const lista = [...dias.get(fecha)].sort((a, b) => a.min - b.min);
      const d = calc.get(fecha);
      if (rel.soloAvisos && !(d?.una || lista.some((x) => relEstadoMarca(x) !== "original") || (d?.repetidas))) continue;
      const nombreReloj = rel.marcas.get(r.codigo)?.nombre || "";
      lista.forEach((x, i) => {
        const est = relEstadoMarca(x);
        filas += `
          <tr class="rel-marca ${est} ${i === 0 ? "rel-dia-ini" : ""}">
            <td>${i === 0 ? `<strong>${fechaCorta(fecha)}</strong> <small>${DIAS_CORTO[new Date(fecha + "T12:00:00").getDay()]}</small>` : ""}</td>
            <td><small>${escapar(nombreReloj)} · ${escapar(r.codigo || "")}</small></td>
            <td><input type="time" step="1" class="rel-hora" value="${horaTxt(x.min)}${x.min % 1 ? `:${pad(Math.round((x.min % 1) * 60) % 60)}` : ":00"}" data-rel-marca="${r.pid}|${fecha}|${x.id}" ${x.borrada ? "disabled" : ""} aria-label="Hora de la marca"></td>
            <td>${{ original: "", editada: `<span class="stf-chip aviso">Editada · antes ${horaTxt(x.orig)}</span>`, agregada: `<span class="stf-chip">Agregada</span>`, borrada: `<span class="stf-chip gris">Eliminada</span>` }[est]}</td>
            <td class="pla-acc">${x.borrada
              ? `<button type="button" class="enlace" data-rel="restaurar" data-k="${r.pid}|${fecha}|${x.id}">Restaurar</button>`
              : `${est === "editada" ? `<button type="button" class="enlace" data-rel="deshacer" data-k="${r.pid}|${fecha}|${x.id}">Deshacer</button>` : ""}<button type="button" class="btn-icono" data-rel="borrar" data-k="${r.pid}|${fecha}|${x.id}" aria-label="Eliminar marca">×</button>`}</td>
            ${i === 0 ? `<td rowspan="${lista.length}" class="rel-dia-total">${d ? `<strong>${hm(d.horas)}</strong>${d.una ? `<small class="pla-neg">Una sola marca: se cuentan ${r.jornada} h</small>` : `<small>${horaTxt(d.entrada)} a ${horaTxt(d.salida)}</small>`}${d.repetidas ? `<small>${d.repetidas} repetida${d.repetidas > 1 ? "s" : ""} (se cuenta una)</small>` : ""}` : `<small>No cuenta (sin marcas)</small>`}
              <button type="button" class="enlace" data-rel="agregar" data-k="${r.pid}|${fecha}">+ Marca</button></td>` : ""}
          </tr>`;
      });
    }
    filas += `<tr class="rel-nuevo-dia"><td colspan="6">
      <label class="stf-inline">Agregar día <input type="date" min="${rel.desde}" max="${rel.hasta}" data-rel-dia="${r.pid}"></label>
      <input type="time" step="1" data-rel-dia-hora="${r.pid}" value="08:00:00" aria-label="Hora">
      <button type="button" class="btn chico" data-rel="agregar-dia" data-p="${r.pid}">Agregar marca</button></td></tr>`;
  }
  const marcasTabla = `
    <div class="rel-filtros">
      <span>Ver:</span>
      <button type="button" class="stf-pill ${rel.ver === null ? "on oscuro" : ""}" data-rel="ver" data-p="">Todos</button>
      ${res.map((r) => `<button type="button" class="stf-pill ${rel.ver === r.pid ? "on oscuro" : ""}" data-rel="ver" data-p="${r.pid}">${escapar(r.nombre.split(" ")[0])}${r.incompletos ? " ⚠️" : ""}</button>`).join("")}
      <label class="stf-inline"><input type="checkbox" data-rel="solo-avisos" ${rel.soloAvisos ? "checked" : ""}> Solo días con avisos o ajustes</label>
    </div>
    <div class="rel-scroll"><table class="tabla rel-marcas">
      <thead><tr><th>Fecha (Date)</th><th>Nombre y n.º (sName · sJobNo)</th><th>Hora (Time)</th><th>Ajuste</th><th></th><th>Horas del día</th></tr></thead>
      <tbody>${filas}</tbody>
    </table></div>`;

  return `
    <p class="nota">Del ${fechaLarga(rel.desde)} al ${fechaLarga(rel.hasta)} · archivo ${escapar(rel.archivo)}. Abajo están las marcas <strong>tal como vienen del archivo</strong>.
      Puede cambiar la hora de cualquier marca, eliminarla o agregar las que falten. El resumen se recalcula solo. Nada se guarda en la planilla hasta que toque <strong>Cargar a la planilla</strong>.</p>
    <h3>Resumen</h3>
    ${totales}
    <h3>Marcas del reloj</h3>
    ${marcasTabla}`;
}

// ---------- Cargar a la planilla ----------
async function relCargar() {
  const q = plaQ(pla.actual);
  const lineas = plaLineasDe(q.id);
  const aplicar = rel.resultado.filter((r) => !r.sinCodigo && lineas.some((l) => l.persona_id === r.pid));
  const sinLinea = rel.resultado.filter((r) => !lineas.some((l) => l.persona_id === r.pid));
  const sinCod = rel.resultado.filter((r) => r.sinCodigo);
  const ajustes = rel.resultado.reduce((s, r) => s + r.cambios, 0);
  const unaMarca = rel.resultado.reduce((s, r) => s + r.incompletos, 0);
  let msg = `¿Está seguro de cargar la información del reloj a ${q.nombre}?\n\n` +
    `• ${aplicar.length} colaborador(es) del ${fechaCorta(rel.desde)} al ${fechaCorta(rel.hasta)}\n` +
    `• ${ajustes} marca(s) ajustada(s) por usted\n` +
    `• ${unaMarca} día(s) con una sola marca (se cuenta la jornada completa)`;
  if (sinLinea.length) msg += `\n\nNo están en esta quincena y se omiten: ${sinLinea.map((r) => r.nombre).join(", ")}.`;
  if (sinCod.length) msg += `\n\nSin número de reloj, no se cambian: ${sinCod.map((r) => r.nombre).join(", ")}.`;
  msg += `\n\nAceptar = cargar. Cancelar = seguir editando.`;
  if (!confirm(msg)) return;                       // "No": la ventana sigue en edición
  for (const [pid, codigo] of rel.mapa) {
    if (!rel.sel.has(pid)) continue;
    const p = personaPorId(pid);
    if (!p || String(p.codigo_reloj || "") === codigo) continue;
    const { error } = await db.from("staff_personas").update({ codigo_reloj: codigo }).eq("id", pid);
    if (error) return fallo(error);
    p.codigo_reloj = codigo;
  }
  const r2h = (x) => Math.round(x * 100) / 100;
  for (const r of aplicar) {
    const l = lineas.find((x) => x.persona_id === r.pid);
    if (r.porHora) l.horas = r2h(r.total);
    else l.horas_extra = r.extra > 0.005 ? r2h(r.extra) : r2h(r.faltante);
    l.reloj = {
      importado: new Date().toISOString(), archivo: rel.archivo, desde: rel.desde, hasta: rel.hasta, codigo: r.codigo,
      dias: r.dias.length, horas: r2h(r.total), extra: r2h(r.extra), faltante: r2h(r.faltante), una_marca: r.incompletos,
      ajustes: relCambios(r.pid),
      semanas: r.semanas.map((w) => ({ lunes: w.lunes, horas: r2h(w.horas), esperado: w.esperado, diferencia: r2h(w.diferencia) }))
    };
    await plaGuardarLinea(l);
  }
  rel.trabajo = new Map(); rel.trabajoClave = ""; rel.paso = 1;
  stfCerrarModal();
  avisar("Horas del reloj cargadas a la planilla.");
  plaPintar();
}
function relHayCambios() { return rel.paso === 2 && rel.resultado?.some((r) => r.cambios); }
const relBuscar = (k) => {
  const [pid, fecha, id] = k.split("|");
  const lista = rel.trabajo.get(Number(pid))?.get(fecha) || [];
  return { pid: Number(pid), fecha, lista, x: lista.find((m) => m.id === Number(id)) };
};
const relRecalcular = () => { relCalcular(); relPintar(); };

// ---------- Eventos ----------
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-rel]");
  if (!b || $("staffModal").hidden || b.tagName === "INPUT") return;
  const a = b.dataset.rel;
  if (a === "cerrar") {
    if (relHayCambios() && !confirm("Tiene ajustes sin cargar. Si cierra, se conservan mientras no cambie el archivo o el rango. ¿Cerrar?")) return;
    return stfCerrarModal();
  }
  if (a === "rango-quincena") { const q = plaQ(pla.actual); rel.desde = q.desde; rel.hasta = q.hasta; return relPintar(); }
  if (a === "siguiente") {
    if (!rel.desde || !rel.hasta || rel.desde > rel.hasta) return avisar("Revise el rango de fechas.", "error");
    if (!rel.sel.size) return avisar("Marque al menos un colaborador.", "error");
    const clave = `${rel.desde}|${rel.hasta}|${rel.archivo}`;
    if (rel.trabajoClave && rel.trabajoClave !== clave && [...rel.trabajo.keys()].some((pid) => relCambios(pid).length)
      && !confirm("Cambió el rango de fechas: los ajustes que había hecho se pierden. ¿Continuar?")) return;
    relArmarTrabajo(); relCalcular(); rel.paso = 2;
    if (rel.ver !== null && !rel.sel.has(rel.ver)) rel.ver = null;
    return relPintar();
  }
  if (a === "volver") { rel.paso = 1; return relPintar(); }
  if (a === "cargar") return conBoton(b, relCargar);
  if (a === "ver") { rel.ver = b.dataset.p ? Number(b.dataset.p) : null; return relPintar(); }
  if (a === "borrar") { const { x } = relBuscar(b.dataset.k); if (x) { if (x.orig === null) { const r = relBuscar(b.dataset.k); r.lista.splice(r.lista.indexOf(x), 1); } else x.borrada = true; } return relRecalcular(); }
  if (a === "restaurar") { const { x } = relBuscar(b.dataset.k); if (x) x.borrada = false; return relRecalcular(); }
  if (a === "deshacer") { const { x } = relBuscar(b.dataset.k); if (x && x.orig !== null) x.min = x.orig; return relRecalcular(); }
  if (a === "agregar") {
    const [pid, fecha] = b.dataset.k.split("|");
    const lista = rel.trabajo.get(Number(pid)).get(fecha);
    const vivas = relDiaVivas(lista);
    const sug = vivas.length ? Math.min(23 * 60 + 59, vivas[vivas.length - 1] + 8 * 60) : 8 * 60;
    lista.push({ id: ++rel.sec, min: sug, orig: null, borrada: false });
    return relRecalcular();
  }
  if (a === "agregar-dia") {
    const pid = Number(b.dataset.p);
    const fecha = document.querySelector(`[data-rel-dia="${pid}"]`)?.value;
    const hora = relMinutos(document.querySelector(`[data-rel-dia-hora="${pid}"]`)?.value || "");
    if (!fecha || fecha < rel.desde || fecha > rel.hasta) return avisar("Elija una fecha dentro del rango.", "error");
    if (hora === null) return avisar("Escriba la hora de la marca.", "error");
    const dias = rel.trabajo.get(pid);
    if (!dias.has(fecha)) dias.set(fecha, []);
    dias.get(fecha).push({ id: ++rel.sec, min: hora, orig: null, borrada: false });
    return relRecalcular();
  }
});
document.addEventListener("change", async (e) => {
  const t = e.target;
  if ($("staffModal").hidden) return;
  if (t.id === "relArchivo" && t.files[0]) {
    const f = t.files[0]; t.value = "";
    try {
      avisar("Leyendo el archivo del reloj…");
      rel.marcas = await relLeer(f);
      rel.archivo = f.name;
      rel.trabajo = new Map(); rel.trabajoClave = "";
      for (const p of relCandidatos()) { const c = relSugerirCodigo(p); if (c) rel.mapa.set(p.id, c); }
      relPintar();
    } catch (err) { fallo(err, err.message); }
    return;
  }
  if (t.id === "relDesde") { rel.desde = t.value; return; }
  if (t.id === "relHasta") { rel.hasta = t.value; return; }
  if (t.dataset.rel === "todos") { rel.sel = t.checked ? new Set(relCandidatos().map((p) => p.id)) : new Set(); return relPintar(); }
  if (t.dataset.rel === "solo-avisos") { rel.soloAvisos = t.checked; return relPintar(); }
  if (t.dataset.relSel) { const id = Number(t.dataset.relSel); t.checked ? rel.sel.add(id) : rel.sel.delete(id); return relPintar(); }
  if (t.dataset.relCod) { const id = Number(t.dataset.relCod); t.value ? rel.mapa.set(id, t.value) : rel.mapa.delete(id); return relPintar(); }
  if (t.dataset.relMarca) {
    const { x } = relBuscar(t.dataset.relMarca);
    const v = relMinutos(t.value);
    if (!x) return;
    if (v === null) { avisar("Escriba una hora válida.", "error"); return relPintar(); }
    x.min = v;
    return relRecalcular();
  }
});
