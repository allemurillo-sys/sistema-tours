// =====================================================
// SECCIÓN SERVICIOS: servicios, tipos de actividad, operadores y propiedades
// (usa las utilidades y datos de panel.js)
// =====================================================

const catalogo = { pestana: "servicios", editando: null };
const TRANSPORTE_TEXTO = { incluido: "Incluido", opcional: "Opcional", sin_transporte: "Sin transporte" };
const OTROS_IDIOMAS = { en: "Inglés", fr: "Francés", de: "Alemán", it: "Italiano" };
const tipoPorId = (id) => app.tipos.find((x) => x.id === Number(id));
const nombreTipo = (tp) => `${tp.icono ? tp.icono + " " : ""}${tp.nombre}`;

document.addEventListener("vista-abierta", (e) => { if (e.detail === "servicios") pintarCatalogo(); });
document.addEventListener("datos-actualizados", () => { if (!$("vistaServicios").hidden) pintarCatalogo(); });

document.querySelectorAll(".pestana[data-pestana]").forEach((b) => b.addEventListener("click", () => {
  catalogo.pestana = b.dataset.pestana;
  catalogo.editando = null;
  pintarCatalogo();
}));

function pintarCatalogo() {
  document.querySelectorAll(".pestana[data-pestana]").forEach((b) => {
    const activa = b.dataset.pestana === catalogo.pestana;
    b.classList.toggle("activa", activa);
    b.setAttribute("aria-selected", activa);
  });

  const editar = puede("editar_catalogo");
  let h = editar ? "" : `<p class="aviso">Puedes consultar el catálogo. Tu usuario no tiene autorización para modificarlo.</p>`;

  if (catalogo.pestana === "servicios") h += catalogo.editando ? htmlFormServicio(catalogo.editando) : htmlListaServicios(editar);
  if (catalogo.pestana === "tipos") h += catalogo.editando ? htmlFormTipo(catalogo.editando) : htmlListaTipos(editar);
  if (catalogo.pestana === "operadores") h += catalogo.editando ? htmlFormOperador(catalogo.editando) : htmlListaOperadores(editar);
  if (catalogo.pestana === "propiedades") h += htmlPropiedades(editar);

  $("catalogoContenido").innerHTML = h;
  $("catalogoContenido").querySelector("[autofocus]")?.focus();
}

