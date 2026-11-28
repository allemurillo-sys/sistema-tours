// =====================================================
// Función de Supabase: resolver-mapa
// Recibe un enlace de Google Maps (incluidos los cortos maps.app.goo.gl)
// y devuelve la latitud y longitud del punto, para ubicar la propiedad
// en Reservas › Mapa de propiedades.
// Solo la usan el Administrador y quien tenga el permiso «mapa_propiedades».
// Por seguridad solo abre direcciones de Google.
// =====================================================
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const responder = (cuerpo: unknown, estado = 200) =>
  new Response(JSON.stringify(cuerpo), { status: estado, headers: { ...cors, "Content-Type": "application/json" } });

// Solo dominios de Google Maps
const permitido = (u: URL) =>
  u.protocol === "https:" &&
  (/^(maps\.app\.goo\.gl|goo\.gl|g\.co)$/.test(u.hostname) ||
    /^((www|maps)\.)?google\.[a-z.]{2,6}$/.test(u.hostname));

// Busca coordenadas en un texto (enlace o página)
function coordenadas(texto: string): { lat: number; lng: number } | null {
  let t = texto;
  try { t = decodeURIComponent(texto.replace(/\+/g, " ")); } catch { /* texto con % sueltos */ }
  const patrones = [
    /!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/,          // punto exacto del lugar
    /[?&](?:q|query|ll|destination|center)=(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/,
    /@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/,              // centro de la vista
    /\/maps\/search\/(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/,
    /center=(-?\d{1,2}\.\d+)%2C(-?\d{1,3}\.\d+)/,
    /\[null,null,(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)\]/,
  ];
  for (const p of patrones) {
    const m = t.match(p) || texto.match(p);
    if (m) {
      const lat = Number(m[1]), lng = Number(m[2]);
      if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
    }
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const usuario = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
      auth: { persistSession: false },
    });
    const [{ data: admin }, { data: conPermiso }] = await Promise.all([
      usuario.rpc("es_admin"),
      usuario.rpc("tiene_permiso", { p: "mapa_propiedades" }).then((r) => r, () => ({ data: false })),
    ]);
    if (!admin && !conPermiso) return responder({ error: "Sin autorización para el mapa de propiedades." }, 403);

    const { enlace } = await req.json();
    let url: URL;
    try { url = new URL(String(enlace || "").trim()); } catch { return responder({ error: "El enlace no es válido." }, 400); }
    if (!permitido(url)) return responder({ error: "Solo se aceptan enlaces de Google Maps." }, 400);

    let punto = coordenadas(url.href);
    // Sigue las redirecciones (enlaces cortos) hasta 6 saltos
    for (let i = 0; !punto && i < 6; i++) {
      const r = await fetch(url.href, { redirect: "manual", headers: { "User-Agent": "Mozilla/5.0", "Accept-Language": "es" } });
      const destino = r.headers.get("location");
      if (destino) {
        const sig = new URL(destino, url);
        if (!permitido(sig)) break;
        url = sig;
        punto = coordenadas(url.href);
        await r.body?.cancel();
        continue;
      }
      if (r.ok) punto = coordenadas((await r.text()).slice(0, 2_000_000));
      else await r.body?.cancel();
      break;
    }
    return responder(punto ? { ...punto, final: url.href } : { lat: null, lng: null, final: url.href });
  } catch (e) {
    return responder({ error: String(e?.message ?? e) }, 500);
  }
});
