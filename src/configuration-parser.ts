import { AddOn } from '@busch-jaeger/free-at-home';
import { NukiBridgeConfig, AddOnConfiguration } from './types';

// Konfigurations-Parser
export class ConfigurationParser {
  /**
   * Extrahiert alle Bridge-Konfigurationen aus dem nukiBridges JSON-Array.
   */
  static extractBridgeConfigs(config: AddOn.Configuration): NukiBridgeConfig[] {
    const defaultConfig = config.default?.items as AddOnConfiguration | undefined;

    if (defaultConfig?.nukiBridges && typeof defaultConfig.nukiBridges === 'string') {
      try {
        const parsed = JSON.parse(defaultConfig.nukiBridges);
        if (Array.isArray(parsed)) {
          const bridges = parsed.filter((b: any): b is NukiBridgeConfig =>
            b &&
            typeof b.ip === 'string' && b.ip &&
            typeof b.token === 'string' && b.token &&
            Array.isArray(b.locks)
          );
          if (bridges.length > 0) {
            return bridges;
          }
        }
      } catch (error) {
        console.error("Fehler beim Parsen der Bridge-Konfiguration:", error);
      }
    }

    console.warn("Keine gültige Bridge-Konfiguration gefunden");
    return [];
  }
}
