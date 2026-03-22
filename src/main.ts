import { FreeAtHome, AddOn, PairingIds, FreeAtHomeRawChannel } from '@busch-jaeger/free-at-home';
import * as http from 'http';

const freeAtHome = new FreeAtHome();
freeAtHome.activateSignalHandling();

// Konstanten
const NUKI_BRIDGE_PORT = 8080;
const STATUS_UPDATE_INTERVAL_MS = 30000;
const STATUS_UPDATE_DELAY_AFTER_ACTION_MS = 2000;
const STATUS_UPDATE_DELAY_AFTER_ERROR_MS = 1000;
const BRIDGE_CONNECTION_TIMEOUT_MS = 5000;

// Nuki Lock States
enum NukiLockState {
  UNCALIBRATED = 0,
  LOCKED = 1,
  UNLOCKED = 2,
  UNLOCKED_LOCK_N_GO = 3,
  UNLATCHING = 4,
  LOCKED_N_GO = 5,
  UNLOCKING = 6
}

// Nuki Lock Actions
enum NukiLockAction {
  LOCK = 2,
  UNLOCK = 3
}

// Interfaces
interface NukiLockStatus {
  nukiId: number;
  name: string;
  batteryCritical: boolean;
  state: NukiLockState;
  stateName: string;
  batteryChargeState: number;
  success: boolean;
}

interface NukiLockConfig {
  id: string;
  name: string;
}

interface NukiBridgeConfig {
  ip: string;
  token: string;
  locks: NukiLockConfig[];
}

interface ManagedLock {
  config: NukiLockConfig;
  device: FreeAtHomeRawChannel;
  isUpdating: boolean;
}

interface ManagedBridge {
  config: NukiBridgeConfig;
  apiClient: NukiApiClient;
  statusIntervalId?: NodeJS.Timeout;
}

interface NukiApiResponse {
  success: boolean;
  [key: string]: any;
}

interface NukiBridgeLock {
  deviceType: number;
  nukiId: number;
  name: string;
  firmwareVersion: string;
  lastKnownState?: {
    mode: number;
    state: number;
    stateName: string;
    batteryCritical: boolean;
    batteryCharging: boolean;
    batteryChargeState: number;
    timestamp: string;
  };
}

interface AddOnConfiguration {
  nukiBridges?: string;
}

// Nuki API Client
class NukiApiClient {
  constructor(
    private bridgeIp: string,
    private apiToken: string
  ) {}

  /**
   * Führt einen HTTP GET Request zur Nuki Bridge API aus
   */
  private async httpGet(endpoint: string, timeoutMs: number = 10000): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const url = `http://${this.bridgeIp}:${NUKI_BRIDGE_PORT}${endpoint}`;

      const req = http.get(url, (res: http.IncomingMessage) => {
        let data = '';

        res.on('data', (chunk: Buffer) => {
          data += chunk.toString();
        });

        res.on('end', () => {
          resolve(data);
        });
      }).on('error', (error: Error) => {
        reject(error);
      });

      req.setTimeout(timeoutMs, () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
    });
  }

  /**
   * Gibt alle Schlösser der Bridge zurück
   */
  async listAllLocks(): Promise<NukiBridgeLock[]> {
    const response = await this.httpGet(`/list?token=${this.apiToken}`, BRIDGE_CONNECTION_TIMEOUT_MS);
    return JSON.parse(response) as NukiBridgeLock[];
  }

  /**
   * Ruft den Status eines Nuki Schlosses ab
   */
  async getLockStatus(lockId: string): Promise<NukiLockStatus | null> {
    try {
      const locks = await this.listAllLocks();
      const lock = locks.find((l) => l.nukiId.toString() === lockId);

      if (!lock) {
        console.warn(`Nuki Lock mit ID ${lockId} nicht gefunden`);
        return null;
      }

      const lastKnownState = lock.lastKnownState;
      if (!lastKnownState) {
        console.warn(`Nuki Lock mit ID ${lockId} hat keinen lastKnownState`);
        return null;
      }

      return {
        nukiId: lock.nukiId,
        name: lock.name || '',
        batteryCritical: lastKnownState.batteryCritical === true,
        state: lastKnownState.state as NukiLockState,
        stateName: lastKnownState.stateName || 'unknown',
        batteryChargeState: lastKnownState.batteryChargeState ?? 0,
        success: true
      };
    } catch (error) {
      console.error(`Fehler beim Abfragen des Nuki Status für Lock ${lockId}:`, error);
      throw error;
    }
  }

  /**
   * Führt eine Lock-Aktion aus (Verriegeln/Entriegeln)
   */
  async executeLockAction(lockId: string, action: NukiLockAction): Promise<boolean> {
    try {
      const response = await this.httpGet(
        `/lockAction?token=${this.apiToken}&nukiId=${lockId}&action=${action}`
      );

      const result: NukiApiResponse = JSON.parse(response);

      if (result.success === true) {
        const actionName = action === NukiLockAction.LOCK ? 'verriegelt' : 'entriegelt';
        console.log(`Nuki Tür erfolgreich ${actionName} (Lock ID: ${lockId})`);
        return true;
      } else {
        throw new Error(`Nuki API Fehler: ${JSON.stringify(result)}`);
      }
    } catch (error) {
      console.error(`Fehler beim Ausführen der Lock-Aktion für Lock ${lockId}:`, error);
      throw error;
    }
  }

  /**
   * Verriegelt ein Schloss
   */
  async lock(lockId: string): Promise<boolean> {
    return this.executeLockAction(lockId, NukiLockAction.LOCK);
  }

  /**
   * Entriegelt ein Schloss
   */
  async unlock(lockId: string): Promise<boolean> {
    return this.executeLockAction(lockId, NukiLockAction.UNLOCK);
  }
}

