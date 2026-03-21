import { LockManager, NukiApiClient, NukiLockState, ManagedLock, NukiLockConfig } from '../main';
import { PairingIds, FreeAtHomeRawChannel } from '@busch-jaeger/free-at-home';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPairingIds = {
  AL_LOCK_UNLOCK_COMMAND: 'AL_LOCK_UNLOCK_COMMAND',
  AL_INFO_LOCK_UNLOCK_COMMAND: 'AL_INFO_LOCK_UNLOCK_COMMAND',
};

jest.mock('@busch-jaeger/free-at-home', () => ({
  AddOn: {},
  FreeAtHome: jest.fn(),
  PairingIds: {
    AL_LOCK_UNLOCK_COMMAND: 'AL_LOCK_UNLOCK_COMMAND',
    AL_INFO_LOCK_UNLOCK_COMMAND: 'AL_INFO_LOCK_UNLOCK_COMMAND',
  },
  FreeAtHomeRawChannel: jest.fn(),
}));

jest.mock('http');

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeDevice() {
  const listeners: Record<string, Function[]> = {};
  return {
    on: jest.fn((event: string, cb: Function) => {
      listeners[event] = listeners[event] ?? [];
      listeners[event].push(cb);
    }),
    setOutputDatapoint: jest.fn().mockResolvedValue(undefined),
    emit: (event: string, ...args: any[]) => {
      (listeners[event] ?? []).forEach(cb => cb(...args));
    },
  };
}

function makeApiClient() {
  return {
    getLockStatus: jest.fn(),
    executeLockAction: jest.fn(),
    lock: jest.fn().mockResolvedValue(true),
    unlock: jest.fn().mockResolvedValue(true),
  } as unknown as NukiApiClient;
}

function makeManagedLock(config: NukiLockConfig, device: any): ManagedLock {
  return { config, device, isUpdating: false };
}

