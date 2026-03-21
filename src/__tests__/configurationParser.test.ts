import { ConfigurationParser } from '../main';
import { AddOn } from '@busch-jaeger/free-at-home';

jest.mock('@busch-jaeger/free-at-home', () => ({
  AddOn: {},
  FreeAtHome: jest.fn(),
  PairingIds: { AL_LOCK_UNLOCK_COMMAND: 'AL_LOCK_UNLOCK_COMMAND', AL_INFO_LOCK_UNLOCK_COMMAND: 'AL_INFO_LOCK_UNLOCK_COMMAND' },
  FreeAtHomeRawChannel: jest.fn(),
}));

// ─── parseLockConfigs ────────────────────────────────────────────────────────

describe('ConfigurationParser.parseLockConfigs', () => {
  it('returns empty array for undefined input', () => {
    expect(ConfigurationParser.parseLockConfigs(undefined)).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(ConfigurationParser.parseLockConfigs('')).toEqual([]);
  });

  it('returns empty array for invalid JSON', () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(ConfigurationParser.parseLockConfigs('not-json')).toEqual([]);
    consoleSpy.mockRestore();
  });

  it('returns empty array when JSON is a non-array value', () => {
    expect(ConfigurationParser.parseLockConfigs('"just a string"')).toEqual([]);
    expect(ConfigurationParser.parseLockConfigs('42')).toEqual([]);
    expect(ConfigurationParser.parseLockConfigs('{}')).toEqual([]);
  });

  it('parses a valid array of lock configs', () => {
    const input = JSON.stringify([
      { id: '123', name: 'Front Door' },
      { id: '456', name: 'Back Door' },
    ]);
    const result = ConfigurationParser.parseLockConfigs(input);
    expect(result).toEqual([
      { id: '123', name: 'Front Door' },
      { id: '456', name: 'Back Door' },
    ]);
  });

  it('filters out items missing id field', () => {
    const input = JSON.stringify([
      { name: 'No ID Lock' },
      { id: '789', name: 'Valid Lock' },
    ]);
    expect(ConfigurationParser.parseLockConfigs(input)).toEqual([
      { id: '789', name: 'Valid Lock' },
    ]);
  });

  it('filters out items missing name field', () => {
    const input = JSON.stringify([
      { id: '111' },
      { id: '222', name: 'Valid Lock' },
    ]);
    expect(ConfigurationParser.parseLockConfigs(input)).toEqual([
      { id: '222', name: 'Valid Lock' },
    ]);
  });

  it('filters out items where id or name is not a string', () => {
    const input = JSON.stringify([
      { id: 123, name: 'Numeric ID' },
      { id: '123', name: 456 },
      { id: '789', name: 'Valid Lock' },
    ]);
    expect(ConfigurationParser.parseLockConfigs(input)).toEqual([
      { id: '789', name: 'Valid Lock' },
    ]);
  });

  it('filters out null entries in the array', () => {
    const input = JSON.stringify([null, { id: '1', name: 'Lock' }]);
    expect(ConfigurationParser.parseLockConfigs(input)).toEqual([
      { id: '1', name: 'Lock' },
    ]);
  });

  it('returns empty array for an empty JSON array', () => {
    expect(ConfigurationParser.parseLockConfigs('[]')).toEqual([]);
  });

  it('preserves extra properties on valid items', () => {
    const input = JSON.stringify([{ id: '1', name: 'Lock', extra: 'data' }]);
    const result = ConfigurationParser.parseLockConfigs(input);
    expect(result[0].id).toBe('1');
    expect(result[0].name).toBe('Lock');
  });
});

// ─── extractConfiguration ────────────────────────────────────────────────────

describe('ConfigurationParser.extractConfiguration', () => {
  function makeConfig(items: Record<string, unknown> | undefined): AddOn.Configuration {
    return { default: items ? { items } : undefined } as unknown as AddOn.Configuration;
  }

  it('returns empty strings and empty array when config has no default', () => {
    const result = ConfigurationParser.extractConfiguration({} as AddOn.Configuration);
    expect(result).toEqual({ bridgeIp: '', apiToken: '', lockConfigs: [] });
  });

  it('returns empty strings when required fields are missing', () => {
    const result = ConfigurationParser.extractConfiguration(makeConfig({}));
    expect(result).toEqual({ bridgeIp: '', apiToken: '', lockConfigs: [] });
  });

  it('extracts bridgeIp, apiToken, and lockConfigs from a valid configuration', () => {
    const locks = JSON.stringify([{ id: '1', name: 'Door' }]);
    const result = ConfigurationParser.extractConfiguration(
      makeConfig({ nukiBridgeIp: '192.168.1.100', nukiApiToken: 'secret', nukiLocks: locks })
    );
    expect(result.bridgeIp).toBe('192.168.1.100');
    expect(result.apiToken).toBe('secret');
    expect(result.lockConfigs).toEqual([{ id: '1', name: 'Door' }]);
  });

  it('treats non-string nukiBridgeIp as missing (returns empty string)', () => {
    const result = ConfigurationParser.extractConfiguration(
      makeConfig({ nukiBridgeIp: 12345, nukiApiToken: 'token', nukiLocks: '[]' })
    );
    expect(result.bridgeIp).toBe('');
  });

  it('treats non-string nukiApiToken as missing (returns empty string)', () => {
    const result = ConfigurationParser.extractConfiguration(
      makeConfig({ nukiBridgeIp: '192.168.1.1', nukiApiToken: true, nukiLocks: '[]' })
    );
    expect(result.apiToken).toBe('');
  });

  it('treats non-string nukiLocks as missing (returns empty lockConfigs)', () => {
    const result = ConfigurationParser.extractConfiguration(
      makeConfig({ nukiBridgeIp: '192.168.1.1', nukiApiToken: 'token', nukiLocks: 42 })
    );
    expect(result.lockConfigs).toEqual([]);
  });

  it('handles invalid JSON in nukiLocks gracefully', () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const result = ConfigurationParser.extractConfiguration(
      makeConfig({ nukiBridgeIp: '1.2.3.4', nukiApiToken: 'tok', nukiLocks: 'bad-json' })
    );
    expect(result.lockConfigs).toEqual([]);
    consoleSpy.mockRestore();
  });
});
