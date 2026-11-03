// =====================================================
// TARIFARIO › CATÁLOGO, TIPOS DE ACTIVIDAD Y CATEGORÍAS (solo administradores)
// El Tarifario es la fuente única del sistema. Aquí se completa lo que ve el cliente
// de cada servicio: nombre, tipo de actividad, descripción, horarios, fotos,
// traducciones y si se muestra en el formulario. También:
//   · alertas de duplicados (mismo proveedor) y de actividades con varios proveedores,
//   · tipos de actividad (antes en Servicios),
//   · equivalencia entre las categorías del tarifario y los tipos de cliente.
// Los datos del cliente se guardan en la tabla servicios (la que leen el formulario y el panel),
// enlazada a su ficha del tarifario (tar_fichas.servicio_id).
// Usa utilidades de panel.js, tarifario.js y tarifario-comparar.js.
// =====================================================

const TAR_FOTOS_MIN = 3;
const TAR_FOTOS_MAX = 8;
const TAR_FOTO_ANCHO = 1200;   // todas las fotos quedan de 1200 × 900 (horizontal 4:3)
const TAR_FOTO_ALTO = 900;
const TAR_BUCKET = "servicios-fotos";
const TAR_DIAS_AVISO = 60;     // avisar cuando la última tarifa termina en menos de estos días
const TAR_IDIOMAS = { en: "Inglés", fr: "Francés", de: "Alemán", it: "Italiano" };

tar.cobertura = [];                 // tarifas de todos los años (solo los campos necesarios)
tar.mapaCategorias = new Map();     // clave de la categoría del tarifario → { clave, nombre, categoria_id }
tar.mapaError = null;
tar.catalogo = { tipo: "", ver: "todos", texto: "" };
tar.catItems = [];                  // filas pintadas en Catálogo
tar.previa = { fecha: "", resultado: null, cargando: false };
tar.catSel = new Set();             // claves marcadas para las acciones en bloque

// ---------- Lo que ve el cliente (etapa 13) ----------
// Requisitos para publicar (marcar visible). La base de datos exige lo mismo
// (t_servicios_publicar); las que ya eran visibles antes no se ocultan solas.
function tarFaltantesPublicar(it) {
  const s = it?.srv;
  if (!s) return ["ficha para clientes"];
  const f = [];
  const fotos = tarFotos(s).length;
  if (fotos < TAR_FOTOS_MIN) f.push(`${TAR_FOTOS_MIN} fotos (tiene ${fotos})`);
  if (!String(s.descripcion ?? "").trim()) f.push("descripción");
  if (!s.tipo_id) f.push("tipo de actividad");
  if (it.sinTarifario || !it.aprobadas) f.push("tarifa aprobada en el Tarifario");
  return f;
}
// Orden en que el cliente ve las actividades dentro de cada tipo:
// primero las recomendadas, luego el orden elegido y al final por nombre
const tarTemporadas = (srv) => (Array.isArray(srv?.temporadas_visible) ? srv.temporadas_visible : []);
function tarCompararCliente(x, y) {
  const a = x.srv || {}, b = y.srv || {};
  return (!!b.recomendada - !!a.recomendada)
    || ((a.orden ?? 1e9) - (b.orden ?? 1e9))
    || tarNombreCliente(x).localeCompare(tarNombreCliente(y), "es");
}
const tarTextoTemporadas = (lista) => lista.map((r) => `${tarFechaCorta(r.desde)} – ${tarFechaCorta(r.hasta)}`).join(" · ");

// ---------- Datos ----------
async function tarLeerCatalogoExtra() {
  const todas = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await db.from("tar_tarifas")
      .select("id, anio, operador_id, servicio, categoria, fecha_inicio, fecha_fin, aprobada, tc, moneda")
      .order("id").range(desde, desde + 999);
    if (error) { fallo(error, "No se pudieron cargar las temporadas."); break; }
    todas.push(...data);
    if (data.length < 1000) break;
  }
  tar.cobertura = todas.map((t) => ({ ...t, operador_id: Number(t.operador_id) }));
  const tc = await db.from("tipos_cambio").select("*").order("creado_en", { ascending: false }).limit(10);
  tar.tiposCambio = tc.error ? [] : tc.data;
  const m = await db.from("tar_categorias").select("*");
  tar.mapaError = m.error || null;
  tar.mapaCategorias = new Map((m.data || []).map((x) => [x.clave, x]));
}

// Al entrar a Catálogo, Tipos o Ajustes se vuelve a leer lo necesario
document.querySelectorAll(".pestana[data-tar-pestana]").forEach((b) => b.addEventListener("click", async () => {
  if (!tarEsAdmin() || !["catalogo", "tipos", "ajustes"].includes(b.dataset.tarPestana)) return;
  await Promise.all([tarLeerCatalogoExtra(), tarLeerFichas(), cargarCatalogos()]);
  if (tar.pestana === b.dataset.tarPestana && !tar.editando) tarPintar();
}));

const tarClaveItem = (it) => (it.sinTarifario ? `s|${it.srv.id}` : `${it.operador_id}|${tarNorm(it.servicio)}`);
const tarFotos = (srv) => (Array.isArray(srv?.fotos) ? srv.fotos : []);
const tarNombreCliente = (it) => it.srv?.nombre || it.servicio;
const tarTraducidos = (srv) => Object.keys(TAR_IDIOMAS).filter((k) => srv?.traducciones?.[k]?.nombre).length;

// Una fila por cada servicio del tarifario (operador + servicio), más los servicios
// del catálogo que todavía no vienen del tarifario.
function tarItemsCatalogo() {
  const mapa = new Map();
  const clave = (op, s) => `${Number(op)}|${tarNorm(s)}`;
  tar.cobertura.forEach((t) => {
    const k = clave(t.operador_id, t.servicio);
    if (!mapa.has(k)) mapa.set(k, { operador_id: Number(t.operador_id), servicio: t.servicio, tarifas: [] });
    mapa.get(k).tarifas.push(t);
  });
  tar.fichas.forEach((f) => {
    const k = clave(f.operador_id, f.servicio);
    if (!mapa.has(k) && f.servicio_id) mapa.set(k, { operador_id: Number(f.operador_id), servicio: f.servicio, tarifas: [] });
  });
  const items = [...mapa.values()]
    .filter((it) => tarOperador(it.operador_id)?.nombre !== "Operador de ejemplo")
    .map((it) => {
      const ficha = tarFicha(it.operador_id, it.servicio);
      return { ...it, ficha, srv: ficha?.servicio_id ? servicioPorId(ficha.servicio_id) : null };
    });
  const enlazados = new Set(items.map((i) => i.srv?.id).filter(Boolean));
  app.servicios.filter((s) => !enlazados.has(s.id)).forEach((s) =>
    items.push({ operador_id: null, servicio: s.nombre, tarifas: [], ficha: null, srv: s, sinTarifario: true }));

  const hoy = aTexto(new Date());
  const enDias = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return aTexto(d); };
  const limite = enDias(TAR_DIAS_AVISO);
  items.forEach((it) => {
    it.clave = tarClaveItem(it);
    it.tipo_id = it.ficha?.tipo_id ?? it.srv?.tipo_id ?? null;
    it.visible = !!it.srv?.activo;
    const aprobadas = it.tarifas.filter((t) => t.aprobada);
    it.aprobadas = aprobadas.length;
    it.hasta = aprobadas.reduce((m, t) => (t.fecha_fin > m ? t.fecha_fin : m), "");
    it.vigenteHoy = aprobadas.some((t) => t.fecha_inicio <= hoy && hoy <= t.fecha_fin);
    it.porVencer = it.hasta && it.hasta >= hoy && it.hasta <= limite;
    it.vencida = it.hasta && it.hasta < hoy;
    it.grupo = tarNorm(it.ficha?.comparar || it.servicio);
    it.recomendada = !!it.srv?.recomendada;
    it.temporadas = tarTemporadas(it.srv);
    it.temporadaPasada = it.temporadas.length > 0 && it.temporadas.every((r) => r.hasta < hoy);
    it.faltan = tarFaltantesPublicar(it);
    it.sinVigente = it.visible && !it.vigenteHoy;
  });

  // Grupos: misma actividad ("Comparar como" o mismo nombre)
  const grupos = new Map();
  items.filter((i) => !i.sinTarifario).forEach((i) => grupos.set(i.grupo, [...(grupos.get(i.grupo) || []), i]));
  items.forEach((i) => {
    const g = i.sinTarifario ? [i] : grupos.get(i.grupo);
    i.otrosProveedores = g.filter((x) => x !== i && x.operador_id !== i.operador_id);
    i.mismoProveedor = g.filter((x) => x !== i && x.operador_id === i.operador_id);
    i.dupPendiente = i.mismoProveedor.length > 0 && !(i.ficha?.duplicado_ok && i.mismoProveedor.every((x) => x.ficha?.duplicado_ok));
    // Con quién compite por mostrarse al cliente (solo una versión por actividad)
    i.rivales = [...i.otrosProveedores, ...(i.dupPendiente ? i.mismoProveedor : [])];
  });
  items.forEach((i) => (i.alertas = tarAlertasItem(i)));
  return items;
}

