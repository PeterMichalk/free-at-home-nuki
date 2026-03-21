import { FreeAtHome, AddOn, PairingIds, FreeAtHomeRawChannel } from '@busch-jaeger/free-at-home';
import * as http from 'http';

// Konstanten
const NUKI_BRIDGE_PORT = 8080;
export const STATUS_UPDATE_INTERVAL_MS = 30000;
export const STATUS_UPDATE_DELAY_AFTER_ACTION_MS = 2000;
export const STATUS_UPDATE_DELAY_AFTER_ERROR_MS = 1000;
const CONFIG_LOAD_DELAY_MS = 2000;

// Nuki Lock States
export enum NukiLockState {
  UNCALIBRATED = 0,
  LOCKED = 1,
  UNLOCKED = 2,
  UNLOCKED_LOCK_N_GO = 3,
  UNLATCHING = 4,
  LOCKED_N_GO = 5,
  UNLOCKING = 6
}

// Nuki Lock Actions
export enum NukiLockAction {
  LOCK = 2,
  UNLOCK = 3
}

// Interfaces
export interface NukiLockStatus {
  nukiId: number;
  name: string;
  batteryCritical: boolean;
  state: NukiLockState;
  stateName: string;
  batteryChargeState: number;
  success: boolean;
}

export interface NukiLockConfig {
  id: string;
  name: string;
}

export interface ManagedLock {
  config: NukiLockConfig;
  device: FreeAtHomeRawChannel;
  isUpdating: boolean;
  updateIntervalId?: NodeJS.Timeout;
}

export interface NukiApiResponse {
  success: boolean;
  [key: string]: any;
}

export interface NukiBridgeLock {
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

export interface AddOnConfiguration {
  nukiBridgeIp?: string;
  nukiApiToken?: string;
  nukiLocks?: string;
}

// Nuki API Client
export class NukiApiClient {
  constructor(
    private bridgeIp: string,
    private apiToken: string
  ) {}

  /**
   * Führt einen HTTP GET Request zur Nuki Bridge API aus
   */
  private async httpGet(endpoint: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const url = `http://${this.bridgeIp}:${NUKI_BRIDGE_PORT}${endpoint}`;

      http.get(url, (res: http.IncomingMessage) => {
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
    });
  }

