// =====================================================
// SECCIÓN SERVICIOS: servicios, operadores y propiedades
// (usa las utilidades y datos de panel.js)
// =====================================================

const catalogo = { pestana: "servicios", editando: null };
const TRANSPORTE_TEXTO = { incluido: "Incluido", opcional: "Opcional", sin_transporte: "Sin transporte" };

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
  if (catalogo.pestana === "operadores") h += catalogo.editando ? htmlFormOperador(catalogo.editando) : htmlListaOperadores(editar);
  if (catalogo.pestana === "propiedades") h += htmlPropiedades(editar);

  $("catalogoContenido").innerHTML = h;
  $("catalogoContenido").querySelector("[autofocus]")?.focus();
}

// ---------------------------------------------------------
// SERVICIOS
// ---------------------------------------------------------
function htmlListaServicios(puede) {
  const filas = app.servicios.map((s) => {
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
        <td>${puede ? `<button type="button" class="enlace" data-cat="editar-servicio" data-id="${s.id}">Editar</button>` : ""}</td>
      </tr>`;
  }).join("");

  return `
    <div class="det-seccion sin-margen">
      <div class="sec-cabeza">
        <h3>Servicios que ofrecemos</h3>
        ${puede ? `<button type="button" class="btn primario" data-cat="nuevo-servicio">Nuevo servicio</button>` : ""}
      </div>
      <p class="nota">Rack es el precio que se cobra al cliente. Neto es lo que nos cobra el operador. El operador y el neto nunca se muestran al cliente.</p>
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
        <label>Operador (empresa que lo realiza)
          <select id="fsOperador"><option value="">Sin operador</option>${operadores}</select>
        </label>
      </div>
      <div class="fila">
        <label>Duración en minutos <input id="fsDuracion" type="number" min="0" value="${s.duracion_min ?? ""}"></label>
        <label>Horarios de salida <input id="fsHorarios" placeholder="Ej.: 07:30, 13:00" value="${(s.horarios || []).map(hora).join(", ")}"></label>
        <label>Transporte <select id="fsTransporte">${transporte}</select></label>
      </div>
      <label>Descripción <textarea id="fsDescripcion">${escapar(s.descripcion ?? "")}</textarea></label>
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
// OPERADORES
// ---------------------------------------------------------
function htmlListaOperadores(puede) {
  const filas = app.operadores.map((o) => {
    const servicios = app.servicios.filter((s) => s.operador_id === o.id).map((s) => escapar(s.nombre)).join(", ");
    return `
      <tr class="${o.activo ? "" : "inactivo"}">
        <td><strong>${escapar(o.nombre)}</strong>${o.contacto ? `<br><span class="nota">${escapar(o.contacto)}</span>` : ""}</td>
        <td>${escapar(o.telefono ?? "")}</td>
        <td>${o.correo ? `<a href="mailto:${escapar(o.correo)}">${escapar(o.correo)}</a>` : ""}</td>
        <td>${servicios || `<span class="nota">Ninguno</span>`}</td>
        <td>${o.activo ? "Activo" : "Inactivo"}</td>
        <td>${puede ? `<button type="button" class="enlace" data-cat="editar-operador" data-id="${o.id}">Editar</button>` : ""}</td>
      </tr>`;
  }).join("");

  return `
    <div class="det-seccion sin-margen">
      <div class="sec-cabeza">
        <h3>Operadores</h3>
        ${puede ? `<button type="button" class="btn primario" data-cat="nuevo-operador">Nuevo operador</button>` : ""}
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
function htmlPropiedades(puede) {
  const filas = app.propiedades.map((p) => `
    <tr class="${p.activa ? "" : "inactivo"}">
      <td><strong>${escapar(p.nombre)}</strong></td>
      <td>${p.activa ? "Visible para clientes" : "Oculta"}</td>
      <td class="acciones-fila">${puede ? `
        <button type="button" class="enlace" data-cat="renombrar-propiedad" data-id="${p.id}">Cambiar nombre</button>
        <button type="button" class="enlace" data-cat="alternar-propiedad" data-id="${p.id}">${p.activa ? "Ocultar" : "Mostrar"}</button>
        <button type="button" class="enlace peligro" data-cat="eliminar-propiedad" data-id="${p.id}">Eliminar</button>` : ""}
      </td>
    </tr>`).join("");

  return `
    <div class="det-seccion sin-margen">
      <h3>Propiedades</h3>
      <p class="nota">Estas son las opciones que ve el cliente en "¿Dónde te hospedas?". Cuando un cliente elige "Otro lugar", lo que escribe queda solo en su cotización y no se agrega a esta lista.</p>
      ${puede ? `
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
