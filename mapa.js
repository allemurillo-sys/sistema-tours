// =====================================================
// MAPA DE PROPIEDADES (Reservas › Mapa de propiedades)
// Muestra dónde está cada propiedad de Reservas y permite copiar su enlace
// de Google Maps para enviarlo a un cliente.
// Solo Administrador y quien tenga el permiso «mapa_propiedades» (Operaciones).
// La ubicación se carga pegando el enlace de Google Maps; si el enlace no trae
// el punto exacto, se toca el mapa para marcarlo.
// (usa las utilidades y datos de panel.js)
// =====================================================

VISTAS.mapa = "vistaMapa";
const mapa = {
  ubicaciones: new Map(),  // propiedad_id → { enlace, latitud, longitud }
  mapa: null,              // mapa Leaflet
  marcadores: new Map(),   // propiedad_id → marcador
  editando: null,          // id de la propiedad cuyo enlace se está editando
  marcando: null,          // id de la propiedad que se está ubicando tocando el mapa
  buscar: ""
};
const CENTRO_LA_FORTUNA = [10.4716, -84.6427];
const mapaPuede = () => app.yo?.rol === "administrador" || app.permisos?.has("mapa_propiedades");

function mapaRevisarAcceso() {
  $("btnMenuMapa").hidden = !mapaPuede();
  if (!mapaPuede() && !$("vistaMapa").hidden) mostrarVista("reservas");
}
new MutationObserver(mapaRevisarAcceso).observe($("usuarioNombre"), { childList: true, characterData: true, subtree: true });
mapaRevisarAcceso();

document.addEventListener("vista-abierta", (e) => {
  if (e.detail !== "mapa") return;
  if (!mapaPuede()) return mostrarVista("reservas");
  mapaAbrir();
});
document.addEventListener("datos-actualizados", () => { if (!$("vistaMapa").hidden && mapa.mapa && !mapa.editando && !mapa.marcando) mapaAbrir(); });

// ---------- Leaflet (se carga solo la primera vez que se abre el mapa) ----------
let leafletCargando = null;
function cargarLeaflet() {
  if (window.L) return Promise.resolve();
  if (leafletCargando) return leafletCargando;
  leafletCargando = new Promise((ok, mal) => {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
    document.head.appendChild(css);
    const js = document.createElement("script");
    js.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    js.onload = ok;
    js.onerror = () => { leafletCargando = null; mal(new Error("No se pudo cargar el mapa. Revisa la conexión a internet.")); };
    document.head.appendChild(js);
  });
  return leafletCargando;
}

// ---------- Datos ----------
async function mapaCargar() {
  const { data, error } = await db.from("propiedades_ubicacion").select("propiedad_id, enlace, latitud, longitud");
  if (error) { fallo(error, "No se pudieron cargar las ubicaciones."); return; }
  mapa.ubicaciones = new Map((data || []).map((u) => [u.propiedad_id, u]));
}
const tienePunto = (u) => u && u.latitud != null && u.longitud != null;
// Enlace para el cliente: el que se pegó, o uno hecho con el punto
const enlaceDe = (u) => u?.enlace || (tienePunto(u) ? `https://www.google.com/maps/search/?api=1&query=${u.latitud},${u.longitud}` : "");

async function mapaAbrir() {
  const cont = $("mapaContenido");
  if (!mapa.mapa) cont.innerHTML = `<p class="nota">Cargando mapa…</p>`;
  try {
    await Promise.all([cargarLeaflet(), mapaCargar()]);
  } catch (err) {
    cont.innerHTML = `<p class="aviso">${escapar(err.message)}</p>`;
    return;
  }
  if (!mapa.mapa) mapaArmar();
  mapaPintarLista();
  mapaPintarMarcadores();
  setTimeout(() => mapa.mapa.invalidateSize(), 50);
}

// ---------- Estructura de la vista ----------
function mapaArmar() {
  $("mapaContenido").innerHTML = `
    <div class="mapa-cuerpo">
      <div class="mapa-lienzo-caja">
        <div id="mapaLienzo" class="mapa-lienzo" aria-label="Mapa de propiedades"></div>
        <p id="mapaMarcando" class="mapa-marcando" hidden></p>
      </div>
      <aside class="mapa-lista">
        <input id="mapaBuscar" type="search" placeholder="Buscar propiedad" aria-label="Buscar propiedad">
        <div id="mapaFilas"></div>
        <p class="nota">Las propiedades salen de Configuración › Propiedades. Para ubicar una, pega su enlace de Google Maps (en Google Maps: <em>Compartir › Copiar vínculo</em>).</p>
      </aside>
    </div>`;
  mapa.mapa = L.map("mapaLienzo", { zoomControl: true }).setView(CENTRO_LA_FORTUNA, 13);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19, attribution: "© OpenStreetMap"
  }).addTo(mapa.mapa);
  mapa.mapa.on("click", (e) => { if (mapa.marcando) mapaGuardarPunto(mapa.marcando, e.latlng.lat, e.latlng.lng); });

  $("mapaBuscar").addEventListener("input", (e) => { mapa.buscar = e.target.value.trim().toLowerCase(); mapaPintarLista(); });
  $("mapaFilas").addEventListener("click", mapaClic);
  $("mapaLienzo").addEventListener("click", (e) => {
    const b = e.target.closest("[data-mapa]");
    if (b) mapaClic(e);
  });
  $("mapaFilas").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.matches(".mapa-enlace-input")) {
      e.preventDefault();
      e.target.closest(".mapa-fila").querySelector('[data-mapa="guardar"]')?.click();
    }
    if (e.key === "Escape" && mapa.editando) { mapa.editando = null; mapaPintarLista(); }
  });
}