// ---------------------------------------------------------
// SERVICIOS
// ---------------------------------------------------------
function htmlListaServicios(editable) {
  const fila = (s) => {
    const precios = app.categorias
      .map((c) => ({ c, p: app.precios.find((x) => x.servicio_id === s.id && x.categoria_id === c.id) }))
      .filter((x) => x.p)
      .map(({ c, p }) => `<span class="precio-linea">${escapar(c.nombre)}: ${dinero(p.precio)}${puede("ver_utilidad") ? ` <span class="nota">neto ${dinero(p.neto)}</span>` : ""}</span>`)
      .join("");
    return `
      <tr class="${s.activo ? "" : "inactivo"}">
        <td><strong>${escapar(s.nombre)}</strong>${s.duracion_min ? `<br><span class="nota">${s.duracion_min} min</span>` : ""}</td>
        <td>${escapar(nombreOperador(s.operador_id)) || `<span class="nota">Sin operador</span>`}</td>
        <td>${TRANSPORTE_TEXTO[s.transporte] ?? ""}</td>
        <td>${precios || `<span class="nota">Sin precios</span>`}</td>
        <td>${s.activo ? "Activo" : "Inactivo"}</td>
        <td>${editable ? `<button type="button" class="enlace" data-cat="editar-servicio" data-id="${s.id}">Editar</button>` : ""}</td>
      </tr>`;
  };

  // Un bloque por tipo de actividad, en el mismo orden que ve el cliente
  const grupos = app.tipos
    .map((tp) => ({ titulo: nombreTipo(tp), oculto: !tp.activo, lista: app.servicios.filter((s) => s.tipo_id === tp.id) }))
    .filter((g) => g.lista.length);
  const sinTipo = app.servicios.filter((s) => !tipoPorId(s.tipo_id));
  if (sinTipo.length) grupos.push({ titulo: "Sin tipo", sinTipo: true, lista: sinTipo });
  const filas = grupos.map((g) => `
    <tr class="fila-grupo"><th colspan="6">${escapar(g.titulo)}
      <span class="nota">${g.lista.length} ${g.lista.length === 1 ? "servicio" : "servicios"}${g.oculto ? " · tipo oculto: no se muestran al cliente" : ""}${g.sinTipo ? " · el cliente los ve en \"Otras actividades\"" : ""}</span>
    </th></tr>
    ${g.lista.map(fila).join("")}`).join("");

  return `
    <div class="det-seccion sin-margen">
      <div class="sec-cabeza">
        <h3>Servicios que ofrecemos</h3>
        ${editable ? `<button type="button" class="btn primario" data-cat="nuevo-servicio">Nuevo servicio</button>` : ""}
      </div>
      <p class="nota">Rack es el precio que se cobra al cliente. Neto es lo que nos cobra el operador. El operador y el neto nunca se muestran al cliente. Los servicios se agrupan por tipo de actividad; los tipos se administran en la pestaña "Tipos de actividad".</p>
      ${app.servicios.length ? `
        <div class="tabla-scroll">
          <table class="tabla">
            <thead><tr><th>Servicio</th><th>Operador</th><th>Transporte</th><th>Precios (rack y neto)</th><th>Estado</th><th></th></tr></thead>
            <tbody>${filas}</tbody>
          </table>
        </div>` : `<p class="nota">Todavía no hay servicios.</p>`}
    </div>`;
}

