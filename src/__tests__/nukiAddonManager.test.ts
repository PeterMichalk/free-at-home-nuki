import * as http from 'http';
import { NukiAddonManager } from '../main';
import { AddOn, FreeAtHome } from '@busch-jaeger/free-at-home';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockDevice = {
  on: jest.fn(),
  setOutputDatapoint: jest.fn().mockResolvedValue(undefined),
  setAutoKeepAlive: jest.fn(),
  isAutoConfirm: false,
};

const mockFreeAtHome = {
  createRawDevice: jest.fn().mockResolvedValue(mockDevice),
  activateSignalHandling: jest.fn(),
} as unknown as FreeAtHome;

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

/** Suppress LockManager's background updateStatus calls by returning an empty lock list */
function mockHttpGetEmptyList(): void {
  const mockResponse: any = {
    on: jest.fn((event: string, cb: Function) => {
      if (event === 'data') cb(Buffer.from('[]'));
      if (event === 'end') cb();
      return mockResponse;
    }),
  };
  const mockRequest: any = { on: jest.fn().mockReturnThis() };
  (http.get as jest.Mock).mockImplementation((_url: any, cb?: any) => {
    if (cb) cb(mockResponse);
    return mockRequest;
  });
}

// ─── AddOn stub ───────────────────────────────────────────────────────────────

function makeAddOn() {
  const listeners: Record<string, Function[]> = {};
  return {
    on: jest.fn((event: string, cb: Function) => {
      listeners[event] = listeners[event] ?? [];
      listeners[event].push(cb);
    }),
    connectToConfiguration: jest.fn(),
    emit: (event: string, ...args: any[]) => {
      (listeners[event] ?? []).forEach(cb => cb(...args));
    },
  } as unknown as AddOn.AddOn & { emit: (e: string, ...a: any[]) => void };
}

// ─── Config factory ───────────────────────────────────────────────────────────