function mapaPintarLista() {
  const filas = app.propiedades
    .filter((p) => !mapa.buscar || p.nombre.toLowerCase().includes(mapa.buscar))
    .map((p) => {
      const u = mapa.ubicaciones.get(p.id);
      const enlace = enlaceDe(u);
      if (mapa.editando === p.id) {
        return `
        <div class="mapa-fila editando">
          <strong>${escapar(p.nombre)}</strong>
          <label class="mapa-etiqueta">Enlace de Google Maps
            <input class="mapa-enlace-input" type="url" value="${escapar(u?.enlace || "")}" placeholder="https://maps.app.goo.gl/…">
          </label>
          <div class="mapa-acciones">
            <button type="button" class="btn primario chico" data-mapa="guardar" data-id="${p.id}">Guardar</button>
            <button type="button" class="btn chico" data-mapa="cancelar">Cancelar</button>
            ${u ? `<button type="button" class="enlace peligro" data-mapa="quitar" data-id="${p.id}">Quitar ubicación</button>` : ""}
          </div>
        </div>`;
      }
      const estado = tienePunto(u) ? "" : enlace ? `<span class="mapa-falta">Falta marcar en el mapa</span>` : `<span class="mapa-falta">Sin ubicación</span>`;
      return `
        <div class="mapa-fila${p.activa ? "" : " inactiva"}" data-fila="${p.id}">
          <button type="button" class="mapa-nombre" data-mapa="ver" data-id="${p.id}" ${tienePunto(u) ? "" : "disabled"}>${escapar(p.nombre)}</button>
          ${estado}
          <div class="mapa-acciones">
            ${enlace ? `
              <button type="button" class="btn chico" data-mapa="copiar" data-id="${p.id}">Copiar enlace</button>
              <a class="enlace" href="${escapar(enlace)}" target="_blank" rel="noopener">Abrir</a>` : ""}
            <button type="button" class="enlace" data-mapa="editar" data-id="${p.id}">${u ? "Cambiar enlace" : "Agregar enlace"}</button>
            ${u ? `<button type="button" class="enlace" data-mapa="marcar" data-id="${p.id}">${tienePunto(u) ? "Mover punto" : "Marcar en el mapa"}</button>` : ""}
          </div>
        </div>`;
    }).join("");
  $("mapaFilas").innerHTML = filas || `<p class="nota">${app.propiedades.length ? "Ninguna propiedad coincide con la búsqueda." : "Todavía no hay propiedades."}</p>`;
  if (mapa.editando) $("mapaFilas").querySelector(".mapa-enlace-input")?.focus();
}

function mapaPintarMarcadores() {
  mapa.marcadores.forEach((m) => m.remove());
  mapa.marcadores.clear();
  const puntos = [];
  app.propiedades.forEach((p) => {
    const u = mapa.ubicaciones.get(p.id);
    if (!tienePunto(u)) return;
    const m = L.marker([u.latitud, u.longitud], { title: p.nombre }).addTo(mapa.mapa);
    m.bindTooltip(escapar(p.nombre), { permanent: true, direction: "top", offset: [-15, -12], className: "mapa-etiqueta-punto" });
    m.bindPopup(`
      <strong>${escapar(p.nombre)}</strong><br>
      <button type="button" class="btn chico" data-mapa="copiar" data-id="${p.id}">Copiar enlace</button>
      <a class="enlace" href="${escapar(enlaceDe(u))}" target="_blank" rel="noopener">Abrir en Google Maps</a>`);
    mapa.marcadores.set(p.id, m);
    puntos.push([u.latitud, u.longitud]);
  });
  if (!mapa.ajustado && puntos.length) {
    mapa.ajustado = true;
    if (puntos.length === 1) mapa.mapa.setView(puntos[0], 15);
    else mapa.mapa.fitBounds(puntos, { padding: [40, 40], maxZoom: 15 });
  }
}

