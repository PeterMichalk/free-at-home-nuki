import { FreeAtHome, AddOn } from '@busch-jaeger/free-at-home';
import { NukiApiClient } from './nuki-api-client';
import { LockManager } from './lock-manager';
import { ActivityLog } from './activity-log';
import { ConfigurationParser } from './configuration-parser';
import {
  NUKI_BRIDGE_PORT,
  STATUS_UPDATE_INTERVAL_MS,
  NukiLockStatus,
  NukiLockState,
  NukiLockConfig,
  NukiBridgeConfig,
  ManagedLock,
  ManagedBridge
} from './types';

// Hauptklasse für die Addon-Verwaltung
export class NukiAddonManager {
  private managedBridges: Map<string, ManagedBridge> = new Map();
  private managedLocks: Map<string, ManagedLock> = new Map();
  private lockManagers: Map<string, LockManager> = new Map();
  private readonly activityLog = new ActivityLog();

  constructor(private addOn: AddOn.AddOn, private freeAtHome: FreeAtHome) {
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
    const apiClient = new NukiApiClient(bridgeConfig.ip, bridgeConfig.token, bridgeConfig.port ?? NUKI_BRIDGE_PORT);

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

      // Zugriffsprotokoll abrufen – separater try/catch, damit ein Fehler hier
      // nicht die Bridge fälschlicherweise als offline markiert (ältere Firmware)
      try {
        const bridgeLogs = await managedBridge.apiClient.getLog(50);
        this.activityLog.mergeBridgeLog(bridgeLogs);
      } catch {
        // getLog() liefert bereits intern eine Warnung; hier nichts weiter tun
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
      managedBridge.config.pollInterval ?? STATUS_UPDATE_INTERVAL_MS
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
      const device = await this.freeAtHome.createRawDevice(deviceId, config.name, "simple_doorlock");
      device.setAutoKeepAlive(true);
      device.isAutoConfirm = true;

      const managedLock: ManagedLock = {
        config,
        device,
        isUpdating: false
      };

      const lockKey = `${bridgeIp}:${config.id}`;
      const manager = new LockManager(config, device, apiClient, managedLock, this.activityLog);

      this.managedLocks.set(lockKey, managedLock);
      this.lockManagers.set(lockKey, manager);
    } catch (error) {
      console.error(`Fehler beim Erstellen des Lock-Geräts für ${config.name}:`, error);
    }
  }
}
