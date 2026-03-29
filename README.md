# free@home Nuki Addon

Ein free@home Addon zur Integration von Nuki Smart Locks in das Busch-Jäger free@home System. Dieses Addon ermöglicht es, mehrere Nuki-Schlösser über mehrere Nuki Bridges hinweg in der free@home Zentrale zu steuern und deren Status zu überwachen.

## Features

- **Multi-Bridge-Support** - Mehrere Nuki Bridges gleichzeitig verwalten
- **Mehrere Nuki-Schlösser** - Pro Bridge beliebig viele Schlösser konfigurieren
- **Automatische Status-Synchronisation** - Status wird regelmäßig aktualisiert (Standard: alle 30 Sekunden)
- **Konfigurierbares Poll-Intervall** - Poll-Intervall pro Bridge individuell einstellbar
- **Konfigurierbarer Port** - Bridge-Port optional anpassbar (Standard: 8080)
- **Vollständige Steuerung** - Verriegeln und Entriegeln direkt aus free@home
- **Offline-Erkennung** - Geräte werden als "nicht erreichbar" markiert, wenn die Bridge offline ist
- **Native Integration** - Verwendet den `simple_doorlock` Gerätetyp für optimale Integration

## Voraussetzungen

- Busch-Jäger free@home System Access Point (SysAP)
- Nuki Smart Lock mit Nuki Bridge
- Node.js 18.x (für Entwicklung)
- Nuki Bridge API Token

## Installation

### 1. Nuki Bridge API Token erstellen

1. Öffne die Nuki Bridge Web-Oberfläche (normalerweise `http://<BRIDGE_IP>:8080`)
2. Navigiere zu den Einstellungen
3. Erstelle einen neuen API Token
4. Notiere dir die Bridge IP-Adresse und den API Token

### 2. Addon installieren

1. Lade das Addon-Archiv herunter oder baue es selbst:
   ```bash
   npm install
   npm run buildProd
   npm run pack
   ```

2. Installiere das Addon in deinem free@home System über die Addon-Verwaltung

## Konfiguration

### Konfigurationsparameter

Nach der Installation musst du das Addon in den free@home Einstellungen konfigurieren. Es gibt einen einzigen Parameter:

**Nuki Bridges** (`nukiBridges`): Ein JSON-Array mit allen Bridges und deren Schlössern.

#### Minimales Beispiel (eine Bridge)

```json
[
  {
    "ip": "192.168.1.100",
    "token": "abc123def456",
    "locks": [
      {
        "id": "594541916",
        "name": "Haustür"
      }
    ]
  }
]
```

#### Erweitertes Beispiel (mehrere Bridges, optionale Parameter)

```json
[
  {
    "ip": "192.168.1.100",
    "port": 8080,
    "token": "abc123def456",
    "pollInterval": 15000,
    "locks": [
      {
        "id": "594541916",
        "name": "Haustür"
      },
      {
        "id": "123456789",
        "name": "Garage"
      }
    ]
  },
  {
    "ip": "192.168.1.101",
    "token": "def456ghi789",
    "locks": [
      {
        "id": "987654321",
        "name": "Büro"
      }
    ]
  }
]
```

#### Parameter pro Bridge

| Parameter | Pflicht | Standard | Beschreibung |
|-----------|---------|---------|--------------|
| `ip` | Ja | – | IP-Adresse der Nuki Bridge im lokalen Netzwerk |
| `token` | Ja | – | API Token der Nuki Bridge |
| `locks` | Ja | – | Array der zu verwaltenden Schlösser (siehe unten) |
| `port` | Nein | `8080` | HTTP-Port der Bridge API |
| `pollInterval` | Nein | `30000` | Status-Abfrageintervall in Millisekunden |

#### Parameter pro Schloss (`locks`)

| Parameter | Pflicht | Beschreibung |
|-----------|---------|--------------|
| `id` | Ja | Nuki Lock ID (numerisch als String) |
| `name` | Ja | Anzeigename in free@home |

### Nuki Lock ID finden

1. **Über die Nuki Bridge API**:
   ```bash
   curl "http://<BRIDGE_IP>:8080/list?token=<API_TOKEN>"
   ```
   Die Antwort enthält ein Array mit allen Schlössern und deren `nukiId`.

2. **Über die Nuki App**: In den Einstellungen des Schlosses findest du die ID

## Verwendung

### Geräte in free@home

Nach der Konfiguration erscheint jedes konfigurierte Schloss als separates Gerät in free@home:

