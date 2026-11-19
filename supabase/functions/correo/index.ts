// =====================================================
// Función de Supabase: correo
// Envía correos por Gmail (contraseña de aplicación, puerto seguro 465)
// y recibe las respuestas del cliente a las preguntas del agente.
//
// Acciones:
//   estado      (panel)          → cuenta configurada y correos enviados hoy
//   configurar  (administrador)  → dirección, nombre del remitente y contraseña de aplicación
//   probar      (administrador)  → correo de prueba al administrador
//   enviar      (panel)          → itinerario, pregunta o mensaje al cliente
//   responder   (cliente)        → respuesta a una pregunta, desde su página
//   solicitud_enviar   (panel)     → envía la solicitud P al proveedor por correo
//   solicitud_mensaje  (panel)     → mensaje del agente al proveedor (por correo o solo registro si es WhatsApp)
//   proveedor_responder (proveedor) → Confirmar / Revisar / Sin disponibilidad desde el enlace
//   proveedor_mensaje   (proveedor) → mensaje del proveedor desde el enlace
//   solicitud_aviso    (panel)     → confirmación final (con el R) o cancelación al proveedor por correo
//   proveedor_recibido (proveedor) → "Recibido" de una cancelación
// =====================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6.9.16";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const responder = (cuerpo: unknown, estado = 200) =>
  new Response(JSON.stringify(cuerpo), { status: estado, headers: { ...cors, "Content-Type": "application/json" } });

const LIMITE_DIARIO = 450; // Gmail permite unos 500 por día
const BOTON: Record<string, Record<string, string>> = {
  itinerario: { es: "Ver mi itinerario", en: "View my itinerary", fr: "Voir mon itinéraire", de: "Meinen Reiseplan ansehen", it: "Vedi il mio itinerario" },
  pregunta: { es: "Responder", en: "Reply", fr: "Répondre", de: "Antworten", it: "Rispondi" },
  mensaje: { es: "Ver mi cotización", en: "View my quote", fr: "Voir mon devis", de: "Mein Angebot ansehen", it: "Vedi il mio preventivo" },
};

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const escapar = (t: string) =>
  String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

// Correo sencillo: el texto tal cual (con saltos de línea) y un botón con el enlace
function html(texto: string, enlace?: string, boton?: string, pie?: string) {
  const parrafos = escapar(texto).split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px">${p.replace(/\n/g, "<br>")}</p>`).join("");
  return `<!doctype html><html><body style="margin:0;background:#f2f5f3;font-family:Arial,Helvetica,sans-serif;color:#1d2a24">
  <div style="max-width:600px;margin:0 auto;padding:24px 16px">
    <div style="background:#fff;border-radius:12px;padding:24px 22px;font-size:15px;line-height:1.55">
      ${parrafos}
      ${enlace ? `<p style="margin:22px 0 6px"><a href="${escapar(enlace)}" style="background:#2f7a55;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:bold;display:inline-block">${escapar(boton || "Abrir")}</a></p>` : ""}
    </div>
    ${pie ? `<p style="font-size:12px;color:#6b7a73;text-align:center;margin:14px 0 0">${escapar(pie)}</p>` : ""}
  </div></body></html>`;
}

async function cuenta() {
  const [{ data: conf }, { data: sec }] = await Promise.all([
    db.from("correo_config").select("direccion, nombre").eq("id", 1).maybeSingle(),
    db.from("correo_secreto").select("clave").eq("id", 1).maybeSingle(),
  ]);
  return { direccion: conf?.direccion || "", nombre: conf?.nombre || "The House of Tours", clave: sec?.clave || "" };
}

async function enviadosHoy() {
  const inicio = new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 10); // día en Costa Rica
  const desde = new Date(`${inicio}T06:00:00Z`).toISOString();
  const [{ count }, { count: prov }] = await Promise.all([
    db.from("mensajes").select("id", { count: "exact", head: true })
      .eq("direccion", "salida").eq("estado", "enviado").gte("creado_en", desde),
    db.from("solicitud_eventos").select("id", { count: "exact", head: true })
      .in("tipo", ["enviada", "mensaje_agente"]).eq("detalle->>medio", "correo").gte("creado_en", desde),
  ]);
  return (count ?? 0) + (prov ?? 0);
}

