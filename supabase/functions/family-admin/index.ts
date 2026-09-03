import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const APP_ORIGIN = "https://darki-hs.github.io";
const corsHeaders = {
  "Access-Control-Allow-Origin": APP_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: corsHeaders });
}

function getServiceKey() {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}") as Record<string, string>;
  return Object.values(keys).find(Boolean);
}

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey = getServiceKey();
if (!serviceKey) throw new Error("Supabase-Administratorschlüssel fehlt");

const admin = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Methode nicht erlaubt." }, 405);
  if (request.headers.get("origin") !== APP_ORIGIN) return json({ error: "Aufruf nicht erlaubt." }, 403);

  try {
    const accessToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!accessToken) return json({ error: "Bitte neu anmelden." }, 401);

    const { data: userData, error: userError } = await admin.auth.getUser(accessToken);
    const callerId = userData.user?.id;
    if (userError || !callerId) return json({ error: "Die Anmeldung ist nicht mehr gültig." }, 401);

    const body = await request.json() as { action?: string; profileId?: string; password?: string };
    if (body.action !== "reset_password") return json({ error: "Unbekannte Aktion." }, 400);
    if (!body.profileId || typeof body.password !== "string") return json({ error: "Angaben sind unvollständig." }, 400);
    if (body.password.length < 10 || body.password.length > 128) return json({ error: "Das Passwort muss 10 bis 128 Zeichen haben." }, 400);

    const [{ data: caller }, { data: target }] = await Promise.all([
      admin.from("profiles").select("id,family_id,role").eq("id", callerId).single(),
      admin.from("profiles").select("id,family_id,display_name,login_name").eq("id", body.profileId).single(),
    ]);
    if (!caller || caller.role !== "adult") return json({ error: "Nur Erwachsene dürfen Passwörter ändern." }, 403);
    if (!target || target.family_id !== caller.family_id) return json({ error: "Dieses Familienmitglied wurde nicht gefunden." }, 403);

    const loginEmail = `${target.login_name}@familienplaner.schuhmacher-jens.chatgpt.site`;
    const { error: updateError } = await admin.auth.admin.updateUserById(target.id, {
      password: body.password,
      email: loginEmail,
      email_confirm: true,
    });
    if (updateError) throw updateError;
    return json({ ok: true, profileId: target.id, displayName: target.display_name });
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Unbekannter Fehler");
    return json({ error: "Das Passwort konnte nicht geändert werden." }, 500);
  }
});
