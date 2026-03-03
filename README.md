# free@home Nuki Addon

Ein free@home Addon zur Integration von Nuki Smart Locks in das Busch-Jäger/ABB free@home System. Dieses Addon ermöglicht es, mehrere Nuki-Schlösser über die free@home Zentrale zu steuern und deren Status zu überwachen.

## Features

- 🔐 **Mehrere Nuki-Schlösser unterstützen** - Verwalte mehrere Schlösser gleichzeitig
- 🔄 **Automatische Status-Synchronisation** - Status wird alle 30 Sekunden aktualisiert
- 🎛️ **Vollständige Steuerung** - Verriegeln und Entriegeln direkt aus free@home
- 📊 **Echtzeit-Status** - Aktueller Zustand jedes Schlosses wird angezeigt
- 🏠 **Native Integration** - Verwendet den `simple_doorlock` Gerätetyp für optimale Integration

## Voraussetzungen

- ABB free@home System Access Point (SysAP)
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

### Konfiguration in free@home

Nach der Installation musst du das Addon in den free@home Einstellungen konfigurieren:

1. **Nuki Bridge IP**: Die IP-Adresse deiner Nuki Bridge im lokalen Netzwerk
   - Beispiel: `192.168.1.100`

2. **Nuki API Token**: Der API Token deiner Nuki Bridge
   - Beispiel: `abc123def456...`

3. **Nuki Locks**: JSON-Array mit den zu verwaltenden Schlössern
   ```json
   [
     {
       "id": "594541916",
       "name": "Haustür"
     },
     {
       "id": "123456789",
       "name": "Garage"
     }
   ]
   ```

### Nuki Lock ID finden

Die Lock ID findest du auf verschiedene Weise:

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

- Der Status jedes Schlosses wird automatisch alle 30 Sekunden aktualisiert
- Änderungen am Schloss werden sofort in free@home angezeigt
- Manuelle Steuerung über free@home wird sofort an das Nuki Schloss weitergegeben

### Lock-Zustände

Das Addon unterstützt folgende Nuki Lock-Zustände:

- **State 1**: Verriegelt (Locked)
- **State 2**: Entriegelt (Unlocked)
- **State 3**: Entriegelt (Unlocked - Lock 'n' Go)
- **State 4**: Entriegeln (Unlatching)
- **State 5**: Verriegelt (Locked - Lock 'n' Go)
- **State 6**: Entriegeln (Unlocking)

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

- **GET** `/list?token=<TOKEN>` - Liste aller Schlösser abrufen
- **GET** `/lockAction?token=<TOKEN>&nukiId=<ID>&action=<ACTION>` - Schloss steuern
  - `action=2`: Verriegeln
  - `action=3`: Entriegeln

Weitere Informationen: [Nuki Bridge API Dokumentation](https://developer.nuki.io/page/nuki-bridge-http-api-1-12/4/)

## Fehlerbehebung

### Schloss wird nicht gefunden

- Überprüfe, ob die Lock ID korrekt ist
- Stelle sicher, dass die Nuki Bridge erreichbar ist
- Prüfe die Logs mit `npm run journal`

### Status wird nicht aktualisiert

- Überprüfe die Bridge IP und den API Token
- Stelle sicher, dass die Bridge im selben Netzwerk ist
- Prüfe die Firewall-Einstellungen

### Addon startet nicht

- Validiere die Metadaten: `npm run validate`
- Prüfe die Logs auf Fehlermeldungen
- Stelle sicher, dass alle Abhängigkeiten installiert sind

## Lizenz

MIT License - Siehe `fhstore/mit-en.txt` für Details.