// Lock Manager - Verwaltet ein einzelnes Lock
class LockManager {
  constructor(
    private config: NukiLockConfig,
    private device: FreeAtHomeRawChannel,
    private apiClient: NukiApiClient,
    private managedLock: ManagedLock
  ) {
    this.setupEventHandlers();
  }

  /**
   * Richtet Event-Handler für Lock-Commands ein
   */
  private setupEventHandlers(): void {
    this.device.on('datapointChanged', async (id: PairingIds, value: string) => {
      if (this.managedLock.isUpdating) {
        return;
      }

      if (id === PairingIds.AL_LOCK_UNLOCK_COMMAND) {
        await this.handleLockCommand(value === "1");
      }
    });
  }

  /**
   * Behandelt Lock/Unlock Commands von free@home
   */
  private async handleLockCommand(shouldLock: boolean): Promise<void> {
    const action = shouldLock ? "VERRIEGELN" : "ENTRIEGELN";
    console.log(`[${this.config.name}] Lock Command: ${action}`);

    try {
      if (shouldLock) {
        await this.apiClient.lock(this.config.id);
      } else {
        await this.apiClient.unlock(this.config.id);
      }

      setTimeout(() => this.updateStatus(), STATUS_UPDATE_DELAY_AFTER_ACTION_MS);
    } catch (error) {
      console.error(`[${this.config.name}] Fehler beim ${action}:`, error);
      setTimeout(() => this.updateStatus(), STATUS_UPDATE_DELAY_AFTER_ERROR_MS);
    }
  }

  /**
   * Wendet einen bereits abgerufenen Lock-Status auf das Gerät an
   */
  async applyStatus(lockStatus: NukiLockStatus | null): Promise<void> {
    if (!lockStatus || this.managedLock.isUpdating) {
      return;
    }

    this.managedLock.isUpdating = true;
    try {
      const isLocked = lockStatus.state === NukiLockState.LOCKED;
      await this.device.setOutputDatapoint(
        PairingIds.AL_INFO_LOCK_UNLOCK_COMMAND,
        isLocked ? "1" : "0"
      );

      console.log(
        `[${this.config.name}] Status aktualisiert: ${lockStatus.stateName} ` +
        `(State: ${lockStatus.state}) -> ${isLocked ? "VERRIEGELT" : "ENTRIEGELT"}`
      );
    } finally {
      this.managedLock.isUpdating = false;
    }
  }

  /**
   * Aktualisiert den Lock-Status von der Nuki API (für Post-Aktion-Abfragen)
   */
  async updateStatus(): Promise<void> {
    try {
      const lockStatus = await this.apiClient.getLockStatus(this.config.id);
      await this.applyStatus(lockStatus);
    } catch (error) {
      console.error(`[${this.config.name}] Fehler beim Abfragen des Status:`, error);
    }
  }

  /**
   * Bereinigt Ressourcen
   */
  dispose(): void {
    // Kein eigener Interval mehr – Polling erfolgt auf Bridge-Ebene
  }
}

