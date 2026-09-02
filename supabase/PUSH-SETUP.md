# WirZeit Push einrichten

Diese Schritte aktivieren Chatmeldungen und Terminerinnerungen bei geschlossener Web-App.

## 1. Datenbank ergänzen

Im Supabase Dashboard den **SQL Editor** öffnen, den gesamten Inhalt aus `push_setup.sql` einfügen und **Run** wählen.

## 2. VAPID-Secrets speichern

Unter **Edge Functions → Secrets** zwei Werte speichern:

- `VAPID_PUBLIC_KEY`: der öffentliche Schlüssel aus der WirZeit-App
- `VAPID_PRIVATE_KEY`: der private Schlüssel aus der separaten Einrichtungsanleitung

Der private Schlüssel darf niemals in GitHub gespeichert werden.

## 3. Edge Function anlegen

Unter **Edge Functions** eine Funktion mit dem Namen `wirzeit-push` anlegen. Den Inhalt aus `functions/wirzeit-push/index.ts` als Funktionscode verwenden und bereitstellen. Für diese Funktion die automatische JWT-Prüfung deaktivieren; die Funktion prüft den Service-Schlüssel selbst.

## 4. Chat-Webhook anlegen

Unter **Database → Webhooks**:

- Name: `wirzeit-chat-push`
- Tabelle: `messages`
- Ereignis: `Insert`
- Typ: `Supabase Edge Function`
- Funktion: `wirzeit-push`
- Methode: `POST`
- Authentifizierung: Auth-Header mit Service-Schlüssel hinzufügen

## 5. Erinnerungsjob anlegen

Unter **Cron → Jobs**:

- Name: `wirzeit-reminders`
- Zeitplan: `* * * * *`
- Typ: `Supabase Edge Function`
- Funktion: `wirzeit-push`
- Methode: `POST`
- Body: `{ "kind": "reminders" }`
- Authentifizierung: Auth-Header mit Service-Schlüssel hinzufügen

Der Job prüft jede Minute fällige Termine. Pro Termin und ausgewählter Person wird nur eine Erinnerung versendet.

## 6. Geräte aktivieren

Jedes Familienmitglied installiert WirZeit über Safari beziehungsweise den Browser, meldet sich an und tippt einmal auf die Glocke. Bereits erteilte Berechtigungen werden beim nächsten Öffnen automatisch mit Supabase verbunden.
