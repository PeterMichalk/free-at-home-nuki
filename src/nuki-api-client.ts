import * as http from 'http';
import {
  NUKI_BRIDGE_PORT,
  BRIDGE_CONNECTION_TIMEOUT_MS,
  NukiLockAction,
  NukiLockState,
  NukiLockStatus,
  NukiBridgeLock,
  NukiApiResponse
} from './types';

// Nuki API Client
export class NukiApiClient {
  constructor(
    private bridgeIp: string,
    private apiToken: string,
    private port: number = NUKI_BRIDGE_PORT
  ) {}

  /**
   * Führt einen HTTP GET Request zur Nuki Bridge API aus
   */
  private async httpGet(endpoint: string, timeoutMs: number = 10000): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const url = `http://${this.bridgeIp}:${this.port}${endpoint}`;

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
