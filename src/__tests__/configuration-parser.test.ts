import { ConfigurationParser } from '../configuration-parser';
import { AddOn } from '@busch-jaeger/free-at-home';

function makeConfig(nukiBridges: unknown): AddOn.Configuration {
  return {
    default: {
      items: { nukiBridges } as any,
    },
  } as unknown as AddOn.Configuration;
}

const validBridge = {
  ip: '192.168.1.100',
  token: 'abc123',
  locks: [{ id: '42', name: 'Haustür' }],
};

describe('ConfigurationParser.extractBridgeConfigs', () => {
  describe('Happy paths', () => {
    it('gibt eine Bridge zurück bei einem gültigen Eintrag', () => {
      const result = ConfigurationParser.extractBridgeConfigs(makeConfig(JSON.stringify([validBridge])));
      expect(result).toHaveLength(1);
      expect(result[0].ip).toBe('192.168.1.100');
    });

    it('gibt mehrere Bridges zurück bei mehreren gültigen Einträgen', () => {
      const second = { ip: '10.0.0.1', token: 'xyz', locks: [] };
      const result = ConfigurationParser.extractBridgeConfigs(
        makeConfig(JSON.stringify([validBridge, second]))
      );
      expect(result).toHaveLength(2);
    });

    it('behält alle Felder: ip, token, locks, port, pollInterval', () => {
      const full = { ...validBridge, port: 8081, pollInterval: 60000 };
      const result = ConfigurationParser.extractBridgeConfigs(makeConfig(JSON.stringify([full])));
      expect(result[0]).toMatchObject(full);
    });
  });

  describe('Filterung ungültiger Einträge', () => {
    it('schließt Einträge ohne ip aus', () => {
      const bad = { token: 'abc', locks: [] };
      const result = ConfigurationParser.extractBridgeConfigs(makeConfig(JSON.stringify([bad])));
      expect(result).toHaveLength(0);
    });

    it('schließt Einträge mit leerer ip aus', () => {
      const bad = { ip: '', token: 'abc', locks: [] };
      const result = ConfigurationParser.extractBridgeConfigs(makeConfig(JSON.stringify([bad])));
      expect(result).toHaveLength(0);
    });

    it('schließt Einträge ohne token aus', () => {
      const bad = { ip: '1.2.3.4', locks: [] };
      const result = ConfigurationParser.extractBridgeConfigs(makeConfig(JSON.stringify([bad])));
      expect(result).toHaveLength(0);
    });

    it('schließt Einträge mit leerem token aus', () => {
      const bad = { ip: '1.2.3.4', token: '', locks: [] };
      const result = ConfigurationParser.extractBridgeConfigs(makeConfig(JSON.stringify([bad])));
      expect(result).toHaveLength(0);
    });

    it('schließt Einträge ohne locks aus', () => {
      const bad = { ip: '1.2.3.4', token: 'abc' };
      const result = ConfigurationParser.extractBridgeConfigs(makeConfig(JSON.stringify([bad])));
      expect(result).toHaveLength(0);
    });

    it('schließt Einträge aus, bei denen locks kein Array ist', () => {
      const bad = { ip: '1.2.3.4', token: 'abc', locks: 'not-an-array' };
      const result = ConfigurationParser.extractBridgeConfigs(makeConfig(JSON.stringify([bad])));
      expect(result).toHaveLength(0);
    });

    it('gibt nur gültige Einträge aus einem gemischten Array zurück', () => {
      const good = validBridge;
      const bad = { ip: '', token: 'abc', locks: [] };
      const result = ConfigurationParser.extractBridgeConfigs(
        makeConfig(JSON.stringify([bad, good]))
      );
      expect(result).toHaveLength(1);
      expect(result[0].ip).toBe('192.168.1.100');
    });
  });

  describe('Edge Cases / Fehlerbehandlung', () => {
    it('gibt [] zurück wenn config.default undefined ist', () => {
      const result = ConfigurationParser.extractBridgeConfigs({} as AddOn.Configuration);
      expect(result).toEqual([]);
    });

    it('gibt [] zurück wenn config.default.items undefined ist', () => {
      const result = ConfigurationParser.extractBridgeConfigs(
        { default: {} } as unknown as AddOn.Configuration
      );
      expect(result).toEqual([]);
    });

    it('gibt [] zurück wenn nukiBridges fehlt', () => {
      const result = ConfigurationParser.extractBridgeConfigs(
        makeConfig(undefined)
      );
      expect(result).toEqual([]);
    });

    it('gibt [] zurück wenn nukiBridges kein String ist', () => {
      const result = ConfigurationParser.extractBridgeConfigs(makeConfig({ some: 'object' }));
      expect(result).toEqual([]);
    });

    it('gibt [] zurück wenn nukiBridges valides JSON ist, aber kein Array', () => {
      const result = ConfigurationParser.extractBridgeConfigs(makeConfig('{}'));
      expect(result).toEqual([]);
    });

    it('gibt [] zurück bei ungültigem JSON', () => {
      const result = ConfigurationParser.extractBridgeConfigs(makeConfig('not json {'));
      expect(result).toEqual([]);
    });

    it('gibt [] zurück bei leerem Array', () => {
      const result = ConfigurationParser.extractBridgeConfigs(makeConfig('[]'));
      expect(result).toEqual([]);
    });

    it('gibt [] zurück wenn alle Einträge ungültig sind', () => {
      const result = ConfigurationParser.extractBridgeConfigs(
        makeConfig(JSON.stringify([{ foo: 'bar' }, { ip: '' }]))
      );
      expect(result).toEqual([]);
    });
  });
});
