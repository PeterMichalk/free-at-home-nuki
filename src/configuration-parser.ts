import { AddOn } from '@busch-jaeger/free-at-home';
import { NukiBridgeConfig, NukiLockConfig } from './types';

export class ConfigurationParser {
  static extractBridgeConfigs(config: AddOn.Configuration): NukiBridgeConfig[] {
    const raw = config as Record<string, any>;
    const bridgeGroup = raw['bridge'];
    const lockGroup   = raw['lock'];

    if (!bridgeGroup?.items) return [];

    // Schlösser nach Bridge-IP gruppieren
    const locksByBridgeIp = new Map<string, NukiLockConfig[]>();
    for (const entry of Object.values((lockGroup?.items ?? {}) as Record<string, any>)) {
      const lockId   = entry?.id       as string | undefined;
      const lockName = entry?.name     as string | undefined;
      const bIp      = entry?.bridgeIp as string | undefined;
      if (!lockId || !lockName || !bIp) continue;
      if (!locksByBridgeIp.has(bIp)) locksByBridgeIp.set(bIp, []);
      locksByBridgeIp.get(bIp)!.push({ id: String(lockId), name: String(lockName) });
    }

    const bridges: NukiBridgeConfig[] = [];
    for (const entry of Object.values(bridgeGroup.items as Record<string, any>)) {
      const ip    = entry?.ip    as string | undefined;
      const token = entry?.token as string | undefined;
      if (!ip || typeof ip !== 'string' || !token || typeof token !== 'string') continue;

      bridges.push({
        ip,
        token,
        port:         entry.port         ? Number(entry.port)         : undefined,
        pollInterval: entry.pollInterval ? Number(entry.pollInterval) : undefined,
        locks: locksByBridgeIp.get(ip) ?? [],
      });
    }

    if (bridges.length === 0) {
      console.warn("Keine gültige Bridge-Konfiguration gefunden");
    }

    return bridges;
  }
}
