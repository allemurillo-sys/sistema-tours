// =====================================================
// SECCIÓN CALENDARIO: actividades de las reservas confirmadas
// (usa las utilidades y datos de panel.js)
// =====================================================

const ESTADOS_CALENDARIO = ["reserva", "finalizado"];

const cal = {
  mes: null,          // "2026-10-01": primer día del mes que se ve
  elegido: null,      // "2026-10-12": día cuyo detalle se muestra
  tipo: "",           // filtro por tipo de actividad ("" = todos)
  usuario: "",        // filtro por colaborador que atiende ("" = todos, "sin" = sin asignar)
  datos: [],          // actividades del rango visible
  cargando: false
};

const inicioMes = (s) => s.slice(0, 7) + "-01";
function moverMes(s, n) {
  const d = new Date(s + "T12:00:00");
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  return aTexto(d);
}
function sumarDiasCal(s, n) {
  const d = new Date(s + "T12:00:00");
  d.setDate(d.getDate() + n);
  return aTexto(d);
}
// Semanas completas de lunes a domingo que cubren el mes
function rangoVisible() {
  const primero = new Date(cal.mes + "T12:00:00");
  const desde = sumarDiasCal(cal.mes, -((primero.getDay() + 6) % 7));
  const ultimo = sumarDiasCal(moverMes(cal.mes, 1), -1);
  const u = new Date(ultimo + "T12:00:00");
  const hasta = sumarDiasCal(ultimo, (7 - u.getDay()) % 7);
  return { desde, hasta };
}

const personasActividad = (a) => (a.actividad_participantes || []).reduce((s, p) => s + (p.cantidad || 0), 0);
const iconoTipo = (servicioId) => app.tipos.find((tp) => tp.id === servicioPorId(servicioId)?.tipo_id)?.icono || "";
function visibles() {
  let lista = cal.datos;
  if (cal.tipo === "sin") lista = lista.filter((a) => !app.tipos.some((tp) => tp.id === servicioPorId(a.servicio_id)?.tipo_id));
  else if (cal.tipo) lista = lista.filter((a) => servicioPorId(a.servicio_id)?.tipo_id === Number(cal.tipo));
  if (cal.usuario === "sin") lista = lista.filter((a) => !a.cot.colaborador_id);
  else if (cal.usuario) lista = lista.filter((a) => a.cot.colaborador_id === cal.usuario);
  return lista;
}

// ---------- Carga ----------
async function cargarCalendario() {
  if (!cal.mes) {
    const hoy = aTexto(new Date());
    cal.mes = inicioMes(hoy);
    cal.elegido = hoy;
  }
  const { desde, hasta } = rangoVisible();
  cal.cargando = true;
  pintarCalendario();

  const { data, error } = await db.from("actividades")
    .select("id, fecha, hora_inicio, hora_fin, hora_recogida, lugar_recogida, servicio_id, cotizacion_id, " +
            "actividad_participantes(cantidad), cotizaciones!inner(id, numero, nombre, apellido, estado, idioma, colaborador_id)")
    .in("cotizaciones.estado", ESTADOS_CALENDARIO)
    .gte("fecha", desde).lte("fecha", hasta)
    .order("fecha").order("hora_inicio", { nullsFirst: false });

  cal.cargando = false;
  if (error) { pintarCalendario(); return fallo(error, "No se pudo cargar el calendario."); }
  cal.datos = data.map((a) => ({ ...a, cot: a.cotizaciones }));
  pintarCalendario();
}

