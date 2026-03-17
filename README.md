# iobroker.kalender

[![Version](https://img.shields.io/badge/version-0.5.4-blue)](https://github.com/MPunktBPunkt/iobroker.kalender)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D16-brightgreen)](https://nodejs.org)

Vollständiger **Kalender-Adapter** für ioBroker mit Web-Dashboard, Alexa-Sprachausgabe, Zeit-Triggern und Google Kalender Integration.

---

## Features

| Feature | Beschreibung |
|---|---|
| 📅 Kalenderansicht | Tag / Woche / Monat mit Navigation |
| ✅ Aufgaben & Termine | Mit Serieneinträgen (täglich / wöchentlich / monatlich / jährlich) |
| ⏰ Zeit-Trigger | Täglich um HH:MM Uhr automatisch ausführen |
| 🗣️ Nachricht bauen | Text + Datenpunkt-Werte kombinieren für Alexa |
| 🔗 Datenpunkt-Aktion | Beliebigen State setzen (bool/Zahl/Text) + Zähler |
| 🎂 Geburtstags-Manager | Countdown, Altersanzeige, Vorankündigung |
| 📆 Google Kalender | ICS/iCal URL Import (read-only, stündlich aktualisiert) |
| 🗣️ Alexa | Mehrere Geräte konfigurierbar |
| 📤 Import / Export | JSON Backup |

---

## Installation

```bash
iobroker url https://github.com/MPunktBPunkt/iobroker.kalender
iobroker add kalender
```

## Update

```bash
iobroker url https://github.com/MPunktBPunkt/iobroker.kalender
iobroker restart kalender
```

---

## Web-Dashboard

Aufruf: `http://<iobroker-ip>:8095`

---

## Zeit-Trigger & Nachricht bauen

### Beispiel: Morgens Poolpumpe einschalten + Ansage

1. Neuer Termin → Datum: heute, Wiederholung: Täglich
2. **Auslöser-Uhrzeit:** `07:30`
3. **Datenpunkt-Aktion:** `pool.0.pump.switch` → `true` (Boolean)
4. **Nachricht bauen:** 
   - `+ Text` → "Guten Morgen! Die Pooltemperatur beträgt "
   - `+ Datenpunkt` → `pool.0.temperature`, Suffix: " Grad."
   - `+ Text` → " Die Pumpe läuft jetzt."
5. Alexa-Gerät auswählen → Speichern

### Beispiel: Abends Poolpumpe aus

1. Neuer Termin → Täglich, Auslöser-Uhrzeit: `21:00`
2. Datenpunkt-Aktion: `pool.0.pump.switch` → `false` (Boolean)

---

## Google Kalender einbinden

1. Google Kalender → Kalendereinstellungen → "Kalender-URL" (iCal-Format, endet auf `.ics`)
2. System-Tab → Externe Kalender → URL einfügen → Hinzufügen
3. Der Adapter lädt die Kalender stündlich und zeigt sie lila in der Kalenderansicht an

---

## Alexa einrichten

State-Pfad für alexa2-Adapter: `alexa2.0.Echo-Devices.<SERIAL>.Commands.speak`

Die Seriennummer findet man in ioBroker → Objects → alexa2.0.Echo-Devices.

---

## ioBroker States

| State | Beschreibung |
|---|---|
| `kalender.0.today.eventsToday` | Heutige Termine (JSON) |
| `kalender.0.today.birthdaysToday` | Heutige Geburtstage (JSON) |
| `kalender.0.data.events` | Alle Termine |
| `kalender.0.data.birthdays` | Alle Geburtstage |
| `kalender.0.data.icsUrls` | Externe ICS-Kalender |

---

## Changelog

### 0.5.0 (2026-03-17)
- Zeitzone-Einstellung in Admin-Konfiguration (Standard: Europe/Berlin)
- Alle Zeitvergleiche (Trigger, Tagescheck) timezone-aware via Intl.DateTimeFormat
- Zeitzone wird in Kopfzeile angezeigt

### 0.4.9 (2026-03-17)
- Bugfix: Syntax-Fehler in app.js behoben (Webinterface reagierte nicht)
- Bugfix: loadDpInfoById Hilfsfunktion für querySelector-Problem

### 0.4.8 (2026-03-17)
- Datenpunkt-Aktionen: beliebig viele per + Datenpunkt (dpActions-Array)
- Auto-Typ-Erkennung beim Laden der State-ID aus ioBroker
- Bool: true/false Dropdown, Zahl: Zahlenfeld, Text: Textfeld
- /api/objects-search und /api/object-info Endpunkte
- Filter Aufgaben-Tab: vergangene Einmaltermine nur noch unter Erledigt

### 0.4.7 (2026-03-17)
- Bugfix: Kalenderbreite verschiebt sich bei Terminen nicht mehr
- CSS: minmax(0,1fr), overflow:hidden, display:block auf event-chip

### 0.4.6 (2026-03-17)
- Uhrzeit in Kopfzeile (sekundengenau, Browserzeit)
- ▶ Jetzt-Ausführen-Button auf jeder Aufgabenkarte
- Warnhinweis im Modal: ohne triggerTime feuert Alexa erst um 00:01 Uhr
- /api/trigger-event Endpunkt für manuelle Sofortausführung

### 0.4.5 (2026-03-17)
- Lautstärke-Slider (0-100%) pro Alexa-Gerät pro Aufgabe
- Volume-State wird vor Speak gesetzt (400ms Pause)

### 0.4.4 (2026-03-17)
- Alexa-Picker direkt im Aufgaben-Modal mit Auto-Discover
- Verbesserte Kalenderansicht: Farbpunkte, Wochenend-Highlight, Uhrzeit-Linie

### 0.4.3 (2026-03-17)
- Alexa Geräte automatisch aus ioBroker laden (Gerätename statt GUID)

### 0.4.2 (2026-03-17)
- Fix: 404 beim Öffnen über Admin-UI behoben (admin/index.html)

### 0.4.1 (2026-03-17)
- Fix: SIGKILL beim Start behoben
- Fix: Direktlink im Admin-UI (localLink)

### 0.4.0 (2026-03-17)
- **Neu:** Zeit-Trigger (HH:MM) für täglich exakte Ausführung
- **Neu:** Nachricht-Baukasten: Text + Datenpunkt-Werte kombinieren
- **Neu:** Datenpunkt-Aktion: State setzen (bool/Zahl/Text) direkt beim Trigger
- **Neu:** Google Kalender / ICS-Import (read-only, stündliche Aktualisierung)
- **Aufgaben-Filter** "Geplant" für Zeit-Trigger-Events
- **Alexa-Datenpunkt-Vorschau** im Nachricht-Baukasten

### 0.3.0 (2026-03-17)
- Vollständige Kalender-SPA, Geburtstage, Alexa, Import/Export

---

## Lizenz

MIT — © MPunktBPunkt