function htmlFormServicio(ed) {
  const s = ed.datos;
  const operadores = app.operadores.filter((o) => o.activo || o.id === s.operador_id)
    .map((o) => `<option value="${o.id}" ${o.id === s.operador_id ? "selected" : ""}>${escapar(o.nombre)}</option>`).join("");
  const tiposOpc = app.tipos.map((tp) =>
    `<option value="${tp.id}" ${tp.id === s.tipo_id ? "selected" : ""}>${escapar(nombreTipo(tp))}${tp.activo ? "" : " (oculto)"}</option>`).join("");
  const tr = s.traducciones || {};
  const filasIdioma = Object.entries(OTROS_IDIOMAS).map(([k, v]) => `
    <tr data-idioma="${k}">
      <th scope="row">${v}</th>
      <td><input data-tr="nombre" value="${escapar(tr[k]?.nombre ?? "")}" aria-label="Nombre en ${v.toLowerCase()}"></td>
      <td><textarea data-tr="descripcion" rows="2" aria-label="Descripción en ${v.toLowerCase()}">${escapar(tr[k]?.descripcion ?? "")}</textarea></td>
    </tr>`).join("");
  const traducidos = Object.keys(OTROS_IDIOMAS).filter((k) => tr[k]?.nombre).length;
  const transporte = Object.entries(TRANSPORTE_TEXTO)
    .map(([k, v]) => `<option value="${k}" ${k === (s.transporte || "opcional") ? "selected" : ""}>${v}</option>`).join("");

  const filasPrecio = app.categorias.map((c) => {
    const p = app.precios.find((x) => x.servicio_id === s.id && x.categoria_id === c.id);
    const rack = p ? Number(p.precio) : "";
    const neto = p ? Number(p.neto) : "";
    return `
      <tr data-cat-id="${c.id}">
        <th scope="row">${escapar(c.nombre)}</th>
        <td><input data-precio="rack" type="number" min="0" step="0.01" value="${rack}" aria-label="Rack ${escapar(c.nombre)}"></td>
        <td><input data-precio="neto" type="number" min="0" step="0.01" value="${neto}" aria-label="Neto ${escapar(c.nombre)}"></td>
        <td class="num celda-utilidad">${rack !== "" ? dinero((rack || 0) - (neto || 0)) : ""}</td>
      </tr>`;
  }).join("");

  return `
    <div class="det-seccion sin-margen">
      <h3>${s.id ? "Editar servicio" : "Nuevo servicio"}</h3>
      <div class="fila">
        <label>Nombre del servicio <input id="fsNombre" value="${escapar(s.nombre ?? "")}" autofocus></label>
        <label>Tipo de actividad
          <select id="fsTipo"><option value="">Sin tipo</option>${tiposOpc}</select>
        </label>
      </div>
      <div class="fila">
        <label>Operador (empresa que lo realiza)
          <select id="fsOperador"><option value="">Sin operador</option>${operadores}</select>
        </label>
      </div>
      <div class="fila">
        <label>Duración en minutos <input id="fsDuracion" type="number" min="0" value="${s.duracion_min ?? ""}"></label>
        <label>Horarios de salida <input id="fsHorarios" placeholder="Ej.: 07:30, 13:00" value="${(s.horarios || []).map(hora).join(", ")}"></label>
        <label>Transporte <select id="fsTransporte">${transporte}</select></label>
      </div>
      <label>Descripción corta para el cliente (se muestra en el formulario)
        <textarea id="fsDescripcion" placeholder="Ej.: Recorrido por puentes colgantes entre el bosque nuboso.">${escapar(s.descripcion ?? "")}</textarea>
      </label>
      <details class="traducciones" ${traducidos ? "" : "open"}>
        <summary>Nombre y descripción en otros idiomas <span class="nota">(${traducidos} de 4 idiomas con nombre)</span></summary>
        <p class="nota">El cliente ve la actividad en el idioma que eligió. Si un idioma queda vacío, verá el nombre en español y ninguna descripción.</p>
        <div class="tabla-scroll">
          <table class="tabla traduccion">
            <thead><tr><th>Idioma</th><th>Nombre</th><th>Descripción corta</th></tr></thead>
            <tbody id="fsTraducciones">${filasIdioma}</tbody>
          </table>
        </div>
      </details>
      <label class="check-linea"><input id="fsActivo" type="checkbox" ${s.activo !== false ? "checked" : ""}> Activo (aparece en el formulario de los clientes)</label>

      <h4>Precios por tipo de cliente</h4>
      <p class="nota">Deja ambos campos vacíos en los tipos de cliente que no aplican a este servicio.</p>
      <div class="tabla-scroll">
        <table class="tabla precios">
          <thead><tr><th>Tipo de cliente</th><th>Rack (al cliente)</th><th>Neto (del operador)</th><th class="num">Utilidad c/u</th></tr></thead>
          <tbody id="fsPrecios">${filasPrecio}</tbody>
        </table>
      </div>
      <div class="sec-botones">
        <button type="button" class="btn primario" data-cat="guardar-servicio">Guardar servicio</button>
        <button type="button" class="btn" data-cat="cancelar">Cancelar</button>
      </div>
    </div>`;
}

function leerTraducciones() {
  const tr = {};
  document.querySelectorAll("#fsTraducciones tr").forEach((fila) => {
    const nombre = fila.querySelector('[data-tr="nombre"]').value.trim();
    const descripcion = fila.querySelector('[data-tr="descripcion"]').value.trim();
    if (nombre || descripcion) tr[fila.dataset.idioma] = { ...(nombre && { nombre }), ...(descripcion && { descripcion }) };
  });
  return tr;
}