function tarAlertasItem(i) {
  const a = [];   // { nivel: "alerta" | "aviso", texto }
  if (i.dupPendiente) {
    a.push({ nivel: "alerta", dup: true, texto: `Posible duplicado del mismo proveedor: ${i.mismoProveedor.map((x) => `"${x.servicio}"`).join(", ")}. ¿Es un error de ingreso?` });
  }
  const visiblesRivales = i.rivales.filter((x) => x.visible);
  if (i.visible && visiblesRivales.length) {
    a.push({ nivel: "alerta", texto: `El cliente vería esta actividad repetida: también se muestra ${visiblesRivales.map((x) => `la de ${tarNombreOp(x.operador_id) || "otro proveedor"}`).join(", ")}. Deja solo una.` });
  }
  if (!i.tipo_id) a.push({ nivel: "aviso", texto: "Sin tipo de actividad." });
  if (i.sinTarifario) {
    a.push({ nivel: i.visible ? "alerta" : "aviso", texto: "No viene del Tarifario: no tiene tarifas, así que el cliente verá \"tarifa pendiente\". Si ya existe en el tarifario con otro nombre, oculta esta versión y usa aquella; si no, crea sus tarifas en Procesar o Importar." });
    return a;
  }
  if (!i.visible) return a;
  const faltanSinTipo = i.faltan.filter((x) => x !== "tipo de actividad" && x !== "tarifa aprobada en el Tarifario");
  if (faltanSinTipo.length) a.push({ nivel: "aviso", texto: `Visible, pero no cumple los requisitos para publicar: le falta ${faltanSinTipo.join(", ")}. Si la ocultas, no se podrá volver a mostrar hasta completarla.` });
  const nota = " El cliente la ve con la nota \"tu agente te ayudará con el precio\".";
  if (!i.aprobadas) a.push({ nivel: "alerta", texto: `Visible sin tarifas aprobadas.${nota}` });
  else if (i.vencida) a.push({ nivel: "alerta", texto: `Visible sin tarifa vigente: su última tarifa terminó el ${tarFechaCorta(i.hasta)}.${nota}` });
  else if (!i.vigenteHoy) a.push({ nivel: "alerta", texto: `Visible sin tarifa vigente hoy (hay un hueco entre temporadas).${nota}` });
  else if (i.porVencer) a.push({ nivel: "aviso", texto: `Su última tarifa termina el ${tarFechaCorta(i.hasta)}: carga la siguiente temporada.` });
  if (i.temporadaPasada) a.push({ nivel: "aviso", texto: `Solo se muestra en ciertas fechas y ya pasaron todas (${tarTextoTemporadas(i.temporadas)}): el cliente no la ve.` });
  return a;
}

// Categorías del tarifario que todavía no tienen equivalencia
function tarCategoriasSinAsignar() {
  const vistas = new Map();
  tar.cobertura.forEach((t) => { const k = tarNorm(t.categoria); if (!vistas.has(k)) vistas.set(k, t.categoria); });
  return [...vistas.keys()].filter((k) => !tar.mapaCategorias.has(k));
}

// =====================================================
// PESTAÑA CATÁLOGO
// =====================================================
function tarHtmlCatalogo() {
  const todos = tarItemsCatalogo();
  const c = tar.catalogo, txt = tarNorm(c.texto);
  const pasa = (i) => ({
    todos: true, alertas: i.alertas.length > 0, visibles: i.visible, ocultos: !i.visible,
    varios: i.otrosProveedores.length > 0, sinvigente: i.sinVigente, recomendadas: i.visible && i.recomendada,
    temporada: i.temporadas.length > 0
  })[c.ver] ?? true;
  const lista = todos.filter((i) =>
    (!c.tipo || (c.tipo === "sin" ? !i.tipo_id : i.tipo_id === Number(c.tipo)))
    && pasa(i)
    && (!txt || tarNorm(`${i.servicio} ${i.srv?.nombre ?? ""} ${tarNombreOp(i.operador_id)} ${i.ficha?.comparar ?? ""}`).includes(txt)));
  tar.catItems = lista;
  // la selección solo guarda servicios que todavía existen y tienen ficha
  const claves = new Set(todos.filter((i) => i.srv).map((i) => i.clave));
  [...tar.catSel].forEach((k) => { if (!claves.has(k)) tar.catSel.delete(k); });

  const visibles = todos.filter((i) => i.visible).length;
  const conAlertas = todos.filter((i) => i.alertas.some((a) => a.nivel === "alerta")).length;
  const dups = todos.filter((i) => i.dupPendiente).length;
  const sinVigente = todos.filter((i) => i.sinVigente).length;
  const recomendadas = todos.filter((i) => i.visible && i.recomendada).length;
  const sinAsignar = tarCategoriasSinAsignar().length;

  // Un bloque por tipo de actividad, en el orden que ve el cliente.
  // Dentro de cada bloque: primero las visibles en el orden del cliente, luego las ocultas.
  const bloques = [...tarTipos().map((tp) => ({ titulo: nombreTipo(tp), oculto: !tp.activo, id: tp.id })), { titulo: "Sin tipo de actividad", id: null }]
    .map((b) => ({ ...b, filas: lista.filter((i) => (b.id ? i.tipo_id === b.id : !tarTipoPorId(i.tipo_id))) }))
    .filter((b) => b.filas.length);
  const porNombre = (x, y) => tarNombreCliente(x).localeCompare(tarNombreCliente(y), "es") || tarNombreOp(x.operador_id).localeCompare(tarNombreOp(y.operador_id), "es");

  const cuerpo = bloques.map((b) => {
    const vis = b.filas.filter((i) => i.visible).sort(tarCompararCliente);
    const ocu = b.filas.filter((i) => !i.visible).sort(porNombre);
    // para las flechas: vecinas visibles del mismo tipo con el mismo estado de "recomendada"
    // (se calcula con todas las visibles del tipo, aunque haya un filtro o búsqueda)
    const visTodas = todos.filter((i) => i.visible && i.srv && (i.tipo_id ?? null) === (vis[0]?.tipo_id ?? null)).sort(tarCompararCliente);
    vis.forEach((i) => {
      const pares = visTodas.filter((x) => x.recomendada === i.recomendada);
      const k = pares.indexOf(i);
      i.puedeSubir = k > 0; i.puedeBajar = k < pares.length - 1;
    });
    return `
    <tr class="fila-grupo"><th colspan="8">${escapar(b.titulo)}
      <span class="nota">${b.filas.length} ${b.filas.length === 1 ? "servicio" : "servicios"}${vis.length ? ` · ${vis.length} visible(s), en el orden que las ve el cliente` : ""}${b.oculto ? " · tipo oculto: el cliente no ve estas actividades" : ""}</span></th></tr>
    ${[...vis, ...ocu].map(tarHtmlFilaCatalogo).join("")}`;
  }).join("");

  const conFicha = lista.filter((i) => i.srv);
  const todasMarcadas = conFicha.length > 0 && conFicha.every((i) => tar.catSel.has(i.clave));
  const n = tar.catSel.size;
  const barra = n ? `
    <div class="tcat-bloque" role="region" aria-label="Acciones en bloque">
      <strong>${n} ${n === 1 ? "seleccionada" : "seleccionadas"}</strong>
      <button type="button" class="btn primario" data-tcat="bloque" data-accion="visible">Hacer visibles</button>
      <button type="button" class="btn" data-tcat="bloque" data-accion="ocultar">Ocultar</button>
      <button type="button" class="btn" data-tcat="bloque" data-accion="recomendar">⭐ Marcar recomendadas</button>
      <button type="button" class="btn" data-tcat="bloque" data-accion="no-recomendar">Quitar recomendada</button>
      <button type="button" class="enlace" data-tcat="bloque-limpiar">Limpiar selección</button>
    </div>` : "";

  return `
    <div class="tar-filtros">
      <label>Tipo de actividad <select data-tcat-filtro="tipo">${tarOpcionesTipos(c.tipo)}</select></label>
      <label>Mostrar
        <select data-tcat-filtro="ver">
          ${[["todos", "Todos los servicios"], ["alertas", "Con alertas o avisos"], ["visibles", "Visibles para clientes"], ["ocultos", "Ocultos"],
             ["sinvigente", "Visibles sin tarifa vigente"], ["recomendadas", "Recomendadas"], ["temporada", "Solo en ciertas fechas"], ["varios", "Con varios proveedores"]]
            .map(([v, t]) => `<option value="${v}" ${c.ver === v ? "selected" : ""}>${t}</option>`).join("")}
        </select>
      </label>
      <label class="tar-buscar">Buscar <input id="tcatBuscar" type="search" value="${escapar(c.texto)}" placeholder="Servicio, proveedor o grupo" data-tcat-filtro="texto"></label>
    </div>
    <p class="tar-resumen">
      <span><strong>${todos.length}</strong> servicios</span>
      <span><strong>${visibles}</strong> visibles para clientes</span>
      <span><strong>${recomendadas}</strong> recomendadas</span>
      <span class="${sinVigente ? "tar-alerta" : ""}"><strong>${sinVigente}</strong> visibles sin tarifa vigente${sinVigente ? ` · <button type="button" class="enlace" data-tcat="ver-sinvigente">Verlas</button>` : ""}</span>
      <span class="${conAlertas ? "tar-alerta" : ""}"><strong>${conAlertas}</strong> con alertas</span>
      <span class="${dups ? "tar-alerta" : ""}"><strong>${dups}</strong> posibles duplicados</span>
      ${sinAsignar ? `<span class="tar-alerta"><strong>${sinAsignar}</strong> categorías sin equivalencia · <button type="button" class="enlace" data-tcat="ir-categorias">Asignarlas en Ajustes</button></span>` : ""}
    </p>
    <div class="tar-ayuda">
      <p>Aquí decides <strong>qué actividades ve el cliente</strong> en el formulario y cómo las ve: nombre, tipo de actividad, descripción, horarios, fotos e idiomas. Marca <strong>Visible</strong> para que aparezca. El cliente nunca ve el proveedor.
        Para publicar una actividad necesita: <strong>${TAR_FOTOS_MIN} fotos, descripción, tipo de actividad y una tarifa aprobada</strong>.</p>
      <p>Marca varias con la casilla de la izquierda para hacerlas visibles, ocultarlas o recomendarlas de una vez. Las <strong>⭐ recomendadas</strong> salen primero en su tipo; usa ▲ ▼ para el orden de las demás.
        Si una visible se queda sin tarifa vigente, el cliente la sigue viendo y al elegirla se le avisa que su agente le ayudará con el precio.</p>
      <p>Cuando la misma actividad la ofrecen <strong>varios proveedores</strong> (mismo nombre o mismo "Comparar como"), solo una puede ser visible: al marcar una, el sistema oculta las demás.
        Si el <strong>mismo proveedor</strong> tiene dos servicios en el mismo grupo, aparece como posible duplicado para que revises si fue un error de ingreso.</p>
    </div>
    ${barra}
    ${lista.length ? `
      <div class="tabla-scroll">
        <table class="tabla tcat-tabla">
          <thead><tr>
            <th class="centro"><input type="checkbox" class="tar-check" data-tcat="sel-todas" ${todasMarcadas ? "checked" : ""} ${conFicha.length ? "" : "disabled"} aria-label="Seleccionar todas las de la lista"></th>
            <th>Servicio</th><th>Proveedor</th><th class="centro">Visible</th><th>Fotos e información</th><th>Tarifas</th><th>Alertas</th><th></th></tr></thead>
          <tbody>${cuerpo}</tbody>
        </table>
      </div>` : `<div class="tar-vacio"><p><strong>No hay servicios que coincidan con los filtros.</strong></p></div>`}`;
}

