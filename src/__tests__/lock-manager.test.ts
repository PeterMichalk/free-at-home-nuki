import { LockManager } from '../lock-manager';
import { NukiApiClient } from '../nuki-api-client';
import {
  NukiLockState,
  NukiLockStatus,
  NukiLockConfig,
  ManagedLock,
} from '../types';
import { PairingIds, FreeAtHomeRawChannel } from '@busch-jaeger/free-at-home';

function makeStatus(state: NukiLockState): NukiLockStatus {
  return {
    nukiId: 42,
    name: 'Haustür',
    batteryCritical: false,
    state,
    stateName: 'locked',
    batteryChargeState: 80,
    success: true,
  };
}

describe('LockManager', () => {
  // Use plain objects cast to any to avoid strict-event-emitter-types conflicts
  let mockDevice: any;
  let mockClient: jest.Mocked<Pick<NukiApiClient, 'lock' | 'unlock' | 'getLockStatus'>>;
  let managedLock: ManagedLock;
  let config: NukiLockConfig;
  let manager: LockManager;
  let datapointChangedListener: (id: PairingIds, value: string) => Promise<void>;

  beforeEach(() => {
    jest.useFakeTimers();

    mockDevice = {
      on: jest.fn(),
      setOutputDatapoint: jest.fn().mockResolvedValue(undefined),
      setUnresponsive: jest.fn().mockResolvedValue(undefined),
    };

    mockClient = {
      lock: jest.fn().mockResolvedValue(true),
      unlock: jest.fn().mockResolvedValue(true),
      getLockStatus: jest.fn().mockResolvedValue(makeStatus(NukiLockState.LOCKED)),
    };

    config = { id: '42', name: 'Haustür' };
    managedLock = {
      config,
      device: mockDevice as unknown as FreeAtHomeRawChannel,
      isUpdating: false,
    };

    manager = new LockManager(
      config,
      mockDevice as unknown as FreeAtHomeRawChannel,
      mockClient as unknown as NukiApiClient,
      managedLock
    );

    // Capture the registered datapointChanged listener
    const onCall = mockDevice.on.mock.calls.find((c) => c[0] === 'datapointChanged');
    datapointChangedListener = onCall![1] as any;
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe('Konstruktor / setupEventHandlers()', () => {
    it('registriert einen datapointChanged-Listener auf dem Gerät', () => {
      expect(mockDevice.on).toHaveBeenCalledWith('datapointChanged', expect.any(Function));
    });
  });

  describe('datapointChanged – Guard: isUpdating', () => {
    it('ignoriert Events wenn managedLock.isUpdating true ist', async () => {
      managedLock.isUpdating = true;
      await datapointChangedListener(PairingIds.AL_LOCK_UNLOCK_COMMAND, '1');
      expect(mockClient.lock).not.toHaveBeenCalled();
    });
  });

  describe('datapointChanged – Guard: falsche PairingId', () => {
    it('ignoriert Events mit anderer PairingId', async () => {
      await datapointChangedListener(PairingIds.AL_SWITCH_ON_OFF, '1');
      expect(mockClient.lock).not.toHaveBeenCalled();
      expect(mockClient.unlock).not.toHaveBeenCalled();
    });
  });

  describe('handleLockCommand() – via datapointChanged', () => {
    it('ruft apiClient.lock() auf wenn value "1" ist', async () => {
      await datapointChangedListener(PairingIds.AL_LOCK_UNLOCK_COMMAND, '1');
      expect(mockClient.lock).toHaveBeenCalledWith('42');
    });

    it('ruft apiClient.unlock() auf wenn value "0" ist', async () => {
      await datapointChangedListener(PairingIds.AL_LOCK_UNLOCK_COMMAND, '0');
      expect(mockClient.unlock).toHaveBeenCalledWith('42');
    });

    it('plant updateStatus nach ACTION_DELAY per setTimeout bei Erfolg', async () => {
      await datapointChangedListener(PairingIds.AL_LOCK_UNLOCK_COMMAND, '1');
      expect(mockClient.getLockStatus).not.toHaveBeenCalled();
      jest.runAllTimers();
      await Promise.resolve(); // flush microtasks
      expect(mockClient.getLockStatus).toHaveBeenCalledWith('42');
    });

    it('plant updateStatus nach ERROR_DELAY per setTimeout wenn lock() fehlschlägt', async () => {
      mockClient.lock.mockRejectedValue(new Error('Bridge nicht erreichbar'));
      await datapointChangedListener(PairingIds.AL_LOCK_UNLOCK_COMMAND, '1');
      jest.runAllTimers();
      await Promise.resolve();
      expect(mockClient.getLockStatus).toHaveBeenCalledWith('42');
    });
  });

  describe('applyStatus(lockStatus)', () => {
    it('tut nichts wenn lockStatus null ist', async () => {
      await manager.applyStatus(null);
      expect(mockDevice.setOutputDatapoint).not.toHaveBeenCalled();
    });

    it('tut nichts wenn managedLock.isUpdating bereits true ist', async () => {
      managedLock.isUpdating = true;
      await manager.applyStatus(makeStatus(NukiLockState.LOCKED));
      expect(mockDevice.setOutputDatapoint).not.toHaveBeenCalled();
    });

    it('setzt Datapoint auf "1" wenn state LOCKED ist', async () => {
      await manager.applyStatus(makeStatus(NukiLockState.LOCKED));
      expect(mockDevice.setOutputDatapoint).toHaveBeenCalledWith(
        PairingIds.AL_INFO_LOCK_UNLOCK_COMMAND,
        '1'
      );
    });

    it('setzt Datapoint auf "0" wenn state UNLOCKED ist', async () => {
      await manager.applyStatus(makeStatus(NukiLockState.UNLOCKED));
      expect(mockDevice.setOutputDatapoint).toHaveBeenCalledWith(
        PairingIds.AL_INFO_LOCK_UNLOCK_COMMAND,
        '0'
      );
    });

    it('setzt isUpdating auf true vor dem await', async () => {
      let capturedFlag = false;
      mockDevice.setOutputDatapoint.mockImplementation(async () => {
        capturedFlag = managedLock.isUpdating;
      });
      await manager.applyStatus(makeStatus(NukiLockState.LOCKED));
      expect(capturedFlag).toBe(true);
    });

    it('setzt isUpdating nach Erfolg auf false zurück', async () => {
      await manager.applyStatus(makeStatus(NukiLockState.LOCKED));
      expect(managedLock.isUpdating).toBe(false);
    });

    it('setzt isUpdating auch nach einem Fehler auf false zurück (finally)', async () => {
      mockDevice.setOutputDatapoint.mockRejectedValue(new Error('Netzwerkfehler'));
      try {
        await manager.applyStatus(makeStatus(NukiLockState.LOCKED));
      } catch {
        // Fehler wird erwartet, finally-Block soll isUpdating trotzdem zurücksetzen
      }
      expect(managedLock.isUpdating).toBe(false);
    });
  });

  describe('updateStatus()', () => {
    it('ruft getLockStatus() und dann applyStatus() auf', async () => {
      const status = makeStatus(NukiLockState.LOCKED);
      mockClient.getLockStatus.mockResolvedValue(status);
      await manager.updateStatus();
      expect(mockClient.getLockStatus).toHaveBeenCalledWith('42');
      expect(mockDevice.setOutputDatapoint).toHaveBeenCalled();
    });

    it('wirft keinen Fehler wenn getLockStatus() fehlschlägt', async () => {
      mockClient.getLockStatus.mockRejectedValue(new Error('Bridge offline'));
      await expect(manager.updateStatus()).resolves.toBeUndefined();
    });
  });

  describe('dispose()', () => {
    it('kann aufgerufen werden ohne zu werfen', () => {
      expect(() => manager.dispose()).not.toThrow();
    });
  });
});
