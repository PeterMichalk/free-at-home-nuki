import { ActivityLog } from '../activity-log';
import { NukiLockState, NukiLogAction, NukiLogTrigger, NukiBridgeLogEntry, ActivityLogEntry } from '../types';

describe('ActivityLog', () => {
  let log: ActivityLog;

  beforeEach(() => {
    log = new ActivityLog(10);
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── addEntry ──────────────────────────────────────────────────────────────

  describe('addEntry()', () => {
    it('fügt einen Eintrag hinzu', () => {
      log.addEntry(makeEntry({ lockId: '1', action: 'VERRIEGELT' }));
      expect(log.size).toBe(1);
    });

    it('respektiert den maximalen Puffer (maxEntries)', () => {
      for (let i = 0; i < 15; i++) {
        log.addEntry(makeEntry({ lockId: String(i) }));
      }
      expect(log.size).toBe(10);
    });

    it('entfernt älteste Einträge bei Überschreitung', () => {
      for (let i = 0; i < 12; i++) {
        log.addEntry(makeEntry({ lockId: String(i), lockName: `Lock ${i}` }));
      }
      const entries = log.getEntries();
      // Älteste zwei (Lock 0, Lock 1) sollten weg sein
      expect(entries.some(e => e.lockName === 'Lock 0')).toBe(false);
      expect(entries.some(e => e.lockName === 'Lock 1')).toBe(false);
      expect(entries.some(e => e.lockName === 'Lock 2')).toBe(true);
    });

    it('schreibt einen Eintrag ins Journal (console.log)', () => {
      log.addEntry(makeEntry({ lockName: 'Haustür', action: 'VERRIEGELT' }));
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('[ZUGRIFFSPROTOKOLL]')
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Haustür')
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('VERRIEGELT')
      );
    });
  });

  // ── getEntries ────────────────────────────────────────────────────────────

  describe('getEntries()', () => {
    it('gibt alle Einträge zurück (neueste zuerst)', () => {
      log.addEntry(makeEntry({ lockId: '1', action: 'VERRIEGELT' }));
      log.addEntry(makeEntry({ lockId: '1', action: 'ENTRIEGELT' }));
      const entries = log.getEntries();
      expect(entries[0].action).toBe('ENTRIEGELT');
      expect(entries[1].action).toBe('VERRIEGELT');
    });

    it('filtert nach lockId', () => {
      log.addEntry(makeEntry({ lockId: '42', lockName: 'Garage' }));
      log.addEntry(makeEntry({ lockId: '99', lockName: 'Haustür' }));
      const entries = log.getEntries('42');
      expect(entries).toHaveLength(1);
      expect(entries[0].lockName).toBe('Garage');
    });

    it('respektiert das limit-Argument', () => {
      for (let i = 0; i < 8; i++) {
        log.addEntry(makeEntry({ lockId: '1' }));
      }
      expect(log.getEntries(undefined, 3)).toHaveLength(3);
    });
  });

  // ── mergeBridgeLog ────────────────────────────────────────────────────────

  describe('mergeBridgeLog()', () => {
    it('fügt neue Bridge-Log-Einträge hinzu', () => {
      const bridgeLogs: NukiBridgeLogEntry[] = [
        makeBridgeEntry({ nukiId: 1, date: '2024-01-01T10:00:00Z', action: NukiLogAction.LOCK }),
        makeBridgeEntry({ nukiId: 1, date: '2024-01-01T11:00:00Z', action: NukiLogAction.UNLOCK }),
      ];
      log.mergeBridgeLog(bridgeLogs);
      expect(log.size).toBe(2);
    });

    it('ignoriert bereits gesehene Einträge (Deduplizierung)', () => {
      const bridgeLogs: NukiBridgeLogEntry[] = [
        makeBridgeEntry({ nukiId: 1, date: '2024-01-01T10:00:00Z' }),
        makeBridgeEntry({ nukiId: 1, date: '2024-01-01T11:00:00Z' }),
      ];
      log.mergeBridgeLog(bridgeLogs);
      log.mergeBridgeLog(bridgeLogs); // zweiter Aufruf mit denselben Daten
      expect(log.size).toBe(2);
    });

    it('fügt nur neuere Einträge beim zweiten Aufruf hinzu', () => {
      const first: NukiBridgeLogEntry[] = [
        makeBridgeEntry({ nukiId: 1, date: '2024-01-01T10:00:00Z' }),
      ];
      const second: NukiBridgeLogEntry[] = [
        makeBridgeEntry({ nukiId: 1, date: '2024-01-01T10:00:00Z' }), // gleicher Zeitstempel
        makeBridgeEntry({ nukiId: 1, date: '2024-01-01T12:00:00Z' }), // neuer Eintrag
      ];
      log.mergeBridgeLog(first);
      log.mergeBridgeLog(second);
      expect(log.size).toBe(2);
    });

    it('verarbeitet Einträge verschiedener Schlösser unabhängig', () => {
      const bridgeLogs: NukiBridgeLogEntry[] = [
        makeBridgeEntry({ nukiId: 1, date: '2024-01-01T10:00:00Z' }),
        makeBridgeEntry({ nukiId: 2, date: '2024-01-01T09:00:00Z' }),
      ];
      log.mergeBridgeLog(bridgeLogs);
      expect(log.size).toBe(2);
    });

    it('sortiert Bridge-Log-Einträge nach Datum vor der Verarbeitung', () => {
      const bridgeLogs: NukiBridgeLogEntry[] = [
        makeBridgeEntry({ nukiId: 1, date: '2024-01-01T12:00:00Z', action: NukiLogAction.UNLOCK }),
        makeBridgeEntry({ nukiId: 1, date: '2024-01-01T10:00:00Z', action: NukiLogAction.LOCK }),
      ];
      log.mergeBridgeLog(bridgeLogs);
      const entries = log.getEntries();
      // Neueste zuerst → 12:00 (ENTRIEGELT) sollte Index 0 sein
      expect(entries[0].action).toBe('ENTRIEGELT');
      expect(entries[1].action).toBe('VERRIEGELT');
    });
  });

  // ── markLockSeen ──────────────────────────────────────────────────────────

  describe('markLockSeen()', () => {
    it('verhindert, dass Bridge-Log-Einträge vor dem markierten Datum verarbeitet werden', () => {
      log.markLockSeen('1', new Date('2024-01-01T11:00:00Z'));

      const bridgeLogs: NukiBridgeLogEntry[] = [
        makeBridgeEntry({ nukiId: 1, date: '2024-01-01T10:00:00Z' }), // vor markiertem Datum
        makeBridgeEntry({ nukiId: 1, date: '2024-01-01T12:00:00Z' }), // nach markiertem Datum
      ];
      log.mergeBridgeLog(bridgeLogs);
      expect(log.size).toBe(1);
    });

    it('aktualisiert lastSeenDate nur bei neuerem Datum', () => {
      log.markLockSeen('1', new Date('2024-01-01T11:00:00Z'));
      log.markLockSeen('1', new Date('2024-01-01T10:00:00Z')); // älter → sollte ignoriert werden

      const bridgeLogs: NukiBridgeLogEntry[] = [
        makeBridgeEntry({ nukiId: 1, date: '2024-01-01T10:30:00Z' }),
      ];
      log.mergeBridgeLog(bridgeLogs);
      expect(log.size).toBe(0); // immer noch durch 11:00 blockiert
    });
  });

  // ── formatAction / formatTrigger ──────────────────────────────────────────

  describe('formatAction()', () => {
    it.each([
      [NukiLogAction.UNLOCK, 'ENTRIEGELT'],
      [NukiLogAction.LOCK,   'VERRIEGELT'],
      [NukiLogAction.UNLATCH, 'GEÖFFNET'],
    ])('action %i → "%s"', (action, expected) => {
      expect(log.formatAction(action)).toBe(expected);
    });

    it('gibt Fallback zurück bei unbekannter Aktion', () => {
      expect(log.formatAction(99)).toBe('Aktion 99');
    });
  });

  describe('formatTrigger()', () => {
    it.each([
      [NukiLogTrigger.APP,       'Nuki App'],
      [NukiLogTrigger.AUTO_LOCK, 'Auto-Lock'],
      [NukiLogTrigger.MANUAL,    'Physisch (Schlüssel/Knauf)'],
      [NukiLogTrigger.BUTTON,    'Tastatur / Fingerabdruck'],
      [NukiLogTrigger.AUTOMATIC, 'Automatisch (Zeitplan)'],
    ])('trigger %i → "%s"', (trigger, expected) => {
      expect(log.formatTrigger(trigger)).toBe(expected);
    });

    it('gibt Fallback zurück bei unbekanntem Trigger', () => {
      expect(log.formatTrigger(99)).toBe('Trigger 99');
    });
  });
});

// ── Hilfsfunktionen ─────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<ActivityLogEntry> = {}): ActivityLogEntry {
  return {
    timestamp: new Date('2024-01-01T10:00:00Z'),
    lockId:    '1',
    lockName:  'Haustür',
    action:    'VERRIEGELT',
    source:    'free@home',
    state:     NukiLockState.LOCKED,
    success:   true,
    ...overrides,
  };
}

function makeBridgeEntry(overrides: Partial<NukiBridgeLogEntry> & { nukiId: number; date: string }): NukiBridgeLogEntry {
  return {
    nukiId:     overrides.nukiId,
    deviceType: 0,
    name:       'Haustür',
    action:     overrides.action ?? NukiLogAction.LOCK,
    trigger:    overrides.trigger ?? NukiLogTrigger.APP,
    state:      overrides.state ?? NukiLockState.LOCKED,
    success:    overrides.success ?? true,
    date:       overrides.date,
  };
}