function tarHtmlFilaCatalogo(it) {
  const i = tar.catItems.indexOf(it);
  const fotos = tarFotos(it.srv);
  const srv = it.srv;
  const nombreTar = !it.sinTarifario && srv && tarNorm(srv.nombre) !== tarNorm(it.servicio) ? `<br><span class="nota">En el tarifario: ${escapar(it.servicio)}</span>` : "";
  const varios = it.otrosProveedores.length ? ` <span class="tcat-varios" title="${escapar(it.otrosProveedores.map((x) => tarNombreOp(x.operador_id)).join(", "))}">Varios proveedores (${it.otrosProveedores.length + 1})</span>` : "";
  const info = srv ? [
    srv.descripcion ? "✓ Descripción" : "✗ Descripción",
    srv.horarios?.length ? "✓ Horarios" : "✗ Horarios",
    `${tarTraducidos(srv)}/4 idiomas`
  ].map((x) => `<span class="${x.startsWith("✗") ? "tcat-falta" : ""}">${x}</span>`).join("<br>") : "";
  const tarifas = it.sinTarifario ? `<span class="nota">—</span>`
    : !it.tarifas.length ? `<span class="nota">Sin tarifas</span>`
    : !it.aprobadas ? `<span class="tar-ojo">${it.tarifas.length} sin aprobar</span>`
    : `Hasta ${tarFechaCorta(it.hasta)}${it.aprobadas < it.tarifas.length ? `<br><span class="nota">${it.tarifas.length - it.aprobadas} sin aprobar</span>` : ""}`;
  const alertas = it.alertas.map((a) => `<li class="tcat-${a.nivel}">${escapar(a.texto)}${a.dup ? ` <button type="button" class="enlace" data-tcat="dup-ok" data-i="${i}">Están bien</button>` : ""}</li>`).join("");

  return `
    <tr class="${it.visible ? "" : "inactivo"} ${it.alertas.some((a) => a.nivel === "alerta") ? "tcat-con-alerta" : ""} ${tar.catSel.has(it.clave) ? "tcat-marcada" : ""}">
      <td class="centro">${srv ? `<input type="checkbox" class="tar-check" data-tcat="sel" data-i="${i}" ${tar.catSel.has(it.clave) ? "checked" : ""} aria-label="Seleccionar ${escapar(tarNombreCliente(it))}">` : ""}</td>
      <td>${it.recomendada ? `<span class="tcat-rec" title="Recomendada: sale primero en su tipo">⭐</span> ` : ""}<strong>${escapar(tarNombreCliente(it))}</strong>${varios}${nombreTar}${it.ficha?.comparar ? `<br><span class="nota">Grupo: ${escapar(it.ficha.comparar)}</span>` : ""}
        ${it.temporadas.length ? `<br><span class="tcat-temporada" title="Fuera de estas fechas el cliente no la ve">📅 Solo ${escapar(tarTextoTemporadas(it.temporadas))}</span>` : ""}</td>
      <td>${it.sinTarifario ? `<span class="nota">Sin tarifario</span>` : escapar(tarNombreOp(it.operador_id))}</td>
      <td class="centro">${srv
        ? `<input type="checkbox" class="tar-check" data-tcat="visible" data-i="${i}" ${it.visible ? "checked" : ""} aria-label="Visible para clientes: ${escapar(tarNombreCliente(it))}"
            ${!it.visible && it.faltan.length ? `title="Para publicar le falta: ${escapar(it.faltan.join(", "))}"` : ""}>
          ${it.visible ? `<span class="tcat-orden">
            <button type="button" class="btn-icono" data-tcat="orden" data-paso="-1" data-i="${i}" ${it.puedeSubir ? "" : "disabled"} aria-label="Subir ${escapar(tarNombreCliente(it))}" title="Subir">▲</button>
            <button type="button" class="btn-icono" data-tcat="orden" data-paso="1" data-i="${i}" ${it.puedeBajar ? "" : "disabled"} aria-label="Bajar ${escapar(tarNombreCliente(it))}" title="Bajar">▼</button>
          </span>` : it.faltan.length ? `<span class="tcat-falta-pub">Falta: ${escapar(it.faltan.join(", "))}</span>` : ""}`
        : `<span class="nota">—</span>`}</td>
      <td>${srv ? `
        <div class="tcat-mini">
          ${fotos[0] ? `<img src="${escapar(fotos[0].url)}" alt="" loading="lazy">` : `<span class="tcat-sin-foto" aria-hidden="true">📷</span>`}
          <span><strong class="${fotos.length < TAR_FOTOS_MIN ? "tcat-falta" : ""}">${fotos.length}/${TAR_FOTOS_MIN} fotos</strong><br><span class="nota">${info}</span></span>
        </div>` : `<span class="nota">Todavía sin ficha para clientes</span>`}</td>
      <td>${tarifas}</td>
      <td>${alertas ? `<ul class="tcat-alertas">${alertas}</ul>` : `<span class="tcmp-bajo">Todo en orden</span>`}</td>
      <td class="acciones-fila">${srv
        ? `<button type="button" class="enlace" data-tcat="editar" data-i="${i}">Editar ficha</button>`
        : `<button type="button" class="enlace" data-tcat="crear" data-i="${i}">Crear ficha</button>`}</td>
    </tr>`;
}

// ---------- Visible / oculto (solo una versión por actividad) ----------
async function tarCambiarVisible(it, visible, el) {
  if (!it?.srv) return;
  let ocultar = [];
  if (visible) {
    const faltan = tarFaltantesPublicar(it);
    if (faltan.length) {
      if (el) el.checked = false;
      avisar(`Para publicar "${tarNombreCliente(it)}" le falta: ${faltan.join(", ")}.`, "error");
      return false;
    }
    ocultar = it.rivales.filter((x) => x.visible && x.srv);
    if (ocultar.length && !confirm(`"${tarNombreCliente(it)}" también la ofrece ${ocultar.map((x) => tarNombreOp(x.operador_id)).join(", ")}, y el cliente solo debe ver una versión.\n\n¿Mostrar la de ${tarNombreOp(it.operador_id) || "este servicio"} y ocultar las demás?`)) {
      if (el) el.checked = false;
      return false;
    }
    if (!tarTipoPorId(it.tipo_id)) avisar("Ojo: no tiene tipo de actividad, el cliente la verá al final en \"Otras actividades\".");
  }
  const { error } = await db.from("servicios").update({ activo: visible }).eq("id", it.srv.id);
  if (error) { if (el) el.checked = !visible; fallo(error); return false; }
  for (const x of ocultar) {
    const r = await db.from("servicios").update({ activo: false }).eq("id", x.srv.id);
    if (r.error) { fallo(r.error, "No se pudieron ocultar las otras versiones."); break; }
  }
  await cargarCatalogos();
  avisar(visible
    ? `"${tarNombreCliente(it)}" ya es visible para los clientes.${ocultar.length ? ` Se ocultaron ${ocultar.length} versión(es) de otros proveedores.` : ""}`
    : `"${tarNombreCliente(it)}" quedó oculto para los clientes.`);
  return true;
}