async function guardarServicio(btn) {
  const s = catalogo.editando.datos;
  const nombre = $("fsNombre").value.trim();
  if (!nombre) return avisar("Escribe el nombre del servicio.", "error");

  const horarios = [];
  for (const parte of $("fsHorarios").value.split(",").map((x) => x.trim()).filter(Boolean)) {
    const m = parte.match(/^(\d{1,2}):(\d{2})$/);
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) {
      return avisar(`El horario "${parte}" no es válido. Usa el formato 07:30, separado por comas.`, "error");
    }
    horarios.push(`${m[1].padStart(2, "0")}:${m[2]}`);
  }

  const fila = {
    nombre,
    operador_id: $("fsOperador").value ? Number($("fsOperador").value) : null,
    tipo_id: $("fsTipo").value ? Number($("fsTipo").value) : null,
    traducciones: leerTraducciones(),
    duracion_min: parseInt($("fsDuracion").value, 10) || null,
    horarios,
    transporte: $("fsTransporte").value,
    descripcion: $("fsDescripcion").value.trim() || null,
    activo: $("fsActivo").checked
  };

  const precios = [...document.querySelectorAll("#fsPrecios tr")].map((tr) => ({
    categoria_id: Number(tr.dataset.catId),
    rack: tr.querySelector('[data-precio="rack"]').value,
    neto: tr.querySelector('[data-precio="neto"]').value
  }));

  await conBoton(btn, async () => {
    let id = s.id;
    if (id) {
      const { error } = await db.from("servicios").update(fila).eq("id", id);
      if (error) return fallo(error);
    } else {
      const { data, error } = await db.from("servicios").insert(fila).select("id").single();
      if (error) return fallo(error);
      id = data.id;
    }

    const conPrecio = precios.filter((p) => p.rack !== "" || p.neto !== "");
    const sinPrecio = precios.filter((p) => p.rack === "" && p.neto === "").map((p) => p.categoria_id);

    if (conPrecio.length) {
      const { error } = await db.from("servicio_precios").upsert(conPrecio.map((p) => ({
        servicio_id: id,
        categoria_id: p.categoria_id,
        precio: Math.max(0, parseFloat(p.rack) || 0),
        neto: Math.max(0, parseFloat(p.neto) || 0),
        actualizado_en: new Date().toISOString()
      })));
      if (error) return fallo(error, "El servicio se guardó, pero no los precios.");
    }
    if (sinPrecio.length) {
      const { error } = await db.from("servicio_precios").delete().eq("servicio_id", id).in("categoria_id", sinPrecio);
      if (error) return fallo(error, "El servicio se guardó, pero no se pudieron quitar algunos precios.");
    }

    await cargarCatalogos();
    catalogo.editando = null;
    pintarCatalogo();
    avisar("Servicio guardado.");
  });
}

