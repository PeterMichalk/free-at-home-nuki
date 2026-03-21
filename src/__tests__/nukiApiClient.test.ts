import * as http from 'http';
import { NukiApiClient, NukiLockState, NukiLockAction } from '../main';

jest.mock('@busch-jaeger/free-at-home', () => ({
  AddOn: {},
  FreeAtHome: jest.fn(),
  PairingIds: {},
  FreeAtHomeRawChannel: jest.fn(),
}));

jest.mock('http');

// Helper to mock http.get with a given response body
function mockHttpGet(responseBody: string): void {
  const mockResponse: any = {
    on: jest.fn((event: string, cb: Function) => {
      if (event === 'data') cb(Buffer.from(responseBody));
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

// Helper to mock http.get with a network error
function mockHttpGetError(error: Error): void {
  const mockRequest: any = {
    on: jest.fn((event: string, cb: Function) => {
      if (event === 'error') cb(error);
      return mockRequest;
    }),
  };
  (http.get as jest.Mock).mockImplementation(() => mockRequest);
}

afterEach(() => {
  jest.clearAllMocks();
});

// ─── getLockStatus ───────────────────────────────────────────────────────────

describe('NukiApiClient.getLockStatus', () => {
  const client = new NukiApiClient('192.168.1.100', 'test-token');

  it('returns lock status when lock is found with lastKnownState', async () => {
    const locks = [
      {
        deviceType: 0,
        nukiId: 123,
        name: 'Front Door',
        firmwareVersion: '1.0',
        lastKnownState: {
          mode: 2,
          state: NukiLockState.LOCKED,
          stateName: 'locked',
          batteryCritical: false,
          batteryCharging: false,
          batteryChargeState: 80,
          timestamp: '2024-01-01T00:00:00Z',
        },
      },
    ];
    mockHttpGet(JSON.stringify(locks));

    const status = await client.getLockStatus('123');

    expect(status).not.toBeNull();
    expect(status!.nukiId).toBe(123);
    expect(status!.name).toBe('Front Door');
    expect(status!.state).toBe(NukiLockState.LOCKED);
    expect(status!.batteryCritical).toBe(false);
    expect(status!.batteryChargeState).toBe(80);
    expect(status!.success).toBe(true);
  });

  it('returns null when lock ID is not found in list', async () => {
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockHttpGet(JSON.stringify([{ nukiId: 999, name: 'Other', deviceType: 0, firmwareVersion: '1' }]));

    const status = await client.getLockStatus('123');

    expect(status).toBeNull();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('123'));
    consoleSpy.mockRestore();
  });

  it('returns null when lock has no lastKnownState', async () => {
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockHttpGet(JSON.stringify([{ nukiId: 123, name: 'Door', deviceType: 0, firmwareVersion: '1' }]));

    const status = await client.getLockStatus('123');

    expect(status).toBeNull();
    consoleSpy.mockRestore();
  });

  it('uses batteryCritical=false when property is falsy', async () => {
    const locks = [
      {
        nukiId: 1, name: 'Lock', deviceType: 0, firmwareVersion: '1',
        lastKnownState: {
          mode: 2, state: NukiLockState.UNLOCKED, stateName: 'unlocked',
          batteryCritical: false, batteryCharging: false, batteryChargeState: 50,
          timestamp: '',
        },
      },
    ];
    mockHttpGet(JSON.stringify(locks));
    const status = await client.getLockStatus('1');
    expect(status!.batteryCritical).toBe(false);
  });

  it('defaults batteryChargeState to 0 when not present', async () => {
    const locks = [
      {
        nukiId: 1, name: 'Lock', deviceType: 0, firmwareVersion: '1',
        lastKnownState: {
          mode: 2, state: 1, stateName: 'locked',
          batteryCritical: false, batteryCharging: false,
          timestamp: '',
          // batteryChargeState intentionally omitted
        },
      },
    ];
    mockHttpGet(JSON.stringify(locks));
    const status = await client.getLockStatus('1');
    expect(status!.batteryChargeState).toBe(0);
  });

  it('throws and logs when HTTP request fails', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockHttpGetError(new Error('Network failure'));

    await expect(client.getLockStatus('123')).rejects.toThrow('Network failure');
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('throws and logs when response is not valid JSON', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockHttpGet('not-json');

    await expect(client.getLockStatus('123')).rejects.toThrow();
    consoleSpy.mockRestore();
  });
});

// ─── executeLockAction ───────────────────────────────────────────────────────

describe('NukiApiClient.executeLockAction', () => {
  const client = new NukiApiClient('192.168.1.100', 'test-token');

  it('returns true when API responds with success=true for LOCK', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    mockHttpGet(JSON.stringify({ success: true }));

    const result = await client.executeLockAction('123', NukiLockAction.LOCK);

    expect(result).toBe(true);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('verriegelt'));
    consoleSpy.mockRestore();
  });

  it('returns true and logs "entriegelt" for UNLOCK action', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    mockHttpGet(JSON.stringify({ success: true }));

    const result = await client.executeLockAction('123', NukiLockAction.UNLOCK);

    expect(result).toBe(true);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('entriegelt'));
    consoleSpy.mockRestore();
  });

  it('throws when API responds with success=false', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockHttpGet(JSON.stringify({ success: false, error: 'denied' }));

    await expect(client.executeLockAction('123', NukiLockAction.LOCK)).rejects.toThrow(
      'Nuki API Fehler'
    );
    consoleSpy.mockRestore();
  });

  it('throws and logs when network request fails', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockHttpGetError(new Error('Connection refused'));

    await expect(client.executeLockAction('123', NukiLockAction.LOCK)).rejects.toThrow(
      'Connection refused'
    );
    consoleSpy.mockRestore();
  });

  it('includes the correct URL parameters (token, nukiId, action) in the request', async () => {
    mockHttpGet(JSON.stringify({ success: true }));
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    await client.executeLockAction('456', NukiLockAction.UNLOCK);

    const calledUrl = (http.get as jest.Mock).mock.calls[0][0] as string;
    expect(calledUrl).toContain('token=test-token');
    expect(calledUrl).toContain('nukiId=456');
    expect(calledUrl).toContain(`action=${NukiLockAction.UNLOCK}`);
    consoleSpy.mockRestore();
  });
});

// ─── lock / unlock convenience methods ───────────────────────────────────────

describe('NukiApiClient lock/unlock convenience methods', () => {
  const client = new NukiApiClient('192.168.1.1', 'tok');

  it('lock() calls executeLockAction with LOCK action', async () => {
    const spy = jest.spyOn(client, 'executeLockAction').mockResolvedValue(true);
    await client.lock('1');
    expect(spy).toHaveBeenCalledWith('1', NukiLockAction.LOCK);
  });

  it('unlock() calls executeLockAction with UNLOCK action', async () => {
    const spy = jest.spyOn(client, 'executeLockAction').mockResolvedValue(true);
    await client.unlock('1');
    expect(spy).toHaveBeenCalledWith('1', NukiLockAction.UNLOCK);
  });
});
