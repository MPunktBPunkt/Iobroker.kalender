# INSTALLATION — iobroker.kalender

## Voraussetzungen

- ioBroker mit js-controller ≥ 5.0
- Node.js ≥ 16
- Port 8095 frei (konfigurierbar)

---

## Methode 1: Via ioBroker URL (empfohlen)

```bash
iobroker url https://github.com/MPunktBPunkt/iobroker.kalender
iobroker restart kalender.0
```

---

## Methode 2: Manuell (Tarball/Ordner)

```bash
# 1. Dateien kopieren
cp -r iobroker.kalender /opt/iobroker/node_modules/

# 2. npm install als iobroker-User
sudo -u iobroker -H bash -c "cd /opt/iobroker/node_modules/iobroker.kalender && npm install"

# 3. Adapter hinzufügen
iobroker add kalender

# 4. Starten
iobroker start kalender.0
```

---

## Erstkonfiguration

1. ioBroker Admin → Adapter → Kalender → Instanz-Einstellungen
2. **Port:** 8095 (Standard, anpassen falls belegt)
3. **Alexa-Geräte** können direkt im Web-Dashboard unter System konfiguriert werden

---

## Alexa-Adapter einrichten

Falls noch nicht installiert:
```bash
iobroker add alexa2
```

Dann in den alexa2-Einstellungen Alexa-Account verknüpfen.
State-Pfad für Sprachausgabe: `alexa2.0.Echo-Devices.<SERIAL>.Commands.speak`

Die Seriennummer findest du in den alexa2-States unter `alexa2.0.Echo-Devices`.

---

## Port prüfen

```bash
# Prüfen ob Port 8095 frei ist
ss -tlnp | grep 8095
```

Falls belegt, anderen Port in den Adapter-Einstellungen wählen.

---

## Update

```bash
iobroker url https://github.com/MPunktBPunkt/iobroker.kalender
iobroker restart kalender.0
```

Oder im Web-Dashboard unter **System → Aktionen**.