// ---------------------------------------------------------
// TIPOS DE ACTIVIDAD
// ---------------------------------------------------------
function htmlListaTipos(editable) {
  const tarjetas = app.tipos.map((tp, i) => {
    const lista = app.servicios.filter((s) => s.tipo_id === tp.id);
    const traducciones = Object.entries(OTROS_IDIOMAS)
      .map(([k, v]) => (tp.traducciones?.[k] ? `${v}: ${escapar(tp.traducciones[k])}` : null)).filter(Boolean).join(" · ");
    return `
      <li class="tipo-tarjeta${tp.activo ? "" : " inactivo"}">
        <div class="tipo-cabeza">
          <span class="tipo-icono" aria-hidden="true">${escapar(tp.icono || "•")}</span>
          <div class="tipo-textos">
            <p class="tipo-nombre">${escapar(tp.nombre)} ${tp.activo ? "" : `<span class="chip-gris">Oculto para clientes</span>`}</p>
            <p class="nota">${traducciones || "Sin traducciones"}</p>
          </div>
          ${editable ? `
            <div class="tipo-acciones">
              <button type="button" class="btn-icono" data-cat="subir-tipo" data-id="${tp.id}" ${i === 0 ? "disabled" : ""} aria-label="Subir ${escapar(tp.nombre)}" title="Subir">▲</button>
              <button type="button" class="btn-icono" data-cat="bajar-tipo" data-id="${tp.id}" ${i === app.tipos.length - 1 ? "disabled" : ""} aria-label="Bajar ${escapar(tp.nombre)}" title="Bajar">▼</button>
              <button type="button" class="enlace" data-cat="editar-tipo" data-id="${tp.id}">Editar</button>
            </div>` : ""}
        </div>
        ${lista.length
          ? `<ul class="tipo-servicios">${lista.map((s) => `<li class="${s.activo ? "" : "inactivo"}">${escapar(s.nombre)}${s.activo ? "" : " <span class=\"nota\">(inactivo)</span>"}</li>`).join("")}</ul>`
          : `<p class="nota tipo-vacio">Todavía no tiene servicios. Asígnalos desde "Editar" en cada servicio.</p>`}
      </li>`;
  }).join("");
  const sinTipo = app.servicios.filter((s) => !tipoPorId(s.tipo_id));

  return `
    <div class="det-seccion sin-margen">
      <div class="sec-cabeza">
        <h3>Tipos de actividad</h3>
        ${editable ? `<button type="button" class="btn primario" data-cat="nuevo-tipo">Nuevo tipo</button>` : ""}
      </div>
      <p class="nota">Así se agrupan las actividades en el formulario del cliente, en este mismo orden. Usa ▲ ▼ para cambiar el orden. Para poner un servicio dentro de un tipo, edita el servicio y elige su "Tipo de actividad".</p>
      ${app.tipos.length ? `<ul class="tipos-lista">${tarjetas}</ul>` : `<p class="nota">Todavía no hay tipos de actividad.</p>`}
      ${sinTipo.length ? `
        <div class="aviso suave">
          <p>Servicios sin tipo (${sinTipo.length})</p>
          ${sinTipo.map((s) => escapar(s.nombre)).join(", ")}. El cliente los ve al final, en "Otras actividades".
        </div>` : ""}
    </div>`;
}