// ---------- Acciones en bloque ----------
async function tarAccionBloque(accion, btn) {
  const todos = tarItemsCatalogo();
  const marcadas = todos.filter((i) => i.srv && tar.catSel.has(i.clave));
  if (!marcadas.length) return;
  const nombre = (i) => `${tarNombreCliente(i)}${i.operador_id ? ` (${tarNombreOp(i.operador_id)})` : ""}`;
  const lineas = (lista) => lista.slice(0, 12).map((x) => `· ${x}`).join("\n") + (lista.length > 12 ? `\n· … y ${lista.length - 12} más` : "");
  let actualizar = [], cambios = {}, ocultarOtras = [], mensaje = "";

  if (accion === "visible") {
    const candidatas = marcadas.filter((i) => !i.visible);
    const incompletas = candidatas.filter((i) => i.faltan.length);
    let listas = candidatas.filter((i) => !i.faltan.length);
    // dos versiones de la misma actividad marcadas a la vez: el cliente solo debe ver una
    const choques = listas.filter((i) => i.rivales.some((r) => listas.includes(r)));
    listas = listas.filter((i) => !choques.includes(i));
    ocultarOtras = [...new Set(listas.flatMap((i) => i.rivales.filter((r) => r.visible && r.srv)))];
    const partes = [];
    if (listas.length) partes.push(`Se harán visibles ${listas.length}:\n${lineas(listas.map(nombre))}`);
    if (ocultarOtras.length) partes.push(`Se ocultarán ${ocultarOtras.length} versión(es) de otros proveedores:\n${lineas(ocultarOtras.map(nombre))}`);
    if (incompletas.length) partes.push(`No se pueden publicar ${incompletas.length} (no cumplen los requisitos):\n${lineas(incompletas.map((i) => `${nombre(i)}: falta ${i.faltan.join(", ")}`))}`);
    if (choques.length) partes.push(`No se tocan ${choques.length} porque son versiones de la misma actividad (elige solo una):\n${lineas(choques.map(nombre))}`);
    if (candidatas.length < marcadas.length) partes.push(`${marcadas.length - candidatas.length} ya eran visibles.`);
    if (!listas.length) return alert(partes.join("\n\n") || "No hay nada que cambiar.");
    if (!confirm(partes.join("\n\n") + "\n\n¿Continuar?")) return;
    actualizar = listas; cambios = { activo: true };
    mensaje = `${listas.length} actividad(es) ya son visibles para los clientes.${ocultarOtras.length ? ` Se ocultaron ${ocultarOtras.length} versión(es) de otros proveedores.` : ""}`;
  } else if (accion === "ocultar") {
    actualizar = marcadas.filter((i) => i.visible);
    if (!actualizar.length) return avisar("Ninguna de las seleccionadas está visible.");
    const sinVolver = actualizar.filter((i) => i.faltan.length);
    if (!confirm(`¿Ocultar ${actualizar.length} actividad(es) para los clientes?${sinVolver.length ? `\n\nOjo: ${sinVolver.length} no cumplen los requisitos y no se podrán volver a mostrar hasta completarlas.` : ""}`)) return;
    cambios = { activo: false };
    mensaje = `${actualizar.length} actividad(es) quedaron ocultas para los clientes.`;
  } else {
    const valor = accion === "recomendar";
    actualizar = marcadas.filter((i) => i.recomendada !== valor);
    if (!actualizar.length) return avisar(valor ? "Ya están marcadas como recomendadas." : "Ninguna estaba recomendada.");
    cambios = { recomendada: valor };
    const ocultas = actualizar.filter((i) => !i.visible).length;
    mensaje = `${actualizar.length} actividad(es) ${valor ? "marcadas como recomendadas" : "dejaron de ser recomendadas"}.${valor && ocultas ? ` ${ocultas} están ocultas: se verán recomendadas cuando las hagas visibles.` : ""}`;
  }

  await conBoton(btn, async () => {
    const { error } = await db.from("servicios").update(cambios).in("id", actualizar.map((i) => i.srv.id));
    if (error) { await cargarCatalogos(); tarPintar(); return fallo(error, "No se pudo aplicar el cambio."); }
    if (ocultarOtras.length) {
      const r = await db.from("servicios").update({ activo: false }).in("id", ocultarOtras.map((i) => i.srv.id));
      if (r.error) fallo(r.error, "No se pudieron ocultar las otras versiones.");
    }
    tar.catSel.clear();
    await cargarCatalogos();
    tarPintar();
    avisar(mensaje);
  });
}

// ---------- Orden dentro del tipo (▲ ▼) ----------
async function tarMoverOrden(it, paso) {
  // las visibles del mismo tipo, en el orden que las ve el cliente
  const lista = tarItemsCatalogo().filter((x) => x.visible && x.srv && (x.tipo_id ?? null) === (it.tipo_id ?? null)).sort(tarCompararCliente);
  const pares = lista.filter((x) => x.recomendada === it.recomendada);
  const k = pares.findIndex((x) => x.clave === it.clave), j = k + paso;
  if (k < 0 || j < 0 || j >= pares.length) return;
  const a = lista.indexOf(pares[k]), b = lista.indexOf(pares[j]);
  [lista[a], lista[b]] = [lista[b], lista[a]];
  const nuevos = lista.map((x, n) => ({ id: x.srv.id, orden: n + 1 })).filter((x, n) => lista[n].srv.orden !== x.orden);
  for (const c of nuevos) {
    const { error } = await db.from("servicios").update({ orden: c.orden }).eq("id", c.id);
    if (error) { await cargarCatalogos(); tarPintar(); return fallo(error, "No se pudo cambiar el orden."); }
  }
  await cargarCatalogos();
  tarPintar();
  const i = tar.catItems.findIndex((x) => x.clave === it.clave);
  document.querySelector(`[data-tcat="orden"][data-paso="${paso}"][data-i="${i}"]:not(:disabled)`)?.focus();
}

// Crea la ficha para clientes (fila en servicios) de un servicio del tarifario que aún no la tiene
async function tarCrearServicioCliente(it, btn) {
  await conBoton(btn, async () => {
    const op = tarOperador(it.operador_id);
    const incluye = tarItems(it.ficha?.incluye);
    const { data, error } = await db.from("servicios").insert({
      nombre: it.servicio, operador_id: op?.operador_id ?? null, tipo_id: it.ficha?.tipo_id ?? null,
      traducciones: {}, horarios: [], duracion_min: null, transporte: "opcional", activo: false, fotos: [],
      descripcion: incluye.length ? `Incluye: ${incluye.join(", ")}.` : null
    }).select().single();
    if (error) return fallo(error, "No se pudo crear la ficha.");
    if (!(await tarGuardarFicha(it.operador_id, it.servicio, { servicio_id: data.id }))) return;
    await cargarCatalogos();
    tar.editando = { tipo: "ficha", clave: `${it.operador_id}|${tarNorm(it.servicio)}` };
    tar.previa = { fecha: "", resultado: null, cargando: false };
    tarPintar();
    avisar("Ficha creada (oculta). Complétala y márcala como visible cuando esté lista.");
  });
}

// =====================================================
// FICHA PARA CLIENTES (editor)
// =====================================================
function tarItemEditando() {
  return tarItemsCatalogo().find((i) => i.clave === tar.editando?.clave);
}

function tarHtmlFichaCliente() {
  const it = tarItemEditando();
  if (!it?.srv) { tar.editando = null; return `<p class="nota">Ese servicio ya no existe.</p>`; }
  const s = it.srv;
  const tr = s.traducciones || {};
  const tiposOpc = tarTipos().map((tp) =>
    `<option value="${tp.id}" ${tp.id === it.tipo_id ? "selected" : ""}>${escapar(nombreTipo(tp))}${tp.activo ? "" : " (oculto)"}</option>`).join("");
  const transporte = Object.entries(TRANSPORTE_TEXTO)
    .map(([k, v]) => `<option value="${k}" ${k === (s.transporte || "opcional") ? "selected" : ""}>${v}</option>`).join("");
  const filasIdioma = Object.entries(TAR_IDIOMAS).map(([k, v]) => `
    <tr data-idioma="${k}">
      <th scope="row">${v}</th>
      <td><input data-tr="nombre" value="${escapar(tr[k]?.nombre ?? "")}" aria-label="Nombre en ${v.toLowerCase()}"></td>
      <td><textarea data-tr="descripcion" rows="2" aria-label="Descripción en ${v.toLowerCase()}">${escapar(tr[k]?.descripcion ?? "")}</textarea></td>
      ${it.sinTarifario ? "" : `<td><textarea data-tr="incluye" rows="2" aria-label="Qué incluye en ${v.toLowerCase()}">${escapar(tr[k]?.incluye ?? "")}</textarea></td>`}
    </tr>`).join("");
  const rivales = it.rivales.filter((x) => x.srv);
  const op = it.sinTarifario ? null : tarOperador(it.operador_id);

  return `
    <div class="det-seccion sin-margen">
      <div class="sec-cabeza">
        <h3>Ficha para clientes</h3>
        <div class="sec-botones"><button type="button" class="btn" data-tcat="cerrar">Volver al catálogo</button></div>
      </div>
      <p class="nota">${it.sinTarifario
        ? "Este servicio no viene del Tarifario: no tiene tarifas, así que el cliente verá \"tarifa pendiente\"."
        : `Del tarifario: <strong>${escapar(it.servicio)}</strong> · proveedor <strong>${escapar(op?.nombre ?? "")}</strong> (el cliente no ve el proveedor).`}
        ${it.otrosProveedores.length ? `<br><span class="tcat-varios">Varios proveedores</span> También la ofrecen: ${it.otrosProveedores.map((x) => `${escapar(tarNombreOp(x.operador_id))}${x.visible ? " (visible)" : ""}`).join(", ")}.` : ""}</p>

      <div class="fila">
        <label>Nombre que ve el cliente <input id="tcfNombre" value="${escapar(s.nombre ?? "")}" autofocus></label>
        <label>Tipo de actividad <select id="tcfTipo"><option value="">Sin tipo</option>${tiposOpc}</select></label>
      </div>
      <div class="fila">
        <label>Duración en minutos <input id="tcfDuracion" type="number" min="0" value="${s.duracion_min ?? ""}"></label>
        <label>Horarios de salida <input id="tcfHorarios" placeholder="Ej.: 07:30, 13:00" value="${(s.horarios || []).map(hora).join(", ")}"></label>
        <label>Transporte <select id="tcfTransporte">${transporte}</select></label>
      </div>
      <label>Descripción para el cliente
        <textarea id="tcfDescripcion" rows="3" placeholder="Ej.: Recorrido por puentes colgantes entre el bosque nuboso.">${escapar(s.descripcion ?? "")}</textarea>
      </label>
      ${it.sinTarifario ? "" : `
        <label>Qué incluye (separado por comas)
          <textarea id="tcfIncluye" rows="2" placeholder="Transporte, almuerzo, guía bilingüe">${escapar(it.ficha?.incluye ?? "")}</textarea>
        </label>`}
      <details class="traducciones" ${tarTraducidos(s) ? "" : "open"}>
        <summary>Nombre y descripción en otros idiomas <span class="nota">(${tarTraducidos(s)} de 4 idiomas con nombre)</span></summary>
        <p class="nota">El cliente ve la actividad en el idioma que eligió. Si un idioma queda vacío, verá el nombre en español y no verá la descripción ni lo que incluye.</p>
        <div class="tabla-scroll">
          <table class="tabla traduccion">
            <thead><tr><th>Idioma</th><th>Nombre</th><th>Descripción</th>${it.sinTarifario ? "" : "<th>Qué incluye</th>"}</tr></thead>
            <tbody id="tcfTraducciones">${filasIdioma}</tbody>
          </table>
        </div>
      </details>
      <fieldset class="tcat-publicar">
        <legend>Lo que ve el cliente</legend>
        <label class="check-linea"><input id="tcfVisible" type="checkbox" ${s.activo ? "checked" : ""}> Visible para clientes (aparece en el formulario)</label>
        ${it.faltan.length
          ? `<p class="${s.activo ? "aviso suave" : "tar-alerta"}">${s.activo ? "Está visible, pero no cumple los requisitos. Si la ocultas, para volver a mostrarla le falta" : "Para publicarla le falta"}: <strong>${escapar(it.faltan.join(", "))}</strong>. Las fotos se suben abajo y se guardan al instante.</p>`
          : `<p class="nota">Cumple los requisitos para publicar (${TAR_FOTOS_MIN} fotos, descripción, tipo de actividad y tarifa aprobada).</p>`}
        ${rivales.length ? `<p class="nota">Si la marcas visible, se ocultan las otras versiones de esta actividad (${rivales.map((x) => escapar(tarNombreOp(x.operador_id) || x.servicio)).join(", ")}).</p>` : ""}
        <label class="check-linea"><input id="tcfRecomendada" type="checkbox" ${s.recomendada ? "checked" : ""}> ⭐ Recomendada (sale primero en su tipo, con una insignia)</label>
        <label class="check-linea"><input id="tcfConTemporada" type="checkbox" ${tarTemporadas(s).length ? "checked" : ""}> Mostrar solo en ciertas fechas</label>
        <div id="tcfTemporadas" ${tarTemporadas(s).length ? "" : "hidden"}>
          <p class="nota">Fuera de estas fechas el cliente <strong>no ve</strong> la actividad. Se revisa con la fecha de cada día del viaje. Si lo desactivas, se muestra todo el año.</p>
          <ul class="tcat-rangos" id="tcfRangos">${(tarTemporadas(s).length ? tarTemporadas(s) : [{ desde: "", hasta: "" }]).map(tarHtmlRango).join("")}</ul>
          <button type="button" class="btn" data-tcat="rango-agregar">Agregar otro rango de fechas</button>
        </div>
      </fieldset>
      <div class="sec-botones">
        <button type="button" class="btn primario" data-tcat="guardar-ficha">Guardar ficha</button>
        <button type="button" class="btn" data-tcat="cerrar">Cancelar</button>
      </div>
    </div>

    <div class="det-seccion sin-margen" id="tcfFotos">${tarHtmlFotos(s)}</div>
    <div class="det-seccion sin-margen" id="tcfPrecios">${tarHtmlPrevia(s)}</div>`;
}

