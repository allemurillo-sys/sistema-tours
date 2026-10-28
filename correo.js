// =====================================================
// CORREO AL CLIENTE (Gmail): itinerario, preguntas y mensajes
// (usa las utilidades y datos de panel.js; el envío lo hace la función "correo" de Supabase)
// =====================================================

const correo = { estado: null, leidoEn: 0, redactando: null };   // redactando: { tipo, asunto, texto, pregunta, actividad_id }
const LOCALE_CORREO = { es: "es-CR", en: "en-US", fr: "fr-FR", de: "de-DE", it: "it-IT" };

// Textos del correo, en el idioma del cliente
const TEXTOS_CORREO = {
  es: {
    saludo: (n) => `Hola ${n}:`,
    cierre: (f) => `Saludos,\n${f}\nThe House of Tours`,
    itin_asunto: (c) => `Tu itinerario ${c.numero} | The House of Tours`,
    itin_intro_cot: "Te compartimos tu itinerario. En el botón de abajo puedes revisarlo completo y confirmarlo.",
    itin_intro_res: "Te compartimos tu itinerario. En el botón de abajo puedes ver todos los detalles, lo pagado y el saldo pendiente.",
    preg_asunto: (c) => `Una consulta sobre tu reserva ${c.numero}`,
    preg_intro: "Para coordinar tu servicio necesitamos un dato:",
    sobre: (s, f) => `Sobre ${s} (${f}):`,
    preg_cierre: "Puedes responder directamente en tu página con el botón de abajo.",
    msg_asunto: (c) => `Tu cotización ${c.numero} | The House of Tours`,
    por_confirmar: "horario por confirmar"
  },
  en: {
    saludo: (n) => `Hi ${n},`,
    cierre: (f) => `Best regards,\n${f}\nThe House of Tours`,
    itin_asunto: (c) => `Your itinerary ${c.numero} | The House of Tours`,
    itin_intro_cot: "Here is your itinerary. Use the button below to review it in full and confirm it.",
    itin_intro_res: "Here is your itinerary. Use the button below to see all the details, the amount paid and the balance due.",
    preg_asunto: (c) => `A question about your booking ${c.numero}`,
    preg_intro: "To arrange your service we need one detail:",
    sobre: (s, f) => `About ${s} (${f}):`,
    preg_cierre: "You can reply directly on your page using the button below.",
    msg_asunto: (c) => `Your quote ${c.numero} | The House of Tours`,
    por_confirmar: "time to be confirmed"
  },
  fr: {
    saludo: (n) => `Bonjour ${n},`,
    cierre: (f) => `Cordialement,\n${f}\nThe House of Tours`,
    itin_asunto: (c) => `Votre itinéraire ${c.numero} | The House of Tours`,
    itin_intro_cot: "Voici votre itinéraire. Le bouton ci-dessous vous permet de le consulter en entier et de le confirmer.",
    itin_intro_res: "Voici votre itinéraire. Le bouton ci-dessous vous permet de voir tous les détails, le montant payé et le solde restant.",
    preg_asunto: (c) => `Une question au sujet de votre réservation ${c.numero}`,
    preg_intro: "Pour organiser votre service, nous avons besoin d’une information :",
    sobre: (s, f) => `Au sujet de ${s} (${f}) :`,
    preg_cierre: "Vous pouvez répondre directement sur votre page avec le bouton ci-dessous.",
    msg_asunto: (c) => `Votre devis ${c.numero} | The House of Tours`,
    por_confirmar: "horaire à confirmer"
  },
  de: {
    saludo: (n) => `Hallo ${n},`,
    cierre: (f) => `Viele Grüße\n${f}\nThe House of Tours`,
    itin_asunto: (c) => `Ihr Reiseplan ${c.numero} | The House of Tours`,
    itin_intro_cot: "Hier ist Ihr Reiseplan. Über die Schaltfläche unten können Sie ihn vollständig ansehen und bestätigen.",
    itin_intro_res: "Hier ist Ihr Reiseplan. Über die Schaltfläche unten sehen Sie alle Details, den bezahlten Betrag und den offenen Betrag.",
    preg_asunto: (c) => `Eine Frage zu Ihrer Buchung ${c.numero}`,
    preg_intro: "Für die Organisation Ihrer Leistung benötigen wir eine Angabe:",
    sobre: (s, f) => `Zu ${s} (${f}):`,
    preg_cierre: "Sie können direkt auf Ihrer Seite über die Schaltfläche unten antworten.",
    msg_asunto: (c) => `Ihr Angebot ${c.numero} | The House of Tours`,
    por_confirmar: "Uhrzeit wird noch bestätigt"
  },
  it: {
    saludo: (n) => `Ciao ${n},`,
    cierre: (f) => `Cordiali saluti,\n${f}\nThe House of Tours`,
    itin_asunto: (c) => `Il tuo itinerario ${c.numero} | The House of Tours`,
    itin_intro_cot: "Ecco il tuo itinerario. Con il pulsante qui sotto puoi consultarlo per intero e confermarlo.",
    itin_intro_res: "Ecco il tuo itinerario. Con il pulsante qui sotto puoi vedere tutti i dettagli, l’importo pagato e il saldo da versare.",
    preg_asunto: (c) => `Una domanda sulla tua prenotazione ${c.numero}`,
    preg_intro: "Per organizzare il tuo servizio ci serve un’informazione:",
    sobre: (s, f) => `Riguardo a ${s} (${f}):`,
    preg_cierre: "Puoi rispondere direttamente sulla tua pagina con il pulsante qui sotto.",
    msg_asunto: (c) => `Il tuo preventivo ${c.numero} | The House of Tours`,
    por_confirmar: "orario da confermare"
  }
};
const textosCorreo = (c) => TEXTOS_CORREO[c.idioma] || TEXTOS_CORREO.es;
const fechaCliente = (c, f, op = { weekday: "long", day: "numeric", month: "long" }) => {
  const t = new Date(f.slice(0, 10) + "T12:00:00").toLocaleDateString(LOCALE_CORREO[c.idioma] || "es-CR", op);
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const servicioCliente = (c, id) => {
  const s = servicioPorId(id);
  return (c.idioma !== "es" && s?.traducciones?.[c.idioma]?.nombre) || s?.nombre || "";
};

// ---------- Estado de la cuenta de Gmail (se consulta cada 5 minutos como máximo) ----------
async function correoEstado(forzar = false) {
  if (!forzar && correo.estado && Date.now() - correo.leidoEn < 300000) return correo.estado;
  try {
    const { data, error } = await db.functions.invoke("correo", { body: { accion: "estado" } });
    if (error) throw error;
    correo.estado = data;
  } catch {
    correo.estado = { configurado: false, error: true };
  }
  correo.leidoEn = Date.now();
  return correo.estado;
}
document.addEventListener("detalle-abierto", () => correoEstado().then(() => { if (app.actual && $("secCorreo")) pintarDetalle(); }));

// ---------- Borradores ----------
function borradorCorreo(tipo, c, actividadId = null) {
  const tx = textosCorreo(c);
  const firma = app.yo?.nombre || "";
  const acts = [...app.actual.actividades].filter((a) => a.servicio_id).sort(ordenActividad);
  if (tipo === "itinerario") {
    const lineas = acts.map((a) => {
      const h = a.hora_inicio ? hora(a.hora_inicio) : tx.por_confirmar;
      const cod = a.codigo_reserva ? ` (${c.numero}-${a.codigo_reserva})` : "";
      return `• ${fechaCliente(c, a.fecha)} · ${h} · ${servicioCliente(c, a.servicio_id)}${cod}`;
    }).join("\n");
    return {
      tipo, asunto: tx.itin_asunto(c),
      texto: `${tx.saludo(c.nombre)}\n\n${c.estado === "proceso" ? tx.itin_intro_cot : tx.itin_intro_res}\n\n${lineas}\n\n${tx.cierre(firma)}`
    };
  }
  if (tipo === "pregunta") return { tipo, asunto: tx.preg_asunto(c), pregunta: "", actividad_id: actividadId };
  return { tipo, asunto: tx.msg_asunto(c), texto: `${tx.saludo(c.nombre)}\n\n\n\n${tx.cierre(firma)}` };
}

// El cuerpo de una pregunta se arma con la pregunta escrita por el agente
function cuerpoPregunta(c, r) {
  const tx = textosCorreo(c);
  const a = r.actividad_id ? app.actual.actividades.find((x) => x.id === Number(r.actividad_id)) : null;
  const sobre = a ? `${tx.sobre(servicioCliente(c, a.servicio_id), fechaCliente(c, a.fecha, { day: "numeric", month: "long" }))}\n` : "";
  return `${tx.saludo(c.nombre)}\n\n${tx.preg_intro}\n\n${sobre}${r.pregunta || "…"}\n\n${tx.preg_cierre}\n\n${tx.cierre(app.yo?.nombre || "")}`;
}

// ---------- Dibujo ----------
const NOMBRE_TIPO_CORREO = { itinerario: "Itinerario", pregunta: "Pregunta", mensaje: "Mensaje", respuesta: "Respuesta del cliente", aviso: "Aviso al agente" };

function htmlCorreo(c) {
  const est = correo.estado;
  const msgs = app.actual.mensajes || [];
  const r = correo.redactando;
  let cuerpo = "";

  if (!est) {
    cuerpo = `<p class="nota">Consultando la cuenta de correo…</p>`;
  } else if (!est.configurado) {
    cuerpo = `<p class="aviso">${est.error ? "No se pudo consultar la cuenta de correo." : "El correo todavía no está configurado."} ${app.yo?.rol === "administrador" ? "Configúralo en Mantenimiento › Correo." : "Pídele al administrador que lo configure en Mantenimiento › Correo."}</p>`;
  } else if (!c.correo) {
    cuerpo = `<p class="aviso">El cliente no tiene correo registrado. Agrégalo en Datos del cliente.</p>`;
  } else if (r) {
    const acts = [...app.actual.actividades].filter((a) => a.id && a.servicio_id).sort(ordenActividad);
    cuerpo = `
      <div class="correo-form">
        <p class="nota">Para: <strong>${escapar(c.correo)}</strong> · desde ${escapar(est.direccion)} · en ${NOMBRE_IDIOMA[c.idioma]?.toLowerCase() ?? "español"}${r.tipo !== "mensaje" ? " · incluye el botón al enlace del cliente" : ""}</p>
        <label>Asunto <input data-correo="asunto" value="${escapar(r.asunto)}"></label>
        ${r.tipo === "pregunta" ? `
          <label>Sobre la actividad (opcional)
            <select data-correo="actividad_id"><option value="">Pregunta general</option>
              ${acts.map((a) => `<option value="${a.id}" ${String(r.actividad_id) === String(a.id) ? "selected" : ""}>${fecha(a.fecha)} · ${escapar(servicioPorId(a.servicio_id)?.nombre ?? "")}</option>`).join("")}
            </select></label>
          <label>Pregunta (el cliente la ve en su página y responde ahí)
            <textarea data-correo="pregunta" rows="3" placeholder="Ej.: ¿Cuál es tu número de vuelo y la hora de llegada?">${escapar(r.pregunta)}</textarea></label>
          <p class="nota">Así se verá el correo:</p>
          <pre class="correo-vista">${escapar(cuerpoPregunta(c, r))}</pre>` : `
          <label>Mensaje <textarea data-correo="texto" rows="${r.tipo === "itinerario" ? 12 : 8}">${escapar(r.texto)}</textarea></label>`}
        ${!c.enviada_en && r.tipo !== "mensaje" ? `<p class="aviso">Para enviar el itinerario o una pregunta, primero prepara el enlace del cliente.</p>` : ""}
        <div class="sec-botones">
          <button type="button" class="btn primario" data-correo-accion="enviar" ${!c.enviada_en && r.tipo !== "mensaje" ? "disabled" : ""}>Enviar correo</button>
          <button type="button" class="btn" data-correo-accion="cancelar">Cancelar</button>
        </div>
      </div>`;
  } else {
    cuerpo = `
      <div class="sec-botones">
        <button type="button" class="btn" data-correo-accion="nuevo" data-tipo="itinerario">Enviar itinerario</button>
        <button type="button" class="btn" data-correo-accion="nuevo" data-tipo="pregunta">Hacer una pregunta</button>
        <button type="button" class="btn" data-correo-accion="nuevo" data-tipo="mensaje">Mensaje libre</button>
      </div>
      <p class="nota">Se envía desde ${escapar(est.direccion)}. Hoy: ${est.enviados_hoy} de ${est.limite} correos.</p>`;
  }

  // Historial: lo enviado, las preguntas y sus respuestas
  const respuestas = (id) => msgs.filter((m) => m.en_respuesta_a === id && m.tipo === "respuesta");
  const visibles = msgs.filter((m) => m.tipo !== "respuesta").slice().reverse();
  const historial = visibles.length ? `
    <ul class="correo-historial">${visibles.map((m) => {
      const resp = respuestas(m.id);
      const act = m.actividad_id ? app.actual.actividades.find((a) => a.id === m.actividad_id) : null;
      return `
        <li class="${m.estado === "error" ? "con-error" : ""}">
          <div><strong>${NOMBRE_TIPO_CORREO[m.tipo] ?? m.tipo}</strong> · ${fechaHora(m.creado_en)}${m.autor ? ` · ${escapar(nombrePerfil(m.autor))}` : ""}
            ${m.estado === "enviado" ? `<span class="act-confirmada">Enviado</span>` : m.estado === "error" ? `<span class="act-sin-tarifa">No se envió</span>` : `<span class="etiqueta">Enviando…</span>`}</div>
          <div class="nota">${escapar(m.asunto ?? "")}${m.para ? ` → ${escapar(m.para)}` : ""}</div>
          ${m.tipo === "pregunta" ? `<p class="cita">${act ? `<small>${escapar(servicioPorId(act.servicio_id)?.nombre ?? "")} · ${fecha(act.fecha)}</small>\n` : ""}${escapar(m.pregunta)}</p>
            ${resp.length ? resp.map((x) => `<p class="cita respuesta">↳ ${escapar(x.texto)}<br><small>Respondió el ${fechaHora(x.creado_en)}</small></p>`).join("") : m.estado === "enviado" ? `<p class="nota">Sin respuesta todavía.</p>` : ""}` : ""}
          ${m.estado === "error" ? `<p class="nota error-texto">${escapar(m.error ?? "")}</p>` : ""}
        </li>`;
    }).join("")}</ul>` : "";

  return `
    <section class="det-seccion" id="secCorreo">
      <h3>Correo al cliente</h3>
      ${cuerpo}
      ${historial}
    </section>`;
}

// ---------- Eventos ----------
$("detalleContenido").addEventListener("input", (e) => {
  const campo = e.target.dataset.correo;
  if (!campo || !correo.redactando) return;
  correo.redactando[campo] = e.target.value;
  if (correo.redactando.tipo === "pregunta" && (campo === "pregunta" || campo === "actividad_id")) {
    const vista = document.querySelector(".correo-vista");
    if (vista) vista.textContent = cuerpoPregunta(app.actual.cot, correo.redactando);
  }
});
$("detalleContenido").addEventListener("change", (e) => {
  if (e.target.dataset.correo === "actividad_id" && correo.redactando) {
    correo.redactando.actividad_id = e.target.value;
    const vista = document.querySelector(".correo-vista");
    if (vista) vista.textContent = cuerpoPregunta(app.actual.cot, correo.redactando);
  }
});

$("detalleContenido").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-correo-accion]");
  if (!btn) return;
  const c = app.actual.cot;
  switch (btn.dataset.correoAccion) {
    case "nuevo":
      if (hayPendientes()) return avisar("Guarda los cambios del itinerario antes de escribir al cliente.", "error");
      correo.redactando = borradorCorreo(btn.dataset.tipo, c);
      pintarDetalle();
      document.getElementById("secCorreo")?.scrollIntoView({ block: "start" });
      break;
    case "cancelar":
      correo.redactando = null;
      pintarDetalle();
      break;
    case "enviar": {
      const r = correo.redactando;
      const texto = r.tipo === "pregunta" ? cuerpoPregunta(c, r) : (r.texto || "").trim();
      if (!r.asunto?.trim()) return avisar("Escribe el asunto.", "error");
      if (r.tipo === "pregunta" && !r.pregunta?.trim()) return avisar("Escribe la pregunta.", "error");
      if (!texto) return avisar("Escribe el mensaje.", "error");
      await conBoton(btn, async () => {
        btn.textContent = "Enviando…";
        const { data, error } = await db.functions.invoke("correo", {
          body: {
            accion: "enviar", cotizacion_id: c.id, tipo: r.tipo, asunto: r.asunto.trim(), texto,
            pregunta: r.pregunta?.trim() || null, actividad_id: r.actividad_id ? Number(r.actividad_id) : null,
            enlace: c.enviada_en ? enlaceCliente(c) : ""
          }
        });
        let mensaje = data?.error;
        if (error && !mensaje) {
          try { mensaje = (await error.context.json())?.error; } catch { /* sin detalle */ }
        }
        if (error || data?.error) {
          avisar(mensaje || "No se pudo enviar el correo.", "error");
        } else {
          correo.redactando = null;
          avisar(`Correo enviado a ${c.correo}.`);
        }
        await correoEstado(true);
        await recargarDetalle(false);
        cargarTablero();
      });
      break;
    }
  }
});

// Al cambiar de cotización se descarta el borrador
document.addEventListener("detalle-cerrado", () => { correo.redactando = null; });
