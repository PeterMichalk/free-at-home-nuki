import { PairingIds, FreeAtHomeRawChannel } from '@busch-jaeger/free-at-home';
import { NukiApiClient } from './nuki-api-client';
import {
  STATUS_UPDATE_DELAY_AFTER_ACTION_MS,
  STATUS_UPDATE_DELAY_AFTER_ERROR_MS,
  NukiLockState,
  NukiLockStatus,
  NukiLockConfig,
  ManagedLock
} from './types';

// Lock Manager - Verwaltet ein einzelnes Lock
export class LockManager {
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