- **Gerätetyp**: Türschloss (`simple_doorlock`)
- **Name**: Der in der Konfiguration angegebene Name
- **Steuerung**: Verriegeln/Entriegeln über die free@home App oder Zentrale

### Status-Synchronisation

- Der Status aller Schlösser einer Bridge wird mit einem einzigen API-Aufruf pro Poll-Zyklus abgefragt
- Änderungen am Schloss werden beim nächsten Poll in free@home angezeigt
- Manuelle Steuerung über free@home wird sofort an das Nuki Schloss weitergegeben
- Nach einer Aktion wird der Status nach 2 Sekunden automatisch nachgefragt

### Offline-Verhalten

Ist eine Nuki Bridge nicht erreichbar, werden alle zugehörigen Geräte in free@home als "nicht erreichbar" (`unresponsive`) markiert. Sobald die Bridge wieder online ist, wird der Status beim nächsten Poll automatisch wiederhergestellt.

### Lock-Zustände

Das Addon unterstützt folgende Nuki Lock-Zustände:

| State | Nuki Status | free@home Anzeige |
|-------|-------------|-------------------|
| 1 | Locked | Verriegelt |
| 2 | Unlocked | Entriegelt |
| 3 | Unlocked (Lock 'n' Go) | Entriegelt |
| 4 | Unlatching | Entriegelt |
| 5 | Locked (Lock 'n' Go) | Verriegelt |
| 6 | Unlocking | Entriegelt |

## Entwicklung

### Projekt-Struktur

```
free-at-home-nuki/
├── src/
│   └── main.ts          # Hauptanwendungslogik
├── build/               # Kompilierte JavaScript-Dateien
├── fhstore/            # free@home Store-Dateien
├── free-at-home-metadata.json  # Addon-Metadaten
├── package.json        # NPM-Abhängigkeiten
└── tsconfig.json       # TypeScript-Konfiguration
```

### Verfügbare Scripts

```bash
# Entwicklung
npm run build           # TypeScript kompilieren
npm start              # Addon starten (für Tests)

# Produktion
npm run buildProd      # Produktions-Build ohne Source Maps
npm run pack           # Addon-Archiv erstellen

# Validierung
npm run validate       # Addon-Metadaten validieren

# Monitoring
npm run journal        # Addon-Logs anzeigen
npm run monitorstate   # Application State überwachen
npm run monitorconfig  # Konfiguration überwachen
```

### Lokale Entwicklung

1. Klone das Repository
2. Installiere Abhängigkeiten:
   ```bash
   npm install
   ```
3. Konfiguriere die `.vscode/launch.json` für Debugging
4. Baue das Projekt:
   ```bash
   npm run build
   ```
5. Teste lokal oder deploye auf deinen SysAP

## API-Referenz

### Nuki Bridge API

Das Addon nutzt die Nuki Bridge Local API:

- **GET** `/list?token=<TOKEN>` - Liste aller Schlösser abrufen (wird einmal pro Poll-Zyklus für alle Schlösser einer Bridge genutzt)
- **GET** `/lockAction?token=<TOKEN>&nukiId=<ID>&action=<ACTION>` - Schloss steuern
  - `action=2`: Verriegeln
  - `action=3`: Entriegeln

Weitere Informationen: [Nuki Bridge API Dokumentation](https://developer.nuki.io/page/nuki-bridge-http-api-1-12/4/)

## Fehlerbehebung

### Schloss wird nicht gefunden

- Überprüfe, ob die Lock ID korrekt ist
- Stelle sicher, dass die Nuki Bridge erreichbar ist
- Prüfe die Logs mit `npm run journal`

### Gerät wird als "nicht erreichbar" angezeigt

- Die Nuki Bridge ist nicht erreichbar oder offline
- Überprüfe IP-Adresse, Port und API Token in der Konfiguration
- Stelle sicher, dass die Bridge im selben Netzwerk ist und kein Firewall-Problem besteht
- Nach Wiederherstellung der Bridge-Verbindung normalisiert sich der Status automatisch

### Status wird nicht aktualisiert

- Überprüfe die Bridge IP und den API Token
- Prüfe die Firewall-Einstellungen
- Überprüfe das konfigurierte `pollInterval` (Standard: 30000 ms)

### Addon startet nicht

- Validiere die Metadaten: `npm run validate`
- Prüfe die Logs auf Fehlermeldungen
- Stelle sicher, dass die JSON-Konfiguration in `nukiBridges` syntaktisch korrekt ist
- Stelle sicher, dass alle Abhängigkeiten installiert sind

## Lizenz

MIT License - Siehe `fhstore/mit-en.txt` für Details.
