// =====================================================
// Función de Supabase: gestionar-usuarios
// Crea usuarios y cambia claves. Solo la puede usar un administrador.
//
// Correo reutilizado (23 nov 2026): se puede crear un usuario con un correo
// que ya se usó, siempre que todos los usuarios que lo tenían estén INACTIVOS.
// La cuenta vieja conserva su historial (todo se liga por id); su acceso se
// renombra a un correo interno y se bloquea, y no se puede volver a activar.
// =====================================================
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const responder = (cuerpo: unknown, estado = 200) =>
  new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { ...cors, "Content-Type": "application/json" },
  });

// Roles del sistema unificado (Tours + Ama de llaves)
const ROLES = ["mucama", "supervisora", "ama_llaves", "operaciones", "administrador"];

// Correo interno para la cuenta vieja: nombre+cedido-<id corto>@dominio
const correoArchivado = (correo: string, id: string) => {
  const [local, dominio] = correo.split("@");
  return `${local}+cedido-${id.slice(0, 8)}-${Date.now().toString(36)}@${dominio}`;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: sesion, error: errorSesion } = await admin.auth.getUser(jwt);
    if (errorSesion || !sesion?.user) {
      return responder({ error: "Tu sesión no es válida. Sal del panel y vuelve a entrar." }, 401);
    }

    const { data: yo } = await admin.from("perfiles").select("rol, activo").eq("id", sesion.user.id).maybeSingle();
    if (!yo?.activo || yo.rol !== "administrador") {
      return responder({ error: "Solo un administrador puede gestionar usuarios." }, 403);
    }

    const cuerpo = await req.json();

    if (cuerpo.accion === "crear") {
      const correo = String(cuerpo.correo ?? "").trim().toLowerCase();
      const nombre = String(cuerpo.nombre ?? "").trim();
      const clave = String(cuerpo.clave ?? "");
      const rol = String(cuerpo.rol ?? "operaciones");

      if (!nombre || !correo) return responder({ error: "El nombre y el correo son obligatorios." }, 400);
      if (!/^[^\s@+]+(\+[^\s@]+)?@[^\s@]+\.[^\s@]+$/.test(correo)) return responder({ error: "El correo no es válido." }, 400);
      if (clave.length < 8) return responder({ error: "La clave debe tener al menos 8 caracteres." }, 400);
      if (!ROLES.includes(rol)) return responder({ error: "El tipo de usuario no es válido." }, 400);

      // ¿Quién tuvo este correo antes?
      const { data: anteriores, error: errorBusca } = await admin
        .from("perfiles").select("id, nombre, activo, correo_reasignado_a").ilike("correo", correo);
      if (errorBusca) return responder({ error: errorBusca.message }, 400);

      const activo = (anteriores ?? []).find((p) => p.activo);
      if (activo) {
        return responder({
          error: `Ese correo pertenece a ${activo.nombre}, que está activo. Para usarlo en un usuario nuevo, primero desactiva a ${activo.nombre}.`,
        }, 400);
      }

      // Libera el acceso de las cuentas inactivas que aún tienen este correo
      const liberados: { id: string; correo: string }[] = [];
      const revertir = async () => {
        for (const l of liberados) {
          await admin.auth.admin.updateUserById(l.id, { email: l.correo, ban_duration: "none" });
        }
      };
      for (const p of anteriores ?? []) {
        const { data: cuenta } = await admin.auth.admin.getUserById(p.id);
        const actual = cuenta?.user?.email?.toLowerCase();
        if (actual !== correo) continue; // ya se había liberado antes
        const { error } = await admin.auth.admin.updateUserById(p.id, {
          email: correoArchivado(correo, p.id),
          email_confirm: true,
          ban_duration: "876000h", // bloqueada: nunca más puede entrar
        });
        if (error) {
          await revertir();
          return responder({ error: `No se pudo liberar el correo de ${p.nombre}: ${error.message}` }, 400);
        }
        liberados.push({ id: p.id, correo });
      }

      const { data, error } = await admin.auth.admin.createUser({ email: correo, password: clave, email_confirm: true });
      if (error) {
        await revertir();
        const repetido = /already|registered|exists/i.test(error.message);
        return responder({ error: repetido ? "Ya existe un usuario con ese correo." : error.message }, 400);
      }

      const { error: errorPerfil } = await admin.from("perfiles").insert({ id: data.user.id, nombre, rol, correo });
      if (errorPerfil) {
        await admin.auth.admin.deleteUser(data.user.id);
        await revertir();
        return responder({ error: errorPerfil.message }, 400);
      }

      // Deja constancia en los perfiles anteriores (su historial sigue a su nombre)
      const pendientes = (anteriores ?? []).filter((p) => !p.correo_reasignado_a).map((p) => p.id);
      if (pendientes.length) {
        await admin.from("perfiles")
          .update({ correo_reasignado_a: data.user.id, correo_reasignado_en: new Date().toISOString(), activo: false })
          .in("id", pendientes);
      }

      return responder({ ok: true, reutilizado: (anteriores ?? []).map((p) => p.nombre) });
    }

    if (cuerpo.accion === "cambiar_clave") {
      const clave = String(cuerpo.clave ?? "");
      if (clave.length < 8) return responder({ error: "La clave debe tener al menos 8 caracteres." }, 400);
      const { data: p } = await admin.from("perfiles").select("correo_reasignado_a").eq("id", String(cuerpo.id)).maybeSingle();
      if (p?.correo_reasignado_a) return responder({ error: "Este usuario cedió su correo a otra persona; su acceso está cerrado." }, 400);
      const { error } = await admin.auth.admin.updateUserById(String(cuerpo.id), { password: clave });
      if (error) return responder({ error: error.message }, 400);
      return responder({ ok: true });
    }

    return responder({ error: "Acción no reconocida." }, 400);
  } catch (e) {
    return responder({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
