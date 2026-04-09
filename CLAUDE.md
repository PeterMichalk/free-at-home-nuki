# CLAUDE.md — free-at-home-nuki

## Project Overview

This is a **Busch-Jäger free@home Smart Home Addon** that integrates **Nuki Smart Locks** via the Nuki Bridge Local API. It runs as a Node.js process on the free@home System Access Point (SysAP), polling Nuki bridges at configurable intervals and exposing locks as `simple_doorlock` devices in the free@home ecosystem.

- **Addon ID:** `tech.michalk.freeathome.nuki`
- **Version:** 1.2.3
- **License:** MIT
- **Author:** Peter Michalk
- **Language:** TypeScript (strict mode, Node.js 18+)

---

## Repository Structure

```
free-at-home-nuki/
├── src/
│   ├── __tests__/                  # Jest unit tests (one per module)
│   │   ├── activity-log.test.ts
│   │   ├── configuration-parser.test.ts
│   │   ├── lock-manager.test.ts
│   │   ├── nuki-addon-manager.test.ts
│   │   └── nuki-api-client.test.ts
│   ├── main.ts                     # Entry point — bootstraps SDK and manager
│   ├── types.ts                    # All shared types, enums, interfaces, constants
│   ├── nuki-addon-manager.ts       # Core orchestration: bridges, locks, polling
│   ├── nuki-api-client.ts          # HTTP wrapper for Nuki Bridge Local API
│   ├── lock-manager.ts             # Per-lock command/status handling
│   ├── configuration-parser.ts     # Parses free@home configuration object
│   └── activity-log.ts             # Circular buffer access log (max 100 entries)
├── fhstore/                        # free@home store assets (icon, localization, metadata)
│   ├── icon.svg
│   ├── de.csv / en.csv
│   └── index.json
├── build/                          # Compiled output (generated, not committed)
├── free-at-home-metadata.json      # Addon declaration + parameter schema for SysAP UI
├── package.json
├── tsconfig.json
├── tsconfig.test.json
└── jest.config.ts
```

---

## Technology Stack

| Concern            | Tool/Library                                  |
|--------------------|-----------------------------------------------|
| Language           | TypeScript 5.3 (strict)                       |
| Runtime            | Node.js >= 18                                 |
| free@home SDK      | `@busch-jaeger/free-at-home` 0.33.1           |
| Mixin utility      | `ts-mixer` 5.4.0                              |
| Testing            | Jest 29.7 + ts-jest 29.4                      |
| Build/Deploy CLI   | `@busch-jaeger/free-at-home-cli` 0.9.1        |

---

## Key Commands

```bash
npm run build          # Compile TypeScript (with source maps) + validate metadata
npm run buildProd      # Compile for production (no source maps) + validate
npm run pack           # buildProd → create .tar.bz2 addon archive for SysAP deployment
npm run clean          # Remove build/ directory

npm test               # Run Jest test suite
npm run test:coverage  # Run tests with coverage report

npm start              # Run addon directly (node build/main.js)
npm run validate       # Validate free-at-home-metadata.json via free-at-home-cli
npm run journal        # View addon logs on SysAP
npm run monitorstate   # Monitor addon application state
npm run monitorconfig  # Monitor configuration changes
```

**Typical development flow:**
1. Edit source in `src/`
2. `npm run build` — compiles and validates
3. `npm test` — run tests
4. `npm run pack` — creates the deployable archive

---

## Architecture

### Data Flow

```
SysAP free@home config
        │
        ▼
ConfigurationParser.extractBridgeConfigs()
        │
        ▼
NukiAddonManager
  ├── per Bridge: NukiApiClient  ──── HTTP GET ──► Nuki Bridge Local API
  ├── per Lock:   LockManager    ◄─── events ───── FreeAtHomeRawChannel
  └── ActivityLog (circular buffer, max 100 entries)
```

### Component Responsibilities

**`main.ts`** — Minimal entry point. Creates `FreeAtHome` + `AddOn` instances, instantiates `NukiAddonManager`, sets up signal handling.

**`types.ts`** — Single source of truth for all types. Contains:
- `NukiLockState` enum (0–6: UNCALIBRATED, LOCKED, UNLOCKED, etc.)
- `NukiLockAction` enum (LOCK=2, UNLOCK=3)
- `NukiLogTrigger` / `NukiLogAction` enums from Bridge `/log` endpoint
- Config interfaces: `NukiBridgeConfig`, `NukiLockConfig`
- Runtime interfaces: `ManagedBridge`, `ManagedLock`
- Constants: `NUKI_BRIDGE_PORT=8080`, `STATUS_UPDATE_INTERVAL_MS=30000`, `BRIDGE_CONNECTION_TIMEOUT_MS=5000`

