"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addDays, format, isSameDay, startOfWeek } from "date-fns";
import { de } from "date-fns/locale";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { Bell, CalendarDays, Check, ChevronLeft, ChevronRight, Cloud, CloudOff, LogOut, MessageCircle, Plus, Send, Sparkles, Trash2, Users } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Profile = { id: string; family_id: string; login_name: string; display_name: string; role: "adult" | "child" };
type MemberColor = "blue" | "coral" | "gold" | "purple" | "green";
type FamilyEvent = { id: string; title: string; startsAt: string; assigneeId: string | null; color: MemberColor; location?: string; reminderMinutes: number; notifyIds: string[]; pending?: boolean };
type ChatMessage = { id: string; authorId: string; author: string; text: string; createdAt: string; own?: boolean; pending?: boolean };
type EventDraft = { title: string; startsAt: string; assigneeId: string | null; location: string; reminderMinutes: number; notifyIds: string[] };
type MessageDraft = { text: string };
type OfflineItem = { id: string; ownerId: string; kind: "event" | "message"; payload: EventDraft | MessageDraft; createdAt: string };
type Snapshot = { profiles: Profile[]; events: FamilyEvent[]; messages: ChatMessage[]; savedAt: string };

const FAMILY_NAME = "Familie Schuhmacher";
const LOGIN_EMAILS: Record<string, string> = {
  jens: "jens@familienplaner.schuhmacher-jens.chatgpt.site",
  susan: "susan@familienplaner.schuhmacher-jens.chatgpt.site",
  jasmin: "jasmin@familienplaner.schuhmacher-jens.chatgpt.site",
  henry: "henry@familienplaner.schuhmacher-jens.chatgpt.site",
};
const COLORS: MemberColor[] = ["blue", "coral", "gold", "purple"];
const QUEUE_KEY = "wirzeit-offline-queue";
const AUTH_STORAGE_KEY = "wirzeit-auth-session-v1";
const LEGACY_AUTH_STORAGE_KEY = "sb-nahkeogrdxdyakowqcqz-auth-token";
const APP_BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const SUPABASE_URL = "https://nahkeogrdxdyakowqcqz.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_1qEEirZJcxeEXgPSIw_6qg__y8wWgY7";
const VAPID_PUBLIC_KEY = "BA9LArpN-5lj5vLZoSZsYs8D0ohrx3tLqwDFbG7jQpIVkDCZ5sQMbRtgBXSPMGqx3Qns4D_cnvwqRzBsfzht3pE";

function getQueue(): OfflineItem[] {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]") as OfflineItem[]; }
  catch { return []; }
}

function addToQueue(ownerId: string, kind: OfflineItem["kind"], payload: OfflineItem["payload"]) {
  const items = getQueue();
  items.push({ id: crypto.randomUUID(), ownerId, kind, payload, createdAt: new Date().toISOString() });
  localStorage.setItem(QUEUE_KEY, JSON.stringify(items));
}

function removeFromQueue(id: string) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(getQueue().filter(item => item.id !== id)));
}

function removeQueuedMessages(ownerId: string) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(getQueue().filter(item => item.ownerId !== ownerId || item.kind !== "message")));
}

function initials(name: string) {
  return name.split(/\s+/).map(part => part[0]).join("").slice(0, 2).toUpperCase();
}

function snapshotKey(profileId: string) { return `wirzeit-snapshot-${profileId}`; }

function base64UrlToUint8Array(value: string) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const bytes = atob(base64);
  return Uint8Array.from(bytes, character => character.charCodeAt(0));
}

function restoreSnapshot(profileId: string): Snapshot | null {
  try { return JSON.parse(localStorage.getItem(snapshotKey(profileId)) ?? "null") as Snapshot | null; }
  catch { return null; }
}