function tarHtmlRango(r) {
  return `
    <li class="tcat-rango">
      <label>Desde <input type="date" data-rango="desde" value="${escapar(r.desde || "")}"></label>
      <label>Hasta <input type="date" data-rango="hasta" value="${escapar(r.hasta || "")}"></label>
      <button type="button" class="enlace peligro" data-tcat="rango-quitar">Quitar</button>
    </li>`;
}

// Rangos de fechas en que se muestra al cliente; null si hay un error (ya avisado)
function tarLeerTemporadasFicha() {
  if (!$("tcfConTemporada").checked) return [];
  const rangos = [];
  for (const li of document.querySelectorAll("#tcfRangos .tcat-rango")) {
    const desde = li.querySelector('[data-rango="desde"]').value, hasta = li.querySelector('[data-rango="hasta"]').value;
    if (!desde && !hasta) continue;
    if (!desde || !hasta) { avisar("Cada rango de fechas necesita \"Desde\" y \"Hasta\".", "error"); return null; }
    if (hasta < desde) { avisar(`El rango ${tarFechaCorta(desde)} – ${tarFechaCorta(hasta)} termina antes de empezar.`, "error"); return null; }
    rangos.push({ desde, hasta });
  }
  if (!rangos.length) { avisar("Escribe al menos un rango de fechas, o desmarca \"Mostrar solo en ciertas fechas\".", "error"); return null; }
  return rangos.sort((a, b) => a.desde.localeCompare(b.desde));
}

function tarLeerTraduccionesFicha() {
  const tr = {};
  document.querySelectorAll("#tcfTraducciones tr").forEach((fila) => {
    const nombre = fila.querySelector('[data-tr="nombre"]').value.trim();
    const descripcion = fila.querySelector('[data-tr="descripcion"]').value.trim();
    const incluye = fila.querySelector('[data-tr="incluye"]')?.value.trim() || "";
    if (nombre || descripcion || incluye) tr[fila.dataset.idioma] = { ...(nombre && { nombre }), ...(descripcion && { descripcion }), ...(incluye && { incluye }) };
  });
  return tr;
}

async function tarGuardarFichaCliente(btn) {
  const it = tarItemEditando();
  if (!it?.srv) return;
  const nombre = $("tcfNombre").value.trim();
  if (!nombre) return avisar("Escribe el nombre que ve el cliente.", "error");
  const horarios = [];
  for (const parte of $("tcfHorarios").value.split(",").map((x) => x.trim()).filter(Boolean)) {
    const m = parte.match(/^(\d{1,2}):(\d{2})$/);
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return avisar(`El horario "${parte}" no es válido. Usa el formato 07:30, separado por comas.`, "error");
    horarios.push(`${m[1].padStart(2, "0")}:${m[2]}`);
  }
  const tipo_id = $("tcfTipo").value ? Number($("tcfTipo").value) : null;
  const visible = $("tcfVisible").checked;
  const temporadas_visible = tarLeerTemporadasFicha();
  if (!temporadas_visible) return;
  const fila = {
    recomendada: $("tcfRecomendada").checked, temporadas_visible,
    nombre, tipo_id, horarios,
    duracion_min: parseInt($("tcfDuracion").value, 10) || null,
    transporte: $("tcfTransporte").value,
    descripcion: $("tcfDescripcion").value.trim() || null,
    traducciones: tarLeerTraduccionesFicha()
  };

  await conBoton(btn, async () => {
    const { error } = await db.from("servicios").update(fila).eq("id", it.srv.id);
    if (error) return fallo(error);
    if (!it.sinTarifario) {
      const cambios = { tipo_id, incluye: $("tcfIncluye").value.trim() || null };
      if ((it.ficha?.tipo_id ?? null) !== cambios.tipo_id || (it.ficha?.incluye ?? null) !== cambios.incluye) {
        if (!(await tarGuardarFicha(it.operador_id, it.servicio, cambios))) return;
      }
    }
    await cargarCatalogos();
    if (visible !== it.visible) {
      const item = tarItemEditando();
      if (!(await tarCambiarVisible(item, visible, $("tcfVisible")))) {
        // los demás datos sí quedaron guardados; la ficha sigue abierta para completarla
        tarPintar();
        return;
      }
    } else avisar("Ficha guardada.");
    tar.editando = null;
    tarPintar();
  });
}

// ---------- Fotos ----------
function tarHtmlFotos(s) {
  const fotos = tarFotos(s);
  return `
    <div class="sec-cabeza">
      <h3>Fotos <span class="nota">(${fotos.length} de mínimo ${TAR_FOTOS_MIN})</span></h3>
      ${fotos.length < TAR_FOTOS_MAX ? `<label class="btn tcat-subir">Subir fotos
        <input id="tcfArchivoFotos" type="file" accept="image/jpeg,image/png,image/webp" multiple hidden></label>` : ""}
    </div>
    <p class="nota">Al subirlas, todas quedan del mismo tamaño: horizontales (4:3) de ${TAR_FOTO_ANCHO} × ${TAR_FOTO_ALTO}. Si la foto no es horizontal, se recorta desde el centro.
      La primera es la principal. Usa fotos en JPG o PNG (las fotos HEIC del iPhone se pueden exportar como JPG).</p>
    <p id="tcfFotosEstado" class="nota" hidden></p>
    ${fotos.length ? `<ul class="tcat-fotos">${fotos.map((f, i) => `
      <li class="tcat-foto">
        <img src="${escapar(f.url)}" alt="Foto ${i + 1} de ${escapar(s.nombre)}" loading="lazy">
        ${i === 0 ? `<span class="tcat-principal">Principal</span>` : ""}
        <div class="tcat-foto-acciones">
          <button type="button" class="btn-icono" data-tcat="foto-mover" data-n="${i}" data-paso="-1" ${i === 0 ? "disabled" : ""} aria-label="Mover a la izquierda" title="Mover a la izquierda">◀</button>
          <button type="button" class="btn-icono" data-tcat="foto-mover" data-n="${i}" data-paso="1" ${i === fotos.length - 1 ? "disabled" : ""} aria-label="Mover a la derecha" title="Mover a la derecha">▶</button>
          <button type="button" class="enlace peligro" data-tcat="foto-borrar" data-n="${i}">Quitar</button>
        </div>
      </li>`).join("")}</ul>` : `<div class="tar-vacio"><p>Todavía no tiene fotos.</p></div>`}`;
}

// Recorta al centro en 4:3 y deja la foto en 1200 × 900 (JPG)
async function tarPrepararFoto(archivo) {
  const url = URL.createObjectURL(archivo);
  try {
    const img = await new Promise((ok, mal) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => mal(new Error(`"${archivo.name}" no se pudo abrir. Usa una foto JPG o PNG.`));
      i.src = url;
    });
    const r = TAR_FOTO_ANCHO / TAR_FOTO_ALTO;
    let sw = img.naturalWidth, sh = img.naturalHeight, sx = 0, sy = 0;
    if (sw / sh > r) { const w = sh * r; sx = (sw - w) / 2; sw = w; } else { const h = sw / r; sy = (sh - h) / 2; sh = h; }
    const lienzo = document.createElement("canvas");
    lienzo.width = TAR_FOTO_ANCHO; lienzo.height = TAR_FOTO_ALTO;
    const ctx = lienzo.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, TAR_FOTO_ANCHO, TAR_FOTO_ALTO);
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, TAR_FOTO_ANCHO, TAR_FOTO_ALTO);
    return await new Promise((ok, mal) => lienzo.toBlob((b) => (b ? ok(b) : mal(new Error("No se pudo preparar la foto."))), "image/jpeg", 0.82));
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function tarGuardarFotos(srv, fotos) {
  const { error } = await db.from("servicios").update({ fotos }).eq("id", srv.id);
  if (error) { fallo(error, "No se pudieron guardar las fotos."); return false; }
  srv.fotos = fotos;
  return true;
}

