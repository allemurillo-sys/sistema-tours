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
//       y el operador puede corregirlo.
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
  editados: new Map(), // `${persona}|${fecha}` → horas escritas por el operador
  abiertos: new Set(), // personas con el detalle desplegado
  resultado: null,
  paso: 1
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

// ---------- Calcular ----------
function relCalcular() {
  const res = [];
  for (const pid of rel.sel) {
    const p = personaPorId(pid);
    const pr = stf.privado.get(pid);
    const codigo = rel.mapa.get(pid);
    const jornada = relJornada(pid);
    const porHora = pr?.bloque === "HORA";
    const m = codigo ? rel.marcas.get(codigo) : null;
    const dias = [];
    if (m) {
      for (const [fecha, lista] of [...m.dias.entries()].sort()) {
        if (fecha < rel.desde || fecha > rel.hasta) continue;
        const ord = [...lista].sort((a, b) => a - b);
        const unicas = ord.filter((x, i) => i === 0 || x - ord[i - 1] >= 2);   // repetidas < 2 min
        const una = unicas.length === 1;
        let horas = una ? jornada : (unicas[unicas.length - 1] - unicas[0]) / 60;
        const clave = `${pid}|${fecha}`;
        const editado = rel.editados.has(clave);
        if (editado) horas = rel.editados.get(clave);
        dias.push({ fecha, entrada: unicas[0], salida: una ? null : unicas[unicas.length - 1], marcas: unicas.length, una, editado, horas });
      }
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
    res.push({ pid, nombre: p.nombre, bloque: pr?.bloque, porHora, jornada, codigo, sinCodigo: !m, dias, semanas: sem, total, extra, faltante,
      incompletos: dias.filter((d) => d.una && !d.editado).length });
  }
  rel.resultado = res.sort((a, b) => a.nombre.localeCompare(b.nombre));
}

// ---------- Ventana ----------
function relAbrir() {
  const q = plaQ(pla.actual);
  rel.desde = rel.desde && rel.archivo ? rel.desde : q.desde;
  rel.hasta = rel.hasta && rel.archivo ? rel.hasta : q.hasta;
  if (!rel.sel.size) {
    const enQ = new Set(plaLineasDe(q.id).map((l) => l.persona_id));
    relCandidatos().forEach((p) => { if (enQ.has(p.id)) rel.sel.add(p.id); });
  }
  rel.paso = rel.marcas ? rel.paso : 1;
  relPintar();
}
function relPintar() {
  const q = plaQ(pla.actual);
  const cuerpo = rel.paso === 2 && rel.resultado ? htmlRelResultado(q) : htmlRelElegir(q);
  const botones = rel.paso === 2
    ? `<button type="button" class="btn" data-rel="volver">‹ Cambiar selección</button><button type="button" class="btn primario" data-rel="aplicar">Pasar a la planilla</button>`
    : `<button type="button" class="btn primario" data-rel="calcular" ${rel.marcas ? "" : "disabled"}>Calcular horas</button>`;
  stfAbrirModal(`
    <div class="det-cabeza" style="--c: var(--verde)">
      <div><p class="det-numero">${escapar(q.nombre)} · Reloj marcador</p><h2 id="stfModalTitulo">${rel.paso === 2 ? "Horas del reloj" : "Importar reloj marcador"}</h2></div>
      <div class="det-acciones"><button type="button" class="btn" data-stf-accion="cerrar-modal">Cerrar</button>${botones}</div>
    </div>
    <div class="det-seccion">${cuerpo}</div>`, "ancho");
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

function htmlRelResultado(q) {
  const lineas = plaLineasDe(q.id);
  const fila = (r) => {
    const tieneLinea = lineas.some((l) => l.persona_id === r.pid);
    const abierto = rel.abiertos.has(r.pid);
    const semanas = r.semanas.map((w) => `<span class="rel-sem ${w.diferencia > 0.005 ? "mas" : w.diferencia < -0.005 ? "menos" : ""}" title="Semana del ${fechaCorta(w.lunes)}: ${hm(w.horas)} trabajadas de ${hm(w.esperado)}">${fechaCorta(w.lunes)} ${w.diferencia >= 0 ? "+" : ""}${hm(w.diferencia)}</span>`).join(" ");
    return `
      <tr>
        <th scope="row"><button type="button" class="enlace" data-rel="detalle" data-p="${r.pid}">${abierto ? "▾" : "▸"} ${escapar(r.nombre)}</button>
          <small>${r.porHora ? "Por horas" : `Jornada ${r.jornada} h`}${r.codigo ? ` · reloj n.º ${r.codigo}` : ""}${tieneLinea ? "" : " · no está en esta quincena"}</small></th>
        <td class="num">${r.dias.length}</td>
        <td class="num"><strong>${hm(r.total)}</strong><small>${horasTxt(Math.round(r.total * 100) / 100)} h</small></td>
        <td>${r.porHora ? `<small>Se pagan todas las horas</small>` : semanas || "—"}</td>
        <td class="num">${r.porHora ? "—" : `<strong>${hm(r.extra)}</strong>`}</td>
        <td class="num ${r.faltante < 0 ? "pla-neg" : ""}">${r.porHora || !r.faltante ? "—" : hm(r.faltante)}</td>
        <td class="centro">${r.sinCodigo ? `<span class="stf-chip alerta">Sin número de reloj</span>` : r.incompletos ? `<span class="stf-chip aviso">${r.incompletos} día${r.incompletos > 1 ? "s" : ""} con una marca</span>` : `<span class="stf-chip ok">Completo</span>`}</td>
      </tr>
      ${abierto ? `<tr class="rel-detalle"><td colspan="7">${htmlRelDias(r)}</td></tr>` : ""}`;
  };
  const conProblema = rel.resultado.filter((r) => r.incompletos).length;
  return `
    <p class="nota">Del ${fechaLarga(rel.desde)} al ${fechaLarga(rel.hasta)} · archivo ${escapar(rel.archivo)}.
      Horas del día = de la primera a la última marca, sin rebajar almuerzo. Extra por semana (lunes a domingo).</p>
    ${conProblema ? `<p class="aviso-caja">⚠️ ${conProblema} colaborador${conProblema > 1 ? "es tienen" : " tiene"} días con una sola marca: se contó la jornada completa. Abra el detalle para corregir la hora si hace falta.</p>` : ""}
    <div class="tabla-scroll"><table class="tabla pla-tabla rel-tabla">
      <thead><tr><th>Colaborador</th><th class="num">Días</th><th class="num">Horas trabajadas</th><th>Semanas (diferencia con la jornada)</th><th class="num">Extra a pagar</th><th class="num">Faltantes</th><th class="centro">Marcas</th></tr></thead>
      <tbody>${rel.resultado.map(fila).join("")}</tbody>
    </table></div>
    <p class="nota">Al pasar a la planilla: a quienes tienen CCSS se les escriben las <strong>horas extra</strong> (si todas sus semanas quedaron en negativo, se anotan las faltantes, que no se rebajan); a los trabajadores por hora, el <strong>total de horas</strong>. Los días laborados no se cambian.</p>`;
}
function htmlRelDias(r) {
  if (!r.dias.length) return `<p class="nota">Sin marcas en el rango.</p>`;
  const filas = r.dias.map((d) => `
    <tr class="${d.una ? "rel-una" : ""}">
      <td>${fechaCorta(d.fecha)} <small>${DIAS_CORTO[new Date(d.fecha + "T12:00:00").getDay()]}</small></td>
      <td>${horaTxt(d.entrada)}</td>
      <td>${d.salida === null ? `<span class="stf-chip aviso">Falta marca</span>` : horaTxt(d.salida)}</td>
      <td class="num">${d.marcas}</td>
      <td class="num"><input class="pla-input corto" type="number" step="0.25" min="0" max="24" value="${Math.round(d.horas * 100) / 100}" data-rel-horas="${r.pid}|${d.fecha}" aria-label="Horas del ${d.fecha}"> <small>${hm(d.horas)}</small>${d.editado ? ` <small>(corregido)</small>` : ""}</td>
      <td class="num ${!r.porHora && d.horas - r.jornada < 0 ? "pla-neg" : ""}">${r.porHora ? "" : `${d.horas - r.jornada >= 0 ? "+" : ""}${hm(d.horas - r.jornada)}`}</td>
    </tr>`).join("");
  return `
    <table class="tabla rel-dias">
      <thead><tr><th>Día</th><th>Primera marca</th><th>Última marca</th><th class="num">Marcas</th><th class="num">Horas</th><th class="num">${r.porHora ? "" : "± jornada"}</th></tr></thead>
      <tbody>${filas}</tbody>
    </table>`;
}

// ---------- Pasar a la planilla ----------
async function relAplicar() {
  const q = plaQ(pla.actual);
  const lineas = plaLineasDe(q.id);
  const sinLinea = rel.resultado.filter((r) => !lineas.some((l) => l.persona_id === r.pid));
  const sinCod = rel.resultado.filter((r) => r.sinCodigo);
  let msg = `¿Pasar las horas de ${rel.resultado.filter((r) => !r.sinCodigo && !sinLinea.includes(r)).length} colaborador(es) a ${q.nombre}?`;
  if (sinLinea.length) msg += `\n\nNo están en esta quincena y se omiten: ${sinLinea.map((r) => r.nombre).join(", ")}.`;
  if (sinCod.length) msg += `\n\nSin número de reloj, no se cambian: ${sinCod.map((r) => r.nombre).join(", ")}.`;
  if (!confirm(msg)) return;
  // Guardar el número del reloj en cada ficha
  for (const [pid, codigo] of rel.mapa) {
    const p = personaPorId(pid);
    if (!p || String(p.codigo_reloj || "") === codigo) continue;
    const { error } = await db.from("staff_personas").update({ codigo_reloj: codigo }).eq("id", pid);
    if (error) return fallo(error);
    p.codigo_reloj = codigo;
  }
  const r2h = (x) => Math.round(x * 100) / 100;
  for (const r of rel.resultado) {
    const l = lineas.find((x) => x.persona_id === r.pid);
    if (!l || r.sinCodigo) continue;
    if (r.porHora) l.horas = r2h(r.total);
    else l.horas_extra = r.extra > 0.005 ? r2h(r.extra) : r2h(r.faltante);
    l.reloj = {
      importado: new Date().toISOString(), archivo: rel.archivo, desde: rel.desde, hasta: rel.hasta, codigo: r.codigo,
      dias: r.dias.length, horas: r2h(r.total), extra: r2h(r.extra), faltante: r2h(r.faltante), una_marca: r.dias.filter((d) => d.una).length,
      corregidos: r.dias.filter((d) => d.editado).map((d) => ({ fecha: d.fecha, horas: r2h(d.horas) })),
      semanas: r.semanas.map((w) => ({ lunes: w.lunes, horas: r2h(w.horas), esperado: w.esperado, diferencia: r2h(w.diferencia) }))
    };
    await plaGuardarLinea(l);
  }
  stfCerrarModal();
  avisar("Horas del reloj pasadas a la planilla.");
  plaPintar();
}

// ---------- Eventos ----------
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-rel]");
  if (!b || $("staffModal").hidden) return;
  const a = b.dataset.rel;
  if (a === "rango-quincena") { const q = plaQ(pla.actual); rel.desde = q.desde; rel.hasta = q.hasta; return relPintar(); }
  if (a === "calcular") {
    if (!rel.desde || !rel.hasta || rel.desde > rel.hasta) return avisar("Revise el rango de fechas.", "error");
    if (!rel.sel.size) return avisar("Marque al menos un colaborador.", "error");
    relCalcular(); rel.paso = 2; rel.abiertos.clear(); return relPintar();
  }
  if (a === "volver") { rel.paso = 1; return relPintar(); }
  if (a === "detalle") { const p = Number(b.dataset.p); rel.abiertos.has(p) ? rel.abiertos.delete(p) : rel.abiertos.add(p); return relPintar(); }
  if (a === "aplicar") return conBoton(b, relAplicar);
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
      rel.editados.clear();
      for (const p of relCandidatos()) { const c = relSugerirCodigo(p); if (c) rel.mapa.set(p.id, c); }
      relPintar();
    } catch (err) { fallo(err, err.message); }
    return;
  }
  if (t.id === "relDesde") { rel.desde = t.value; return; }
  if (t.id === "relHasta") { rel.hasta = t.value; return; }
  if (t.dataset.rel === "todos") { rel.sel = t.checked ? new Set(relCandidatos().map((p) => p.id)) : new Set(); return relPintar(); }
  if (t.dataset.relSel) { const id = Number(t.dataset.relSel); t.checked ? rel.sel.add(id) : rel.sel.delete(id); return relPintar(); }
  if (t.dataset.relCod) { const id = Number(t.dataset.relCod); t.value ? rel.mapa.set(id, t.value) : rel.mapa.delete(id); return relPintar(); }
  if (t.dataset.relHoras) {
    const v = Number(t.value);
    if (!(v >= 0 && v <= 24)) return avisar("Escriba horas entre 0 y 24.", "error");
    rel.editados.set(t.dataset.relHoras, v);
    relCalcular(); return relPintar();
  }
});
