# semp — CRM

Leichtgewichtiges CRM für unsere Website-Sales-Pipeline. Single-File HTML, Supabase als Backend, gehostet auf GitHub Pages.

**Live-URL nach Setup:** https://sempergo.github.io/semp-studios/crm/

---

## Was es macht

- Leads ab dem Punkt verwalten, wo wir die Website bauen — Cold Outreach bleibt außerhalb
- Pipeline-Phasen: In Arbeit → Gesendet → Nachfass → Verhandlung → Gewonnen / Verloren
- Follow-ups mit Datum + Uhrzeit, **rot wenn überfällig**, gelb wenn heute fällig
- Notizen-Timeline pro Lead
- "Anruf erledigt"-Workflow: Notiz schreiben + nächsten Schritt in einer Aktion
- Click-to-Call (`tel:`), WhatsApp-Direktlink, Email, Website-Link
- Multi-device-Sync via Supabase Realtime (Laptop ↔ Handy live)
- Geteilter Account für 2 Personen — kein User-Management

---

## Setup (einmalig, ~10 Min)

### 1. Supabase-Projekt anlegen

1. Auf [supabase.com](https://supabase.com) kostenlosen Account erstellen
2. **New Project** → Name z.B. `semp-crm` → **Region: Frankfurt (eu-central-1)** (DSGVO) → Datenbank-Passwort vergeben
3. Warten bis das Projekt fertig provisioniert ist (~1 Min)

### 2. Datenbank-Schema einspielen

1. Im Supabase-Dashboard: **SQL Editor** → **New query**
2. Den Inhalt von `schema.sql` einfügen → **Run**
3. Erfolg = "Success. No rows returned."

Das Schema legt automatisch an:
- Tabellen `leads` und `notes`
- Trigger für `updated_at`
- Indices für Performance
- Row-Level-Security (nur eingeloggte User dürfen lesen/schreiben)
- Realtime-Publication (Live-Updates)

### 3. Shared-Account erstellen

1. **Authentication** → **Users** → **Add user** → **Create new user**
2. Email + Passwort vergeben (z.B. `crm@semp-studios.de`)
3. **Auto Confirm User** anhaken (sonst kommt eine Bestätigungs-Mail)
4. → **Create user**

Beide Personen nutzen später dieselben Credentials.

### 4. Self-Signup deaktivieren (Sicherheit)

1. **Authentication** → **Providers** → **Email**
2. **Enable Sign Up** ausschalten → nur der eine User kommt rein

### 5. API-Keys ins HTML einfügen

1. **Project Settings** → **API**
2. Aus dem Dashboard kopieren:
   - **Project URL** → das ist `SUPABASE_URL`
   - **anon / public Key** → das ist `SUPABASE_ANON_KEY`
3. In `crm/index.html` ganz oben im `<script>`-Block:

```js
const SUPABASE_URL      = 'https://xxxxxxxxxxxx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOi...';
```

Der Anon-Key darf öffentlich im Code stehen — RLS blockt alles ohne gültige Session.

### 6. Pushen

```bash
git add crm/
git commit -m "crm: initial setup"
git push
```

GitHub Pages serviert nach ~1 Min unter:
**https://sempergo.github.io/semp-studios/crm/**

---

## Bedienung

### Lead anlegen
- **+ Neuer Lead** (oder Taste `n`) → Firma als Pflichtfeld, Rest optional
- Telefon im Format `+49…` oder `0…` (wird automatisch normalisiert für WhatsApp)

### Follow-up setzen
- Im Lead-Detail-Panel: Datepicker oder Quick-Buttons (Morgen 10 Uhr / In 3 Tagen / Nächste Woche)
- Notiz im Textfeld dahinter ("Logo-Vorschläge schicken")

### Nach jedem Anruf
- Lead öffnen → **Anruf erledigt** Button → kombiniertes Form:
  - Was ist passiert? (wird zur Timeline-Notiz)
  - Nächster Schritt wann? (setzt neues Follow-up-Datum)
- In einem Submit: Notiz + Datum aktualisiert

### Status wechseln
- 6 Buttons im Detail-Panel
- Bei `Gewonnen` oder `Verloren` wird das Follow-up automatisch entfernt → Lead verschwindet aus aktiven Listen, taucht im jeweiligen Filter-Tab auf

### Lead löschen
- Unten im Detail-Panel **Lead löschen** → Soft-Delete (landet im **Archiv**-Tab, von dort wiederherstellbar)
- Toast mit **Rückgängig** für 8 Sekunden

### Suchen
- Taste `/` fokussiert die Suche
- Filtert live über Firma, Branche, Kontaktperson, Telefon, Email

### Tastatur-Shortcuts
- `n` — neuer Lead
- `/` — Suche fokussieren
- `Esc` — Detail-Panel oder Modal schließen

### Backup
- Menü (rechts oben) → **JSON exportieren** → lädt alle Leads + Notes als Datei

---

## Farbsystem (Reminder-Logik)

| Zustand | Bedingung | Anzeige |
|---|---|---|
| **Überfällig** | Follow-up-Datum liegt in der Vergangenheit | Rote Card, pulsierender Glow, rote Border am Lead |
| **Heute fällig** | Follow-up ist heute | Gelbe Card, gelbe Border |
| **Diese Woche** | Follow-up in nächsten 7 Tagen | Neutrale Card |
| **Kein Follow-up** | Status ist Nachfass oder Verhandlung, aber kein Datum gesetzt | ⚠ Warn-Badge — sichtbar, weil hier was vergessen wurde |

---

## Tech-Stack

- Vanilla HTML/JS — kein Build-System
- Tailwind CSS via CDN
- Supabase JS SDK v2 (Postgres + Auth + Realtime)
- GSAP für Micro-Animations
- Inter via Google Fonts

---

## Realtime-Sync

Updates erscheinen live auf allen Geräten. Rechts oben in der Top-Bar zeigt der grüne Dot "live" an, sobald die WebSocket-Verbindung steht. Wenn beide Personen gleichzeitig denselben Lead bearbeiten: last-write-wins (für 2 User in der Praxis kein Problem).

---

## Bewusst weggelassen

- Kein User-Management / Rollen (geteilter Account reicht)
- Keine Email-/Push-Notifications (Dashboard zeigt offene Follow-ups beim Öffnen)
- Keine Kalender-Integration (ICS-Export kann später nachgerüstet werden)
- Kein Pipeline-Wert / Forecast — kommt wenn relevant