export function Familienplaner() {
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [events, setEvents] = useState<FamilyEvent[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [booting, setBooting] = useState(true);
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [isOnline, setIsOnline] = useState(true);
  const [weekOffset, setWeekOffset] = useState(0);
  const [chatText, setChatText] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [notice, setNotice] = useState("WirZeit ist bereit");
  const flushing = useRef(false);

  const memberColor = useCallback((id: string | null): MemberColor => {
    if (!id) return "green";
    const index = profiles.findIndex(member => member.id === id);
    return COLORS[index >= 0 ? index % COLORS.length : 0];
  }, [profiles]);

  const savePushSubscription = useCallback(async (client: SupabaseClient, current: Profile) => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) throw new Error("Push wird nicht unterstützt");
    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    const subscription = existing ?? await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToUint8Array(VAPID_PUBLIC_KEY),
    });
    const json = subscription.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) throw new Error("Push-Abonnement ist unvollständig");
    const { error } = await client.from("push_subscriptions").upsert({
      profile_id: current.id,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      user_agent: navigator.userAgent,
      updated_at: new Date().toISOString(),
    }, { onConflict: "endpoint" });
    if (error) throw error;
    return registration;
  }, []);

  const loadFamilyData = useCallback(async (client: SupabaseClient, current: Profile) => {
    const [profileResult, eventResult, recipientResult, messageResult] = await Promise.all([
      client.from("profiles").select("id,family_id,login_name,display_name,role").eq("family_id", current.family_id).order("display_name"),
      client.from("events").select("id,title,starts_at,location,assignee_id,reminder_minutes").eq("family_id", current.family_id).order("starts_at"),
      client.from("event_recipients").select("event_id,profile_id"),
      client.from("messages").select("id,author_id,body,created_at").eq("family_id", current.family_id).order("created_at"),
    ]);
    const firstError = profileResult.error ?? eventResult.error ?? recipientResult.error ?? messageResult.error;
    if (firstError) throw firstError;
    const familyProfiles = (profileResult.data ?? []) as Profile[];
    setProfiles(familyProfiles);
    const names = new Map(familyProfiles.map(member => [member.id, member.display_name]));
    const recipientMap = new Map<string, string[]>();
    for (const row of recipientResult.data ?? []) {
      const list = recipientMap.get(row.event_id) ?? [];
      list.push(row.profile_id);
      recipientMap.set(row.event_id, list);
    }
    const mappedEvents: FamilyEvent[] = (eventResult.data ?? []).map(row => ({
      id: row.id,
      title: row.title,
      startsAt: row.starts_at,
      assigneeId: row.assignee_id,
      color: row.assignee_id ? COLORS[Math.max(0, familyProfiles.findIndex(member => member.id === row.assignee_id)) % COLORS.length] : "green",
      location: row.location ?? "",
      reminderMinutes: row.reminder_minutes,
      notifyIds: recipientMap.get(row.id) ?? [],
    }));
    const mappedMessages: ChatMessage[] = (messageResult.data ?? []).map(row => ({
      id: row.id,
      authorId: row.author_id,
      author: names.get(row.author_id) ?? "Familie",
      text: row.body,
      createdAt: row.created_at,
      own: row.author_id === current.id,
    }));
    setEvents(mappedEvents);
    setMessages(mappedMessages);
    localStorage.setItem(snapshotKey(current.id), JSON.stringify({ profiles: familyProfiles, events: mappedEvents, messages: mappedMessages, savedAt: new Date().toISOString() } satisfies Snapshot));
  }, []);

  const createRemoteEvent = useCallback(async (client: SupabaseClient, current: Profile, draft: EventDraft) => {
    const { data, error } = await client.from("events").insert({
      family_id: current.family_id,
      created_by: current.id,
      title: draft.title,
      starts_at: draft.startsAt,
      location: draft.location || null,
      assignee_id: draft.assigneeId,
      reminder_minutes: draft.reminderMinutes,
    }).select("id").single();
    if (error) throw error;
    const { error: recipientError } = await client.from("event_recipients").insert(draft.notifyIds.map(profileId => ({ event_id: data.id, profile_id: profileId })));
    if (recipientError) throw recipientError;
  }, []);

  const createRemoteMessage = useCallback(async (client: SupabaseClient, current: Profile, draft: MessageDraft) => {
    const { error } = await client.from("messages").insert({ family_id: current.family_id, author_id: current.id, body: draft.text });
    if (error) throw error;
  }, []);

  const flushQueue = useCallback(async (client: SupabaseClient, current: Profile) => {
    if (flushing.current || !navigator.onLine) return;
    flushing.current = true;
    try {
      const pending = getQueue().filter(item => item.ownerId === current.id);
      for (const item of pending) {
        if (item.kind === "event") await createRemoteEvent(client, current, item.payload as EventDraft);
        else await createRemoteMessage(client, current, item.payload as MessageDraft);
        removeFromQueue(item.id);
      }
      await loadFamilyData(client, current);
      if (pending.length) setNotice("Offline-Änderungen wurden synchronisiert");
    } catch {
      setNotice("Synchronisierung wartet auf eine stabile Verbindung");
    } finally {
      flushing.current = false;
    }
  }, [createRemoteEvent, createRemoteMessage, loadFamilyData]);

  const restoreAuthenticatedProfile = useCallback(async (client: SupabaseClient, userId: string) => {
    const { data: current, error } = await client.from("profiles").select("id,family_id,login_name,display_name,role").eq("id", userId).single();
    if (error || !current) throw error ?? new Error("Familienprofil fehlt");
    setProfile(current as Profile);
    try {
      await loadFamilyData(client, current as Profile);
    } catch {
      const snapshot = restoreSnapshot(current.id);
      if (!snapshot) throw new Error("Keine Offline-Daten verfügbar");
      setProfiles(snapshot.profiles);
      setEvents(snapshot.events);
      setMessages(snapshot.messages.map(message => ({ ...message, own: message.authorId === current.id })));
      setNotice("Offline-Stand wird angezeigt");
    }
  }, [loadFamilyData]);

  useEffect(() => {
    let active = true;
    let unsubscribeAuth: (() => void) | undefined;
    let resumeSession: (() => void) | undefined;
    async function start() {
      try {
        const legacySession = localStorage.getItem(LEGACY_AUTH_STORAGE_KEY);
        if (!localStorage.getItem(AUTH_STORAGE_KEY) && legacySession) {
          localStorage.setItem(AUTH_STORAGE_KEY, legacySession);
          localStorage.removeItem(LEGACY_AUTH_STORAGE_KEY);
        }
        const client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: false,
            storage: window.localStorage,
            storageKey: AUTH_STORAGE_KEY,
          },
        });
        if (!active) return;
        setSupabase(client);
        const restoreSession = async () => {
          const { data } = await client.auth.getSession();
          if (data.session && active) await restoreAuthenticatedProfile(client, data.session.user.id);
        };
        const { data: authListener } = client.auth.onAuthStateChange((event, session) => {
          if (!active) return;
          if (event === "SIGNED_OUT") {
            setProfile(null);
            return;
          }
          if (session && (event === "SIGNED_IN" || event === "TOKEN_REFRESHED")) {
            window.setTimeout(() => void restoreAuthenticatedProfile(client, session.user.id).catch(() => undefined), 0);
          }
        });
        unsubscribeAuth = () => authListener.subscription.unsubscribe();
        resumeSession = () => {
          if (document.visibilityState === "visible") void restoreSession().catch(() => undefined);
        };
        document.addEventListener("visibilitychange", resumeSession);
        await restoreSession();
      } catch {
        if (active) setLoginError("Die Cloud-Verbindung konnte nicht geladen werden. Bitte später erneut versuchen.");
      } finally {
        if (active) setBooting(false);
      }
    }
    void start();
    return () => {
      active = false;
      unsubscribeAuth?.();
      if (resumeSession) document.removeEventListener("visibilitychange", resumeSession);
    };
  }, [restoreAuthenticatedProfile]);

  useEffect(() => {
    const update = () => {
      const online = navigator.onLine;
      setIsOnline(online);
      if (online && supabase && profile) void flushQueue(supabase, profile);
    };
    update();
    addEventListener("online", update);
    addEventListener("offline", update);
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register(`${APP_BASE_PATH}/sw.js`, { scope: `${APP_BASE_PATH}/` });
    return () => { removeEventListener("online", update); removeEventListener("offline", update); };
  }, [flushQueue, profile, supabase]);

  useEffect(() => {
    if (!supabase || !profile || !("Notification" in window) || Notification.permission !== "granted") return;
    void savePushSubscription(supabase, profile).catch(() => setNotice("Push-Verbindung konnte nicht erneuert werden"));
  }, [profile, savePushSubscription, supabase]);

  useEffect(() => {
    if (!supabase || !profile) return;
    const refresh = () => void loadFamilyData(supabase, profile).catch(() => undefined);
    const channel = supabase.channel(`family-${profile.family_id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "events", filter: `family_id=eq.${profile.family_id}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `family_id=eq.${profile.family_id}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "event_recipients" }, refresh)
      .subscribe();
    const timer = window.setInterval(refresh, 20000);
    const flushTimer = window.setTimeout(() => void flushQueue(supabase, profile), 0);
    return () => { window.clearInterval(timer); window.clearTimeout(flushTimer); void supabase.removeChannel(channel); };
  }, [flushQueue, loadFamilyData, profile, supabase]);

  const weekStart = useMemo(() => addDays(startOfWeek(new Date(), { weekStartsOn: 1 }), weekOffset * 7), [weekOffset]);
  const weekEnd = addDays(weekStart, 6);
  const weekLabel = weekStart.getMonth() === weekEnd.getMonth()
    ? format(weekStart, "MMMM yyyy", { locale: de })
    : `${format(weekStart, "d. MMM", { locale: de })} – ${format(weekEnd, "d. MMM yyyy", { locale: de })}`;
  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const upcoming = [...events].filter(item => new Date(item.startsAt) >= new Date()).sort((a, b) => a.startsAt.localeCompare(b.startsAt)).slice(0, 4);
  const nameById = useMemo(() => new Map(profiles.map(member => [member.id, member.display_name])), [profiles]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    const data = new FormData(event.currentTarget);
    const loginName = String(data.get("name") ?? "").trim().toLowerCase();
    const email = LOGIN_EMAILS[loginName];
    if (!email) { setLoginError("Dieser Name gehört nicht zu Familie Schuhmacher."); return; }
    setLoginBusy(true);
    setLoginError("");
    const { data: authData, error } = await supabase.auth.signInWithPassword({ email, password: String(data.get("password") ?? "") });
    if (error || !authData.user) {
      setLoginError("Name oder Passwort ist nicht richtig.");
      setLoginBusy(false);
      return;
    }
    const { data: current, error: profileError } = await supabase.from("profiles").select("id,family_id,login_name,display_name,role").eq("id", authData.user.id).single();
    if (profileError || !current) {
      await supabase.auth.signOut();
      setLoginError("Das Familienprofil konnte nicht geladen werden.");
      setLoginBusy(false);
      return;
    }
    setProfile(current as Profile);
    await loadFamilyData(supabase, current as Profile);
    setLoginBusy(false);
  }

  async function logout() {
    if (supabase) await supabase.auth.signOut();
    setProfile(null);
    setProfiles([]);
    setEvents([]);
    setMessages([]);
  }

  async function addCalendarEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile || !supabase) return;
    const data = new FormData(event.currentTarget);
    const notifyIds = data.getAll("notify").map(String);
    if (!notifyIds.length) { setNotice("Bitte mindestens eine Person für die Erinnerung wählen"); return; }
    const draft: EventDraft = {
      title: String(data.get("title")),
      startsAt: new Date(`${data.get("date")}T${data.get("time")}:00`).toISOString(),
      assigneeId: String(data.get("member")) || null,
      location: String(data.get("location") ?? ""),
      reminderMinutes: Number(data.get("reminder")),
      notifyIds,
    };
    setDialogOpen(false);
    if (!navigator.onLine) {
      addToQueue(profile.id, "event", draft);
      setEvents(items => [...items, { id: crypto.randomUUID(), ...draft, color: memberColor(draft.assigneeId), pending: true }]);
      setNotice("Termin offline gespeichert");
      return;
    }
    try {
      await createRemoteEvent(supabase, profile, draft);
      await loadFamilyData(supabase, profile);
      setNotice("Termin wurde gespeichert");
    } catch {
      addToQueue(profile.id, "event", draft);
      setEvents(items => [...items, { id: crypto.randomUUID(), ...draft, color: memberColor(draft.assigneeId), pending: true }]);
      setNotice("Termin wartet auf Synchronisierung");
    }
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    if (!profile || !supabase || !chatText.trim()) return;
    const draft: MessageDraft = { text: chatText.trim() };
    setChatText("");
    if (!navigator.onLine) {
      addToQueue(profile.id, "message", draft);
      setMessages(items => [...items, { id: crypto.randomUUID(), authorId: profile.id, author: profile.display_name, text: draft.text, createdAt: new Date().toISOString(), own: true, pending: true }]);
      setNotice("Nachricht offline gespeichert");
      return;
    }
    try {
      await createRemoteMessage(supabase, profile, draft);
      await loadFamilyData(supabase, profile);
    } catch {
      addToQueue(profile.id, "message", draft);
      setMessages(items => [...items, { id: crypto.randomUUID(), authorId: profile.id, author: profile.display_name, text: draft.text, createdAt: new Date().toISOString(), own: true, pending: true }]);
      setNotice("Nachricht wartet auf Synchronisierung");
    }
  }

  async function clearChat() {
    if (!profile || !supabase || profile.role !== "adult") return;
    const { error } = await supabase.from("messages").delete().eq("family_id", profile.family_id);
    if (error) {
      setNotice("Chat konnte nicht gelöscht werden");
      return;
    }
    removeQueuedMessages(profile.id);
    setMessages([]);
    await loadFamilyData(supabase, profile);
    setNotice("Chat wurde vollständig gelöscht");
  }

  async function requestNotifications() {
    if (!supabase || !profile) return;
    if (!("Notification" in window)) { setNotice("Dieser Browser unterstützt keine Benachrichtigungen"); return; }
    const permission = await Notification.requestPermission();
    if (permission !== "granted") { setNotice("Browser-Benachrichtigungen nicht erlaubt"); return; }
    try {
      const registration = await savePushSubscription(supabase, profile);
      setNotice("Push-Benachrichtigungen aktiviert");
      await registration.showNotification("WirZeit", { body: "Push-Benachrichtigungen sind auf diesem Gerät aktiviert.", icon: `${APP_BASE_PATH}/icon-192.png`, badge: `${APP_BASE_PATH}/favicon-32.png` });
    } catch {
      setNotice("Push-Benachrichtigungen konnten nicht eingerichtet werden");
    }
  }

  if (booting) return <main className="login-shell"><section className="login-card"><div className="brand-mark"><Sparkles size={23}/><span>WirZeit</span></div><p className="login-copy">Familienplaner wird geladen …</p></section><aside className="login-art" aria-hidden="true"><div className="family-orb"><Users size={48}/><strong>Zusammen<br/>ist leichter.</strong></div></aside></main>;

  if (!profile) return <main className="login-shell"><section className="login-card" aria-labelledby="login-title"><div className="brand-mark"><Sparkles size={23}/><span>WirZeit</span></div><Badge variant="secondary">Privater Familienbereich</Badge><h1 id="login-title">Schön, dass du da bist.</h1><p className="login-copy">Termine, Absprachen und Erinnerungen an einem ruhigen Ort.</p><form onSubmit={login} className="login-form"><div><Label htmlFor="name">Dein fester Name</Label><Input id="name" name="name" autoComplete="username" placeholder="z. B. Jens" required/></div><div><Label htmlFor="password">Passwort</Label><Input id="password" name="password" type="password" autoComplete="current-password" required/></div>{loginError && <p className="form-error" role="alert">{loginError}</p>}<Button type="submit" size="lg" disabled={!supabase || loginBusy}>{loginBusy ? "Anmeldung läuft …" : "Sicher anmelden"}</Button></form><p className="privacy-note">Jedes Familienmitglied hat einen eigenen Zugang. Passwörter werden von Supabase geprüft und nicht in WirZeit gespeichert.</p></section><aside className="login-art" aria-hidden="true"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="family-orb"><Users size={48}/><strong>Zusammen<br/>ist leichter.</strong></div></aside></main>;

  return <main className="app-shell"><header className="topbar"><div className="top-brand"><div className="brand-mark"><Sparkles size={21}/><span>WirZeit</span></div><span className="mobile-family-name">{FAMILY_NAME}</span></div><div className="family-title"><span>{FAMILY_NAME}</span><div className="avatar-stack">{profiles.map((member, index) => <Avatar key={member.id} className={`member-avatar ${COLORS[index % COLORS.length]}`}><AvatarFallback>{initials(member.display_name)}</AvatarFallback></Avatar>)}</div></div><div className="top-actions"><button className={`sync-state ${isOnline ? "online" : "offline"}`}>{isOnline ? <Cloud size={16}/> : <CloudOff size={16}/>} {isOnline ? "Online" : "Offline"}</button><Button variant="outline" size="icon" onClick={requestNotifications} aria-label="Browser-Benachrichtigungen aktivieren"><Bell size={18}/></Button><Button variant="ghost" size="icon" onClick={logout} aria-label="Abmelden"><LogOut size={18}/></Button></div></header><div className="notice"><Check size={14}/> {notice}</div>
    <section className="workspace"><div className="calendar-panel"><div className="calendar-toolbar"><div><p className="eyebrow">Familienkalender</p><h1>{weekLabel}</h1></div><div className="toolbar-actions"><Tabs defaultValue="week"><TabsList><TabsTrigger value="week">Woche</TabsTrigger><TabsTrigger value="month">Monat</TabsTrigger></TabsList></Tabs><div className="week-nav"><Button variant="outline" size="icon" onClick={() => setWeekOffset(value => value - 1)}><ChevronLeft size={18}/></Button><Button variant="outline" onClick={() => setWeekOffset(0)}>Heute</Button><Button variant="outline" size="icon" onClick={() => setWeekOffset(value => value + 1)}><ChevronRight size={18}/></Button></div><Dialog open={dialogOpen} onOpenChange={setDialogOpen}><DialogTrigger asChild><Button><Plus size={18}/> Termin</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>Neuer Termin</DialogTitle><DialogDescription>Lege fest, für wen der Termin ist und wer benachrichtigt wird.</DialogDescription></DialogHeader><form className="event-form" onSubmit={addCalendarEvent}><div><Label htmlFor="event-title">Titel</Label><Input id="event-title" name="title" placeholder="Was steht an?" required/></div><div className="form-row"><div><Label htmlFor="event-date">Datum</Label><Input id="event-date" name="date" type="date" defaultValue={format(new Date(), "yyyy-MM-dd")} required/></div><div><Label htmlFor="event-time">Uhrzeit</Label><Input id="event-time" name="time" type="time" defaultValue="10:00" required/></div></div><div><Label htmlFor="event-location">Ort</Label><Input id="event-location" name="location" placeholder="Optional"/></div><div className="form-row"><div><Label htmlFor="event-member">Termin für</Label><select id="event-member" name="member" defaultValue=""><option value="">Alle</option>{profiles.map(member => <option key={member.id} value={member.id}>{member.display_name}</option>)}</select></div><div><Label htmlFor="event-reminder">Erinnern</Label><select id="event-reminder" name="reminder" defaultValue="30"><option value="0">Zum Termin</option><option value="5">5 Minuten vorher</option><option value="15">15 Minuten vorher</option><option value="30">30 Minuten vorher</option><option value="60">1 Stunde vorher</option><option value="1440">1 Tag vorher</option></select></div></div><fieldset className="notify-fieldset"><legend>Wer soll benachrichtigt werden?</legend><p>Mindestens eine Person auswählen.</p><div className="notify-options">{profiles.map(member => <label key={member.id}><Checkbox name="notify" value={member.id} defaultChecked/><span>{member.display_name}</span></label>)}</div></fieldset><Button type="submit">Termin speichern</Button></form></DialogContent></Dialog></div></div>
      <div className="week-grid">{days.map(day => { const dayEvents = events.filter(item => isSameDay(new Date(item.startsAt), day)); const today = isSameDay(day, new Date()); return <article className={`day-column ${today ? "today" : ""}`} key={day.toISOString()}><header><span>{format(day, "EEE", { locale: de })}</span><strong>{format(day, "d")}</strong></header><div className="day-events">{dayEvents.map(item => <div className={`event-card ${item.color}`} key={item.id}><div className="event-time">{format(new Date(item.startsAt), "HH:mm")}{item.pending && <CloudOff size={12}/>}</div><strong>{item.title}</strong><span>{item.location}</span><small>{item.assigneeId ? nameById.get(item.assigneeId) : "Alle"} · 🔔 {item.notifyIds.map(id => nameById.get(id)).filter(Boolean).join(", ")}</small></div>)}{dayEvents.length === 0 && <div className="empty-slot"/>}</div></article>; })}</div><div className="legend">{profiles.map((member, index) => <span key={member.id}><i className={COLORS[index % COLORS.length]}/>{member.display_name}</span>)}<span><i className="green"/>Alle</span></div></div>
      <aside className="side-panel"><section className="upcoming-section"><div className="section-heading"><div><p className="eyebrow">Im Blick</p><h2>Als Nächstes</h2></div><CalendarDays size={22}/></div><div className="upcoming-list">{upcoming.map(item => <article key={item.id}><div className={`date-chip ${item.color}`}><strong>{format(new Date(item.startsAt), "d")}</strong><span>{format(new Date(item.startsAt), "MMM", { locale: de })}</span></div><div><strong>{item.title}</strong><span>{format(new Date(item.startsAt), "HH:mm")}{item.location ? ` · ${item.location}` : ""}</span></div></article>)}{upcoming.length === 0 && <p className="empty-copy">Noch keine kommenden Termine.</p>}</div></section><section className="chat-section"><div className="section-heading"><div><p className="eyebrow">Familienchat</p><h2>Absprachen</h2></div><div className="chat-heading-actions">{profile.role === "adult" && <AlertDialog><AlertDialogTrigger asChild><Button variant="ghost" size="sm" disabled={!isOnline || messages.length === 0}><Trash2 size={15}/> Leeren</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Familienchat vollständig löschen?</AlertDialogTitle><AlertDialogDescription>Alle derzeit gespeicherten Chatnachrichten werden für die ganze Familie dauerhaft gelöscht. Dies kann nicht rückgängig gemacht werden.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Abbrechen</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={clearChat}>Chat löschen</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>}<MessageCircle size={22}/></div></div><div className="messages">{messages.map(message => <div key={message.id} className={`message ${message.own ? "own" : ""}`}><span className="message-author">{message.author}</span><p>{message.text}</p><small>{format(new Date(message.createdAt), "HH:mm")}{message.pending ? " · wartet" : ""}</small></div>)}{messages.length === 0 && <p className="empty-copy">Noch keine Nachrichten.</p>}</div><form className="chat-input" onSubmit={sendMessage}><Input value={chatText} onChange={event => setChatText(event.target.value)} placeholder="Nachricht schreiben …" aria-label="Nachricht"/><Button size="icon" type="submit" aria-label="Nachricht senden"><Send size={17}/></Button></form></section></aside></section>
    <nav className="mobile-nav"><button className="active"><CalendarDays/>Planer</button><button><MessageCircle/>Chat</button><button><Users/>Familie</button></nav></main>;
}