// ---------- Acciones ----------
async function mapaCopiar(texto) {
  try {
    await navigator.clipboard.writeText(texto);
  } catch {
    const t = document.createElement("textarea");
    t.value = texto; document.body.appendChild(t); t.select();
    document.execCommand("copy"); t.remove();
  }
  avisar("Enlace copiado. Ya lo puedes pegar en el mensaje al cliente.");
}

function mapaEmpezarMarcado(id) {
  const p = app.propiedades.find((x) => x.id === id);
  mapa.marcando = id;
  $("mapaMarcando").hidden = false;
  $("mapaMarcando").innerHTML = `Toca en el mapa dónde está <strong>${escapar(p?.nombre || "")}</strong>. <button type="button" class="enlace" id="mapaCancelarMarcado">Cancelar</button>`;
  $("mapaCancelarMarcado").onclick = (e) => { e.stopPropagation(); mapaTerminarMarcado(); };
  $("mapaLienzo").classList.add("marcando");
  $("mapaLienzo").scrollIntoView({ behavior: "smooth", block: "center" });
}
function mapaTerminarMarcado() {
  mapa.marcando = null;
  $("mapaMarcando").hidden = true;
  $("mapaLienzo").classList.remove("marcando");
}

async function mapaGuardarPunto(id, lat, lng) {
  const u = mapa.ubicaciones.get(id);
  const { error } = await db.from("propiedades_ubicacion")
    .upsert({ propiedad_id: id, enlace: u?.enlace || "", latitud: lat, longitud: lng });
  if (error) return fallo(error);
  mapaTerminarMarcado();
  await mapaCargar();
  mapaPintarLista();
  mapaPintarMarcadores();
  avisar("Ubicación guardada.");
}

async function mapaGuardarEnlace(id, enlace, btn) {
  if (!enlace) return avisar("Pega el enlace de Google Maps.", "error");
  let url;
  try { url = new URL(enlace); } catch { return avisar("Ese enlace no es válido. Cópialo de Google Maps con «Compartir › Copiar vínculo».", "error"); }
  if (!/(^|\.)google\.|goo\.gl$|^g\.co$/.test(url.hostname)) return avisar("Pega un enlace de Google Maps.", "error");

  return conBoton(btn, async () => {
    // Busca el punto: primero en el propio enlace, si no, lo resuelve el servidor
    let punto = null;
    const { data, error: errFn } = await db.functions.invoke("resolver-mapa", { body: { enlace } });
    if (!errFn && data?.lat != null) punto = { lat: data.lat, lng: data.lng };

    const u = mapa.ubicaciones.get(id);
    const fila = { propiedad_id: id, enlace, latitud: punto?.lat ?? u?.latitud ?? null, longitud: punto?.lng ?? u?.longitud ?? null };
    const { error } = await db.from("propiedades_ubicacion").upsert(fila);
    if (error) return fallo(error);
    mapa.editando = null;
    await mapaCargar();
    mapaPintarLista();
    mapaPintarMarcadores();
    if (punto) {
      mapa.mapa.setView([punto.lat, punto.lng], 16);
      mapa.marcadores.get(id)?.openPopup();
      avisar("Enlace guardado y propiedad ubicada en el mapa.");
    } else {
      avisar("Enlace guardado. No se pudo leer el punto exacto: toca el mapa para marcar la propiedad.");
      mapaEmpezarMarcado(id);
    }
  });
}

async function mapaClic(e) {
  const btn = e.target.closest("[data-mapa]");
  if (!btn) return;
  const id = Number(btn.dataset.id);
  const u = mapa.ubicaciones.get(id);
  switch (btn.dataset.mapa) {
    case "ver": {
      if (!tienePunto(u)) return;
      mapa.mapa.setView([u.latitud, u.longitud], 16);
      mapa.marcadores.get(id)?.openPopup();
      $("mapaLienzo").scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    case "copiar": return mapaCopiar(enlaceDe(u));
    case "editar": mapaTerminarMarcado(); mapa.editando = id; return mapaPintarLista();
    case "cancelar": mapa.editando = null; return mapaPintarLista();
    case "guardar": {
      const enlace = btn.closest(".mapa-fila").querySelector(".mapa-enlace-input").value.trim();
      return mapaGuardarEnlace(id, enlace, btn);
    }
    case "marcar": return mapaEmpezarMarcado(id);
    case "quitar": {
      const p = app.propiedades.find((x) => x.id === id);
      if (!confirm(`¿Quitar la ubicación de "${p?.nombre}"? La propiedad no se elimina, solo su enlace y su punto en el mapa.`)) return;
      const { error } = await db.from("propiedades_ubicacion").delete().eq("propiedad_id", id);
      if (error) return fallo(error);
      mapa.editando = null;
      await mapaCargar();
      mapaPintarLista();
      mapaPintarMarcadores();
      return avisar("Ubicación quitada.");
    }
  }
}