function tarRepintarFotos(srv) {
  if ($("tcfFotos")) $("tcfFotos").innerHTML = tarHtmlFotos(srv);
}

async function tarSubirFotos(archivos) {
  const it = tarItemEditando();
  if (!it?.srv) return;
  const srv = it.srv;
  const libres = TAR_FOTOS_MAX - tarFotos(srv).length;
  const lista = [...archivos].slice(0, libres);
  if (archivos.length > libres) avisar(`Solo se pueden tener ${TAR_FOTOS_MAX} fotos por servicio: se subirán ${lista.length}.`);
  const estado = $("tcfFotosEstado");
  let subidas = 0;
  for (const [n, archivo] of lista.entries()) {
    if (estado) { estado.hidden = false; estado.textContent = `Preparando y subiendo foto ${n + 1} de ${lista.length}…`; }
    try {
      const blob = await tarPrepararFoto(archivo);
      const path = `servicio-${srv.id}/${Date.now()}-${n}.jpg`;
      const subida = await db.storage.from(TAR_BUCKET).upload(path, blob, { contentType: "image/jpeg", cacheControl: "31536000", upsert: false });
      if (subida.error) throw subida.error;
      const url = db.storage.from(TAR_BUCKET).getPublicUrl(path).data.publicUrl;
      if (!(await tarGuardarFotos(srv, [...tarFotos(srv), { path, url }]))) break;
      subidas++;
      tarRepintarFotos(srv);
    } catch (e) {
      fallo(e, "No se pudo subir la foto.");
      break;
    }
  }
  if (subidas) avisar(`${subidas} foto(s) subida(s).`);
  tarRepintarFotos(srv);
}

async function tarMoverFoto(n, paso) {
  const srv = tarItemEditando()?.srv;
  const fotos = [...tarFotos(srv)];
  const j = n + paso;
  if (!srv || j < 0 || j >= fotos.length) return;
  [fotos[n], fotos[j]] = [fotos[j], fotos[n]];
  if (await tarGuardarFotos(srv, fotos)) tarRepintarFotos(srv);
}

async function tarBorrarFoto(n) {
  const srv = tarItemEditando()?.srv;
  const foto = tarFotos(srv)[n];
  if (!foto || !confirm("¿Quitar esta foto?")) return;
  if (!(await tarGuardarFotos(srv, tarFotos(srv).filter((_, i) => i !== n)))) return;
  if (foto.path) await db.storage.from(TAR_BUCKET).remove([foto.path]);   // si falla, solo queda el archivo sin usar
  tarRepintarFotos(srv);
  avisar("Foto quitada.");
}

// ---------- Vista previa del precio que ve el cliente ----------
function tarHtmlPrevia(s) {
  const p = tar.previa;
  const r = p.resultado;
  let res = "";
  if (p.cargando) res = `<p class="nota">Consultando…</p>`;
  else if (r?.error) res = `<p class="aviso">${escapar(r.error)}</p>`;
  else if (r?.lista && !r.lista.length) res = `<p class="aviso suave">El cliente verá: <strong>Tarifa pendiente de ingreso, un agente la verificará.</strong> No hay una tarifa aprobada cuya temporada cubra esa fecha (o sus categorías no tienen equivalencia en Ajustes).</p>`;
  else if (r?.lista) res = `<ul class="tcat-precios">${r.lista.map((x) => `
      <li><span>${escapar(x.categoria)}${x.por_grupo ? ` <span class="nota">(por grupo)</span>` : ""}</span>
        <strong>${dinero(x.precio)}${x.colones ? ` <span title="Tarifa en colones (${tarDinero(x.precio_colones, "CRC")}), se muestra en dólares" aria-label="Tarifa en colones">ⓘ</span>` : ""}</strong></li>`).join("")}</ul>
      ${r.lista.some((x) => x.colones) ? `<p class="nota">ⓘ = tarifa en colones convertida a dólares con el tipo de cambio de Ajustes.</p>` : ""}`;
  return `
    <h3>Precio que ve el cliente</h3>
    <p class="nota">Precio TC de las tarifas aprobadas, según la fecha de la actividad. El cliente nunca ve el neto ni el Cash.</p>
    <div class="fila-form">
      <label class="tar-filtro-corto">Fecha <input id="tcfFechaPrevia" type="date" value="${p.fecha}"></label>
      <button type="button" class="btn" data-tcat="previa">Ver precio</button>
    </div>
    ${res}`;
}

async function tarConsultarPrevia() {
  const it = tarItemEditando();
  if (!it?.srv) return;
  const fecha = $("tcfFechaPrevia").value;
  if (!fecha) return avisar("Elige una fecha.", "error");
  tar.previa = { fecha, resultado: null, cargando: true };
  $("tcfPrecios").innerHTML = tarHtmlPrevia(it.srv);
  const { data, error } = await db.rpc("precios_cliente", { p_servicio: it.srv.id, p_fecha: fecha });
  tar.previa = { fecha, cargando: false, resultado: error ? { error: `No se pudo consultar: ${error.message}` } : { lista: data || [] } };
  if ($("tcfPrecios")) $("tcfPrecios").innerHTML = tarHtmlPrevia(it.srv);
}

// =====================================================
// PESTAÑA TIPOS DE ACTIVIDAD (antes en Servicios)
// =====================================================
function tarHtmlTipos() {
  const tarjetas = tarTipos().map((tp, i) => {
    const lista = app.servicios.filter((s) => s.tipo_id === tp.id);
    const visibles = lista.filter((s) => s.activo).length;
    const traducciones = Object.entries(TAR_IDIOMAS)
      .map(([k, v]) => (tp.traducciones?.[k] ? `${v}: ${escapar(tp.traducciones[k])}` : null)).filter(Boolean).join(" · ");
    return `
      <li class="tipo-tarjeta${tp.activo ? "" : " inactivo"}">
        <div class="tipo-cabeza">
          <span class="tipo-icono" aria-hidden="true">${escapar(tp.icono || "•")}</span>
          <div class="tipo-textos">
            <p class="tipo-nombre">${escapar(tp.nombre)} ${tp.activo ? "" : `<span class="chip-gris">Oculto para clientes</span>`}</p>
            <p class="nota">${traducciones || "Sin traducciones"} · ${lista.length} servicios, ${visibles} visibles</p>
          </div>
          <div class="tipo-acciones">
            <button type="button" class="btn-icono" data-ttipo="subir" data-id="${tp.id}" ${i === 0 ? "disabled" : ""} aria-label="Subir ${escapar(tp.nombre)}" title="Subir">▲</button>
            <button type="button" class="btn-icono" data-ttipo="bajar" data-id="${tp.id}" ${i === tarTipos().length - 1 ? "disabled" : ""} aria-label="Bajar ${escapar(tp.nombre)}" title="Bajar">▼</button>
            <button type="button" class="enlace" data-ttipo="editar" data-id="${tp.id}">Editar</button>
          </div>
        </div>
      </li>`;
  }).join("");

  return `
    <div class="det-seccion sin-margen">
      <div class="sec-cabeza">
        <h3>Tipos de actividad</h3>
        <button type="button" class="btn primario" data-ttipo="nuevo">Nuevo tipo</button>
      </div>
      <p class="nota">Así se agrupan las actividades en el formulario del cliente, en este mismo orden. Usa ▲ ▼ para cambiar el orden.
        Para poner un servicio dentro de un tipo, edita su ficha en Catálogo (o usa Comparar › Clasificar servicios).</p>
      ${tarTipos().length ? `<ul class="tipos-lista">${tarjetas}</ul>` : `<p class="nota">Todavía no hay tipos de actividad.</p>`}
    </div>`;
}

function tarHtmlFormTipo() {
  const tp = tar.editando.datos;
  const idiomas = Object.entries(TAR_IDIOMAS).map(([k, v]) =>
    `<label>${v} <input data-tr-tipo="${k}" value="${escapar(tp.traducciones?.[k] ?? "")}"></label>`).join("");
  const cuantos = tp.id ? app.servicios.filter((s) => s.tipo_id === tp.id).length : 0;
  return `
    <div class="det-seccion sin-margen">
      <h3>${tp.id ? "Editar tipo de actividad" : "Nuevo tipo de actividad"}</h3>
      <div class="fila">
        <label>Nombre (en español) <input id="ftNombre" value="${escapar(tp.nombre ?? "")}" autofocus></label>
        <label>Ícono (un emoji, opcional) <input id="ftIcono" value="${escapar(tp.icono ?? "")}" maxlength="8" placeholder="Ej.: 🌋"></label>
      </div>
      <h4>Nombre en otros idiomas</h4>
      <div class="fila">${idiomas}</div>
      <label class="check-linea"><input id="ftActivo" type="checkbox" ${tp.activo !== false ? "checked" : ""}> Visible para clientes (si lo ocultas, sus actividades tampoco aparecen en el formulario)</label>
      <div class="sec-botones">
        <button type="button" class="btn primario" data-ttipo="guardar">Guardar tipo</button>
        <button type="button" class="btn" data-ttipo="cancelar">Cancelar</button>
        ${tp.id ? `<button type="button" class="enlace peligro" data-ttipo="eliminar" data-id="${tp.id}" data-cuantos="${cuantos}">Eliminar tipo</button>` : ""}
      </div>
    </div>`;
}

