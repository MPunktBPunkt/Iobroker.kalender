# iobroker.kalender

[![Version](https://img.shields.io/badge/version-0.4.1-blue)](https://github.com/MPunktBPunkt/iobroker.kalender)
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