// Konfigurations-Parser
class ConfigurationParser {
  /**
   * Extrahiert alle Bridge-Konfigurationen aus dem nukiBridges JSON-Array.
   */
  static extractBridgeConfigs(config: AddOn.Configuration): NukiBridgeConfig[] {
    const defaultConfig = config.default?.items as AddOnConfiguration | undefined;

    if (defaultConfig?.nukiBridges && typeof defaultConfig.nukiBridges === 'string') {
      try {
        const parsed = JSON.parse(defaultConfig.nukiBridges);
        if (Array.isArray(parsed)) {
          const bridges = parsed.filter((b: any): b is NukiBridgeConfig =>
            b &&
            typeof b.ip === 'string' && b.ip &&
            typeof b.token === 'string' && b.token &&
            Array.isArray(b.locks)
          );
          if (bridges.length > 0) {
            return bridges;
          }
        }
      } catch (error) {
        console.error("Fehler beim Parsen der Bridge-Konfiguration:", error);
      }
    }

    console.warn("Keine gültige Bridge-Konfiguration gefunden");
    return [];
  }
}

// Hauptklasse für die Addon-Verwaltung
class NukiAddonManager {
  private managedBridges: Map<string, ManagedBridge> = new Map();
  private managedLocks: Map<string, ManagedLock> = new Map();
  private lockManagers: Map<string, LockManager> = new Map();

  constructor(private addOn: AddOn.AddOn) {
    this.setupConfigurationHandler();
  }

  /**
   * Richtet den Handler für Konfigurationsänderungen ein
   */
  private setupConfigurationHandler(): void {
    this.addOn.on("configurationChanged", async (configuration: AddOn.Configuration) => {
      console.log("Konfiguration geändert");
      await this.handleConfigurationChange(configuration);
    });

    this.addOn.connectToConfiguration();
  }

  /**
   * Behandelt Konfigurationsänderungen
   */
  private async handleConfigurationChange(configuration: AddOn.Configuration): Promise<void> {
    const bridgeConfigs = ConfigurationParser.extractBridgeConfigs(configuration);

    // Entferne Bridges, die nicht mehr konfiguriert sind
    for (const [bridgeIp, managedBridge] of this.managedBridges.entries()) {
      if (!bridgeConfigs.find(b => b.ip === bridgeIp)) {
        this.disposeBridge(bridgeIp, managedBridge);
        this.managedBridges.delete(bridgeIp);
      }
    }

    // Neue Bridges hinzufügen; bestehende Locks aktualisieren
    for (const bridgeConfig of bridgeConfigs) {
      if (!this.managedBridges.has(bridgeConfig.ip)) {
        await this.createBridge(bridgeConfig);
      } else {
        const managedBridge = this.managedBridges.get(bridgeConfig.ip)!;
        managedBridge.config = bridgeConfig;
        await this.initializeLocks(bridgeConfig, managedBridge.apiClient);
      }
    }

    console.log(`${this.managedBridges.size} Nuki Bridge(s) konfiguriert`);
  }

  /**
   * Erstellt eine neue Bridge und startet den Poll-Zyklus
   */
  private async createBridge(bridgeConfig: NukiBridgeConfig): Promise<void> {
    const apiClient = new NukiApiClient(bridgeConfig.ip, bridgeConfig.token);

    const managedBridge: ManagedBridge = {
      config: bridgeConfig,
      apiClient
    };

    this.managedBridges.set(bridgeConfig.ip, managedBridge);

    await this.initializeLocks(bridgeConfig, apiClient);
    this.startBridgePoll(managedBridge);

    console.log(`Bridge ${bridgeConfig.ip} initialisiert`);
  }

  /**
   * Bereinigt alle Ressourcen einer Bridge
   */
  private disposeBridge(bridgeIp: string, managedBridge: ManagedBridge): void {
    if (managedBridge.statusIntervalId) {
      clearInterval(managedBridge.statusIntervalId);
    }

    for (const lockConfig of managedBridge.config.locks) {
      const lockKey = `${bridgeIp}:${lockConfig.id}`;
      const manager = this.lockManagers.get(lockKey);
      if (manager) {
        manager.dispose();
        this.lockManagers.delete(lockKey);
      }
      this.managedLocks.delete(lockKey);
    }

    console.log(`Bridge ${bridgeIp} entfernt`);
  }

