/* =====================================================
   MODO CELULAR (todo el sistema)
   - Menú ☰ desplegable en el panel
   - Etiquetas en las celdas de las tablas para verlas
     como tarjetas en pantallas pequeñas (movil.css)
   En computadora e impresión no cambia nada visible.
   ===================================================== */
(function () {
  "use strict";

  /* ---------- Menú ☰ del panel ---------- */
  function iniciarMenu() {
    const barra = document.querySelector(".barra-panel");
    const menu = barra && barra.querySelector(".menu");
    if (!barra || !menu || barra.querySelector(".mv-menu-btn")) return;

    const marca = barra.querySelector(".marca");
    const seccion = document.createElement("span");
    seccion.className = "mv-seccion";
    if (marca) marca.appendChild(seccion);

    const boton = document.createElement("button");
    boton.type = "button";
    boton.className = "mv-menu-btn";
    boton.setAttribute("aria-label", "Abrir menú");
    boton.setAttribute("aria-expanded", "false");
    if (!menu.id) menu.id = "menuPanel";
    boton.setAttribute("aria-controls", menu.id);
    boton.innerHTML =
      '<svg class="mv-ico-abrir" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>' +
      '<svg class="mv-ico-cerrar" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
      '<span class="mv-menu-aviso" hidden></span>';
    barra.appendChild(boton);

    const fondo = document.createElement("div");
    fondo.className = "mv-menu-fondo";
    document.body.appendChild(fondo);

    function abrir(si) {
      barra.classList.toggle("mv-abierto", si);
      document.body.classList.toggle("mv-menu-abierto", si);
      boton.setAttribute("aria-expanded", si ? "true" : "false");
      boton.setAttribute("aria-label", si ? "Cerrar menú" : "Abrir menú");
    }
    boton.addEventListener("click", () => abrir(!barra.classList.contains("mv-abierto")));
    fondo.addEventListener("click", () => abrir(false));
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && barra.classList.contains("mv-abierto")) { abrir(false); boton.focus(); }
    });
    menu.addEventListener("click", (e) => {
      if (e.target.closest(".menu-btn") && e.target.closest("#btnActualizar") === null) abrir(false);
    });

    // Nombre de la sección actual y aviso de mensajes/alarmas en el botón ☰
    function refrescar() {
      const actual = menu.querySelector('.menu-btn[aria-current="page"]');
      seccion.textContent = actual ? textoLimpio(actual) : "";
      const aviso = boton.querySelector(".mv-menu-aviso");
      const hay = [...menu.querySelectorAll(".menu-cuenta")].some((c) => !c.hidden && c.textContent.trim());
      aviso.hidden = !hay;
    }
    function textoLimpio(btn) {
      let t = "";
      btn.childNodes.forEach((n) => { if (n.nodeType === 3) t += n.textContent; });
      return t.trim();
    }
    new MutationObserver(refrescar).observe(menu, { attributes: true, childList: true, subtree: true, characterData: true });
    refrescar();
  }

  /* ---------- Tablas como tarjetas ---------- */
  const EXCLUIR = ".permisos, .stf-tabla, .stf-imp-tabla, .pla-imp-tabla, .mv-no-tarjetas";

  function textoCelda(c) { return (c.textContent || "").replace(/\s+/g, " ").trim(); }

  function etiquetasDe(fila) {
    const lista = [];
    [...fila.cells].forEach((c) => {
      const n = c.colSpan || 1;
      for (let i = 0; i < n; i++) lista.push(textoCelda(c));
    });
    return lista;
  }

  function prepararTabla(t) {
    if (t.matches(EXCLUIR)) return;
    const cab = t.tHead && t.tHead.rows.length ? t.tHead.rows[t.tHead.rows.length - 1] : null;
    let etiquetas = cab ? etiquetasDe(cab) : null;
    const total = cab ? etiquetas.length : 0;

    [...t.tBodies, t.tFoot].filter(Boolean).forEach((grupo) => {
      [...grupo.rows].forEach((fila) => {
        const celdas = [...fila.cells];
        const soloTh = celdas.length > 1 && celdas.every((c) => c.tagName === "TH");
        if (soloTh && grupo !== t.tFoot) {
          // Fila de títulos de columna dentro del cuerpo: sirve de etiqueta para las siguientes
          etiquetas = etiquetasDe(fila);
          fila.classList.add("mv-cab-interna");
          return;
        }
        if (celdas.length === 1 && (celdas[0].colSpan || 1) > 1) {
          fila.classList.add("mv-fila-titulo");
          return;
        }
        let col = 0;
        celdas.forEach((c) => {
          const n = c.colSpan || 1;
          const et = etiquetas && etiquetas[col] ? etiquetas[col] : "";
          if (et && !c.hasAttribute("data-label")) c.setAttribute("data-label", et);
          if (!textoCelda(c) && !c.querySelector("input, select, button, textarea, img, svg")) c.classList.add("mv-vacia");
          col += n;
        });
      });
    });
    if (etiquetas || total) t.classList.add("mv-tarjetas");
    t.dataset.mvListo = "1";
  }

  let pendiente = false;
  function revisarTablas() {
    if (pendiente) return;
    pendiente = true;
    requestAnimationFrame(() => {
      pendiente = false;
      document.querySelectorAll("table.tabla, table.part, table.participantes").forEach((t) => {
        // Se vuelve a preparar si su contenido cambió
        const firma = t.rows.length + ":" + (t.tHead ? t.tHead.textContent.length : 0);
        if (t.dataset.mvFirma === firma && t.dataset.mvListo) return;
        t.dataset.mvFirma = firma;
        prepararTabla(t);
      });
    });
  }

  function iniciar() {
    document.documentElement.classList.add("mv-activo");
    iniciarMenu();
    revisarTablas();
    new MutationObserver(revisarTablas).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar);
  else iniciar();
})();