async function tarGuardarTipo(btn) {
  const tp = tar.editando.datos;
  const traducciones = {};
  document.querySelectorAll("[data-tr-tipo]").forEach((el) => { if (el.value.trim()) traducciones[el.dataset.trTipo] = el.value.trim(); });
  const fila = { nombre: $("ftNombre").value.trim(), icono: $("ftIcono").value.trim() || null, traducciones, activo: $("ftActivo").checked };
  if (!fila.nombre) return avisar("Escribe el nombre del tipo de actividad.", "error");
  if (!tp.id) fila.orden = Math.max(0, ...tarTipos().map((x) => x.orden)) + 1;
  await conBoton(btn, async () => {
    const r = tp.id ? await db.from("tipos_servicio").update(fila).eq("id", tp.id) : await db.from("tipos_servicio").insert(fila);
    if (r.error) return fallo(r.error, r.error.code === "23505" ? "Ya existe un tipo con ese nombre." : "No se pudo guardar.");
    await cargarCatalogos();
    tar.editando = null;
    tarPintar();
    avisar("Tipo de actividad guardado.");
  });
}

async function tarMoverTipo(id, paso) {
  const lista = [...tarTipos()];
  const i = lista.findIndex((x) => x.id === id), j = i + paso;
  if (i < 0 || j < 0 || j >= lista.length) return;
  [lista[i], lista[j]] = [lista[j], lista[i]];
  const cambios = lista.map((x, k) => ({ id: x.id, orden: k + 1 })).filter((x) => tarTipoPorId(x.id).orden !== x.orden);
  for (const c of cambios) {
    const { error } = await db.from("tipos_servicio").update({ orden: c.orden }).eq("id", c.id);
    if (error) { await cargarCatalogos(); tarPintar(); return fallo(error, "No se pudo cambiar el orden."); }
  }
  await cargarCatalogos();
  tarPintar();
  document.querySelector(`[data-ttipo="${paso < 0 ? "subir" : "bajar"}"][data-id="${id}"]:not(:disabled)`)?.focus();
}

async function tarEliminarTipo(id, cuantos) {
  const tp = tarTipoPorId(id);
  const texto = cuantos
    ? `¿Eliminar el tipo "${tp?.nombre}"? Sus ${cuantos} servicios no se borran: quedan "sin tipo" y el cliente los verá en "Otras actividades".`
    : `¿Eliminar el tipo "${tp?.nombre}"?`;
  if (!confirm(texto)) return;
  const { error } = await db.from("tipos_servicio").delete().eq("id", id);
  if (error) return fallo(error, "No se pudo eliminar.");
  await Promise.all([cargarCatalogos(), tarLeerFichas()]);
  tar.editando = null;
  tarPintar();
  avisar("Tipo de actividad eliminado.");
}

// =====================================================
// AJUSTES › TIPO DE CAMBIO AUTOMÁTICO (BAC; si falla, Banco Central)
// =====================================================
function tarHtmlTipoCambio() {
  const lista = tar.tiposCambio || [];
  const ultimo = lista.find((x) => x.ok);
  const falla = lista[0] && !lista[0].ok ? lista[0] : null;
  const cuando = (x) => new Date(x.creado_en).toLocaleString("es-CR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const usaVenta = Number(tar.ajustes.tipo_cambio_usa_venta) === 1;
  return `
    <div class="tcat-tc">
      ${ultimo ? `<p><strong>Último tipo de cambio:</strong> compra ₡${ultimo.compra} · venta ₡${ultimo.venta}
        <span class="nota">(${escapar(ultimo.fuente)}, ${cuando(ultimo)}). Se usa el de ${usaVenta ? "venta" : "compra"}.</span></p>`
        : `<p class="nota">Todavía no se ha consultado el tipo de cambio automático.</p>`}
      ${falla ? `<p class="tar-alerta">La última consulta (${cuando(falla)}) no funcionó: ${escapar(falla.detalle || "sin respuesta")}. Se mantiene el valor anterior.</p>` : ""}
      <p class="nota">Se actualiza solo todos los días a las 7:00 a. m. desde BAC Credomatic Costa Rica; si BAC no responde, se toma del Banco Central de Costa Rica.</p>
      <button type="button" class="btn" data-tcat="actualizar-tc">Actualizar ahora</button>
    </div>`;
}

async function tarActualizarTipoCambio(btn) {
  await conBoton(btn, async () => {
    const { data, error } = await db.functions.invoke("tipo-cambio", { body: {} });
    if (error || !data?.ok) return fallo(error || { message: data?.detalle || "" }, "No se pudo consultar el tipo de cambio.");
    const aj = await db.from("tar_ajustes").select("*");
    if (!aj.error) aj.data.forEach((a) => (tar.ajustes[a.clave] = Number(a.valor)));
    await tarLeerCatalogoExtra();
    tarPintar();
    avisar(`Tipo de cambio actualizado: ₡${tar.ajustes.tipo_cambio} (${data.fuente}).`);
  });
}

// =====================================================
// AJUSTES › CATEGORÍAS DEL TARIFARIO Y TIPOS DE CLIENTE
// =====================================================
const TAR_SUGERENCIAS_CAT = {
  adulto: "adulto", adult: "adulto", adults: "adulto", "adulto extranjero": "adulto",
  nino: "nino", child: "nino", children: "nino", "nino extranjero": "nino",
  "adulto mayor": "senior", senior: "senior", seniors: "senior", "ciudadano de oro": "senior",
  estudiante: "estudiante", student: "estudiante", infante: "menor de 6 anos"
};
const tarSugerenciaCat = (clave) => {
  const destino = TAR_SUGERENCIAS_CAT[clave];
  return destino ? app.categorias.find((k) => tarNorm(k.nombre) === destino) : null;
};

function tarHtmlCategorias() {
  if (tar.mapaError) return `<div class="det-seccion sin-margen"><h3>Categorías del tarifario</h3><p class="aviso">Falta preparar la base de datos para esta sección (etapa 1).</p></div>`;
  const porClave = new Map();
  tar.cobertura.forEach((t) => {
    const k = tarNorm(t.categoria);
    const x = porClave.get(k) || { clave: k, nombre: t.categoria, tarifas: 0, aprobadas: 0 };
    x.tarifas++; if (t.aprobada) x.aprobadas++;
    porClave.set(k, x);
  });
  const lista = [...porClave.values()].sort((a, b) =>
    (tar.mapaCategorias.has(a.clave) - tar.mapaCategorias.has(b.clave)) || a.nombre.localeCompare(b.nombre, "es"));
  const sinAsignar = lista.filter((x) => !tar.mapaCategorias.has(x.clave));
  const conSugerencia = sinAsignar.filter((x) => tarSugerenciaCat(x.clave)).length;
  const opciones = (x) => {
    const m = tar.mapaCategorias.get(x.clave);
    const valor = !m ? "" : m.categoria_id ? String(m.categoria_id) : "oculta";
    return `<option value="" ${valor === "" ? "selected" : ""}>— Sin asignar —</option>`
      + app.categorias.map((k) => `<option value="${k.id}" ${valor === String(k.id) ? "selected" : ""}>${escapar(k.nombre)}${k.por_grupo ? " (por grupo)" : ""}</option>`).join("")
      + `<option value="oculta" ${valor === "oculta" ? "selected" : ""}>No se muestra al cliente</option>`;
  };

  const filasTipos = app.categorias.map((k) => `
    <tr data-cat-cliente="${k.id}">
      <td><input data-kc="nombre" value="${escapar(k.nombre)}" aria-label="Nombre"></td>
      ${Object.keys(TAR_IDIOMAS).map((l) => `<td><input data-kc="${l}" value="${escapar(k.traducciones?.[l] ?? "")}" aria-label="${TAR_IDIOMAS[l]}"></td>`).join("")}
      <td class="centro"><input type="checkbox" class="tar-check" data-kc="por_grupo" ${k.por_grupo ? "checked" : ""} aria-label="Precio por grupo"></td>
    </tr>`).join("");

  return `
    <div class="det-seccion sin-margen" id="tarCategorias">
      <div class="sec-cabeza">
        <h3>Categorías del tarifario → tipos de cliente</h3>
        ${conSugerencia ? `<button type="button" class="btn" data-tcat="aplicar-sug-cat">Asignar ${conSugerencia} sugerida(s)</button>` : ""}
      </div>
      <p class="nota">Cada operador llama distinto a sus categorías ("Adulto", "adult", "Adulto extranjero"…). Indica a qué tipo de cliente corresponde cada una:
        así el cliente ve el precio correcto y el agente lo usa al cotizar. Las que no se muestran al cliente (por ejemplo, tarifas para nacionales) siguen en el tarifario.
        ${sinAsignar.length ? `<strong class="tar-alerta">${sinAsignar.length} sin asignar:</strong> mientras tanto esos precios no se muestran al cliente.` : ""}</p>
      <div class="tabla-scroll">
        <table class="tabla">
          <thead><tr><th>Categoría en el tarifario</th><th class="num">Tarifas</th><th>Tipo de cliente</th></tr></thead>
          <tbody>${lista.map((x) => `
            <tr class="${tar.mapaCategorias.has(x.clave) ? "" : "tcat-con-alerta"}">
              <td>${escapar(x.nombre)}${!tar.mapaCategorias.has(x.clave) && tarSugerenciaCat(x.clave) ? `<br><span class="nota">Sugerido: ${escapar(tarSugerenciaCat(x.clave).nombre)}</span>` : ""}</td>
              <td class="num">${x.tarifas}${x.aprobadas < x.tarifas ? ` <span class="nota">(${x.aprobadas} aprobadas)</span>` : ""}</td>
              <td><select data-tcat-cat="${escapar(x.clave)}" data-nombre="${escapar(x.nombre)}" aria-label="Tipo de cliente para ${escapar(x.nombre)}">${opciones(x)}</select></td>
            </tr>`).join("")}</tbody>
        </table>
      </div>
    </div>

    <div class="det-seccion sin-margen">
      <h3>Tipos de cliente</h3>
      <p class="nota">Son las categorías que ve el cliente y que usa el agente al cotizar. Escribe su nombre en otros idiomas (se guarda solo al salir de cada casilla).
        Marca <strong>Por grupo</strong> cuando el precio es por vehículo, habitación o grupo (no por persona); por ejemplo "Vehículo 1-6 pax".</p>
      <div class="tabla-scroll">
        <table class="tabla traduccion">
          <thead><tr><th>Nombre</th>${Object.values(TAR_IDIOMAS).map((v) => `<th>${v}</th>`).join("")}<th class="centro">Por grupo</th></tr></thead>
          <tbody>${filasTipos}</tbody>
        </table>
      </div>
      <div class="fila-form">
        <label>Nuevo tipo de cliente <input id="tcatNuevoTipo" placeholder="Ej.: Vehículo 1-6 pax"></label>
        <label class="check-linea tar-check-form"><input id="tcatNuevoGrupo" type="checkbox"> Precio por grupo</label>
        <button type="button" class="btn" data-tcat="nuevo-tipo-cliente">Agregar</button>
      </div>
    </div>`;
}

async function tarGuardarEquivalencia(sel) {
  const clave = sel.dataset.tcatCat, nombre = sel.dataset.nombre, v = sel.value;
  const r = v === ""
    ? await db.from("tar_categorias").delete().eq("clave", clave)
    : await db.from("tar_categorias").upsert({ clave, nombre, categoria_id: v === "oculta" ? null : Number(v), actualizado: new Date().toISOString() });
  if (r.error) { fallo(r.error); return tarPintar(); }
  if (v === "") tar.mapaCategorias.delete(clave);
  else tar.mapaCategorias.set(clave, { clave, nombre, categoria_id: v === "oculta" ? null : Number(v) });
  sel.closest("tr")?.classList.toggle("tcat-con-alerta", v === "");
  avisar("Guardado.");
}

async function tarAplicarSugerenciasCat(btn) {
  const filas = [];
  const vistas = new Map();
  tar.cobertura.forEach((t) => { const k = tarNorm(t.categoria); if (!vistas.has(k)) vistas.set(k, t.categoria); });
  vistas.forEach((nombre, clave) => {
    const k = !tar.mapaCategorias.has(clave) && tarSugerenciaCat(clave);
    if (k) filas.push({ clave, nombre, categoria_id: k.id });
  });
  if (!filas.length) return;
  await conBoton(btn, async () => {
    const { error } = await db.from("tar_categorias").upsert(filas);
    if (error) return fallo(error);
    filas.forEach((f) => tar.mapaCategorias.set(f.clave, f));
    tarPintar();
    avisar(`${filas.length} categoría(s) asignadas.`);
  });
}

// Se guarda la fila completa al salir de cualquiera de sus casillas
async function tarGuardarTipoCliente(el) {
  const tr = el.closest("tr");
  const id = Number(tr.dataset.catCliente);
  const k = app.categorias.find((x) => x.id === id);
  const nombre = tr.querySelector('[data-kc="nombre"]').value.trim();
  if (!nombre) { tr.querySelector('[data-kc="nombre"]').value = k?.nombre ?? ""; return avisar("El nombre del tipo de cliente no puede quedar vacío.", "error"); }
  const traducciones = {};
  Object.keys(TAR_IDIOMAS).forEach((l) => { const v = tr.querySelector(`[data-kc="${l}"]`).value.trim(); if (v) traducciones[l] = v; });
  const fila = { nombre, traducciones, por_grupo: tr.querySelector('[data-kc="por_grupo"]').checked };
  const { error } = await db.from("categorias_cliente").update(fila).eq("id", id);
  if (error) { fallo(error, error.code === "23505" ? "Ya existe un tipo de cliente con ese nombre." : "No se pudo guardar."); return tarPintar(); }
  if (k) Object.assign(k, fila);
  avisar("Tipo de cliente guardado.");
}

async function tarNuevoTipoCliente(btn) {
  const nombre = $("tcatNuevoTipo").value.trim();
  if (!nombre) return avisar("Escribe el nombre del tipo de cliente.", "error");
  await conBoton(btn, async () => {
    const orden = Math.max(0, ...app.categorias.map((k) => k.orden)) + 1;
    const { error } = await db.from("categorias_cliente").insert({ nombre, orden, por_grupo: $("tcatNuevoGrupo").checked });
    if (error) return fallo(error, error.code === "23505" ? "Ya existe un tipo de cliente con ese nombre." : "No se pudo agregar.");
    await cargarCatalogos();
    tarPintar();
    avisar("Tipo de cliente agregado.");
  });
}

// =====================================================
// EVENTOS
// =====================================================
$("tarContenido").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-tcat], [data-ttipo]");
  if (!b || !tarEsAdmin()) return;
  const it = () => tar.catItems[Number(b.dataset.i)];

  if (b.dataset.ttipo) {
    const id = Number(b.dataset.id);
    switch (b.dataset.ttipo) {
      case "nuevo": tar.editando = { tipo: "tipo", datos: { activo: true, traducciones: {} } }; return tarPintar();
      case "editar": tar.editando = { tipo: "tipo", datos: { ...tarTipoPorId(id) } }; return tarPintar();
      case "cancelar": tar.editando = null; return tarPintar();
      case "guardar": return tarGuardarTipo(b);
      case "subir": case "bajar": return conBoton(b, () => tarMoverTipo(id, b.dataset.ttipo === "subir" ? -1 : 1));
      case "eliminar": return tarEliminarTipo(id, Number(b.dataset.cuantos));
    }
    return;
  }

  switch (b.dataset.tcat) {
    case "editar":
      tar.editando = { tipo: "ficha", clave: it().clave };
      tar.previa = { fecha: "", resultado: null, cargando: false };
      tarPintar();
      return window.scrollTo({ top: $("vistaTarifario").offsetTop });
    case "crear": return tarCrearServicioCliente(it(), b);
    case "cerrar": tar.editando = null; return tarPintar();
    case "guardar-ficha": return tarGuardarFichaCliente(b);
    case "foto-mover": return conBoton(b, () => tarMoverFoto(Number(b.dataset.n), Number(b.dataset.paso)));
    case "foto-borrar": return tarBorrarFoto(Number(b.dataset.n));
    case "previa": return conBoton(b, tarConsultarPrevia);
    case "dup-ok": {
      const x = it();
      const fichas = [x, ...x.mismoProveedor];
      if (!confirm(`¿Confirmas que estos servicios de ${tarNombreOp(x.operador_id)} son distintos y están bien?\n\n${fichas.map((f) => `· ${f.servicio}`).join("\n")}\n\nDejarán de marcarse como posible duplicado y cada uno puede ser visible.`)) return;
      for (const f of fichas) if (!(await tarGuardarFicha(f.operador_id, f.servicio, { duplicado_ok: true }))) return;
      tarPintar();
      return avisar("Marcados como revisados.");
    }
    case "ir-categorias":
      tar.pestana = "ajustes"; tar.editando = null; tarPintar();
      return $("tarCategorias")?.scrollIntoView({ behavior: "smooth" });
    case "bloque": return tarAccionBloque(b.dataset.accion, b);
    case "bloque-limpiar": tar.catSel.clear(); return tarPintar();
    case "orden": return conBoton(b, () => tarMoverOrden(it(), Number(b.dataset.paso)));
    case "ver-sinvigente": tar.catalogo.ver = "sinvigente"; tar.catalogo.tipo = ""; return tarPintar();
    case "rango-agregar": {
      $("tcfRangos").insertAdjacentHTML("beforeend", tarHtmlRango({}));
      return $("tcfRangos").lastElementChild.querySelector("input")?.focus();
    }
    case "rango-quitar": {
      const li = b.closest(".tcat-rango");
      if ($("tcfRangos").children.length > 1) li.remove();
      else li.querySelectorAll("input").forEach((x) => (x.value = ""));
      return;
    }
    case "aplicar-sug-cat": return tarAplicarSugerenciasCat(b);
    case "actualizar-tc": return tarActualizarTipoCambio(b);
    case "nuevo-tipo-cliente": return tarNuevoTipoCliente(b);
  }
});