function makeConfig(
  bridgeIp: string,
  apiToken: string,
  locks: { id: string; name: string }[]
): AddOn.Configuration {
  return {
    default: {
      items: {
        nukiBridgeIp: bridgeIp,
        nukiApiToken: apiToken,
        nukiLocks: JSON.stringify(locks),
      },
    },
  } as unknown as AddOn.Configuration;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('NukiAddonManager', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    (mockFreeAtHome.createRawDevice as jest.Mock).mockResolvedValue(mockDevice);
    mockHttpGetEmptyList();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  // ── constructor ──────────────────────────────────────────────────────────

  describe('constructor', () => {
    it('calls connectToConfiguration on startup', () => {
      const addOn = makeAddOn();
      new NukiAddonManager(addOn, mockFreeAtHome);
      expect(addOn.connectToConfiguration).toHaveBeenCalled();
    });

    it('registers a configurationChanged event listener', () => {
      const addOn = makeAddOn();
      new NukiAddonManager(addOn, mockFreeAtHome);
      expect(addOn.on).toHaveBeenCalledWith('configurationChanged', expect.any(Function));
    });
  });

  // ── handleConfigurationChange ────────────────────────────────────────────

  describe('handleConfigurationChange', () => {
    it('creates lock devices for each configured lock when credentials are present', async () => {
      const addOn = makeAddOn();
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      const manager = new NukiAddonManager(addOn, mockFreeAtHome);

      const config = makeConfig('192.168.1.100', 'secret', [
        { id: '1', name: 'Front' },
        { id: '2', name: 'Back' },
      ]);
      await manager.handleConfigurationChange(config);

      expect(mockFreeAtHome.createRawDevice).toHaveBeenCalledTimes(2);
      expect(mockFreeAtHome.createRawDevice).toHaveBeenCalledWith(
        'nuki-lock-1', 'Front', 'simple_doorlock'
      );
      expect(mockFreeAtHome.createRawDevice).toHaveBeenCalledWith(
        'nuki-lock-2', 'Back', 'simple_doorlock'
      );
      consoleSpy.mockRestore();
    });

    it('logs a warning and creates no devices when bridgeIp is missing', async () => {
      const addOn = makeAddOn();
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const manager = new NukiAddonManager(addOn, mockFreeAtHome);

      await manager.handleConfigurationChange(makeConfig('', 'secret', [{ id: '1', name: 'Lock' }]));

      expect(mockFreeAtHome.createRawDevice).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('logs a warning and creates no devices when apiToken is missing', async () => {
      const addOn = makeAddOn();
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const manager = new NukiAddonManager(addOn, mockFreeAtHome);

      await manager.handleConfigurationChange(makeConfig('192.168.1.1', '', [{ id: '1', name: 'Lock' }]));

      expect(mockFreeAtHome.createRawDevice).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('does not create duplicate devices when called twice with same config', async () => {
      const addOn = makeAddOn();
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      const manager = new NukiAddonManager(addOn, mockFreeAtHome);

      const config = makeConfig('192.168.1.1', 'tok', [{ id: '1', name: 'Lock' }]);
      await manager.handleConfigurationChange(config);
      await manager.handleConfigurationChange(config);

      expect(mockFreeAtHome.createRawDevice).toHaveBeenCalledTimes(1);
      consoleSpy.mockRestore();
    });

    // createRawDevice is called synchronously (before the first await), so no flush needed.
    it('fires when configurationChanged event is emitted on the addOn', () => {
      const addOn = makeAddOn();
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      new NukiAddonManager(addOn, mockFreeAtHome);

      const config = makeConfig('1.2.3.4', 'tok', [{ id: '9', name: 'Garage' }]);
      addOn.emit('configurationChanged', config);

      expect(mockFreeAtHome.createRawDevice).toHaveBeenCalledWith('nuki-lock-9', 'Garage', 'simple_doorlock');
      consoleSpy.mockRestore();
    });
  });

  // ── removeObsoleteLocks ──────────────────────────────────────────────────

  describe('removeObsoleteLocks', () => {
    it('removes locks that are no longer in the config', async () => {
      const addOn = makeAddOn();
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      const manager = new NukiAddonManager(addOn, mockFreeAtHome);

      // Add two locks
      await manager.handleConfigurationChange(
        makeConfig('1.2.3.4', 'tok', [{ id: '1', name: 'A' }, { id: '2', name: 'B' }])
      );
      expect(mockFreeAtHome.createRawDevice).toHaveBeenCalledTimes(2);

      (mockFreeAtHome.createRawDevice as jest.Mock).mockClear();

      // Reconfigure with only lock #2
      await manager.handleConfigurationChange(
        makeConfig('1.2.3.4', 'tok', [{ id: '2', name: 'B' }])
      );

      // Lock #1 should have been removed; no new device for #2
      expect(mockFreeAtHome.createRawDevice).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('1'));
      consoleSpy.mockRestore();
    });
  });

  // ── createLockDevice error handling ──────────────────────────────────────

  describe('createLockDevice', () => {
    it('logs an error but does not throw when createRawDevice rejects', async () => {
      const addOn = makeAddOn();
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      (mockFreeAtHome.createRawDevice as jest.Mock).mockRejectedValue(new Error('fah down'));

      const manager = new NukiAddonManager(addOn, mockFreeAtHome);

      await expect(
        manager.handleConfigurationChange(makeConfig('1.2.3.4', 'tok', [{ id: '1', name: 'Lock' }]))
      ).resolves.not.toThrow();

      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
      consoleSpy.mockRestore();
    });
  });

  // ── tryLoadInitialConfiguration ──────────────────────────────────────────

  describe('tryLoadInitialConfiguration', () => {
    it('does not call initializeLocks if locks were already initialized', async () => {
      const addOn = makeAddOn();
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      const manager = new NukiAddonManager(addOn, mockFreeAtHome);

      // Initialize locks via config change first
      await manager.handleConfigurationChange(
        makeConfig('1.2.3.4', 'tok', [{ id: '1', name: 'Lock' }])
      );
      (mockFreeAtHome.createRawDevice as jest.Mock).mockClear();

      await manager.tryLoadInitialConfiguration();
      jest.advanceTimersByTime(2000);
      await Promise.resolve();

      // No additional device creation should happen
      expect(mockFreeAtHome.createRawDevice).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });
});