  /**
   * Ruft den Status eines Nuki Schlosses ab
   */
  async getLockStatus(lockId: string): Promise<NukiLockStatus | null> {
    try {
      const response = await this.httpGet(`/list?token=${this.apiToken}`);
      const locks: NukiBridgeLock[] = JSON.parse(response);

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
export class LockManager {
  private updateIntervalId?: NodeJS.Timeout;

  constructor(
    private config: NukiLockConfig,
    private device: FreeAtHomeRawChannel,
    private apiClient: NukiApiClient,
    private managedLock: ManagedLock
  ) {
    this.setupEventHandlers();
    this.startStatusUpdates();
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
  async handleLockCommand(shouldLock: boolean): Promise<void> {
    const action = shouldLock ? "VERRIEGELN" : "ENTRIEGELN";
    console.log(`[${this.config.name}] Lock Command: ${action}`);

    try {
      if (shouldLock) {
        await this.apiClient.lock(this.config.id);
      } else {
        await this.apiClient.unlock(this.config.id);
      }

      // Status nach Aktion aktualisieren
      setTimeout(() => this.updateStatus(), STATUS_UPDATE_DELAY_AFTER_ACTION_MS);
    } catch (error) {
      console.error(`[${this.config.name}] Fehler beim ${action}:`, error);
      setTimeout(() => this.updateStatus(), STATUS_UPDATE_DELAY_AFTER_ERROR_MS);
    }
  }

  /**
   * Aktualisiert den Lock-Status von der Nuki API
   */
  async updateStatus(): Promise<void> {
    if (this.managedLock.isUpdating) {
      return;
    }

    try {
      const lockStatus = await this.apiClient.getLockStatus(this.config.id);

      if (!lockStatus) {
        return;
      }

      this.managedLock.isUpdating = true;

      const isLocked = lockStatus.state === NukiLockState.LOCKED;
      await this.device.setOutputDatapoint(
        PairingIds.AL_INFO_LOCK_UNLOCK_COMMAND,
        isLocked ? "1" : "0"
      );

      const statusText = isLocked ? "VERRIEGELT" : "ENTRIEGELT";
      console.log(
        `[${this.config.name}] Status aktualisiert: ${lockStatus.stateName} ` +
        `(State: ${lockStatus.state}) -> ${statusText}`
      );

      this.managedLock.isUpdating = false;
    } catch (error) {
      console.error(`[${this.config.name}] Fehler beim Abfragen des Status:`, error);
      this.managedLock.isUpdating = false;
    }
  }

  /**
   * Startet regelmäßige Status-Updates
   */
  private startStatusUpdates(): void {
    // Initialen Status abfragen
    this.updateStatus();

    // Regelmäßig Status aktualisieren
    this.updateIntervalId = setInterval(() => {
      if (!this.managedLock.isUpdating) {
        this.updateStatus();
      }
    }, STATUS_UPDATE_INTERVAL_MS);
  }

  /**
   * Stoppt Status-Updates und bereinigt Ressourcen
   */
  dispose(): void {
    if (this.updateIntervalId) {
      clearInterval(this.updateIntervalId);
      this.updateIntervalId = undefined;
    }
  }
}

// Konfigurations-Parser
export class ConfigurationParser {
  /**
   * Parst die Lock-Konfiguration aus einem JSON-String
   */
  static parseLockConfigs(configString: string | undefined): NukiLockConfig[] {
    if (!configString || typeof configString !== 'string') {
      return [];
    }

    try {
      const parsed = JSON.parse(configString);
      if (Array.isArray(parsed)) {
        return parsed.filter((item: any): item is NukiLockConfig =>
          item && typeof item.id === 'string' && typeof item.name === 'string'
        );
      }
    } catch (error) {
      console.error("Fehler beim Parsen der Lock-Konfiguration:", error);
    }

    return [];
  }

  /**
   * Extrahiert Konfigurationswerte aus der AddOn-Konfiguration
   */
  static extractConfiguration(config: AddOn.Configuration): {
    bridgeIp: string;
    apiToken: string;
    lockConfigs: NukiLockConfig[];
  } {
    const defaultConfig = config.default?.items as AddOnConfiguration | undefined;

    return {
      bridgeIp: (defaultConfig?.nukiBridgeIp && typeof defaultConfig.nukiBridgeIp === 'string')
        ? defaultConfig.nukiBridgeIp
        : '',
      apiToken: (defaultConfig?.nukiApiToken && typeof defaultConfig.nukiApiToken === 'string')
        ? defaultConfig.nukiApiToken
        : '',
      lockConfigs: this.parseLockConfigs(
        defaultConfig?.nukiLocks && typeof defaultConfig.nukiLocks === 'string'
          ? defaultConfig.nukiLocks
          : undefined
      )
    };
  }
}

// Hauptklasse für die Addon-Verwaltung
export class NukiAddonManager {
  private bridgeIp: string = '';
  private apiToken: string = '';
  private lockConfigs: NukiLockConfig[] = [];
  private managedLocks: Map<string, ManagedLock> = new Map();
  private lockManagers: Map<string, LockManager> = new Map();
  private apiClient: NukiApiClient | null = null;

  constructor(
    private addOn: AddOn.AddOn,
    private freeAtHome: FreeAtHome
  ) {
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
  async handleConfigurationChange(configuration: AddOn.Configuration): Promise<void> {
    const config = ConfigurationParser.extractConfiguration(configuration);

    this.bridgeIp = config.bridgeIp;
    this.apiToken = config.apiToken;
    this.lockConfigs = config.lockConfigs;

    // API Client neu erstellen, wenn sich Credentials geändert haben
    if (this.bridgeIp && this.apiToken) {
      this.apiClient = new NukiApiClient(this.bridgeIp, this.apiToken);
      await this.initializeLocks();
    } else {
      console.warn("Nuki Bridge IP oder API Token fehlt in der Konfiguration");
    }
  }

  /**
   * Initialisiert alle konfigurierten Locks
   */
  async initializeLocks(): Promise<void> {
    if (!this.apiClient) {
      return;
    }

    // Entferne Locks, die nicht mehr in der Konfiguration sind
    this.removeObsoleteLocks();

    // Erstelle neue Locks
    await this.createNewLocks();

    console.log(`${this.managedLocks.size} Nuki Türschlösser initialisiert`);
  }

  /**
   * Entfernt Locks, die nicht mehr in der Konfiguration sind
   */
  removeObsoleteLocks(): void {
    for (const [lockId, managedLock] of this.managedLocks.entries()) {
      if (!this.lockConfigs.find(c => c.id === lockId)) {
        console.log(`Lock ${lockId} entfernt`);

        // Manager bereinigen
        const manager = this.lockManagers.get(lockId);
        if (manager) {
          manager.dispose();
          this.lockManagers.delete(lockId);
        }

        this.managedLocks.delete(lockId);
      }
    }
  }

  /**
   * Erstellt neue Locks basierend auf der Konfiguration
   */
  async createNewLocks(): Promise<void> {
    if (!this.apiClient) {
      return;
    }

    for (const config of this.lockConfigs) {
      if (!this.managedLocks.has(config.id)) {
        await this.createLockDevice(config);
      }
    }
  }

  /**
   * Erstellt ein Lock-Gerät und den zugehörigen Manager
   */
  async createLockDevice(config: NukiLockConfig): Promise<void> {
    if (!this.apiClient) {
      return;
    }

    try {
      console.log(`Initialisiere Lock: ${config.name} (ID: ${config.id})`);

      const deviceId = `nuki-lock-${config.id}`;
      const device = await this.freeAtHome.createRawDevice(deviceId, config.name, "simple_doorlock");
      device.setAutoKeepAlive(true);
      device.isAutoConfirm = true;

      const managedLock: ManagedLock = {
        config: config,
        device: device,
        isUpdating: false
      };

      // Erstelle Lock Manager
      const manager = new LockManager(config, device, this.apiClient, managedLock);

      this.managedLocks.set(config.id, managedLock);
      this.lockManagers.set(config.id, manager);
    } catch (error) {
      console.error(`Fehler beim Erstellen des Lock-Geräts für ${config.name}:`, error);
    }
  }

  /**
   * Versucht eine initiale Konfiguration zu laden
   */
  async tryLoadInitialConfiguration(): Promise<void> {
    setTimeout(async () => {
      if (this.managedLocks.size === 0 && this.lockConfigs.length > 0 && this.apiClient) {
        await this.initializeLocks();
      }
    }, CONFIG_LOAD_DELAY_MS);
  }
}

// Hauptfunktion
async function main(): Promise<void> {
  const freeAtHome = new FreeAtHome();
  freeAtHome.activateSignalHandling();

  const metaData = AddOn.readMetaData();
  const addOn = new AddOn.AddOn(metaData.id);

  const manager = new NukiAddonManager(addOn, freeAtHome);
  await manager.tryLoadInitialConfiguration();

  console.log("Nuki Addon initialisiert");
}

/* istanbul ignore next */
if (require.main === module) {
  main().catch((error) => {
    console.error("Kritischer Fehler beim Starten des Addons:", error);
    process.exit(1);
  });
}