async function mandar(para: string, asunto: string, texto: string, htmlCuerpo: string, responderA?: string) {
  const c = await cuenta();
  if (!c.direccion || !c.clave) throw new Error("El correo no está configurado. Un administrador debe configurarlo en Mantenimiento › Correo.");
  if ((await enviadosHoy()) >= LIMITE_DIARIO) throw new Error(`Se alcanzó el límite de ${LIMITE_DIARIO} correos de hoy (Gmail permite unos 500 por día). Inténtalo mañana.`);
  const transporte = nodemailer.createTransport({
    host: "smtp.gmail.com", port: 465, secure: true,
    auth: { user: c.direccion, pass: c.clave.replace(/\s+/g, "") },
    connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 20000,
  });
  try {
    await transporte.sendMail({
      from: { name: c.nombre, address: c.direccion }, to: para, subject: asunto, text: texto, html: htmlCuerpo,
      replyTo: responderA || c.direccion,
    });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    if (/535|Username and Password not accepted|Invalid login/i.test(m)) {
      throw new Error("Gmail rechazó el usuario o la contraseña de aplicación. Revísalos en Mantenimiento › Correo (la contraseña de aplicación tiene 16 letras y requiere la verificación en dos pasos).");
    }
    throw new Error("Gmail no aceptó el envío: " + m);
  }
  return c;
}

async function usuario(req: Request) {
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const { data } = await db.auth.getUser(jwt);
  if (!data?.user) return null;
  const { data: perfil } = await db.from("perfiles").select("id, nombre, rol, activo, correo").eq("id", data.user.id).maybeSingle();
  return perfil?.activo ? perfil : null;
}

