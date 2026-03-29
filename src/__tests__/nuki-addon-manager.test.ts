import { NukiAddonManager } from '../nuki-addon-manager';
import { NukiApiClient } from '../nuki-api-client';
import { AddOn, FreeAtHome, FreeAtHomeRawChannel } from '@busch-jaeger/free-at-home';
import { NukiBridgeConfig, NukiLockState, STATUS_UPDATE_INTERVAL_MS } from '../types';

jest.mock('../nuki-api-client');

const MockedNukiApiClient = NukiApiClient as jest.MockedClass<typeof NukiApiClient>;

function makeBridgeConfig(overrides: Partial<NukiBridgeConfig> = {}): NukiBridgeConfig {
  return {
    ip: '192.168.1.100',
    token: 'mytoken',
    locks: [{ id: '42', name: 'Haustür' }],
    ...overrides,
  };
}

function makeConfiguration(bridges: NukiBridgeConfig[]): AddOn.Configuration {
  return {
    default: {
      items: { nukiBridges: JSON.stringify(bridges) } as any,
    },
  } as unknown as AddOn.Configuration;
}

describe('NukiAddonManager', () => {
  let mockAddOn: any;
  // Use plain object to avoid strict-event-emitter-types conflicts
  let mockDevice: any;
  let mockFreeAtHome: jest.Mocked<Pick<FreeAtHome, 'createRawDevice'>>;
  let mockApiClientInstance: jest.Mocked<Pick<NukiApiClient, 'listAllLocks' | 'getLockStatus' | 'lock' | 'unlock'>>;
  let configurationChangedListener: (config: AddOn.Configuration) => Promise<void>;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();

    mockDevice = {
      setAutoKeepAlive: jest.fn(),
      setOutputDatapoint: jest.fn().mockResolvedValue(undefined),
      setUnresponsive: jest.fn().mockResolvedValue(undefined),
      on: jest.fn(),
      isAutoConfirm: false,
    };

    mockFreeAtHome = {
      createRawDevice: jest.fn().mockResolvedValue(mockDevice as unknown as FreeAtHomeRawChannel),
    };

    mockApiClientInstance = {
      listAllLocks: jest.fn().mockResolvedValue([]),
      getLockStatus: jest.fn().mockResolvedValue(null),
      lock: jest.fn().mockResolvedValue(true),
      unlock: jest.fn().mockResolvedValue(true),
    };
    MockedNukiApiClient.mockImplementation(() => mockApiClientInstance as unknown as NukiApiClient);

    mockAddOn = {
      on: jest.fn(),
      connectToConfiguration: jest.fn(),
    };

    new NukiAddonManager(
      mockAddOn as unknown as AddOn.AddOn,
      mockFreeAtHome as unknown as FreeAtHome
    );

    const onCall = mockAddOn.on.mock.calls.find((c) => c[0] === 'configurationChanged');
    configurationChangedListener = onCall![1] as any;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('Konstruktor', () => {
    it('registriert einen configurationChanged-Listener', () => {
      expect(mockAddOn.on).toHaveBeenCalledWith('configurationChanged', expect.any(Function));
    });

    it('ruft connectToConfiguration() auf', () => {
      expect(mockAddOn.connectToConfiguration).toHaveBeenCalled();
    });
  });

  describe('handleConfigurationChange() – neue Bridge', () => {
    it('erstellt einen NukiApiClient mit ip, token und port', async () => {
      const config = makeBridgeConfig({ port: 8081 });
      await configurationChangedListener(makeConfiguration([config]));
      expect(MockedNukiApiClient).toHaveBeenCalledWith('192.168.1.100', 'mytoken', 8081);
    });

    it('verwendet NUKI_BRIDGE_PORT als Standard wenn kein port angegeben', async () => {
      await configurationChangedListener(makeConfiguration([makeBridgeConfig()]));
      expect(MockedNukiApiClient).toHaveBeenCalledWith('192.168.1.100', 'mytoken', 8080);
    });

    it('ruft createRawDevice mit einer device-ID auf, die IP und Lock-ID enthält', async () => {
      await configurationChangedListener(makeConfiguration([makeBridgeConfig()]));
      expect(mockFreeAtHome.createRawDevice).toHaveBeenCalledWith(
        expect.stringContaining('192-168-1-100'),
        expect.any(String),
        expect.any(String)
      );
      expect(mockFreeAtHome.createRawDevice).toHaveBeenCalledWith(
        expect.stringContaining('42'),
        expect.any(String),
        expect.any(String)
      );
    });

    it('setzt setAutoKeepAlive(true) und isAutoConfirm = true auf dem erstellten Gerät', async () => {
      await configurationChangedListener(makeConfiguration([makeBridgeConfig()]));
      expect(mockDevice.setAutoKeepAlive).toHaveBeenCalledWith(true);
      expect(mockDevice.isAutoConfirm).toBe(true);
    });

    it('ruft listAllLocks sofort beim ersten Poll auf', async () => {
      await configurationChangedListener(makeConfiguration([makeBridgeConfig()]));
      await Promise.resolve(); // flush
      expect(mockApiClientInstance.listAllLocks).toHaveBeenCalled();
    });

    it('startet einen Interval mit dem konfigurierten pollInterval', async () => {
      const config = makeBridgeConfig({ pollInterval: 60000 });
      await configurationChangedListener(makeConfiguration([config]));
      const initialCalls = mockApiClientInstance.listAllLocks.mock.calls.length;
      jest.advanceTimersByTime(60000);
      await Promise.resolve();
      expect(mockApiClientInstance.listAllLocks.mock.calls.length).toBeGreaterThan(initialCalls);
    });

    it('startet einen Interval mit STATUS_UPDATE_INTERVAL_MS wenn kein pollInterval angegeben', async () => {
      await configurationChangedListener(makeConfiguration([makeBridgeConfig()]));
      const initialCalls = mockApiClientInstance.listAllLocks.mock.calls.length;
      jest.advanceTimersByTime(STATUS_UPDATE_INTERVAL_MS);
      await Promise.resolve();
      expect(mockApiClientInstance.listAllLocks.mock.calls.length).toBeGreaterThan(initialCalls);
    });
  });

  describe('handleConfigurationChange() – bestehende Bridge aktualisieren', () => {
    beforeEach(async () => {
      await configurationChangedListener(makeConfiguration([makeBridgeConfig()]));
      jest.clearAllMocks();
      MockedNukiApiClient.mockImplementation(() => mockApiClientInstance as unknown as NukiApiClient);
    });

    it('erstellt keinen zweiten NukiApiClient für die gleiche IP', async () => {
      const updated = makeBridgeConfig({ pollInterval: 10000 });
      await configurationChangedListener(makeConfiguration([updated]));
      expect(MockedNukiApiClient).not.toHaveBeenCalled();
    });

    it('erstellt ein neues Lock-Gerät wenn ein neues Lock zur Konfiguration hinzukommt', async () => {
      const updated = makeBridgeConfig({
        locks: [
          { id: '42', name: 'Haustür' },
          { id: '99', name: 'Garagentor' },
        ],
      });
      await configurationChangedListener(makeConfiguration([updated]));
      expect(mockFreeAtHome.createRawDevice).toHaveBeenCalledWith(
        expect.stringContaining('99'),
        'Garagentor',
        expect.any(String)
      );
    });
  });

  describe('handleConfigurationChange() – Bridge entfernen', () => {
    it('ruft clearInterval für den gespeicherten Interval auf', async () => {
      const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
      await configurationChangedListener(makeConfiguration([makeBridgeConfig()]));
      clearIntervalSpy.mockClear();

      // Bridge aus Konfiguration entfernen
      await configurationChangedListener(makeConfiguration([]));
      expect(clearIntervalSpy).toHaveBeenCalled();
    });

    it('entfernt die Bridge so dass sie bei erneuter Konfiguration neu erstellt wird', async () => {
      await configurationChangedListener(makeConfiguration([makeBridgeConfig()]));
      await configurationChangedListener(makeConfiguration([]));
      MockedNukiApiClient.mockClear();

      // Bridge wieder hinzufügen
      await configurationChangedListener(makeConfiguration([makeBridgeConfig()]));
      expect(MockedNukiApiClient).toHaveBeenCalledTimes(1);
    });
  });

  describe('pollBridge()', () => {
    const nukiBridgeLock = {
      deviceType: 0,
      nukiId: 42,
      name: 'Haustür',
      firmwareVersion: '3.5',
      lastKnownState: {
        mode: 2,
        state: NukiLockState.LOCKED,
        stateName: 'locked',
        batteryCritical: false,
        batteryCharging: false,
        batteryChargeState: 80,
        timestamp: '2024-01-01T00:00:00Z',
      },
    };

    it('ruft listAllLocks einmal pro Poll-Zyklus auf', async () => {
      mockApiClientInstance.listAllLocks.mockResolvedValue([nukiBridgeLock]);
      await configurationChangedListener(makeConfiguration([makeBridgeConfig()]));
      expect(mockApiClientInstance.listAllLocks).toHaveBeenCalledTimes(1);
    });

    it('ruft applyStatus (via setOutputDatapoint) für ein bekanntes Lock auf', async () => {
      mockApiClientInstance.listAllLocks.mockResolvedValue([nukiBridgeLock]);
      await configurationChangedListener(makeConfiguration([makeBridgeConfig()]));
      await Promise.resolve();
      expect(mockDevice.setOutputDatapoint).toHaveBeenCalled();
    });

    it('überspringt Locks mit fehlendem lastKnownState', async () => {
      const lockWithoutState = { ...nukiBridgeLock, lastKnownState: undefined };
      mockApiClientInstance.listAllLocks.mockResolvedValue([lockWithoutState as any]);
      await configurationChangedListener(makeConfiguration([makeBridgeConfig()]));
      await Promise.resolve();
      expect(mockDevice.setOutputDatapoint).not.toHaveBeenCalled();
    });

    it('ruft setUnresponsive() auf allen Locks der Bridge auf wenn listAllLocks fehlschlägt', async () => {
      mockApiClientInstance.listAllLocks.mockRejectedValue(new Error('Bridge offline'));
      await configurationChangedListener(makeConfiguration([makeBridgeConfig()]));
      await Promise.resolve();
      expect(mockDevice.setUnresponsive).toHaveBeenCalled();
    });

    it('wirft keinen Fehler wenn setUnresponsive() selbst fehlschlägt', async () => {
      mockApiClientInstance.listAllLocks.mockRejectedValue(new Error('offline'));
      mockDevice.setUnresponsive.mockRejectedValue(new Error('Gerät nicht erreichbar'));
      await expect(
        configurationChangedListener(makeConfiguration([makeBridgeConfig()]))
      ).resolves.toBeUndefined();
      await Promise.resolve();
    });
  });

  describe('createLockDevice()', () => {
    it('device-ID enthält IP-Adresse mit Bindestrichen statt Punkten', async () => {
      await configurationChangedListener(makeConfiguration([makeBridgeConfig()]));
      const [deviceId] = mockFreeAtHome.createRawDevice.mock.calls[0];
      expect(deviceId).not.toContain('.');
      expect(deviceId).toContain('192-168-1-100');
    });

    it('wirft keinen Fehler wenn createRawDevice fehlschlägt – Lock wird nicht hinzugefügt', async () => {
      mockFreeAtHome.createRawDevice.mockRejectedValue(new Error('Gerät konnte nicht erstellt werden'));
      await expect(
        configurationChangedListener(makeConfiguration([makeBridgeConfig()]))
      ).resolves.toBeUndefined();
    });
  });

  describe('initializeLocks() – Idempotenz', () => {
    it('erstellt kein doppeltes Lock-Gerät bei zweifachem Aufruf mit gleicher Konfiguration', async () => {
      await configurationChangedListener(makeConfiguration([makeBridgeConfig()]));
      await configurationChangedListener(makeConfiguration([makeBridgeConfig()]));
      expect(mockFreeAtHome.createRawDevice).toHaveBeenCalledTimes(1);
    });
  });
});
