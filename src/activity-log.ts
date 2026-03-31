import {
  NukiLockState,
  NukiLogAction,
  NukiLogTrigger,
  NukiBridgeLogEntry,
  ActivityLogEntry
} from './types';

/**
 * Zugriffsprotokoll – speichert Sperr-/Entsperr-Ereignisse
 * aus der Nuki Bridge sowie von free@home ausgelöste Aktionen.
 */
export class ActivityLog {
  private entries: ActivityLogEntry[] = [];

  /** Letztes bekanntes Ereignisdatum je Schloss (für Deduplizierung) */
  private lastSeenDates: Map<string, Date> = new Map();

  constructor(private readonly maxEntries = 100) {}

  /**
   * Fügt einen Eintrag hinzu (zirkulärer Puffer).
   * Der Eintrag wird sofort ins Journal geschrieben.
   */
  addEntry(entry: ActivityLogEntry): void {
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }
    this.printEntry(entry);
  }

  /**
   * Merged Bridge-Log-Einträge – ignoriert bereits bekannte Ereignisse,
   * um Dopplungen mit free@home-Einträgen zu vermeiden.
   */
  mergeBridgeLog(bridgeLogs: NukiBridgeLogEntry[]): void {
    const sorted = [...bridgeLogs].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    for (const raw of sorted) {
      const lockId = raw.nukiId.toString();
      const entryDate = new Date(raw.date);
      const lastSeen = this.lastSeenDates.get(lockId);

      if (lastSeen && entryDate <= lastSeen) {
        continue;
      }

      this.lastSeenDates.set(lockId, entryDate);
      this.addEntry({
        timestamp: entryDate,
        lockId,
        lockName: raw.name,
        action:   this.formatAction(raw.action),
        source:   this.formatTrigger(raw.trigger),
        state:    raw.state as NukiLockState,
        success:  raw.success,
      });
    }
  }

  /**
   * Markiert einen Zeitpunkt als „bereits verarbeitet" für ein Schloss.
   * Wird von free@home-Kommandos aufgerufen, damit spätere Bridge-Log-Einträge
   * mit demselben Zeitstempel nicht doppelt erscheinen.
   */
  markLockSeen(lockId: string, date: Date): void {
    const current = this.lastSeenDates.get(lockId);
    if (!current || date > current) {
      this.lastSeenDates.set(lockId, date);
    }
  }

  /**
   * Gibt Einträge zurück (optional gefiltert nach Schloss-ID).
   * Neueste zuerst.
   */
  getEntries(lockId?: string, limit = 50): ActivityLogEntry[] {
    const filtered = lockId
      ? this.entries.filter(e => e.lockId === lockId)
      : this.entries;
    return filtered.slice(-limit).reverse();
  }

  /**
   * Gibt die Gesamtzahl der gespeicherten Einträge zurück.
   */
  get size(): number {
    return this.entries.length;
  }

  // ── Hilfsmethoden ──────────────────────────────────────────────────────────

  formatAction(action: number): string {
    const map: Record<number, string> = {
      [NukiLogAction.UNLOCK]:            'ENTRIEGELT',
      [NukiLogAction.LOCK]:              'VERRIEGELT',
      [NukiLogAction.UNLATCH]:           'GEÖFFNET',
      [NukiLogAction.LOCK_N_GO]:         "LOCK'N'GO",
      [NukiLogAction.LOCK_N_GO_UNLATCH]: "LOCK'N'GO + ÖFFNEN",
    };
    return map[action] ?? `Aktion ${action}`;
  }

  formatTrigger(trigger: number): string {
    const map: Record<number, string> = {
      [NukiLogTrigger.SYSTEM]:    'System',
      [NukiLogTrigger.MANUAL]:    'Physisch (Schlüssel/Knauf)',
      [NukiLogTrigger.BUTTON]:    'Tastatur / Fingerabdruck',
      [NukiLogTrigger.AUTOMATIC]: 'Automatisch (Zeitplan)',
      [NukiLogTrigger.TIMED]:     'Zeitgesteuert',
      [NukiLogTrigger.APP]:       'Nuki App',
      [NukiLogTrigger.AUTO_LOCK]: 'Auto-Lock',
    };
    return map[trigger] ?? `Trigger ${trigger}`;
  }

  private printEntry(entry: ActivityLogEntry): void {
    const ts = entry.timestamp.toLocaleString('de-DE', {
      timeZone:   'Europe/Berlin',
      dateStyle:  'short',
      timeStyle:  'medium',
    });
    const status = entry.success ? 'OK' : 'FEHLER';
    console.log(
      `[ZUGRIFFSPROTOKOLL] ${ts} | ${entry.lockName} | ${entry.action} | ` +
      `Quelle: ${entry.source} | ${status}`
    );
  }
}