// ---------- Solicitudes al proveedor ----------
const fechaLarga = (f: string) => {
  if (!f) return "";
  const t = new Date(String(f).slice(0, 10) + "T12:00:00").toLocaleDateString("es-CR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const hora = (h: string) => (h ? String(h).slice(0, 5) : "");
const usd = (n: number) => "$" + (Number(n) || 0).toFixed(2);
const enlaceSolicitud = (base: string, s: { codigo: string; token: string }) =>
  `${base.replace(/[^/]*$/, "")}proveedor.html?p=${encodeURIComponent(s.codigo)}&t=${s.token}`;
function baseValida(base: string) {
  return /^https:\/\/[^\s]+$/.test(base) || /^http:\/\/(localhost|127\.0\.0\.1)/.test(base);
}

// Texto de la solicitud (correo en texto plano). Si el neto trae IVA incluido, se muestra el desglose.
function textoSolicitud(s: any, enlace: string, aviso?: string) {
  const c = s.contenido || {};
  const filas = (c.participantes || []).map((p: any) => `  - ${p.cantidad} ${p.categoria} × ${usd(p.neto)} = ${usd(p.subtotal)}` +
    (p.iva_pct ? `\n    (neto ${usd(p.neto_sin_iva)} + IVA ${p.iva_pct} % ${usd(p.iva)} por persona)` : "")).join("\n");
  const conIva = Number(c.total_iva) > 0;
  return [
    aviso ? aviso + "\n" : "",
    c.no_facturar ? "*** NO FACTURAR ***\n" : "",
    `Solicitud ${s.codigo}${s.version > 1 ? ` (versión ${s.version})` : ""} · Ref. ${c.codigo_reserva || c.cotizacion}`,
    `Titular: ${c.titular}`,
    `Servicio: ${c.servicio}`,
    `Fecha: ${fechaLarga(c.fecha)}${c.hora_inicio ? ` · Hora: ${hora(c.hora_inicio)}${c.hora_fin ? " a " + hora(c.hora_fin) : ""}` : ""}`,
    c.transporte && c.recogida ? `Pick up: ${c.recogida}${c.hora_recogida ? " · " + hora(c.hora_recogida) : ""}` : "",
    c.transporte && c.dejada ? `Drop off: ${c.dejada}` : "",
    `Participantes (tarifa neta por persona):\n${filas}`,
    Number(c.transporte_neto) ? `Transporte neto: ${usd(c.transporte_neto)}` : "",
    conIva ? `Total sin IVA: ${usd(c.total - c.total_iva)}\nIVA${c.iva_pct ? ` ${c.iva_pct} %` : ""}: ${usd(c.total_iva)}` : "",
    `TOTAL NETO${conIva ? " (IVA incluido)" : ""}: ${usd(c.total)}`,
    c.notas ? `Notas: ${c.notas}` : "",
    "",
    `Para confirmar, revisar o indicar que no hay disponibilidad, ingrese al enlace:\n${enlace}`,
  ].filter((x) => x !== "").join("\n");
}

// Correo HTML de la solicitud: tabla con los datos y el botón al enlace
// (el panel tiene una copia para la vista previa en proveedores.js: si cambias una, cambia la otra)
function htmlSolicitud(s: any, enlace: string, empresa: any, agente: any, aviso?: string) {
  const c = s.contenido || {};
  const fila = (k: string, v: string) => v ? `<tr><td style="padding:6px 10px;color:#6b7a73;white-space:nowrap;vertical-align:top">${escapar(k)}</td><td style="padding:6px 10px;font-weight:bold">${escapar(v)}</td></tr>` : "";
  const ivaTxt = (sin: number, iva: number, pct: any) => pct ? `<div style="font-size:11px;color:#6b7a73">${usd(sin)} + IVA${pct === true ? "" : " " + pct + " %"} ${usd(iva)}</div>` : "";
  const part = (c.participantes || []).map((p: any) => `<tr><td style="padding:5px 10px">${escapar(String(p.cantidad))} ${escapar(p.categoria)}</td><td style="padding:5px 10px;text-align:right">${usd(p.neto)}${ivaTxt(p.neto_sin_iva, p.iva, p.iva_pct)}</td><td style="padding:5px 10px;text-align:right">${usd(p.subtotal)}${ivaTxt(p.subtotal_sin_iva, p.subtotal_iva, p.iva_pct && true)}</td></tr>`).join("");
  const conIva = Number(c.total_iva) > 0;
  const filasIva = conIva ? `<tr style="color:#6b7a73"><td style="padding:4px 10px">Total sin IVA</td><td></td><td style="padding:4px 10px;text-align:right">${usd(c.total - c.total_iva)}</td></tr>
      <tr style="color:#6b7a73"><td style="padding:4px 10px">IVA${c.iva_pct ? " " + c.iva_pct + " %" : ""}</td><td></td><td style="padding:4px 10px;text-align:right">${usd(c.total_iva)}</td></tr>` : "";
  const marca = empresa?.logo
    ? `<img src="${escapar(empresa.logo)}" alt="${escapar(empresa?.nombre_legal || "The House of Tours")}" style="max-height:48px;max-width:180px">`
    : `<strong style="font-size:18px;color:#1f5a3e">The House of Tours</strong>`;
  const pie = [empresa?.nombre_legal, empresa?.cedula && `Céd. ${empresa.cedula}`, empresa?.direccion, empresa?.movil, empresa?.correo].filter(Boolean).map(escapar).join(" · ");
  return `<!doctype html><html><body style="margin:0;background:#f2f5f3;font-family:Arial,Helvetica,sans-serif;color:#1d2a24">
  <div style="max-width:640px;margin:0 auto;padding:24px 16px">
   <div style="background:#fff;border-radius:12px;padding:22px">
    <table width="100%" style="border-bottom:2px solid #2f7a55;margin-bottom:14px"><tr><td>${marca}</td>
      <td style="text-align:right"><div style="font-size:12px;color:#6b7a73;text-transform:uppercase">Solicitud de servicio</div>
      <div style="font-size:22px;font-weight:bold">${escapar(s.codigo)}</div>
      <div style="font-size:12px;color:#6b7a73">Ref. ${escapar(c.codigo_reserva || c.cotizacion || "")}${s.version > 1 ? ` · versión ${s.version}` : ""}</div></td></tr></table>
    ${aviso ? `<p style="background:#fcebdd;color:#8a3b12;padding:10px 12px;border-radius:8px;font-weight:bold">${escapar(aviso)}</p>` : ""}
    ${c.no_facturar ? `<p style="background:#b3261e;color:#fff;padding:10px 12px;border-radius:8px;font-weight:bold;font-size:17px;text-align:center;letter-spacing:1px">*** NO FACTURAR ***</p>` : ""}
    <table style="border-collapse:collapse;font-size:15px">
      ${fila("Servicio", c.servicio)}${fila("Titular", c.titular)}
      ${fila("Fecha", fechaLarga(c.fecha))}
      ${fila("Hora", c.hora_inicio ? hora(c.hora_inicio) + (c.hora_fin ? " a " + hora(c.hora_fin) : "") : "Por confirmar")}
      ${c.transporte ? fila("Pick up", c.recogida ? `${c.recogida}${c.hora_recogida ? " · " + hora(c.hora_recogida) : ""}` : "") : ""}
      ${c.transporte ? fila("Drop off", c.dejada || "") : ""}
    </table>
    <table width="100%" style="border-collapse:collapse;font-size:14px;margin-top:12px;border-top:1px solid #dfe6e2">
      <tr style="color:#6b7a73;font-size:12px"><td style="padding:6px 10px">Participantes</td><td style="padding:6px 10px;text-align:right">Neto por persona</td><td style="padding:6px 10px;text-align:right">Subtotal</td></tr>
      ${part}
      ${Number(c.transporte_neto) ? `<tr><td style="padding:5px 10px">Transporte</td><td></td><td style="padding:5px 10px;text-align:right">${usd(c.transporte_neto)}</td></tr>` : ""}
      ${filasIva}
      <tr style="border-top:2px solid #1d2a24"><td style="padding:8px 10px;font-weight:bold">TOTAL NETO${conIva ? " (IVA incluido)" : ""}</td><td></td><td style="padding:8px 10px;text-align:right;font-weight:bold;font-size:17px">${usd(c.total)}</td></tr>
    </table>
    ${c.notas ? `<p style="margin:14px 0 0"><strong>Notas:</strong> ${escapar(c.notas)}</p>` : ""}
    <p style="margin:20px 0 6px">Para <strong>confirmar</strong>, <strong>revisar</strong> o indicar que <strong>no hay disponibilidad</strong>, ingrese al enlace:</p>
    <p style="margin:0 0 6px"><a href="${escapar(enlace)}" style="background:#2f7a55;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:bold;display:inline-block">Responder solicitud</a></p>
    ${agente?.nombre ? `<p style="font-size:13px;color:#6b7a73;margin-top:16px">Agente: ${escapar(agente.nombre)}${agente.correo ? " · " + escapar(agente.correo) : ""}</p>` : ""}
   </div>
   ${pie ? `<p style="font-size:12px;color:#6b7a73;text-align:center;margin:14px 0 0">${pie}</p>` : ""}
  </div></body></html>`;
}

const NOMBRE_RESPUESTA: Record<string, string> = { confirmar: "Confirmar", revisar: "Revisar", sin_disponibilidad: "Sin disponibilidad" };

// Aviso al agente cuando el proveedor responde o escribe (si falla el correo, todo lo demás ya quedó guardado)
async function avisarAgente(solicitudId: number, asunto: string, txt: string) {
  try {
    const { data: s } = await db.from("solicitudes_proveedor").select("cotizacion_id, enviada_por, creado_por").eq("id", solicitudId).maybeSingle();
    if (!s) return;
    const { data: cot } = await db.from("cotizaciones").select("colaborador_id").eq("id", s.cotizacion_id).maybeSingle();
    const agenteId = s.enviada_por || cot?.colaborador_id || s.creado_por;
    const { data: agente } = agenteId ? await db.from("perfiles").select("correo").eq("id", agenteId).maybeSingle() : { data: null };
    const c = await cuenta();
    const para = agente?.correo || c.direccion;
    if (!para || !c.clave) return;
    await mandar(para, asunto, txt, html(txt, undefined, undefined, "Aviso automático de THOT Sistema"));
    await db.from("mensajes").insert({ cotizacion_id: s.cotizacion_id, direccion: "salida", tipo: "aviso", para, asunto, texto: txt, estado: "enviado" });
  } catch (_) { /* sin aviso */ }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const cuerpo = await req.json().catch(() => ({}));
    const accion = String(cuerpo.accion ?? "");

    // ---------- Respuesta del cliente (sin sesión: se valida con número y token) ----------
    if (accion === "responder") {
      const texto = String(cuerpo.texto ?? "").trim();
      if (!texto || texto.length > 2000) return responder({ error: "Escribe tu respuesta (máximo 2000 caracteres)." }, 400);
      const { data: cot } = await db.from("cotizaciones").select("id, numero, nombre, apellido, colaborador_id, estado")
        .eq("numero", String(cuerpo.numero ?? "")).eq("token", String(cuerpo.token ?? "")).not("enviada_en", "is", null).maybeSingle();
      if (!cot || cot.estado === "cancelado") return responder({ error: "No encontramos la cotización." }, 404);
      const { data: preg } = await db.from("mensajes").select("id, pregunta, actividad_id, autor")
        .eq("id", Number(cuerpo.mensaje_id)).eq("cotizacion_id", cot.id).eq("tipo", "pregunta").maybeSingle();
      if (!preg) return responder({ error: "No encontramos la pregunta." }, 404);

      const { error } = await db.from("mensajes").insert({
        cotizacion_id: cot.id, actividad_id: preg.actividad_id, direccion: "entrada", tipo: "respuesta",
        texto, en_respuesta_a: preg.id, estado: "recibido",
      });
      if (error) throw error;
      await db.from("mensajes").update({ respondida_en: new Date().toISOString() }).eq("id", preg.id);
      await db.from("bitacora").insert({ cotizacion_id: cot.id, accion: "respuesta del cliente", detalle: `${preg.pregunta}\n→ ${texto}` });
      await db.from("cotizaciones").update({ cambios_pendientes: true }).eq("id", cot.id);

      // Aviso por correo al agente que atiende (si falla, la respuesta igual queda guardada)
      try {
        const agenteId = cot.colaborador_id || preg.autor;
        const { data: agente } = agenteId
          ? await db.from("perfiles").select("correo, nombre").eq("id", agenteId).maybeSingle() : { data: null };
        const c = await cuenta();
        const para = agente?.correo || c.direccion;
        if (para && c.clave) {
          const asunto = `Respuesta del cliente · ${cot.numero} · ${cot.nombre} ${cot.apellido}`;
          const txt = `${cot.nombre} ${cot.apellido} respondió en su página (${cot.numero}).\n\nPregunta: ${preg.pregunta}\n\nRespuesta: ${texto}\n\nLa cotización quedó marcada con cambios del cliente en el panel.`;
          await mandar(para, asunto, txt, html(txt, undefined, undefined, "Aviso automático de THOT Sistema"));
          await db.from("mensajes").insert({ cotizacion_id: cot.id, direccion: "salida", tipo: "aviso", para, asunto, texto: txt, estado: "enviado" });
        }
      } catch (_) { /* sin aviso */ }
      return responder({ ok: true });
    }

    // ---------- Respuesta del proveedor desde el enlace (sin sesión: se valida con código y token) ----------
    if (accion === "proveedor_responder") {
      const { data: r, error } = await db.rpc("responder_solicitud_proveedor", {
        p_codigo: String(cuerpo.codigo ?? ""), p_token: String(cuerpo.token ?? ""), p_respuesta: String(cuerpo.respuesta ?? ""),
        p_nombre: String(cuerpo.nombre ?? "").slice(0, 120), p_numero: String(cuerpo.numero ?? "").slice(0, 80) || null,
        p_nota: String(cuerpo.nota ?? "").slice(0, 2000) || null,
      });
      if (error) return responder({ error: error.message }, 400);
      const { data: s } = await db.from("solicitudes_proveedor").select("codigo, contenido, respuesta_nombre, respuesta_nota, respuesta_numero").eq("id", r.id).maybeSingle();
      const urgente = r.alerta === "urgente";
      const asunto = `${urgente ? "URGENTE · " : ""}Respuesta del proveedor · ${r.codigo} · ${NOMBRE_RESPUESTA[String(cuerpo.respuesta)]}`;
      const txt = `${urgente ? "ATENCIÓN: el proveedor indica que la respuesta registrada por chat NO es correcta.\n\n" : r.verificacion ? "El proveedor verificó en el enlace la confirmación registrada por chat.\n\n" : ""}` +
        `Solicitud ${r.codigo} · ${s?.contenido?.servicio ?? ""} · ${fechaLarga(s?.contenido?.fecha)}\nReferencia: ${s?.contenido?.codigo_reserva || s?.contenido?.cotizacion}\n\n` +
        `Respuesta: ${NOMBRE_RESPUESTA[String(cuerpo.respuesta)]}\nResponde: ${s?.respuesta_nombre ?? ""}` +
        `${s?.respuesta_numero ? `\nN.º de confirmación: ${s.respuesta_numero}` : ""}${s?.respuesta_nota ? `\nNota: ${s.respuesta_nota}` : ""}` +
        `\n\nLa reserva quedó marcada en el panel.`;
      await avisarAgente(r.id, asunto, txt);
      return responder({ ok: true });
    }

    if (accion === "proveedor_recibido") {
      const { data: r, error } = await db.rpc("recibir_cancelacion_proveedor", {
        p_codigo: String(cuerpo.codigo ?? ""), p_token: String(cuerpo.token ?? ""), p_nombre: String(cuerpo.nombre ?? "").slice(0, 120),
      });
      if (error) return responder({ error: error.message }, 400);
      await avisarAgente(r.id, `Cancelación recibida · ${r.codigo}`, `El proveedor confirmó que recibió la cancelación de la solicitud ${r.codigo} (${String(cuerpo.nombre ?? "")}).`);
      return responder({ ok: true });
    }

    if (accion === "proveedor_mensaje") {
      const texto = String(cuerpo.texto ?? "").trim();
      const nombre = String(cuerpo.nombre ?? "").trim().slice(0, 120);
      if (!texto || texto.length > 2000) return responder({ error: "Escriba el mensaje (máximo 2000 caracteres)." }, 400);
      if (!nombre) return responder({ error: "Escriba su nombre." }, 400);
      const { data: s } = await db.from("solicitudes_proveedor").select("id, codigo, cotizacion_id, estado, contenido")
        .eq("codigo", String(cuerpo.codigo ?? "")).eq("token", String(cuerpo.token ?? "")).maybeSingle();
      if (!s || s.estado === "borrador") return responder({ error: "No encontramos la solicitud." }, 404);
      const { error } = await db.from("solicitud_eventos").insert({ solicitud_id: s.id, tipo: "mensaje_proveedor", texto, nombre });
      if (error) throw error;
      const { data: cot } = await db.from("cotizaciones").select("alerta_proveedor").eq("id", s.cotizacion_id).maybeSingle();
      if (cot?.alerta_proveedor !== "urgente") await db.from("cotizaciones").update({ alerta_proveedor: "respuesta" }).eq("id", s.cotizacion_id);
      await db.from("bitacora").insert({ cotizacion_id: s.cotizacion_id, accion: "mensaje del proveedor", detalle: `${s.codigo} · ${nombre}: ${texto}` });
      await avisarAgente(s.id, `Mensaje del proveedor · ${s.codigo}`, `${nombre} escribió sobre la solicitud ${s.codigo} (${s.contenido?.servicio ?? ""}):\n\n${texto}`);
      return responder({ ok: true });
    }

    // ---------- Acciones del panel (requieren sesión) ----------
    const yo = await usuario(req);
    if (!yo) return responder({ error: "Tu sesión no es válida. Sal del panel y vuelve a entrar." }, 401);
    const esAdmin = yo.rol === "administrador";

    if (accion === "estado") {
      const c = await cuenta();
      return responder({ configurado: !!(c.direccion && c.clave), direccion: c.direccion, nombre: c.nombre, enviados_hoy: await enviadosHoy(), limite: LIMITE_DIARIO });
    }

    if (accion === "configurar") {
      if (!esAdmin) return responder({ error: "Solo un administrador puede configurar el correo." }, 403);
      const direccion = String(cuerpo.direccion ?? "").trim().toLowerCase();
      const nombre = String(cuerpo.nombre ?? "").trim() || "The House of Tours";
      const clave = String(cuerpo.clave ?? "").replace(/\s+/g, "");
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(direccion)) return responder({ error: "Revisa la dirección de correo." }, 400);
      if (clave && clave.length !== 16) return responder({ error: "La contraseña de aplicación de Google tiene 16 letras (sin contar los espacios)." }, 400);
      const { error } = await db.from("correo_config").upsert({ id: 1, direccion, nombre, actualizado: new Date().toISOString(), actualizado_por: yo.id });
      if (error) throw error;
      if (clave) {
        const r = await db.from("correo_secreto").upsert({ id: 1, clave });
        if (r.error) throw r.error;
      }
      return responder({ ok: true });
    }

    if (accion === "probar") {
      if (!esAdmin) return responder({ error: "Solo un administrador puede enviar la prueba." }, 403);
      const c = await cuenta();
      const para = String(cuerpo.para ?? "").trim() || yo.correo || c.direccion;
      const txt = `Hola ${yo.nombre}:\n\nEste es un correo de prueba de THOT Sistema. Si lo recibiste, el envío por Gmail (${c.direccion}) funciona correctamente.`;
      await mandar(para, "Prueba de correo · THOT Sistema", txt, html(txt));
      return responder({ ok: true, para });
    }

    if (accion === "enviar") {
      const tipo = String(cuerpo.tipo ?? "");
      if (!["itinerario", "pregunta", "mensaje"].includes(tipo)) return responder({ error: "Tipo de correo no válido." }, 400);
      const asunto = String(cuerpo.asunto ?? "").trim();
      const texto = String(cuerpo.texto ?? "").trim();
      const pregunta = String(cuerpo.pregunta ?? "").trim();
      const enlace = String(cuerpo.enlace ?? "").trim();
      if (!asunto || !texto) return responder({ error: "Escribe el asunto y el mensaje." }, 400);
      if (tipo === "pregunta" && !pregunta) return responder({ error: "Escribe la pregunta." }, 400);

      const { data: cot } = await db.from("cotizaciones").select("id, numero, token, correo, idioma, estado, enviada_en")
        .eq("id", Number(cuerpo.cotizacion_id)).maybeSingle();
      if (!cot) return responder({ error: "No se encontró la cotización." }, 404);
      if (!cot.correo) return responder({ error: "El cliente no tiene correo registrado." }, 400);
      if (enlace && !(enlace.includes(encodeURIComponent(cot.numero)) || enlace.includes(cot.numero)) ) return responder({ error: "El enlace no corresponde a esta cotización." }, 400);
      if (tipo !== "mensaje" && !cot.enviada_en) return responder({ error: "Primero activa el enlace del cliente (Preparar para el cliente)." }, 400);

      const actividad = cuerpo.actividad_id ? Number(cuerpo.actividad_id) : null;
      const { data: fila, error } = await db.from("mensajes").insert({
        cotizacion_id: cot.id, actividad_id: actividad, direccion: "salida", tipo, para: cot.correo,
        asunto, texto, pregunta: tipo === "pregunta" ? pregunta : null, autor: yo.id, estado: "pendiente",
      }).select("id").single();
      if (error) throw error;

      const enlaceFinal = enlace ? enlace + (tipo === "pregunta" ? "#preguntas" : "") : "";
      const boton = (BOTON[tipo] || BOTON.mensaje)[cot.idioma] || BOTON[tipo].es;
      try {
        const c = await mandar(cot.correo, asunto, enlaceFinal ? `${texto}\n\n${enlaceFinal}` : texto, html(texto, enlaceFinal || undefined, boton, "The House of Tours"));
        await db.from("mensajes").update({ estado: "enviado" }).eq("id", fila.id);
        const nombreTipo = { itinerario: "itinerario enviado", pregunta: "pregunta enviada", mensaje: "mensaje enviado" }[tipo];
        await db.from("bitacora").insert({ cotizacion_id: cot.id, accion: `correo: ${nombreTipo}`, detalle: `${asunto} → ${cot.correo}${tipo === "pregunta" ? `\n${pregunta}` : ""}`, usuario_id: yo.id });
        return responder({ ok: true, id: fila.id, desde: c.direccion });
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        await db.from("mensajes").update({ estado: "error", error: m }).eq("id", fila.id);
        return responder({ error: m }, 502);
      }
    }

    if (accion === "solicitud_enviar" || accion === "solicitud_mensaje" || accion === "solicitud_aviso") {
      const base = String(cuerpo.enlace_base ?? "").trim();
      if (!baseValida(base)) return responder({ error: "No se pudo armar el enlace del proveedor." }, 400);
      const { data: s } = await db.from("solicitudes_proveedor").select("*").eq("id", Number(cuerpo.solicitud_id)).maybeSingle();
      if (!s) return responder({ error: "No se encontró la solicitud." }, 404);
      const { data: op } = await db.from("tar_operadores").select("nombre, correo_reservas").eq("operador_id", s.operador_id).limit(1).maybeSingle();
      const { data: empresa } = await db.from("empresa").select("*").eq("id", 1).maybeSingle();
      const enlace = enlaceSolicitud(base, s);

      // Confirmación final (con el código del cliente) o cancelación, por correo
      if (accion === "solicitud_aviso") {
        if (!["confirmacion_final", "cancelacion"].includes(s.aviso)) return responder({ error: "Esta solicitud no tiene ese aviso pendiente." }, 400);
        if (!op?.correo_reservas) return responder({ error: "El proveedor no tiene correo para reservas. Agrégalo en Tarifario › Operadores o usa WhatsApp." }, 400);
        const c = s.contenido || {};
        const detalle = `${c.servicio} · ${fechaLarga(c.fecha)}${c.hora_inicio ? " · " + hora(c.hora_inicio) : ""} · Titular: ${c.titular}`;
        let asunto: string, txt: string, boton: string;
        if (s.aviso === "confirmacion_final") {
          const chat = s.respuesta_origen === "agente"
            ? `\n\nRegistramos su confirmación por chat (${s.respuesta_nombre}, ${fechaLarga(s.respuesta_en)}). Puede verla y verificarla en el enlace.` : "";
          asunto = `CONFIRMADA · ${s.codigo} · Código del cliente ${c.codigo_reserva}`;
          txt = `Reserva CONFIRMADA\n\nSolicitud ${s.codigo} · ${detalle}\nCódigo del cliente: ${c.codigo_reserva}\n\nEl cliente presentará este código en su voucher.${chat}\n\n${yo.nombre}\nThe House of Tours`;
          boton = "Ver solicitud";
        } else {
          asunto = `CANCELACIÓN · ${s.codigo} · ${c.servicio} · ${fechaLarga(c.fecha)}`;
          txt = `CANCELACIÓN de la solicitud ${s.codigo}\n\n${detalle}\n\nPor favor confirme que la recibió con el botón "Recibido" del enlace.\n\n${yo.nombre}\nThe House of Tours`;
          boton = "Abrir y marcar Recibido";
        }
        await mandar(op.correo_reservas, asunto, `${txt}\n\n${enlace}`, html(txt, enlace, boton, empresa?.nombre_legal || "The House of Tours"));
        const final = s.aviso === "confirmacion_final";
        await db.from("solicitudes_proveedor").update({ aviso: null, aviso_desde: null, ...(final ? { confirmacion_final_en: new Date().toISOString() } : {}) }).eq("id", s.id);
        await db.from("solicitud_eventos").insert({ solicitud_id: s.id, tipo: final ? "confirmacion_final" : "aviso_marcado", autor: yo.id, detalle: { aviso: s.aviso, medio: "correo", para: op.correo_reservas } });
        await db.from("bitacora").insert({ cotizacion_id: s.cotizacion_id, accion: final ? "confirmación final enviada al proveedor" : "cancelación avisada al proveedor",
          detalle: `${s.codigo} por correo a ${op.correo_reservas}`, usuario_id: yo.id });
        return responder({ ok: true, para: op.correo_reservas });
      }

      if (accion === "solicitud_mensaje") {
        const texto = String(cuerpo.texto ?? "").trim();
        const medio = cuerpo.medio === "whatsapp" ? "whatsapp" : "correo";
        if (!texto || texto.length > 2000) return responder({ error: "Escribe el mensaje (máximo 2000 caracteres)." }, 400);
        if (s.estado === "borrador") return responder({ error: "Primero envía la solicitud." }, 400);
        if (medio === "correo") {
          if (!op?.correo_reservas) return responder({ error: "El proveedor no tiene correo para reservas. Agrégalo en Tarifario › Operadores o usa WhatsApp." }, 400);
          const txt = `Mensaje sobre la solicitud ${s.codigo} (${s.contenido?.servicio ?? ""}, ${fechaLarga(s.contenido?.fecha)}):\n\n${texto}\n\nPuede responder aquí: ${enlace}\n\n${yo.nombre}\nThe House of Tours`;
          await mandar(op.correo_reservas, `Mensaje sobre ${s.codigo} · The House of Tours`, txt,
            html(`Mensaje sobre la solicitud ${s.codigo} (${s.contenido?.servicio ?? ""}, ${fechaLarga(s.contenido?.fecha)}):\n\n${texto}\n\n${yo.nombre}\nThe House of Tours`, enlace, "Ver solicitud y responder", empresa?.nombre_legal || "The House of Tours"));
        }
        const { error } = await db.from("solicitud_eventos").insert({ solicitud_id: s.id, tipo: "mensaje_agente", texto, autor: yo.id, detalle: { medio } });
        if (error) throw error;
        await db.from("bitacora").insert({ cotizacion_id: s.cotizacion_id, accion: "mensaje al proveedor", detalle: `${s.codigo} por ${medio === "correo" ? "correo" : "WhatsApp"}: ${texto}`, usuario_id: yo.id });
        return responder({ ok: true, enlace });
      }

      // Enviar la solicitud por correo
      if (!["borrador", "enviada"].includes(s.estado)) return responder({ error: "Esta solicitud ya tiene respuesta." }, 400);
      if (!op?.correo_reservas) return responder({ error: "El proveedor no tiene correo para reservas. Agrégalo en Tarifario › Operadores o envíala por WhatsApp." }, 400);
      let contenido = s.contenido;
      if (s.estado === "borrador" && s.actividad_id) {
        const { data: nuevo, error } = await db.rpc("solicitud_contenido", { p_actividad: s.actividad_id });
        if (error) throw error;
        if (nuevo) contenido = nuevo;
      }
      const sol = { ...s, contenido };
      const { data: agente } = await db.from("perfiles").select("nombre, correo").eq("id", yo.id).maybeSingle();
      const modif = s.aviso === "modificacion";
      const avisoTxt = modif ? `MODIFICACIÓN (versión ${s.version}): hubo cambios en esta solicitud. Por favor revise y confirme de nuevo.` : undefined;
      const asunto = `${modif ? "MODIFICACIÓN · " : ""}Solicitud de servicio ${s.codigo}${s.version > 1 ? ` (versión ${s.version})` : ""} · ${contenido.servicio} · ${fechaLarga(contenido.fecha)}`;
      await mandar(op.correo_reservas, asunto, textoSolicitud(sol, enlace, avisoTxt), htmlSolicitud(sol, enlace, empresa, agente, avisoTxt));
      await db.from("solicitudes_proveedor").update({ contenido, estado: "enviada", medio: "correo", enviada_en: new Date().toISOString(), enviada_por: yo.id, ...(modif ? { aviso: null, aviso_desde: null } : {}) }).eq("id", s.id);
      await db.from("solicitud_eventos").insert({ solicitud_id: s.id, tipo: "enviada", autor: yo.id, detalle: { medio: "correo", version: s.version, para: op.correo_reservas, modificacion: modif } });
      await db.from("bitacora").insert({ cotizacion_id: s.cotizacion_id, accion: "solicitud al proveedor enviada",
        detalle: `${s.codigo} por correo a ${op.correo_reservas}${s.version > 1 ? ` (versión ${s.version})` : ""}`, usuario_id: yo.id });
      return responder({ ok: true, para: op.correo_reservas, enlace });
    }

    return responder({ error: "Acción no reconocida." }, 400);
  } catch (e) {
    return responder({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
