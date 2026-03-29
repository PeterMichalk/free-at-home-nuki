import { EventEmitter } from 'events';
import * as http from 'http';
import { NukiApiClient } from '../nuki-api-client';
import { NukiLockAction, NukiLockState, BRIDGE_CONNECTION_TIMEOUT_MS } from '../types';

jest.mock('http');

const mockedHttpGet = http.get as jest.MockedFunction<typeof http.get>;

function makeMockReq(opts: { triggerTimeout?: boolean; triggerError?: Error } = {}) {
  const emitter = new EventEmitter();
  const req = Object.assign(emitter, {
    destroy: jest.fn(),
    setTimeout: jest.fn((ms: number, cb: () => void) => {
      if (opts.triggerTimeout) cb();
    }),
  });
  return req;
}

function makeMockRes(body: string) {
  const res = new EventEmitter();
  process.nextTick(() => {
    res.emit('data', Buffer.from(body));
    res.emit('end');
  });
  return res;
}

function setupSuccessfulGet(body: string) {
  mockedHttpGet.mockImplementation((url: any, cb: any) => {
    const req = makeMockReq();
    cb(makeMockRes(body));
    return req as any;
  });
}

const bridgeLockFixture = {
  deviceType: 0,
  nukiId: 42,
  name: 'Haustür',
  firmwareVersion: '3.5.1',
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

describe('NukiApiClient', () => {
  let client: NukiApiClient;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new NukiApiClient('192.168.1.100', 'mytoken', 8080);
  });

  describe('listAllLocks()', () => {
    it('gibt ein gepartes Array zurück bei gültiger JSON-Antwort', async () => {
      setupSuccessfulGet(JSON.stringify([bridgeLockFixture]));
      const result = await client.listAllLocks();
      expect(result).toHaveLength(1);
      expect(result[0].nukiId).toBe(42);
    });

    it('baut die URL korrekt als http://<ip>:<port>/list?token=<token>', async () => {
      setupSuccessfulGet('[]');
      await client.listAllLocks();
      expect(mockedHttpGet).toHaveBeenCalledWith(
        expect.stringContaining('http://192.168.1.100:8080/list?token=mytoken'),
        expect.any(Function)
      );
    });

    it('verwendet BRIDGE_CONNECTION_TIMEOUT_MS als Timeout', async () => {
      const req = makeMockReq();
      mockedHttpGet.mockImplementation((url: any, cb: any) => {
        cb(makeMockRes('[]'));
        return req as any;
      });
      await client.listAllLocks();
      expect(req.setTimeout).toHaveBeenCalledWith(BRIDGE_CONNECTION_TIMEOUT_MS, expect.any(Function));
    });

    it('wirft einen Fehler wenn das error-Event ausgelöst wird', async () => {
      mockedHttpGet.mockImplementation(() => {
        const req = makeMockReq();
        process.nextTick(() => req.emit('error', new Error('Netzwerkfehler')));
        return req as any;
      });
      await expect(client.listAllLocks()).rejects.toThrow('Netzwerkfehler');
    });

    it('wirft einen Fehler bei ungültigem JSON in der Antwort', async () => {
      setupSuccessfulGet('kein json {{{');
      await expect(client.listAllLocks()).rejects.toThrow();
    });
  });

  describe('getLockStatus(lockId)', () => {
    it('gibt ein NukiLockStatus-Objekt zurück wenn das Schloss gefunden wird', async () => {
      setupSuccessfulGet(JSON.stringify([bridgeLockFixture]));
      const status = await client.getLockStatus('42');
      expect(status).not.toBeNull();
      expect(status!.nukiId).toBe(42);
      expect(status!.state).toBe(NukiLockState.LOCKED);
      expect(status!.success).toBe(true);
    });

    it('gibt null zurück wenn nukiId nicht im Array ist', async () => {
      setupSuccessfulGet(JSON.stringify([bridgeLockFixture]));
      const status = await client.getLockStatus('999');
      expect(status).toBeNull();
    });

    it('gibt null zurück wenn lastKnownState fehlt', async () => {
      const lockWithoutState = { ...bridgeLockFixture, lastKnownState: undefined };
      setupSuccessfulGet(JSON.stringify([lockWithoutState]));
      const status = await client.getLockStatus('42');
      expect(status).toBeNull();
    });

    it('setzt batteryCritical auf false wenn batteryCritical nicht true ist', async () => {
      const lock = {
        ...bridgeLockFixture,
        lastKnownState: { ...bridgeLockFixture.lastKnownState, batteryCritical: undefined as any },
      };
      setupSuccessfulGet(JSON.stringify([lock]));
      const status = await client.getLockStatus('42');
      expect(status!.batteryCritical).toBe(false);
    });

    it('setzt batteryChargeState auf 0 wenn der Wert fehlt', async () => {
      const lock = {
        ...bridgeLockFixture,
        lastKnownState: { ...bridgeLockFixture.lastKnownState, batteryChargeState: null as any },
      };
      setupSuccessfulGet(JSON.stringify([lock]));
      const status = await client.getLockStatus('42');
      expect(status!.batteryChargeState).toBe(0);
    });

    it('wirft den Fehler weiter wenn listAllLocks fehlschlägt', async () => {
      mockedHttpGet.mockImplementation(() => {
        const req = makeMockReq();
        process.nextTick(() => req.emit('error', new Error('Verbindung getrennt')));
        return req as any;
      });
      await expect(client.getLockStatus('42')).rejects.toThrow('Verbindung getrennt');
    });

    it('findet Schloss per String-Vergleich mit numerischer nukiId', async () => {
      setupSuccessfulGet(JSON.stringify([bridgeLockFixture])); // nukiId ist number 42
      const status = await client.getLockStatus('42'); // lockId ist string "42"
      expect(status).not.toBeNull();
    });
  });

  describe('executeLockAction(lockId, action)', () => {
    it('gibt true zurück wenn die API { success: true } antwortet', async () => {
      setupSuccessfulGet(JSON.stringify({ success: true }));
      const result = await client.executeLockAction('42', NukiLockAction.LOCK);
      expect(result).toBe(true);
    });

    it('baut die URL mit nukiId, action und token', async () => {
      setupSuccessfulGet(JSON.stringify({ success: true }));
      await client.executeLockAction('42', NukiLockAction.UNLOCK);
      const calledUrl = (mockedHttpGet.mock.calls[0][0] as string);
      expect(calledUrl).toContain('nukiId=42');
      expect(calledUrl).toContain(`action=${NukiLockAction.UNLOCK}`);
      expect(calledUrl).toContain('token=mytoken');
    });

    it('wirft einen Fehler wenn success false ist', async () => {
      setupSuccessfulGet(JSON.stringify({ success: false, errorCode: 1 }));
      await expect(client.executeLockAction('42', NukiLockAction.LOCK)).rejects.toThrow();
    });

    it('wirft den Fehler weiter bei HTTP-Fehler', async () => {
      mockedHttpGet.mockImplementation(() => {
        const req = makeMockReq();
        process.nextTick(() => req.emit('error', new Error('Timeout')));
        return req as any;
      });
      await expect(client.executeLockAction('42', NukiLockAction.LOCK)).rejects.toThrow('Timeout');
    });
  });

  describe('lock() / unlock()', () => {
    it('lock() ruft executeLockAction mit NukiLockAction.LOCK auf', async () => {
      setupSuccessfulGet(JSON.stringify({ success: true }));
      await client.lock('42');
      const calledUrl = (mockedHttpGet.mock.calls[0][0] as string);
      expect(calledUrl).toContain(`action=${NukiLockAction.LOCK}`);
    });

    it('unlock() ruft executeLockAction mit NukiLockAction.UNLOCK auf', async () => {
      setupSuccessfulGet(JSON.stringify({ success: true }));
      await client.unlock('42');
      const calledUrl = (mockedHttpGet.mock.calls[0][0] as string);
      expect(calledUrl).toContain(`action=${NukiLockAction.UNLOCK}`);
    });
  });

  describe('Timeout-Verhalten in httpGet', () => {
    it('zerstört den Request und wirft "Request timeout" wenn Timeout auslöst', async () => {
      const req = makeMockReq({ triggerTimeout: true });
      mockedHttpGet.mockImplementation((_url: any, _cb: any) => req as any);

      await expect(client.listAllLocks()).rejects.toThrow('Request timeout');
      expect(req.destroy).toHaveBeenCalled();
    });
  });
});