// ---------- Dibujo ----------
function pintarCalendario() {
  const cont = $("calendarioContenido");
  if (!cal.mes) return;
  const { desde, hasta } = rangoVisible();
  const hoy = aTexto(new Date());
  const mesTexto = new Date(cal.mes + "T12:00:00").toLocaleDateString("es-CR", { month: "long", year: "numeric" });
  const lista = visibles();

  const porDia = {};
  lista.forEach((a) => (porDia[a.fecha] ||= []).push(a));

  // Resumen del mes (solo días del mes, no los de relleno)
  const delMes = lista.filter((a) => a.fecha.slice(0, 7) === cal.mes.slice(0, 7));
  const reservas = new Set(delMes.map((a) => a.cotizacion_id)).size;
  const resumen = cal.cargando && !cal.datos.length ? "Cargando…" :
    delMes.length
      ? `${delMes.length} ${delMes.length === 1 ? "actividad" : "actividades"} de ${reservas} ${reservas === 1 ? "reserva" : "reservas"} este mes.`
      : (cal.tipo || cal.usuario ? "No hay actividades con estos filtros este mes." : "No hay actividades de reservas confirmadas este mes.");

  const tipos = [
    `<option value="">Todos los tipos</option>`,
    ...app.tipos.map((tp) => `<option value="${tp.id}" ${String(tp.id) === cal.tipo ? "selected" : ""}>${escapar(nombreTipo(tp))}</option>`),
    `<option value="sin" ${cal.tipo === "sin" ? "selected" : ""}>Sin tipo</option>`
  ].join("");

  const perfilesOrdenados = [...app.perfiles].sort((x, y) => (x.nombre || "").localeCompare(y.nombre || "", "es"));
  const usuarios = [
    `<option value="">Todos los usuarios</option>`,
    `<option value="${app.yo.id}" ${cal.usuario === app.yo.id ? "selected" : ""}>Mis reservas</option>`,
    ...perfilesOrdenados.filter((pf) => pf.id !== app.yo.id)
      .map((pf) => `<option value="${pf.id}" ${cal.usuario === pf.id ? "selected" : ""}>${escapar(pf.nombre)}</option>`),
    `<option value="sin" ${cal.usuario === "sin" ? "selected" : ""}>Sin asignar</option>`
  ].join("");

  // Encabezado de días (lunes a domingo)
  const lunes = "2024-01-01";
  const cabeza = [0, 1, 2, 3, 4, 5, 6].map((i) => {
    const d = new Date(sumarDiasCal(lunes, i) + "T12:00:00");
    return `<div class="cal-cab" role="columnheader"><span class="largo">${d.toLocaleDateString("es-CR", { weekday: "long" })}</span><span class="corto">${d.toLocaleDateString("es-CR", { weekday: "narrow" })}</span></div>`;
  }).join("");

  let celdas = "";
  for (let f = desde; f <= hasta; f = sumarDiasCal(f, 1)) {
    const acts = porDia[f] || [];
    const fuera = f.slice(0, 7) !== cal.mes.slice(0, 7);
    const clases = ["cal-celda", fuera && "fuera", f === hoy && "hoy", f === cal.elegido && "elegido", acts.length && "con-act"].filter(Boolean).join(" ");
    const items = acts.map((a) => `
      <button type="button" class="cal-item estado-${a.cot.estado}" data-cot="${a.cot.id}"
        title="${escapar(`${hora(a.hora_inicio) || "Sin hora"} · ${servicioPorId(a.servicio_id)?.nombre ?? "Actividad"} · ${nombreCompleto(a.cot)} (${a.cot.numero})`)}">
        <span class="cal-hora">${hora(a.hora_inicio) || "--:--"}</span>
        <span class="cal-texto">${escapar(servicioPorId(a.servicio_id)?.nombre ?? "Actividad")} · ${escapar(a.cot.apellido || a.cot.nombre)}</span>
      </button>`).join("");
    const mas = acts.length > 3 ? `<button type="button" class="cal-mas" data-dia="${f}">+${acts.length - 3} más</button>` : "";
    const diaTexto = fechaLarga(f);

    celdas += `
      <div class="${clases}" role="gridcell">
        <button type="button" class="cal-num" data-dia="${f}"
          aria-label="${escapar(`${diaTexto}: ${acts.length} ${acts.length === 1 ? "actividad" : "actividades"}`)}"
          ${f === cal.elegido ? 'aria-pressed="true"' : 'aria-pressed="false"'}>
          <span>${Number(f.slice(8))}</span>
          ${acts.length ? `<span class="cal-cuenta">${acts.length}</span>` : ""}
        </button>
        <div class="cal-items">${items}</div>
        ${mas}
      </div>`;
  }

  cont.innerHTML = `
    <div class="cal-barra">
      <div class="cal-nav">
        <button type="button" class="btn-icono grande" data-cal="anterior" aria-label="Mes anterior" title="Mes anterior">‹</button>
        <h2 class="cal-mes">${escapar(mesTexto.charAt(0).toUpperCase() + mesTexto.slice(1))}</h2>
        <button type="button" class="btn-icono grande" data-cal="siguiente" aria-label="Mes siguiente" title="Mes siguiente">›</button>
        <button type="button" class="btn" data-cal="hoy">Hoy</button>
      </div>
      <div class="cal-filtros">
        <label class="en-linea">Usuario <select id="calUsuario">${usuarios}</select></label>
        <label class="en-linea">Tipo de actividad <select id="calTipo">${tipos}</select></label>
        <button type="button" class="btn" data-cal="imprimir">Imprimir mes</button>
      </div>
    </div>
    ${cal.usuario || cal.tipo ? `<p class="solo-impresion cal-filtro-imp">Filtro: ${escapar([
      cal.usuario ? (cal.usuario === "sin" ? "sin asignar" : nombrePerfil(cal.usuario)) : "",
      cal.tipo ? (cal.tipo === "sin" ? "sin tipo" : nombreTipo(app.tipos.find((tp) => String(tp.id) === cal.tipo) || {})) : ""
    ].filter(Boolean).join(" · "))}</p>` : ""}
    <p class="nota cal-resumen">${escapar(resumen)} Se muestran las actividades de las reservas confirmadas y finalizadas. Toca una actividad para abrir su reserva.</p>
    <div class="cal-leyenda nota">
      <span><i class="punto estado-reserva"></i> Reserva confirmada</span>
      <span><i class="punto estado-finalizado"></i> Finalizada</span>
    </div>
    <div class="cal-grid" role="grid" aria-label="Calendario de ${escapar(mesTexto)}">
      <div class="cal-fila-cab" role="row">${cabeza}</div>
      <div class="cal-dias">${celdas}</div>
    </div>
    ${htmlDiaElegido(porDia)}`;
}

