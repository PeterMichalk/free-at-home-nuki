import { ConfigurationParser } from '../configuration-parser';
import { AddOn } from '@busch-jaeger/free-at-home';

function makeConfig(
  bridges: Record<string, any>,
  locks: Record<string, any> = {}
): AddOn.Configuration {
  return {
    bridge: { items: bridges },
    lock:   { items: locks },
  } as unknown as AddOn.Configuration;
}

const BRIDGE_IP = '192.168.1.100';

const validBridge = { ip: BRIDGE_IP, token: 'abc123' };
const validLock   = { id: '42', name: 'Haustür', bridgeIp: BRIDGE_IP };

describe('ConfigurationParser.extractBridgeConfigs', () => {
  describe('Happy paths', () => {
    it('gibt eine Bridge zurück bei einem gültigen Eintrag', () => {
      const result = ConfigurationParser.extractBridgeConfigs(
        makeConfig({ 'b1': validBridge }, { 'l1': validLock })
      );
      expect(result).toHaveLength(1);
      expect(result[0].ip).toBe(BRIDGE_IP);
    });

    it('gibt mehrere Bridges zurück bei mehreren gültigen Einträgen', () => {
      const second = { ip: '10.0.0.1', token: 'xyz' };
      const result = ConfigurationParser.extractBridgeConfigs(
        makeConfig({ 'b1': validBridge, 'b2': second })
      );
      expect(result).toHaveLength(2);
    });

    it('behält alle Felder: ip, token, port, pollInterval', () => {
      const bridge = { ...validBridge, port: 8081, pollInterval: 60000 };
      const result = ConfigurationParser.extractBridgeConfigs(makeConfig({ 'b1': bridge }));
      expect(result[0].port).toBe(8081);
      expect(result[0].pollInterval).toBe(60000);
    });

    it('ordnet Schlösser der richtigen Bridge via bridgeIp zu', () => {
      const result = ConfigurationParser.extractBridgeConfigs(
        makeConfig({ 'b1': validBridge }, { 'l1': validLock })
      );
      expect(result[0].locks).toHaveLength(1);
      expect(result[0].locks[0]).toEqual({ id: '42', name: 'Haustür' });
    });

    it('ordnet mehrere Schlösser derselben Bridge zu', () => {
      const lock2 = { id: '99', name: 'Büro', bridgeIp: BRIDGE_IP };
      const result = ConfigurationParser.extractBridgeConfigs(
        makeConfig({ 'b1': validBridge }, { 'l1': validLock, 'l2': lock2 })
      );
      expect(result[0].locks).toHaveLength(2);
    });

    it('ordnet Schlösser verschiedenen Bridges zu', () => {
      const ip2   = '10.0.0.1';
      const lock2 = { id: '99', name: 'Büro', bridgeIp: ip2 };
      const result = ConfigurationParser.extractBridgeConfigs(
        makeConfig(
          { 'b1': validBridge, 'b2': { ip: ip2, token: 'xyz' } },
          { 'l1': validLock, 'l2': lock2 }
        )
      );
      const b1 = result.find(b => b.ip === BRIDGE_IP)!;
      const b2 = result.find(b => b.ip === ip2)!;
      expect(b1.locks).toHaveLength(1);
      expect(b2.locks).toHaveLength(1);
    });

    it('gibt leeres locks-Array zurück wenn keine Schlösser konfiguriert sind', () => {
      const result = ConfigurationParser.extractBridgeConfigs(makeConfig({ 'b1': validBridge }));
      expect(result[0].locks).toEqual([]);
    });
  });

  describe('Filterung ungültiger Einträge', () => {
    it('schließt Bridge ohne ip aus', () => {
      const bad = { token: 'abc' };
      const result = ConfigurationParser.extractBridgeConfigs(makeConfig({ 'b1': bad }));
      expect(result).toHaveLength(0);
    });

    it('schließt Bridge mit leerer ip aus', () => {
      const result = ConfigurationParser.extractBridgeConfigs(makeConfig({ 'b1': { ip: '', token: 'abc' } }));
      expect(result).toHaveLength(0);
    });

    it('schließt Bridge ohne token aus', () => {
      const result = ConfigurationParser.extractBridgeConfigs(makeConfig({ 'b1': { ip: BRIDGE_IP } }));
      expect(result).toHaveLength(0);
    });

    it('schließt Bridge mit leerem token aus', () => {
      const result = ConfigurationParser.extractBridgeConfigs(makeConfig({ 'b1': { ip: BRIDGE_IP, token: '' } }));
      expect(result).toHaveLength(0);
    });

    it('schließt Lock ohne id aus', () => {
      const badLock = { name: 'Haustür', bridgeIp: BRIDGE_IP };
      const result = ConfigurationParser.extractBridgeConfigs(
        makeConfig({ 'b1': validBridge }, { 'l1': badLock })
      );
      expect(result[0].locks).toHaveLength(0);
    });

    it('schließt Lock ohne bridgeIp aus', () => {
      const badLock = { id: '42', name: 'Haustür' };
      const result = ConfigurationParser.extractBridgeConfigs(
        makeConfig({ 'b1': validBridge }, { 'l1': badLock })
      );
      expect(result[0].locks).toHaveLength(0);
    });

    it('ignoriert Lock mit unbekannter bridgeIp', () => {
      const orphanLock = { id: '42', name: 'Haustür', bridgeIp: '99.99.99.99' };
      const result = ConfigurationParser.extractBridgeConfigs(
        makeConfig({ 'b1': validBridge }, { 'l1': orphanLock })
      );
      expect(result[0].locks).toHaveLength(0);
    });

    it('gibt nur gültige Bridges aus gemischten Einträgen zurück', () => {
      const result = ConfigurationParser.extractBridgeConfigs(
        makeConfig({ 'b1': { ip: '', token: 'abc' }, 'b2': validBridge })
      );
      expect(result).toHaveLength(1);
      expect(result[0].ip).toBe(BRIDGE_IP);
    });
  });

  describe('Edge Cases / Fehlerbehandlung', () => {
    it('gibt [] zurück wenn config kein bridge-Objekt hat', () => {
      const result = ConfigurationParser.extractBridgeConfigs({} as AddOn.Configuration);
      expect(result).toEqual([]);
    });

    it('gibt [] zurück wenn bridge.items fehlt', () => {
      const result = ConfigurationParser.extractBridgeConfigs(
        { bridge: {} } as unknown as AddOn.Configuration
      );
      expect(result).toEqual([]);
    });

    it('gibt [] zurück wenn bridge.items leer ist', () => {
      const result = ConfigurationParser.extractBridgeConfigs(makeConfig({}));
      expect(result).toEqual([]);
    });

    it('gibt [] zurück wenn alle Bridge-Einträge ungültig sind', () => {
      const result = ConfigurationParser.extractBridgeConfigs(
        makeConfig({ 'b1': { foo: 'bar' }, 'b2': { ip: '' } })
      );
      expect(result).toEqual([]);
    });

    it('funktioniert ohne lock-Gruppe in der Konfiguration', () => {
      const result = ConfigurationParser.extractBridgeConfigs(
        { bridge: { items: { 'b1': validBridge } } } as unknown as AddOn.Configuration
      );
      expect(result).toHaveLength(1);
      expect(result[0].locks).toEqual([]);
    });
  });
});