  /**
   * Ruft einmal /list ab und verteilt die Ergebnisse an alle Locks der Bridge.
   * Schlägt der Aufruf fehl, werden alle Locks als unresponsive markiert.
   */
  private async pollBridge(managedBridge: ManagedBridge): Promise<void> {
    const bridgeIp = managedBridge.config.ip;

    try {
      const allLocks = await managedBridge.apiClient.listAllLocks();

      for (const [lockKey, managedLock] of this.managedLocks.entries()) {
        if (!lockKey.startsWith(`${bridgeIp}:`)) {
          continue;
        }

        const manager = this.lockManagers.get(lockKey);
        if (!manager) {
          continue;
        }

        const bridgeLock = allLocks.find(l => l.nukiId.toString() === managedLock.config.id);
        if (!bridgeLock?.lastKnownState) {
          continue;
        }

        const lks = bridgeLock.lastKnownState;
        const lockStatus: NukiLockStatus = {
          nukiId: bridgeLock.nukiId,
          name: bridgeLock.name || '',
          batteryCritical: lks.batteryCritical === true,
          state: lks.state as NukiLockState,
          stateName: lks.stateName || 'unknown',
          batteryChargeState: lks.batteryChargeState ?? 0,
          success: true
        };

        await manager.applyStatus(lockStatus);
      }
    } catch (error) {
      console.warn(`Nuki Bridge ${bridgeIp} nicht erreichbar – Aktoren werden deaktiviert`);
      for (const [lockKey, managedLock] of this.managedLocks.entries()) {
        if (lockKey.startsWith(`${bridgeIp}:`)) {
          try {
            await managedLock.device.setUnresponsive();
          } catch (err) {
            console.error(`Fehler beim Deaktivieren von ${managedLock.config.name}:`, err);
          }
        }
      }
    }
  }

  /**
   * Startet den regelmäßigen Poll-Zyklus für eine Bridge
   */
  private startBridgePoll(managedBridge: ManagedBridge): void {
    if (managedBridge.statusIntervalId) {
      clearInterval(managedBridge.statusIntervalId);
    }

    this.pollBridge(managedBridge);

    managedBridge.statusIntervalId = setInterval(
      () => this.pollBridge(managedBridge),
      STATUS_UPDATE_INTERVAL_MS
    );
  }

  /**
   * Synchronisiert die Locks einer Bridge mit der Konfiguration
   */
  private async initializeLocks(bridgeConfig: NukiBridgeConfig, apiClient: NukiApiClient): Promise<void> {
    const bridgeIp = bridgeConfig.ip;

    // Entferne Locks, die nicht mehr konfiguriert sind
    for (const [lockKey, managedLock] of this.managedLocks.entries()) {
      if (!lockKey.startsWith(`${bridgeIp}:`)) {
        continue;
      }
      if (!bridgeConfig.locks.find(l => l.id === managedLock.config.id)) {
        const manager = this.lockManagers.get(lockKey);
        if (manager) {
          manager.dispose();
          this.lockManagers.delete(lockKey);
        }
        this.managedLocks.delete(lockKey);
        console.log(`Lock ${managedLock.config.id} von Bridge ${bridgeIp} entfernt`);
      }
    }

    // Neue Locks erstellen
    for (const lockConfig of bridgeConfig.locks) {
      const lockKey = `${bridgeIp}:${lockConfig.id}`;
      if (!this.managedLocks.has(lockKey)) {
        await this.createLockDevice(lockConfig, bridgeIp, apiClient);
      }
    }

    console.log(`${bridgeConfig.locks.length} Schloss/Schlösser für Bridge ${bridgeIp} konfiguriert`);
  }

  /**
   * Erstellt ein Lock-Gerät und den zugehörigen Manager
   */
  private async createLockDevice(config: NukiLockConfig, bridgeIp: string, apiClient: NukiApiClient): Promise<void> {
    try {
      console.log(`Initialisiere Lock: ${config.name} (ID: ${config.id}) an Bridge ${bridgeIp}`);

      const deviceId = `nuki-lock-${bridgeIp.replace(/\./g, '-')}-${config.id}`;
      const device = await freeAtHome.createRawDevice(deviceId, config.name, "simple_doorlock");
      device.setAutoKeepAlive(true);
      device.isAutoConfirm = true;

      const managedLock: ManagedLock = {
        config,
        device,
        isUpdating: false
      };

      const lockKey = `${bridgeIp}:${config.id}`;
      const manager = new LockManager(config, device, apiClient, managedLock);

      this.managedLocks.set(lockKey, managedLock);
      this.lockManagers.set(lockKey, manager);
    } catch (error) {
      console.error(`Fehler beim Erstellen des Lock-Geräts für ${config.name}:`, error);
    }
  }
}

// Hauptfunktion
async function main(): Promise<void> {
  const metaData = AddOn.readMetaData();
  const addOn = new AddOn.AddOn(metaData.id);

  new NukiAddonManager(addOn);

  console.log("Nuki Addon initialisiert");
}

main().catch((error) => {
  console.error("Kritischer Fehler beim Starten des Addons:", error);
  process.exit(1);
});
