import type { NukiApiClient } from './nuki-api-client';
import type { FreeAtHomeRawChannel } from '@busch-jaeger/free-at-home';

// Konstanten
export const NUKI_BRIDGE_PORT = 8080;
export const STATUS_UPDATE_INTERVAL_MS = 30000;
export const STATUS_UPDATE_DELAY_AFTER_ACTION_MS = 2000;
export const STATUS_UPDATE_DELAY_AFTER_ERROR_MS = 1000;
export const BRIDGE_CONNECTION_TIMEOUT_MS = 5000;

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

export interface NukiBridgeConfig {
  ip: string;
  port?: number;
  token: string;
  pollInterval?: number;
  locks: NukiLockConfig[];
}

export interface ManagedLock {
  config: NukiLockConfig;
  device: FreeAtHomeRawChannel;
  isUpdating: boolean;
}

export interface ManagedBridge {
  config: NukiBridgeConfig;
  apiClient: NukiApiClient;
  statusIntervalId?: NodeJS.Timeout;
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
  nukiBridges?: string;
}
