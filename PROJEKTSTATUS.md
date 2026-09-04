# WirZeit – Projektstatus

## Adressen

- App: https://darki-hs.github.io/wirzeit-familienplaner/
- GitHub: https://github.com/DARKI-HS/wirzeit-familienplaner
- Backend: Supabase
- Veröffentlichung: automatisch über GitHub Actions
- Hauptbranch: `main`

## Aktueller Funktionsumfang

- Persönliche Anmeldung für jedes Familienmitglied
- Erwachsenenverwaltung zum Setzen neuer Passwörter
- Gemeinsamer Familienkalender
- Wochenansicht, die montags beginnt
- Schnelle Wochen- und Monatsnavigation
- Termine erstellen, bearbeiten, verschieben und löschen
- Mehrere Erinnerungen je Termin
- Familienchat
- Push-Benachrichtigungen
- Navigation über Planner, Chat und Familie
- Beim Scrollen sichtbare, farblich zugeordnete Namensleiste
- Chat-Eingabe oberhalb der Nachrichten

## Technische Struktur

- Oberfläche: Next.js und TypeScript
- Datenbank und Anmeldung: Supabase
- Veröffentlichung: GitHub Pages
- Supabase Edge Functions: `family-admin` und `wirzeit-push`
- GitHub-Workflow: `.github/workflows/deploy-pages.yml`

## Weiterarbeiten

Vor einer Änderung:

1. Den aktuellen Stand des Branches `main` laden.
2. Den vorhandenen Code und die Datenbankstruktur untersuchen.
3. Keine Benutzer, Tabellen oder Edge Functions ohne vorherige Prüfung neu anlegen.
4. Änderungen lokal mit Lint und Build prüfen.
5. Erst nach ausdrücklicher Bestätigung auf `main` übertragen.
6. Den anschließenden GitHub-Actions-Lauf kontrollieren.

## Sicherheit

In dieser Datei und im Repository niemals Passwörter, private Schlüssel,
Service-Role-Schlüssel, Zugangscodes oder andere Geheimnisse speichern.

Geheimnisse ausschließlich in den dafür vorgesehenen Einstellungen von
Supabase oder GitHub verwalten. Der öffentliche Supabase-Publishable-Key darf
im Browsercode verwendet werden; der Service-Role-Schlüssel darf dort nicht
gespeichert werden.

## Letzter geprüfter Stand

- Letzter geprüfter Commit vor dieser Dokumentation:
  `5818de1e0a8bea2b81d0c04f2f8f0fcb27fe1646`
- Commit-Nachricht: `Namensleiste und Chat-Anordnung verbessern`
- GitHub zeigte den zugehörigen Status als erfolgreich an.
