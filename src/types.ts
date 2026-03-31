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

// Trigger-Quellen aus Nuki Bridge API /log
export enum NukiLogTrigger {
  SYSTEM    = 0,  // System/Timeout
  MANUAL    = 1,  // Physischer Schlüssel/Drehknauf
  BUTTON    = 2,  // Nuki Keypad / Fingerabdruckleser
  AUTOMATIC = 3,  // Zeitplan
  TIMED     = 4,  // Zeitgesteuert
  APP       = 5,  // Nuki App
  AUTO_LOCK = 6,  // Auto-Lock
}

// Aktions-Codes aus Nuki Bridge API /log
export enum NukiLogAction {
  UNLOCK            = 1,
  LOCK              = 2,
  UNLATCH           = 3,
  LOCK_N_GO         = 4,
  LOCK_N_GO_UNLATCH = 5,
}

// Roheintrag aus /log-Endpunkt der Nuki Bridge
export interface NukiBridgeLogEntry {
  nukiId:     number;
  deviceType: number;
  name:       string;
  action:     number;   // NukiLogAction
  trigger:    number;   // NukiLogTrigger
  state:      number;   // NukiLockState
  success:    boolean;
  date:       string;   // ISO 8601
}

// Normalisierter Eintrag im Zugriffsprotokoll
export interface ActivityLogEntry {
  timestamp: Date;
  lockId:    string;
  lockName:  string;
  action:    string;
  source:    string;
  state:     NukiLockState;
  success:   boolean;
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
  previousState?: NukiLockState;
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