$("tarContenido").addEventListener("change", async (e) => {
  const el = e.target;
  if (!tarEsAdmin()) return;
  if (el.dataset.tcat === "visible") {
    const x = tar.catItems[Number(el.dataset.i)];
    el.disabled = true;
    const ok = await tarCambiarVisible(x, el.checked, el);
    if (el.isConnected) el.disabled = false;
    if (ok) tarPintar();
    return;
  }
  if (el.dataset.tcat === "sel") {
    const x = tar.catItems[Number(el.dataset.i)];
    if (x) { if (el.checked) tar.catSel.add(x.clave); else tar.catSel.delete(x.clave); }
    tarPintar();
    return document.querySelector(`[data-tcat="sel"][data-i="${el.dataset.i}"]`)?.focus({ preventScroll: true });
  }
  if (el.dataset.tcat === "sel-todas") {
    tar.catItems.filter((x) => x.srv).forEach((x) => (el.checked ? tar.catSel.add(x.clave) : tar.catSel.delete(x.clave)));
    tarPintar();
    return document.querySelector('[data-tcat="sel-todas"]')?.focus({ preventScroll: true });
  }
  if (el.id === "tcfConTemporada") {
    $("tcfTemporadas").hidden = !el.checked;
    if (el.checked) $("tcfRangos").querySelector("input")?.focus();
    return;
  }
  if (el.id === "tcfArchivoFotos" && el.files.length) return tarSubirFotos(el.files);
  if (el.dataset.tcatCat !== undefined) return tarGuardarEquivalencia(el);
  if (el.dataset.kc) return tarGuardarTipoCliente(el);
  const f = el.dataset.tcatFiltro;
  if (f && f !== "texto") { tar.catalogo[f] = el.value; tarPintar(); }
});

// Búsqueda mientras se escribe (sin perder el cursor)
$("tarContenido").addEventListener("input", (e) => {
  const el = e.target;
  if (el.dataset.tcatFiltro !== "texto") return;
  tar.catalogo.texto = el.value;
  clearTimeout(tarHtmlCatalogo.espera);
  tarHtmlCatalogo.espera = setTimeout(() => {
    tarPintar();
    const nuevo = $("tcatBuscar");
    if (nuevo) { nuevo.focus(); nuevo.setSelectionRange(nuevo.value.length, nuevo.value.length); }
  }, 300);
});
