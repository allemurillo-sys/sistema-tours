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
    const lineaHv = marca && marca.querySelector(".marca-hv");
    if (lineaHv) lineaHv.appendChild(seccion);
    else if (marca) marca.appendChild(seccion);

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
      if (e.target.closest(".menu-btn") && !e.target.closest("#btnActualizar, .menu-grupo-btn")) abrir(false);
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


  /* ---------- Barra del panel: Actualizar y Salir como íconos (en computadora) ---------- */
  const ICONOS = {
    btnActualizar: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6"/>',
    btnSalir: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/>'
  };
  function iconosBarra() {
    Object.keys(ICONOS).forEach((id) => {
      const b = document.getElementById(id);
      if (!b || b.querySelector(".mv-ico")) return;
      const texto = b.textContent.trim();
      b.innerHTML = '<svg class="mv-ico" viewBox="0 0 24 24" aria-hidden="true">' + ICONOS[id] + '</svg><span class="mv-etq">' + texto + "</span>";
      b.title = texto;
    });
    // El nombre del usuario se ve al pasar el mouse sobre el avatar
    const nombre = document.getElementById("usuarioNombre");
    const avatar = document.getElementById("chatAvatarBtn");
    if (nombre && avatar) {
      const poner = () => { const t = nombre.textContent.trim(); if (t) avatar.title = t; };
      new MutationObserver(poner).observe(nombre, { childList: true, characterData: true, subtree: true });
      poner();
    }
    // Hora de la última actualización junto al ícono
    const hora = document.getElementById("ultimaActualizacion");
    const act = document.getElementById("btnActualizar");
    if (hora && act) {
      const poner = () => { const t = hora.textContent.trim(); act.title = t ? "Actualizar · " + t : "Actualizar"; };
      new MutationObserver(poner).observe(hora, { childList: true, characterData: true, subtree: true });
    }
  }


  /* ---------- Vista compacta / cómoda (computadora), en el menú del perfil ---------- */
  function iniciarDensidad() {
    const raiz = document.documentElement;
    const aplicar = (v) => raiz.classList.toggle("vista-comoda", v === "comoda");
    aplicar(leer("thotVista"));
    const menu = document.getElementById("chatMenuPerfil");
    if (!menu) return;
    const etiqueta = () => (raiz.classList.contains("vista-comoda")
      ? "Vista: cómoda <span class=\"nota\">cambiar a compacta</span>"
      : "Vista: compacta <span class=\"nota\">cambiar a cómoda</span>");
    new MutationObserver(() => {
      if (menu.hidden || menu.querySelector(".esc-vista")) return;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "mp-opcion esc-vista";
      b.innerHTML = etiqueta();
      menu.appendChild(b);
    }).observe(menu, { childList: true, attributes: true, attributeFilter: ["hidden"] });
    menu.addEventListener("click", (e) => {
      const b = e.target.closest(".esc-vista");
      if (!b) return;
      e.stopPropagation();
      const nueva = raiz.classList.contains("vista-comoda") ? "compacta" : "comoda";
      guardar("thotVista", nueva);
      aplicar(nueva);
      b.innerHTML = etiqueta();
    }, true);
  }


  /* ---------- Grupos desplegables del menú (Administración, y luego Ama de llaves) ---------- */
  function iniciarGrupos() {
    document.querySelectorAll(".menu-grupo").forEach((g) => {
      if (g.dataset.listo) return;
      g.dataset.listo = "1";
      const boton = g.querySelector(".menu-grupo-btn");
      const desp = g.querySelector(".menu-desp");
      const cuentaGrupo = boton.querySelector(".menu-cuenta");
      const abrir = (si) => { g.classList.toggle("abierto", si); boton.setAttribute("aria-expanded", si ? "true" : "false"); };
      boton.addEventListener("click", (e) => { e.stopPropagation(); abrir(!g.classList.contains("abierto")); });
      desp.addEventListener("click", (e) => { if (e.target.closest(".menu-btn")) abrir(false); });
      document.addEventListener("click", (e) => { if (!g.contains(e.target)) abrir(false); });
      document.addEventListener("keydown", (e) => { if (e.key === "Escape" && g.classList.contains("abierto")) { abrir(false); boton.focus(); } });
      // Se esconde si no tiene opciones visibles; muestra la suma de pendientes y si contiene la sección actual
      const revisar = () => {
        const visibles = [...desp.querySelectorAll(":scope > .menu-btn")].filter((b) => !b.hidden);
        g.hidden = !visibles.length;
        g.classList.toggle("contiene-actual", visibles.some((b) => b.getAttribute("aria-current") === "page"));
        if (cuentaGrupo) {
          const n = [...desp.querySelectorAll(".menu-cuenta")].filter((c) => !c.hidden)
            .reduce((t, c) => t + (parseInt(c.textContent, 10) || 0), 0);
          cuentaGrupo.hidden = !n;
          if (n) cuentaGrupo.textContent = String(n);
        }
      };
      new MutationObserver(revisar).observe(desp, { attributes: true, childList: true, subtree: true, characterData: true });
      revisar();
    });
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

  /* ---------- Reservas: columnas como pestañas ---------- */
  const NOMBRE_COL = { cotizacion: "Cotiz.", proceso: "Proceso", reserva: "Reserva", finalizado: "Final.", cancelado: "Cancel." };
  let colElegida = leer("mvColReservas") || "";

  function pestanasReservas() {
    const tablero = document.getElementById("tablero");
    if (!tablero) return;
    const cols = [...tablero.querySelectorAll(":scope > .columna")];
    let barra = document.getElementById("mvPestanasTablero");
    if (!cols.length) { if (barra) barra.hidden = true; return; }
    if (!barra) {
      barra = document.createElement("div");
      barra.id = "mvPestanasTablero";
      barra.className = "mv-pestanas-tablero";
      barra.setAttribute("role", "tablist");
      barra.setAttribute("aria-label", "Etapas de las reservas");
      tablero.parentNode.insertBefore(barra, tablero);
      barra.addEventListener("click", (e) => {
        const b = e.target.closest("button[data-col]");
        if (!b) return;
        colElegida = b.dataset.col;
        guardar("mvColReservas", colElegida);
        pestanasReservas();
      });
    }
    barra.hidden = false;
    const ids = cols.map((c) => (c.className.match(/col-([a-z]+)/) || [])[1] || "");
    if (!ids.includes(colElegida)) colElegida = ids[0];
    const firma = cols.map((c, i) => ids[i] + ":" + (c.querySelector(".col-cuenta")?.textContent || "")).join("|") + "|" + colElegida;
    if (barra.dataset.firma !== firma) {
      barra.dataset.firma = firma;
      barra.innerHTML = cols.map((c, i) => {
        const nombre = c.querySelector(".col-titulo span:first-child")?.textContent.trim() || ids[i];
        const cuenta = c.querySelector(".col-cuenta")?.textContent.trim() || "0";
        const on = ids[i] === colElegida;
        return `<button type="button" role="tab" class="col-${ids[i]}" data-col="${ids[i]}" aria-selected="${on}" aria-label="${nombre}: ${cuenta}">` +
          `<span class="mv-pt-nombre">${NOMBRE_COL[ids[i]] || nombre}</span><span class="mv-pt-cuenta">${cuenta}</span></button>`;
      }).join("");
    }
    cols.forEach((c, i) => c.classList.toggle("mv-col-oculta", ids[i] !== colElegida));
  }

  /* ---------- Horarios: un día a la vez ---------- */
  let diaElegido = "";
  const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "set", "oct", "nov", "dic"];

  function horarioPorDia(t) {
    const cab = t.tHead && t.tHead.rows[0];
    if (!cab) return;
    const dias = [...cab.cells].slice(1, -1); // sin "Colaborador" ni "Total"
    if (!dias.length) return;
    const claves = dias.map((th) => textoCelda(th));
    const ingresos = t.tHead.querySelector(".stf-ingresos");
    const conIngreso = dias.map((_, i) => {
      const c = ingresos && ingresos.cells[i + 1];
      if (!c) return false;
      const inp = c.querySelector("input");
      return Number(inp ? inp.value : textoCelda(c)) > 0;
    });

    if (!claves.includes(diaElegido)) {
      const hoy = new Date();
      const hoyTxt = hoy.getDate() + " " + MESES[hoy.getMonth()];
      const i = dias.findIndex((th) => {
        const s = (th.querySelector("small")?.textContent || "").toLowerCase().replace(/\./g, "");
        return s.startsWith(hoyTxt) || s === hoyTxt;
      });
      diaElegido = claves[i >= 0 ? i : 0];
    }
    const k = claves.indexOf(diaElegido);

    const caja = t.closest(".stf-tabla-caja") || t;
    let tira = caja.previousElementSibling;
    if (!tira || !tira.classList.contains("mv-dias")) {
      tira = document.createElement("div");
      tira.className = "mv-dias";
      tira.setAttribute("role", "tablist");
      tira.setAttribute("aria-label", "Días del horario");
      caja.parentNode.insertBefore(tira, caja);
      tira.addEventListener("click", (e) => {
        const b = e.target.closest("button[data-dia]");
        if (!b) return;
        diaElegido = b.dataset.dia;
        const tabla = tira.nextElementSibling && tira.nextElementSibling.querySelector("table.stf-tabla");
        if (tabla) horarioPorDia(tabla);
      });
    }
    tira.innerHTML = dias.map((th, i) => {
      const small = th.querySelector("small");
      const fecha = small ? small.textContent.trim() : "";
      const dia = textoCelda(th).replace(fecha, "").trim();
      const num = (fecha.match(/\d+/) || [""])[0];
      return `<button type="button" role="tab" data-dia="${claves[i].replace(/"/g, "&quot;")}" aria-selected="${i === k}" aria-label="${claves[i]}${conIngreso[i] ? ", con ingresos" : ""}"${th.classList.contains("dom") ? ' class="dom"' : ""}>` +
        `<span>${dia}</span><b>${num}</b><i${conIngreso[i] ? "" : " hidden"}></i></button>`;
    }).join("");

    // Muestra solo la columna del día elegido (más el nombre)
    [...t.rows].forEach((fila) => {
      const celdas = [...fila.cells];
      if (celdas.length === 1) return;
      celdas.forEach((c, i) => c.classList.toggle("mv-col-oculta", i !== 0 && i !== k + 1));
    });
    t.classList.add("mv-un-dia");
  }

  /* ---------- Tarifario final: servicios plegables ---------- */
  const abiertos = new Set();

  function tarifarioPlegable(t) {
    const filas = [...t.tBodies[0]?.rows || []];
    let grupo = null, lista = [];
    const cerrar = () => {
      if (!grupo) return;
      const clave = grupo.dataset.mvClave || textoCelda(grupo.cells[0]).slice(0, 80);
      const abierto = abiertos.has(clave);
      grupo.classList.add("mv-plegable");
      grupo.classList.toggle("mv-abierto", abierto);
      grupo.setAttribute("aria-expanded", abierto ? "true" : "false");
      grupo.dataset.mvClave = clave;
      lista.forEach((f) => f.classList.toggle("mv-plegada", !abierto));
      // Resumen: cuántas tarifas y el precio TC de la primera (la tarifa base)
      let base = "";
      for (const f of lista) {
        const celda = [...f.cells].find((c) => /^TC$/i.test(c.getAttribute("data-label") || ""));
        const txt = celda ? textoCelda(celda) : "";
        if (/\d/.test(txt)) { base = txt; break; }
      }
      let res = grupo.cells[0].querySelector(".mv-resumen");
      if (!res) { res = document.createElement("span"); res.className = "mv-resumen"; grupo.cells[0].appendChild(res); }
      res.textContent = lista.length + (lista.length === 1 ? " tarifa" : " tarifas") + (base ? " · TC " + base : "");
    };
    filas.forEach((f) => {
      if (f.classList.contains("fila-grupo")) { cerrar(); grupo = f; lista = []; }
      else if (grupo) lista.push(f);
    });
    cerrar();
    if (!t.dataset.mvPlegable) {
      t.dataset.mvPlegable = "1";
      t.addEventListener("click", (e) => {
        const g = e.target.closest("tr.mv-plegable");
        if (!g || e.target.closest("button, a, input, select") || !esCelular()) return;
        const clave = g.dataset.mvClave;
        abiertos.has(clave) ? abiertos.delete(clave) : abiertos.add(clave);
        tarifarioPlegable(t);
      });
    }
  }

  function esCelular() { return window.matchMedia("(max-width: 640px)").matches; }
  function leer(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function guardar(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* sin almacenamiento */ } }

  let pendiente = false;
  function revisarTablas() {
    if (pendiente) return;
    pendiente = true;
    requestAnimationFrame(() => {
      pendiente = false;
      pestanasReservas();
      document.querySelectorAll("table.stf-tabla").forEach((t) => {
        // Alto de la fila de días, para que "Ingresos previstos" quede fija justo debajo
        const fila1 = t.tHead && t.tHead.rows[0];
        if (fila1 && fila1.offsetHeight) t.style.setProperty("--stf-cab", fila1.offsetHeight + "px");
        if (!t.classList.contains("mv-un-dia") || !(t.closest(".stf-tabla-caja") || t).previousElementSibling?.classList.contains("mv-dias")) horarioPorDia(t);
      });
      document.querySelectorAll("table.tabla, table.part, table.participantes").forEach((t) => {
        // Se vuelve a preparar si su contenido cambió
        const firma = t.rows.length + ":" + (t.tHead ? t.tHead.textContent.length : 0);
        if (t.dataset.mvFirma === firma && t.dataset.mvListo) return;
        t.dataset.mvFirma = firma;
        prepararTabla(t);
        if (t.classList.contains("tar-final")) tarifarioPlegable(t);
      });
    });
  }

  function iniciar() {
    document.documentElement.classList.add("mv-activo");
    iconosBarra();
    iniciarGrupos();
    iniciarDensidad();
    iniciarMenu();
    revisarTablas();
    new MutationObserver(revisarTablas).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar);
  else iniciar();
})();