function htmlDiaElegido(porDia) {
  if (!cal.elegido) {
    return `<section class="cal-detalle"><p class="nota">Toca un día para ver todas sus actividades.</p></section>`;
  }
  const acts = porDia[cal.elegido] || [];
  const titulo = fechaLarga(cal.elegido);
  const filas = acts.map((a) => {
    const serv = servicioPorId(a.servicio_id);
    const horario = a.hora_inicio ? `${hora(a.hora_inicio)}${a.hora_fin ? " – " + hora(a.hora_fin) : ""}` : "Sin hora";
    const n = personasActividad(a);
    const recogida = a.hora_recogida || a.lugar_recogida
      ? `Pick up${a.hora_recogida ? " " + hora(a.hora_recogida) : ""}${a.lugar_recogida ? ": " + a.lugar_recogida : ""}` : "";
    return `
      <li>
        <button type="button" class="cal-fila estado-${a.cot.estado}" data-cot="${a.cot.id}">
          <span class="cal-fila-hora">${escapar(horario)}</span>
          <span class="cal-fila-cuerpo">
            <strong>${iconoTipo(a.servicio_id) ? escapar(iconoTipo(a.servicio_id)) + " " : ""}${escapar(serv?.nombre ?? "Actividad")}</strong>
            <span>${escapar(nombreCompleto(a.cot))} · <span class="sin-cortar">${a.cot.numero}</span>${n ? ` · ${n} ${n === 1 ? "persona" : "personas"}` : ""}${a.cot.idioma && a.cot.idioma !== "es" ? ` · ${a.cot.idioma.toUpperCase()}` : ""}</span>
            <span class="nota">Atiende: ${escapar(nombrePerfil(a.cot.colaborador_id)) || "sin asignar"}${recogida ? ` · ${escapar(recogida)}` : ""}</span>
          </span>
          <span class="chip-estado">${a.cot.estado === "finalizado" ? "Finalizada" : "Reserva"}</span>
        </button>
      </li>`;
  }).join("");

  return `
    <section class="cal-detalle" aria-live="polite">
      <h3>${escapar(titulo.charAt(0).toUpperCase() + titulo.slice(1))}</h3>
      ${acts.length ? `<ul class="cal-lista">${filas}</ul>` : `<p class="nota">No hay actividades de reservas confirmadas este día.</p>`}
    </section>`;
}

// ---------- Eventos ----------
$("calendarioContenido").addEventListener("click", async (e) => {
  const item = e.target.closest("[data-cot]");
  if (item) return abrirDetalle(Number(item.dataset.cot));

  const dia = e.target.closest("[data-dia]");
  if (dia) {
    cal.elegido = dia.dataset.dia;
    // Si tocó un día del mes anterior o siguiente, se cambia de mes
    if (inicioMes(cal.elegido) !== cal.mes) {
      cal.mes = inicioMes(cal.elegido);
      await cargarCalendario();
    } else {
      pintarCalendario();
    }
    document.querySelector(`.cal-num[data-dia="${cal.elegido}"]`)?.focus();
    if (window.matchMedia("(max-width: 760px)").matches) document.querySelector(".cal-detalle")?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }

  const btn = e.target.closest("[data-cal]");
  if (!btn) return;
  switch (btn.dataset.cal) {
    case "anterior":
    case "siguiente":
      cal.mes = moverMes(cal.mes, btn.dataset.cal === "anterior" ? -1 : 1);
      cal.elegido = null;
      await cargarCalendario();
      document.querySelector(`[data-cal="${btn.dataset.cal}"]`)?.focus();
      break;
    case "hoy": {
      const hoy = aTexto(new Date());
      cal.mes = inicioMes(hoy);
      cal.elegido = hoy;
      await cargarCalendario();
      break;
    }
    case "imprimir":
      window.print();
      break;
  }
});

$("calendarioContenido").addEventListener("change", (e) => {
  if (e.target.id === "calTipo") cal.tipo = e.target.value;
  else if (e.target.id === "calUsuario") cal.usuario = e.target.value;
  else return;
  const id = e.target.id;
  pintarCalendario();
  $(id)?.focus();
});

// Se recarga al abrir la sección, al actualizar los datos y al cerrar una reserva
const calendarioVisible = () => !$("vistaCalendario").hidden;
document.addEventListener("vista-abierta", (e) => { if (e.detail === "calendario") cargarCalendario(); });
document.addEventListener("tablero-actualizado", () => { if (calendarioVisible() && !cal.cargando) cargarCalendario(); });
document.addEventListener("detalle-cerrado", () => { if (calendarioVisible()) cargarCalendario(); });
