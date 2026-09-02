import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import webpush from "npm:web-push@3.6.7";

type SubscriptionRow = {
  endpoint: string;
  p256dh: string;
  auth: string;
  profile_id: string;
};

type PushPayload = {
  title: string;
  body: string;
  tag: string;
  url: string;
};

const APP_URL = "https://darki-hs.github.io/wirzeit-familienplaner/";

function getSecretKeys() {
  const result: string[] = [];
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) result.push(legacy);
  const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}") as Record<string, string>;
  result.push(...Object.values(keys));
  return [...new Set(result.filter(Boolean))];
}

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKeys = getSecretKeys();
const serviceKey = serviceKeys[0];
const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY")!;
const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY")!;

if (!serviceKey || !vapidPublicKey || !vapidPrivateKey) {
  throw new Error("WirZeit Push-Secrets fehlen");
}

const admin = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

webpush.setVapidDetails(APP_URL, vapidPublicKey, vapidPrivateKey);

function isServiceRequest(request: Request) {
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const apiKey = request.headers.get("apikey");
  return serviceKeys.includes(bearer ?? "") || serviceKeys.includes(apiKey ?? "");
}

async function sendToProfiles(profileIds: string[], payload: PushPayload) {
  if (!profileIds.length) return 0;
  const { data, error } = await admin
    .from("push_subscriptions")
    .select("endpoint,p256dh,auth,profile_id")
    .in("profile_id", profileIds);
  if (error) throw error;

  let sent = 0;
  for (const subscription of (data ?? []) as SubscriptionRow[]) {
    try {
      await webpush.sendNotification({
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      }, JSON.stringify(payload), { TTL: 3600, urgency: "high" });
      sent += 1;
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        await admin.from("push_subscriptions").delete().eq("endpoint", subscription.endpoint);
      }
    }
  }
  return sent;
}

async function sendChatPush(body: Record<string, unknown>) {
  const record = body.record as { id?: string; family_id?: string; author_id?: string; body?: string } | undefined;
  if (body.type !== "INSERT" || body.table !== "messages" || !record?.id || !record.family_id || !record.author_id) {
    return { ignored: true };
  }

  const [{ data: author }, { data: recipients }] = await Promise.all([
    admin.from("profiles").select("display_name").eq("id", record.author_id).single(),
    admin.from("profiles").select("id").eq("family_id", record.family_id).neq("id", record.author_id),
  ]);
  const profileIds = (recipients ?? []).map(item => item.id);
  const message = String(record.body ?? "Neue Nachricht").slice(0, 160);
  const sent = await sendToProfiles(profileIds, {
    title: `WirZeit · ${author?.display_name ?? "Familie"}`,
    body: message,
    tag: `chat-${record.id}`,
    url: APP_URL,
  });
  return { kind: "chat", sent };
}

async function sendReminderPush() {
  const { data: reminders, error } = await admin.rpc("claim_due_reminders");
  if (error) throw error;
  let sent = 0;

  for (const reminder of reminders ?? []) {
    const start = new Intl.DateTimeFormat("de-DE", {
      timeZone: "Europe/Berlin",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(reminder.starts_at));
    const body = reminder.location ? `${start} · ${reminder.location}` : start;
    const delivered = await sendToProfiles([reminder.profile_id], {
      title: `Termin: ${reminder.title}`,
      body,
      tag: `event-${reminder.event_id}`,
      url: APP_URL,
    });

    if (delivered > 0) {
      await admin.from("reminder_deliveries").update({ sent_at: new Date().toISOString() })
        .eq("event_id", reminder.event_id).eq("profile_id", reminder.profile_id);
      sent += delivered;
    } else {
      await admin.from("reminder_deliveries").delete()
        .eq("event_id", reminder.event_id).eq("profile_id", reminder.profile_id);
    }
  }
  return { kind: "reminders", sent, claimed: reminders?.length ?? 0 };
}

Deno.serve(async request => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!isServiceRequest(request)) return new Response("Unauthorized", { status: 401 });

  try {
    const body = await request.json() as Record<string, unknown>;
    const result = body.kind === "reminders" ? await sendReminderPush() : await sendChatPush(body);
    return Response.json(result);
  } catch (error) {
    console.error(error);
    return Response.json({ error: "Push-Versand fehlgeschlagen" }, { status: 500 });
  }
});
