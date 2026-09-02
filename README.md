# WirZeit – Familienplaner

WirZeit ist die private Familienplaner-Web-App der Familie Schuhmacher. Sie verbindet einen gemeinsamen Kalender, auswählbare Terminempfänger, Erinnerungen, Familienchat und Offline-Unterstützung mit Supabase.

## Veröffentlichung mit GitHub Pages

Dieses Projekt ist für das Repository `DARKI-HS/wirzeit-familienplaner` vorbereitet.

1. Alle Dateien und Ordner aus dem bereitgestellten Paket in die oberste Ebene des Repositorys hochladen.
2. Den Upload mit **Commit changes** bestätigen.
3. Im Repository **Settings → Pages** öffnen.
4. Unter **Build and deployment** als Quelle **GitHub Actions** auswählen.
5. Unter **Actions** den Lauf „WirZeit auf GitHub Pages veröffentlichen“ abwarten.

Nach erfolgreicher Veröffentlichung ist die App unter folgender Adresse erreichbar:

`https://darki-hs.github.io/wirzeit-familienplaner/`

## App auf dem Telefon installieren

Die veröffentlichte Adresse im normalen Browser öffnen und dann **Zum Home-Bildschirm** beziehungsweise **App installieren** wählen. Die alte, über ChatGPT geöffnete Installation sollte anschließend vom Home-Bildschirm entfernt werden.

## Sicherheit

- Die Familienmitglieder melden sich weiterhin nur mit ihrem WirZeit-Namen und Passwort an.
- Passwörter befinden sich nicht im Repository.
- Im Browsercode steht ausschließlich der öffentliche Supabase Publishable Key. Dieser ist für Web-Apps vorgesehen.
- Der geheime Supabase `service_role`-Schlüssel darf niemals in dieses Repository eingetragen werden.
- Der Schutz der Familieninformationen erfolgt durch die in `supabase/schema.sql` enthaltenen Row-Level-Security-Regeln.

## Lokale Entwicklung

Voraussetzung ist Node.js 22 oder neuer.

```bash
npm ci
npm run dev
```

Statischer Test-Build für GitHub Pages:

```bash
NEXT_PUBLIC_BASE_PATH=/wirzeit-familienplaner npm run build:pages
```

Der GitHub-Actions-Ablauf in `.github/workflows/deploy-pages.yml` führt diesen Build automatisch aus.

## Wichtiger Hinweis zu Benachrichtigungen

Die App kann Benachrichtigungsrechte im Browser anfordern und Push-Nachrichten anzeigen. Vollautomatische Terminerinnerungen bei vollständig geschlossener App benötigen zusätzlich eine Supabase Edge Function mit Zeitplan und Web-Push-Abonnements. Diese serverseitige Erweiterung ist nicht Bestandteil des reinen GitHub-Pages-Uploads.