function makeLockConfig(overrides: Partial<NukiLockConfig> = {}): NukiLockConfig {
  return { id: '42', name: 'Test Lock', ...overrides };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('LockManager', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  // ── constructor / startup ────────────────────────────────────────────────

  describe('constructor', () => {
    it('calls updateStatus once immediately on construction', () => {
      const device = makeDevice();
      const api = makeApiClient();
      (api.getLockStatus as jest.Mock).mockResolvedValue(null);
      const config = makeLockConfig();
      const managed = makeManagedLock(config, device);

      new LockManager(config, device as any, api, managed);

      // updateStatus is async; it fires immediately but resolves later
      expect(api.getLockStatus).toHaveBeenCalledWith('42');
    });

    it('registers a datapointChanged event handler on the device', () => {
      const device = makeDevice();
      const api = makeApiClient();
      (api.getLockStatus as jest.Mock).mockResolvedValue(null);
      const config = makeLockConfig();
      const managed = makeManagedLock(config, device);

      new LockManager(config, device as any, api, managed);

      expect(device.on).toHaveBeenCalledWith('datapointChanged', expect.any(Function));
    });
  });

  // ── handleLockCommand ────────────────────────────────────────────────────

  describe('handleLockCommand', () => {
    it('calls apiClient.lock() when shouldLock=true', async () => {
      const device = makeDevice();
      const api = makeApiClient();
      (api.getLockStatus as jest.Mock).mockResolvedValue(null);
      const config = makeLockConfig();
      const managed = makeManagedLock(config, device);
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      const manager = new LockManager(config, device as any, api, managed);
      await manager.handleLockCommand(true);

      expect(api.lock).toHaveBeenCalledWith('42');
      consoleSpy.mockRestore();
    });

    it('calls apiClient.unlock() when shouldLock=false', async () => {
      const device = makeDevice();
      const api = makeApiClient();
      (api.getLockStatus as jest.Mock).mockResolvedValue(null);
      const config = makeLockConfig();
      const managed = makeManagedLock(config, device);
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      const manager = new LockManager(config, device as any, api, managed);
      await manager.handleLockCommand(false);

      expect(api.unlock).toHaveBeenCalledWith('42');
      consoleSpy.mockRestore();
    });

    it('schedules a status update after a successful lock action', async () => {
      const device = makeDevice();
      const api = makeApiClient();
      (api.getLockStatus as jest.Mock).mockResolvedValue(null);
      const config = makeLockConfig();
      const managed = makeManagedLock(config, device);
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      const manager = new LockManager(config, device as any, api, managed);
      // clear the initial call
      (api.getLockStatus as jest.Mock).mockClear();

      await manager.handleLockCommand(true);
      jest.advanceTimersByTime(2000);
      await Promise.resolve(); // flush microtask queue

      expect(api.getLockStatus).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('schedules a faster status update after a failed lock action', async () => {
      const device = makeDevice();
      const api = makeApiClient();
      (api.getLockStatus as jest.Mock).mockResolvedValue(null);
      (api.lock as jest.Mock).mockRejectedValue(new Error('API down'));
      const config = makeLockConfig();
      const managed = makeManagedLock(config, device);
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      const manager = new LockManager(config, device as any, api, managed);
      (api.getLockStatus as jest.Mock).mockClear();

      await manager.handleLockCommand(true);
      jest.advanceTimersByTime(1000);
      await Promise.resolve();

      expect(api.getLockStatus).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  // ── updateStatus ─────────────────────────────────────────────────────────

  describe('updateStatus', () => {
    it('sets datapoint to "1" when lock state is LOCKED', async () => {
      const device = makeDevice();
      const api = makeApiClient();
      (api.getLockStatus as jest.Mock).mockResolvedValue({
        state: NukiLockState.LOCKED,
        stateName: 'locked',
        nukiId: 42,
        name: 'Test',
        batteryCritical: false,
        batteryChargeState: 80,
        success: true,
      });
      const config = makeLockConfig();
      const managed = makeManagedLock(config, device);
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      const manager = new LockManager(config, device as any, api, managed);
      await manager.updateStatus();

      expect(device.setOutputDatapoint).toHaveBeenCalledWith(
        mockPairingIds.AL_INFO_LOCK_UNLOCK_COMMAND,
        '1'
      );
      consoleSpy.mockRestore();
    });

    it('sets datapoint to "0" when lock state is UNLOCKED', async () => {
      const device = makeDevice();
      const api = makeApiClient();
      (api.getLockStatus as jest.Mock).mockResolvedValue({
        state: NukiLockState.UNLOCKED,
        stateName: 'unlocked',
        nukiId: 42,
        name: 'Test',
        batteryCritical: false,
        batteryChargeState: 80,
        success: true,
      });
      const config = makeLockConfig();
      const managed = makeManagedLock(config, device);
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      const manager = new LockManager(config, device as any, api, managed);
      await manager.updateStatus();

      expect(device.setOutputDatapoint).toHaveBeenCalledWith(
        mockPairingIds.AL_INFO_LOCK_UNLOCK_COMMAND,
        '0'
      );
      consoleSpy.mockRestore();
    });

    it('skips update when managedLock.isUpdating is true', async () => {
      const device = makeDevice();
      const api = makeApiClient();
      (api.getLockStatus as jest.Mock).mockResolvedValue(null);
      const config = makeLockConfig();
      const managed = makeManagedLock(config, device);
      managed.isUpdating = true;

      const manager = new LockManager(config, device as any, api, managed);
      (api.getLockStatus as jest.Mock).mockClear();

      await manager.updateStatus();

      expect(api.getLockStatus).not.toHaveBeenCalled();
    });

    it('returns early without calling setOutputDatapoint when getLockStatus returns null', async () => {
      const device = makeDevice();
      const api = makeApiClient();
      (api.getLockStatus as jest.Mock).mockResolvedValue(null);
      const config = makeLockConfig();
      const managed = makeManagedLock(config, device);
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      const manager = new LockManager(config, device as any, api, managed);
      device.setOutputDatapoint.mockClear();
      await manager.updateStatus();

      expect(device.setOutputDatapoint).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('resets isUpdating to false after error in getLockStatus', async () => {
      const device = makeDevice();
      const api = makeApiClient();
      (api.getLockStatus as jest.Mock).mockRejectedValue(new Error('API error'));
      const config = makeLockConfig();
      const managed = makeManagedLock(config, device);
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      const manager = new LockManager(config, device as any, api, managed);
      await manager.updateStatus();

      expect(managed.isUpdating).toBe(false);
      consoleSpy.mockRestore();
    });

    it('resets isUpdating to false after error in setOutputDatapoint', async () => {
      const device = makeDevice();
      const api = makeApiClient();
      (api.getLockStatus as jest.Mock).mockResolvedValue({
        state: NukiLockState.LOCKED, stateName: 'locked',
        nukiId: 1, name: 'Lock', batteryCritical: false, batteryChargeState: 90, success: true,
      });
      device.setOutputDatapoint.mockRejectedValue(new Error('fah error'));
      const config = makeLockConfig();
      const managed = makeManagedLock(config, device);
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      const manager = new LockManager(config, device as any, api, managed);
      await manager.updateStatus();

      expect(managed.isUpdating).toBe(false);
      consoleSpy.mockRestore();
    });
  });

  // ── dispose ──────────────────────────────────────────────────────────────

  describe('dispose', () => {
    it('clears the status update interval', () => {
      const device = makeDevice();
      const api = makeApiClient();
      (api.getLockStatus as jest.Mock).mockResolvedValue(null);
      const config = makeLockConfig();
      const managed = makeManagedLock(config, device);

      const manager = new LockManager(config, device as any, api, managed);
      const clearSpy = jest.spyOn(global, 'clearInterval');

      manager.dispose();

      expect(clearSpy).toHaveBeenCalled();
    });

    it('calling dispose twice does not throw', () => {
      const device = makeDevice();
      const api = makeApiClient();
      (api.getLockStatus as jest.Mock).mockResolvedValue(null);
      const config = makeLockConfig();
      const managed = makeManagedLock(config, device);

      const manager = new LockManager(config, device as any, api, managed);
      expect(() => {
        manager.dispose();
        manager.dispose();
      }).not.toThrow();
    });
  });

  // ── datapointChanged event handler ───────────────────────────────────────

  describe('datapointChanged event handler', () => {
    // api.lock/unlock is called synchronously before the first `await` in handleLockCommand,
    // so these tests do not need to be async.
    it('calls api.lock() when AL_LOCK_UNLOCK_COMMAND fires with value "1"', () => {
      const device = makeDevice();
      const api = makeApiClient();
      (api.getLockStatus as jest.Mock).mockResolvedValue(null);
      const config = makeLockConfig();
      const managed = makeManagedLock(config, device);
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      const manager = new LockManager(config, device as any, api, managed);
      device.emit('datapointChanged', mockPairingIds.AL_LOCK_UNLOCK_COMMAND, '1');

      expect(api.lock).toHaveBeenCalledWith('42');
      manager.dispose();
      consoleSpy.mockRestore();
    });

    it('calls api.unlock() when AL_LOCK_UNLOCK_COMMAND fires with value "0"', () => {
      const device = makeDevice();
      const api = makeApiClient();
      (api.getLockStatus as jest.Mock).mockResolvedValue(null);
      const config = makeLockConfig();
      const managed = makeManagedLock(config, device);
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      const manager = new LockManager(config, device as any, api, managed);
      device.emit('datapointChanged', mockPairingIds.AL_LOCK_UNLOCK_COMMAND, '0');

      expect(api.unlock).toHaveBeenCalledWith('42');
      manager.dispose();
      consoleSpy.mockRestore();
    });

    it('ignores events while isUpdating is true', () => {
      const device = makeDevice();
      const api = makeApiClient();
      (api.getLockStatus as jest.Mock).mockResolvedValue(null);
      const config = makeLockConfig();
      const managed = makeManagedLock(config, device);
      managed.isUpdating = true;

      const manager = new LockManager(config, device as any, api, managed);
      (api.lock as jest.Mock).mockClear();

      device.emit('datapointChanged', mockPairingIds.AL_LOCK_UNLOCK_COMMAND, '1');

      expect(api.lock).not.toHaveBeenCalled();
      manager.dispose();
    });

    it('ignores events for other datapoint IDs', () => {
      const device = makeDevice();
      const api = makeApiClient();
      (api.getLockStatus as jest.Mock).mockResolvedValue(null);
      const config = makeLockConfig();
      const managed = makeManagedLock(config, device);

      const manager = new LockManager(config, device as any, api, managed);
      (api.lock as jest.Mock).mockClear();

      device.emit('datapointChanged', 'SOME_OTHER_ID', '1');

      expect(api.lock).not.toHaveBeenCalled();
      manager.dispose();
    });
  });
});
