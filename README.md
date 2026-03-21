# iobroker.kalender

[![Version](https://img.shields.io/badge/version-0.5.8-blue)](https://github.com/MPunktBPunkt/iobroker.kalender)
[![License](https://img.shields.io/badge/license-GPL%20v3-blue)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D16-brightgreen)](https://nodejs.org)
[![Donate](https://img.shields.io/badge/Donate-PayPal-00457C.svg?logo=paypal)](https://www.paypal.com/donate/?business=martin%40bchmnn.de&currency_code=EUR)

Vollständiger **Kalender-Adapter** für ioBroker mit Web-Dashboard, Alexa-Sprachausgabe, Zeit-Triggern und Google Kalender-Integration.

---

## Features

| Feature | Beschreibung |
|---|---|
| 📅 Kalenderansicht | Tag / Woche / Monat — Klick öffnet Tages-Panel |
| ✅ Aufgaben & Termine | Serieneinträge: täglich, werktags, wöchentlich, monatlich, jährlich |
| 📅 Wochentage | Frei wählbare Wochentage + Werktags-Preset |
| ⏰ Zeit-Trigger | Alexa + Datenpunkte automatisch zu HH:MM Uhr auslösen |
| 🔔 Erinnerung | X Minuten / Stunden / Tage vor dem Termin per Alexa |
| 🗣️ Nachricht bauen | Text + Datenpunkt-Werte kombinieren für individuelle Ansagen |
| 🔗 Datenpunkt-Aktionen | Beliebig viele States setzen (Bool/Zahl/Text) — mit Adapter-Picker |
| 🎂 Geburtstags-Manager | Countdown, Altersanzeige, Vorankündigung per Alexa |
| 📆 Google Kalender | ICS/iCal URL Import (read-only, stündlich aktualisiert) |
| 🗣️ Alexa | Mehrere Geräte, Lautstärke pro Gerät einstellbar |
| 🕐 Wecker-Tab | Alle geplanten Aufgaben mit großer Uhrzeitanzeige |
| 🕒 Zeitzone | Automatisch aus ioBroker system.config + Sync-Tool |
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

Das Web-Dashboard ist erreichbar unter: `http://<iobroker-ip>:8095`

---

## Kurzanleitung: Poolpumpe morgens ein, abends aus + Alexa-Ansage

**Morgens:**
1. Neuer Termin → Wiederholung: Täglich, Uhrzeit: `07:30`
2. Datenpunkt-Aktion: Adapter `pool.0` → State `pump.switch` → `true`
3. Nachricht bauen: `"Guten Morgen! Pooltemperatur: "` + Datenpunkt `pool.0.temperature` + `" Grad."`
4. Alexa-Gerät auswählen (🔄 für Auto-Erkennung) → Speichern

**Abends:**
1. Neuer Termin → Täglich, Uhrzeit: `21:00`
2. Datenpunkt-Aktion: `pool.0.pump.switch` → `false`

---

## Alexa einrichten

State-Pfad im alexa2-Adapter:
```
alexa2.0.Echo-Devices.<SERIAL>.Commands.speak   ← Sprachausgabe
alexa2.0.Echo-Devices.<SERIAL>.Commands.volume  ← Lautstärke (0–100)
```

Die Seriennummer findet man in ioBroker → Objekte → alexa2.0.Echo-Devices.  
Im Adapter einfach auf 🔄 klicken — alle Echo-Geräte werden automatisch erkannt.

---

## Google Kalender einbinden

1. Google Kalender → ⚙️ Einstellungen → Kalender auswählen → **Privatadresse im iCal-Format** kopieren
2. Kalender-Adapter → System-Tab → Externe Kalender → URL einfügen → Hinzufügen
3. Der Adapter lädt die Kalender stündlich und zeigt sie lila (read-only) in der Kalenderansicht an

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

## Weitere Adapter von MPunktBPunkt

| Adapter | Beschreibung |
|---|---|
| [iobroker.metermaster](https://github.com/MPunktBPunkt/iobroker.metermaster) | Zählerstand-App: Strom, Wasser, Gas per Android-App ablesen |
| [iobroker.linuxdashboard](https://github.com/MPunktBPunkt/iobroker.linuxdashboard) | Linux System-Dashboard: CPU, RAM, Dienste, Terminal |
| [iobroker.kostalpiko](https://github.com/MPunktBPunkt/iobroker.kostalpiko) | Kostal PIKO Solar-Wechselrichter (PIKO 8.3 / 5.5) |
| [iobroker.fritzwireguard](https://github.com/MPunktBPunkt/iobroker.FritzWireguard) | WireGuard VPN über FritzBox mit TCP-Tunnel-Manager |
| [iobroker.freeair100](https://github.com/MPunktBPunkt/Iobroker.freeair100) | bluMartin freeAir 100 Lüftungsgerät |
| [iobroker.mbrepository](https://github.com/MPunktBPunkt/iobroker.mbrepository) | Eigene Adapter verwalten, updaten, installieren |

---

## Changelog

### 0.5.7 (2026-03-18)
- Bugfix: Adapter-Dropdown im Datenpunkt-Picker springt nicht mehr zurück

### 0.5.6 (2026-03-18)
- Neu: Datenpunkt-Picker mit Adapter-Instanz + State Dropdown
- Bugfix: Klick auf Kalendertag öffnet Tages-Panel (nicht mehr Event-Modal)

### 0.5.5 (2026-03-18)
- Neu: Wecker-Tab mit großer Uhrzeitanzeige
- Neu: Tages-Panel beim Klick auf Kalender-Tag
- Bugfix: Tagesansicht scrollt jetzt bis 24:00 Uhr

### 0.5.4 (2026-03-17)
- Neu: Wochentage bei wöchentlicher Wiederholung (Mo–So, Werktags-Preset)
- Neu: Erinnerung X Minuten/Stunden/Tage vorher per Alexa
- Uhrzeit = Auslöser (ein Feld statt zwei)

### 0.5.0–0.5.3 (2026-03-17)
- Zeitzone automatisch aus ioBroker system.config
- Zeitzone-Dashboard im System-Tab mit Linux-Sync

### 1.0.0 (2026-03-18)
_Erste stabile Veröffentlichung nach Entwicklungsphase (0.x)_

---

## Lizenz

**GNU General Public License v3.0**

Dieses Projekt steht unter der GPL v3. Du darfst den Code verwenden, studieren und weitergeben — aber Modifikationen müssen ebenfalls unter der GPL v3 veröffentlicht werden und den Copyright-Hinweis enthalten.

© 2026 [MPunktBPunkt](https://github.com/MPunktBPunkt)

---

## Unterstützung

Wenn dir dieser Adapter gefällt und du die Weiterentwicklung unterstützen möchtest:

[![Donate](https://img.shields.io/badge/Donate-PayPal-00457C.svg?logo=paypal)](https://www.paypal.com/donate/?business=martin%40bchmnn.de&currency_code=EUR)