function htmlFormTipo(ed) {
  const tp = ed.datos;
  const idiomas = Object.entries(OTROS_IDIOMAS).map(([k, v]) =>
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
        <button type="button" class="btn primario" data-cat="guardar-tipo">Guardar tipo</button>
        <button type="button" class="btn" data-cat="cancelar">Cancelar</button>
        ${tp.id ? `<button type="button" class="enlace peligro" data-cat="eliminar-tipo" data-id="${tp.id}" data-cuantos="${cuantos}">Eliminar tipo</button>` : ""}
      </div>
    </div>`;
}

async function guardarTipo(btn) {
  const tp = catalogo.editando.datos;
  const traducciones = {};
  document.querySelectorAll("[data-tr-tipo]").forEach((el) => {
    if (el.value.trim()) traducciones[el.dataset.trTipo] = el.value.trim();
  });
  const fila = {
    nombre: $("ftNombre").value.trim(),
    icono: $("ftIcono").value.trim() || null,
    traducciones,
    activo: $("ftActivo").checked
  };
  if (!fila.nombre) return avisar("Escribe el nombre del tipo de actividad.", "error");
  if (!tp.id) fila.orden = Math.max(0, ...app.tipos.map((x) => x.orden)) + 1;

  await conBoton(btn, async () => {
    const r = tp.id
      ? await db.from("tipos_servicio").update(fila).eq("id", tp.id)
      : await db.from("tipos_servicio").insert(fila);
    if (r.error) return fallo(r.error, r.error.code === "23505" ? "Ya existe un tipo con ese nombre." : "No se pudo guardar.");
    await cargarCatalogos();
    catalogo.editando = null;
    pintarCatalogo();
    avisar("Tipo de actividad guardado.");
  });
}

async function moverTipo(id, paso) {
  const i = app.tipos.findIndex((x) => x.id === id);
  const j = i + paso;
  if (i < 0 || j < 0 || j >= app.tipos.length) return;
  // Se renumera toda la lista para que el orden quede limpio (1, 2, 3...)
  const lista = [...app.tipos];
  [lista[i], lista[j]] = [lista[j], lista[i]];
  const cambios = lista.map((x, k) => ({ id: x.id, orden: k + 1 })).filter((x) => tipoPorId(x.id).orden !== x.orden);
  for (const c of cambios) {
    const { error } = await db.from("tipos_servicio").update({ orden: c.orden }).eq("id", c.id);
    if (error) { await cargarCatalogos(); pintarCatalogo(); return fallo(error, "No se pudo cambiar el orden."); }
  }
  await cargarCatalogos();
  pintarCatalogo();
  document.querySelector(`[data-cat="${paso < 0 ? "subir" : "bajar"}-tipo"][data-id="${id}"]:not(:disabled)`)?.focus();
}

// ---------------------------------------------------------
// OPERADORES
// ---------------------------------------------------------
function htmlListaOperadores(editable) {
  const filas = app.operadores.map((o) => {
    const servicios = app.servicios.filter((s) => s.operador_id === o.id).map((s) => escapar(s.nombre)).join(", ");
    return `
      <tr class="${o.activo ? "" : "inactivo"}">
        <td><strong>${escapar(o.nombre)}</strong>${o.contacto ? `<br><span class="nota">${escapar(o.contacto)}</span>` : ""}</td>
        <td>${escapar(o.telefono ?? "")}</td>
        <td>${o.correo ? `<a href="mailto:${escapar(o.correo)}">${escapar(o.correo)}</a>` : ""}</td>
        <td>${servicios || `<span class="nota">Ninguno</span>`}</td>
        <td>${o.activo ? "Activo" : "Inactivo"}</td>
        <td>${editable ? `<button type="button" class="enlace" data-cat="editar-operador" data-id="${o.id}">Editar</button>` : ""}</td>
      </tr>`;
  }).join("");

  return `
    <div class="det-seccion sin-margen">
      <div class="sec-cabeza">
        <h3>Operadores</h3>
        ${editable ? `<button type="button" class="btn primario" data-cat="nuevo-operador">Nuevo operador</button>` : ""}
      </div>
      <p class="nota">Empresas que realizan los servicios. Esta información es solo para uso interno.</p>
      ${app.operadores.length ? `
        <div class="tabla-scroll">
          <table class="tabla">
            <thead><tr><th>Operador</th><th>Teléfono</th><th>Correo</th><th>Servicios</th><th>Estado</th><th></th></tr></thead>
            <tbody>${filas}</tbody>
          </table>
        </div>` : `<p class="nota">Todavía no hay operadores. Agrega el primero y luego asígnalo a sus servicios.</p>`}
    </div>`;
}

function htmlFormOperador(ed) {
  const o = ed.datos;
  return `
    <div class="det-seccion sin-margen">
      <h3>${o.id ? "Editar operador" : "Nuevo operador"}</h3>
      <div class="fila">
        <label>Nombre de la empresa <input id="foNombre" value="${escapar(o.nombre ?? "")}" autofocus></label>
        <label>Persona de contacto <input id="foContacto" value="${escapar(o.contacto ?? "")}"></label>
      </div>
      <div class="fila">
        <label>Teléfono <input id="foTelefono" type="tel" value="${escapar(o.telefono ?? "")}"></label>
        <label>Correo <input id="foCorreo" type="email" value="${escapar(o.correo ?? "")}"></label>
      </div>
      <label>Notas (datos bancarios, condiciones de pago, etc.) <textarea id="foNotas">${escapar(o.notas ?? "")}</textarea></label>
      <label class="check-linea"><input id="foActivo" type="checkbox" ${o.activo !== false ? "checked" : ""}> Activo</label>
      <div class="sec-botones">
        <button type="button" class="btn primario" data-cat="guardar-operador">Guardar operador</button>
        <button type="button" class="btn" data-cat="cancelar">Cancelar</button>
      </div>
    </div>`;
}

async function guardarOperador(btn) {
  const o = catalogo.editando.datos;
  const fila = {
    nombre: $("foNombre").value.trim(),
    contacto: $("foContacto").value.trim() || null,
    telefono: $("foTelefono").value.trim() || null,
    correo: $("foCorreo").value.trim() || null,
    notas: $("foNotas").value.trim() || null,
    activo: $("foActivo").checked
  };
  if (!fila.nombre) return avisar("Escribe el nombre del operador.", "error");

  await conBoton(btn, async () => {
    const r = o.id
      ? await db.from("operadores").update(fila).eq("id", o.id)
      : await db.from("operadores").insert(fila);
    if (r.error) return fallo(r.error);
    await cargarCatalogos();
    catalogo.editando = null;
    pintarCatalogo();
    avisar("Operador guardado.");
  });
}

// ---------------------------------------------------------
// PROPIEDADES
// ---------------------------------------------------------
function htmlPropiedades(editable) {
  const filas = app.propiedades.map((p) => `
    <tr class="${p.activa ? "" : "inactivo"}">
      <td><strong>${escapar(p.nombre)}</strong></td>
      <td>${p.activa ? "Visible para clientes" : "Oculta"}</td>
      <td class="acciones-fila">${editable ? `
        <button type="button" class="enlace" data-cat="renombrar-propiedad" data-id="${p.id}">Cambiar nombre</button>
        <button type="button" class="enlace" data-cat="alternar-propiedad" data-id="${p.id}">${p.activa ? "Ocultar" : "Mostrar"}</button>
        <button type="button" class="enlace peligro" data-cat="eliminar-propiedad" data-id="${p.id}">Eliminar</button>` : ""}
      </td>
    </tr>`).join("");

  return `
    <div class="det-seccion sin-margen">
      <h3>Propiedades</h3>
      <p class="nota">Estas son las opciones que ve el cliente en "¿Dónde te hospedas?". Cuando un cliente elige "Otro lugar", lo que escribe queda solo en su cotización y no se agrega a esta lista.</p>
      ${editable ? `
        <div class="fila-form">
          <label>Nueva propiedad <input id="nuevaPropiedad" type="text" placeholder="Nombre de la propiedad"></label>
          <button type="button" class="btn primario" data-cat="agregar-propiedad">Agregar</button>
        </div>` : ""}
      ${app.propiedades.length ? `
        <div class="tabla-scroll">
          <table class="tabla">
            <thead><tr><th>Propiedad</th><th>Estado</th><th></th></tr></thead>
            <tbody>${filas}</tbody>
          </table>
        </div>` : `<p class="nota">Todavía no hay propiedades.</p>`}
    </div>`;
}

// ---------------------------------------------------------
// EVENTOS
// ---------------------------------------------------------
$("catalogoContenido").addEventListener("input", (e) => {
  const tr = e.target.closest("#fsPrecios tr");
  if (!tr) return;
  const rack = tr.querySelector('[data-precio="rack"]').value;
  const neto = tr.querySelector('[data-precio="neto"]').value;
  tr.querySelector(".celda-utilidad").textContent =
    rack === "" && neto === "" ? "" : dinero((parseFloat(rack) || 0) - (parseFloat(neto) || 0));
});

$("catalogoContenido").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.id === "nuevaPropiedad") {
    e.preventDefault();
    document.querySelector('[data-cat="agregar-propiedad"]')?.click();
  }
});

$("catalogoContenido").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-cat]");
  if (!btn) return;
  const id = Number(btn.dataset.id);

  switch (btn.dataset.cat) {
    case "nuevo-servicio":
      catalogo.editando = { datos: { activo: true, transporte: "opcional", horarios: [] } };
      pintarCatalogo();
      break;
    case "editar-servicio":
      catalogo.editando = { datos: { ...app.servicios.find((s) => s.id === id) } };
      pintarCatalogo();
      break;
    case "guardar-servicio":
      await guardarServicio(btn);
      break;

    case "nuevo-tipo":
      catalogo.editando = { datos: { activo: true, traducciones: {} } };
      pintarCatalogo();
      break;
    case "editar-tipo":
      catalogo.editando = { datos: { ...tipoPorId(id) } };
      pintarCatalogo();
      break;
    case "guardar-tipo":
      await guardarTipo(btn);
      break;
    case "subir-tipo":
    case "bajar-tipo":
      await conBoton(btn, () => moverTipo(id, btn.dataset.cat === "subir-tipo" ? -1 : 1));
      break;
    case "eliminar-tipo": {
      const cuantos = Number(btn.dataset.cuantos);
      const tp = tipoPorId(id);
      const texto = cuantos
        ? `¿Eliminar el tipo "${tp?.nombre}"? Sus ${cuantos} servicios no se borran: quedan "sin tipo" y el cliente los verá en "Otras actividades".`
        : `¿Eliminar el tipo "${tp?.nombre}"?`;
      if (!confirm(texto)) return;
      const { error } = await db.from("tipos_servicio").delete().eq("id", id);
      if (error) return fallo(error, "No se pudo eliminar.");
      await cargarCatalogos();
      catalogo.editando = null;
      pintarCatalogo();
      avisar("Tipo de actividad eliminado.");
      break;
    }

    case "nuevo-operador":
      catalogo.editando = { datos: { activo: true } };
      pintarCatalogo();
      break;
    case "editar-operador":
      catalogo.editando = { datos: { ...app.operadores.find((o) => o.id === id) } };
      pintarCatalogo();
      break;
    case "guardar-operador":
      await guardarOperador(btn);
      break;

    case "cancelar":
      catalogo.editando = null;
      pintarCatalogo();
      break;

    case "agregar-propiedad": {
      const nombre = $("nuevaPropiedad").value.trim();
      if (!nombre) return avisar("Escribe el nombre de la propiedad.", "error");
      await conBoton(btn, async () => {
        const { error } = await db.from("propiedades").insert({ nombre });
        if (error) return fallo(error, error.code === "23505" ? "Esa propiedad ya existe." : "No se pudo agregar.");
        await cargarCatalogos();
        pintarCatalogo();
        $("nuevaPropiedad")?.focus();
        avisar("Propiedad agregada.");
      });
      break;
    }
    case "renombrar-propiedad": {
      const actual = app.propiedades.find((p) => p.id === id);
      const nombre = prompt("Nuevo nombre de la propiedad:", actual?.nombre ?? "")?.trim();
      if (!nombre || nombre === actual?.nombre) return;
      const { error } = await db.from("propiedades").update({ nombre }).eq("id", id);
      if (error) return fallo(error);
      await cargarCatalogos();
      pintarCatalogo();
      break;
    }
    case "alternar-propiedad": {
      const actual = app.propiedades.find((p) => p.id === id);
      const { error } = await db.from("propiedades").update({ activa: !actual.activa }).eq("id", id);
      if (error) return fallo(error);
      await cargarCatalogos();
      pintarCatalogo();
      break;
    }
    case "eliminar-propiedad": {
      const actual = app.propiedades.find((p) => p.id === id);
      if (!confirm(`¿Eliminar "${actual?.nombre}"?`)) return;
      const { error } = await db.from("propiedades").delete().eq("id", id);
      if (error) {
        if (error.code === "23503") {
          return avisar("Esta propiedad ya aparece en cotizaciones, así que no se puede eliminar. Usa \"Ocultar\" para que los clientes ya no la vean.", "error");
        }
        return fallo(error, "No se pudo eliminar.");
      }
      await cargarCatalogos();
      pintarCatalogo();
      avisar("Propiedad eliminada.");
      break;
    }
  }
});