**`nuki-addon-manager.ts`** — Core manager. Reacts to `configurationChanged` events from the SDK. Manages bridge lifecycle (create/dispose), per-bridge polling intervals, and lock device creation. Lock key format: `"<bridgeIp>:<lockId>"`.

**`nuki-api-client.ts`** — HTTP client using Node's built-in `http` module (no axios). Endpoints used:
- `GET /list?token=...` — all locks with last known state
- `GET /lockAction?token=...&nukiId=...&action=...` — lock/unlock
- `GET /log?token=...&count=...` — access log (requires Bridge firmware >= 1.22)

**`lock-manager.ts`** — Listens to `datapointChanged` on `PairingIds.AL_LOCK_UNLOCK_COMMAND`. Applies status via `PairingIds.AL_INFO_LOCK_UNLOCK_COMMAND`. Uses `isUpdating` flag to prevent event loops. After a lock command, schedules a status refresh after `STATUS_UPDATE_DELAY_AFTER_ACTION_MS` (2000ms).

**`configuration-parser.ts`** — Parses the raw free@home configuration object. Bridges are in `config['bridge'].items`, locks in `config['lock'].items`. Locks reference their bridge via `bridgeIp` field.

**`activity-log.ts`** — Circular buffer (100 entries). Merges Bridge API logs with free@home-initiated actions. Deduplicates by tracking `lastSeenDates` per lock ID. Prints entries to console with German locale timestamps.

---

## Configuration Schema (free-at-home-metadata.json)

Two parameter groups, both `multiple: true`:

**`bridge`** group (per Nuki Bridge):
- `ip` — IPv4, required
- `token` — password, required
- `port` — number, default 8080, range 1–65535
- `pollInterval` — number (ms), default 30000, range 1000–60000

**`lock`** group (per Nuki lock):
- `id` — string, required (Nuki lock numeric ID as string)
- `name` — string, required
- `bridgeIp` — IPv4, required (must match a configured bridge IP)

---

## Lock State Mapping

| Nuki State (enum)    | Value | free@home datapoint |
|----------------------|-------|---------------------|
| LOCKED               | 1     | "0" (locked)        |
| LOCKED_N_GO          | 5     | "0" (locked)        |
| UNLOCKED             | 2     | "1" (unlocked)      |
| UNLOCKED_LOCK_N_GO   | 3     | "1" (unlocked)      |
| UNLATCHING           | 4     | "1" (unlocked)      |
| UNLOCKING            | 6     | "1" (unlocked)      |
| UNCALIBRATED         | 0     | (no update)         |

---

## Testing Conventions

- **Framework:** Jest with `ts-jest`
- **Location:** `src/__tests__/*.test.ts`
- **One test file per module** (matching module name)
- **Mocking:** Use `jest.mock('../nuki-api-client')` pattern; mock the free@home SDK classes
- **Timers:** Use `jest.useFakeTimers()` / `jest.runAllTimers()` for polling tests
- **Coverage:** Excluded from coverage: `types.ts`, `main.ts`
- **Language:** Test descriptions and comments are in German (following existing codebase convention)

Fixture helper pattern used in tests:
```typescript
function makeBridgeConfig(overrides: Partial<NukiBridgeConfig> = {}): NukiBridgeConfig {
  return { ip: '192.168.1.100', token: 'mytoken', locks: [...], ...overrides };
}
```

---

## Code Conventions

- **Language:** Code comments and `console.log`/`console.error` messages are in **German**
- **Strict TypeScript:** No `any` except at SDK boundaries (configuration parsing)
- **Error handling:** `try/catch` with `console.error`; activity log fetch failures are swallowed silently to avoid marking bridges offline
- **No external HTTP libraries:** The `http` module from Node.js stdlib is used directly
- **Device ID format:** `nuki-lock-<ip-with-dashes>-<lockId>` (e.g., `nuki-lock-192-168-1-100-42`)
- **Lock key format:** `"<bridgeIp>:<lockId>"` used as Map keys throughout
- **Polling:** Managed at bridge level (one `setInterval` per bridge), not per lock
- **`isUpdating` flag:** Guards against re-entrant updates in `ManagedLock`; always reset in `finally` block
- **No CI/CD pipeline:** No `.github/workflows/` — manual build and deploy

---

## Important Constraints

- **Do not use `axios` or other HTTP libraries** — the project deliberately uses Node's built-in `http` module
- **Do not add per-lock polling intervals** — polling is intentionally bridge-level
- **The `dispose()` method on `LockManager` is intentionally empty** — cleanup is managed by `NukiAddonManager`
- **`getLog()` failures must not mark a bridge as offline** — handled by a nested `try/catch` in `pollBridge()`
- **Configuration changes are handled reactively** — the addon listens to `configurationChanged` events, not a startup-only config read
- **`free-at-home-metadata.json` must be valid** — `npm run postbuild` runs `free-at-home-cli validate` automatically; never skip this
