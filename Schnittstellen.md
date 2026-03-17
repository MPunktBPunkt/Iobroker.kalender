# Schnittstellen.md — iobroker.kalender v0.5.0

## HTTP REST-API (Port 8095)

### Allgemein

| Header | Wert |
|---|---|
| Content-Type | application/json |
| Access-Control-Allow-Origin | * |

---

## GET /api/ping
Health-Check.
```json
{ "ok": true, "ts": 1742213456789 }
```

## GET /api/data
Alle Adapterdaten auf einmal.
```json
{
  "events":       [...],
  "birthdays":    [...],
  "icsEvents":    [...],
  "icsUrls":      [...],
  "alexaDevices": [...],
  "version":      "0.4.0",
  "lastCheck":    "2026-03-17T07:00:01.000Z"
}
```

## GET /api/version
```json
{ "current": "0.4.0", "latest": "0.4.0" }
```

## POST /api/trigger
Tagesprüfung sofort ausführen.
```json
{ "ok": true }
```

## GET /api/foreign-state?id=pool.0.temperature
Datenpunkt-Wert lesen (für Nachricht-Vorschau).
```json
{ "id": "pool.0.temperature", "val": 23.5, "ts": 1742213456789, "ok": true }
```

---

## Events

### GET /api/events
Alle Events als Array.

### POST /api/events
Neuen Event anlegen.

**Request:**
```json
{
  "title":            "Pool Morgenroutine",
  "date":             "2026-03-17",
  "time":             "",
  "endTime":          "",
  "allDay":           false,
  "type":             "event",
  "color":            "#3fb950",
  "recurrence":       "daily",
  "recurrenceEnd":    "",

  "triggerTime":      "07:30",

  "setDatapointId":   "pool.0.pump.switch",
  "setDatapointValue":"true",
  "setDatapointType": "boolean",

  "iobCounterId":     "",
  "iobDatapointId":   "",
  "iobDatapointValue": true,

  "messageSegments": [
    { "type": "text",      "value": "Guten Morgen! Pooltemperatur: " },
    { "type": "datapoint", "stateId": "pool.0.temperature", "prefix": "", "suffix": " Grad." }
  ],
  "alexaMessage":     "",
  "alexaDatapoints":  ["alexa2.0.Echo-Devices.G091AA10135600WP.Commands.speak"]
}
```

### PUT /api/events/:id
Event aktualisieren (partial update möglich).

### DELETE /api/events/:id
```json
{ "ok": true }
```

---

## Birthdays

### GET /api/birthdays
### POST /api/birthdays
```json
{
  "name":              "Max Mustermann",
  "date":              "1990-03-17",
  "notifyDaysBefore":  3,
  "alexaMessage":      "In {days} Tagen hat {name} Geburtstag! Er wird {age} Jahre alt.",
  "alexaDatapoints":   ["alexa2.0.Echo-Devices.G091AA10135600WP.Commands.speak"]
}
```
### PUT /api/birthdays/:id
### DELETE /api/birthdays/:id

---

## ICS / Externe Kalender

### GET /api/ics-urls
```json
[{ "name": "Familie", "url": "https://calendar.google.com/...basic.ics", "color": "#a371f7" }]
```

### POST /api/ics-urls
```json
{ "urls": [{ "name": "Familie", "url": "https://...", "color": "#a371f7" }] }
```

### POST /api/ics-refresh
ICS-Kalender sofort neu laden.
```json
{ "ok": true, "message": "ICS-Kalender werden geladen..." }
```

### GET /api/ics-events
Alle geladenen ICS-Events als Array.

---

## Alexa

### POST /api/alexa
```json
{ "devices": [{ "name": "Wohnzimmer", "stateId": "alexa2.0.Echo-Devices.G091AA10135600WP.Commands.speak" }] }
```

---

## Logs

### GET /api/logs
```json
[{ "ts": 1742213456789, "level": "info", "cat": "TRIGGER", "msg": "Zeit-Trigger 07:30: Pool Morgenroutine" }]
```

Level: `debug` | `info` | `warn` | `error`
Kategorien: `SYSTEM` | `CHECK` | `TRIGGER` | `ALEXA` | `ICS` | `EVENT` | `BIRTHDAY` | `SERVER`

---

## Datenpunkt-Typen (setDatapointType)

| Wert | Konvertierung |
|---|---|
| `boolean` | `"true"/"false"` → `true/false` |
| `number` | `parseFloat(val)` |
| `string` | String bleibt String |

---

## Segment-Typen (messageSegments)

| Typ | Felder | Beschreibung |
|---|---|---|
| `text` | `value: string` | Statischer Text |
| `datapoint` | `stateId, prefix, suffix` | Wert wird zur Laufzeit gelesen |

Beispiel-Ergebnis: `"Guten Morgen! Pooltemperatur: 23.5 Grad. Pumpe läuft."`

---

## Alexa-Integration

State-Pfad: `alexa2.0.Echo-Devices.<SERIAL>.Commands.speak`

Seriennummer aus ioBroker Objects → alexa2.0.Echo-Devices.

Alternativ `announcement` statt `speak` für Ansagen mit Gong.

---

## Alexa Volume (v0.4.5)

`alexaVolumes` im Event/Birthday-Objekt: `{ "<stateId>": <0-100> }`

Beispiel:
```json
"alexaVolumes": {
  "alexa2.0.Echo-Devices.G091AA10135600WP.Commands.speak": 60,
  "alexa2.0.Echo-Devices.G070VM098487295E.Commands.speak": 80
}
```

Kein Eintrag = Lautstärke wird nicht verändert.

## GET /api/alexa-discover (v0.4.3+)
```json
{
  "devices": [
    {
      "name":          "Echo Dot Bad",
      "serial":        "G091AA10135600WP",
      "stateId":       "alexa2.0.Echo-Devices.G091AA10135600WP.Commands.speak",
      "volumeStateId": "alexa2.0.Echo-Devices.G091AA10135600WP.Commands.volume"
    }
  ]
}
```

---

## GET /api/objects-search?q=<query> (v0.4.8+)
Sucht ioBroker States per Wildcard-Pattern (max. 30 Ergebnisse).
```json
{ "objects": [{ "id": "pool.0.pump", "type": "boolean", "name": "Poolpumpe", "unit": "" }] }
```

## GET /api/object-info?id=<stateId> (v0.4.8+)
Lädt Typ, Name, Einheit und aktuellen Wert eines States.
```json
{ "found": true, "id": "pool.0.pump", "type": "boolean", "name": "Poolpumpe",
  "unit": "", "states": null, "min": null, "max": null, "currentVal": true }
```

## POST /api/trigger-event (v0.4.6+)
Führt einen einzelnen Event sofort aus (Alexa + Datenpunkte).
```json
Request:  { "id": "lx8abc123" }
Response: { "ok": true, "title": "Pool Morgenroutine" }
```

## dpActions Array (v0.4.8+)
Mehrere Datenpunkt-Aktionen pro Event:
```json
"dpActions": [
  { "id": "pool.0.pump.switch", "type": "boolean", "value": "true",  "name": "Pumpe", "unit": "" },
  { "id": "pool.0.heater",      "type": "boolean", "value": "false", "name": "Heizer","unit": "" }
]
```

## Zeitzone (v0.5.0+)
Konfigurierbar in Admin-UI. Wird in `/api/data` als `timezone`-Feld zurückgegeben.
Alle Zeitvergleiche (minuteTick, dailyCheck, todayStr) arbeiten in der konfigurierten Zeitzone.
