# Claw-Pilot AI Coding Guidelines

You are an expert full-stack developer (Node.js, Express, TypeScript, React, Tailwind, Zustand) working in a Turborepo. You are building "Claw-Pilot", a Mission Control dashboard for OpenClaw AI agents. 

Read these rules carefully before writing or modifying any code.

## 1. Monorepo Architecture & Stack
- **Workspace:** Yarn workspaces / Turborepo.
- **`packages/shared-types`**: Contains Zod schemas and TypeScript interfaces. Both frontend and backend must import types from here.
- **`apps/backend`**: Node.js, Express, Socket.io, **Drizzle ORM + SQLite** (`better-sqlite3`, WAL mode). The database file lives at `apps/backend/data/claw-pilot.db`. Do NOT use lowdb, JSON flat files, or raw SQL strings — use the Drizzle query builder.
- **`apps/frontend`**: React (Vite), TypeScript, TailwindCSS, Zustand. A mock UI already exists; your job is often to wire this UI to the backend and Zustand state.

## 2. The OpenClaw Gateway Client (CRITICAL)
- **DO NOT** attempt to import an `openclaw` npm package. OpenClaw is a Python CLI tool with a **WebSocket RPC gateway**.
- Claw-Pilot communicates with OpenClaw EXCLUSIVELY via WebSocket JSON-RPC, using the `gatewayCall` helper in `apps/backend/src/openclaw/cli.ts`.
- **Never use `child_process` / `execFile`** to shell out to the `openclaw` binary. All communication goes through the gateway socket.

**Core helper:**
```typescript
import { gatewayCall } from '../openclaw/cli.js';
// Opens a fresh WS connection, performs Mode-A device-identity handshake, fires one RPC method, closes.
const payload = await gatewayCall('sessions.list', {});
const payload = await gatewayCall('chat.send', { sessionKey, message, deliver: false, idempotencyKey });
```

**Authentication — Mode A (device identity + one-time pairing):**
- On first start, `cli.ts` generates a persistent Ed25519 key pair stored in `apps/backend/data/device-identity.json`.
- The gateway issues a `connect.challenge` event with a nonce. Claw-Pilot signs the nonce with its Ed25519 private key and sends a `connect` request with the `device` block.
- **First connection from a new device:** the gateway closes with code 1008 ("pairing required"). The UI shows a **"Pair Device"** banner with instructions. After the user runs `openclaw devices approve --latest` on the gateway machine, the next connection succeeds and a `deviceToken` is saved to the identity file.
- **Subsequent connections:** `deviceToken` is sent in the `auth` block — no manual approval ever again.
- `OPENCLAW_GATEWAY_TOKEN` is used as initial auth before a `deviceToken` exists.

**Gateway environment variables (in `apps/backend/src/config/env.ts`):**

| Variable | Default | Description |
| :--- | :--- | :--- |
| `OPENCLAW_GATEWAY_URL` | `ws://localhost:18789` | WebSocket URL of the OpenClaw gateway |
| `OPENCLAW_GATEWAY_TOKEN` | _(optional)_ | Initial bearer token used before a `deviceToken` is obtained |
| `OPENCLAW_GATEWAY_ID` | `gateway` | Used to build the main-agent session key |
| `OPENCLAW_WS_TIMEOUT` | `15000` | Timeout (ms) for fast RPC calls |
| `OPENCLAW_AI_TIMEOUT` | `120000` | Timeout (ms) for heavy AI calls |
| `OPENCLAW_DEVICE_IDENTITY_PATH` | `data/device-identity.json` | Path to the Ed25519 key pair + deviceToken file |

**Key RPC methods used:**

| Higher-level function | RPC method(s) called |
| :--- | :--- |
| `getAgents()` | `config.get` → reads `payload.config.agents` |
| `getLiveSessions()` | `sessions.list` |
| `routeChatToAgent(agentId, msg)` | `sessions.patch` then `chat.send` |
| `generateAgentConfig(prompt)` | `sessions.patch` then `chat.send` (main session) |
| `getModels()` | `models.list` |
| `spawnTaskSession(agentId, taskId, prompt)` | `sessions.patch` then `chat.send` with `deliver: true` |

**Session key conventions:**

| Agent | Session key |
| :--- | :--- |
| Gateway main agent (`'main'`) | `mc-gateway:{OPENCLAW_GATEWAY_ID}:main` |
| Any other agent | `mc:mc-{agentId}:main` |

**Agent file management** (`GET/PUT /api/agents/:id/files`) uses `agents.files.get` / `agents.files.set` RPC — **not** local disk reads.

**Async RPC Rule (CRITICAL):** AI generation calls (`routeChatToAgent`, `generateAgentConfig`, `spawnTaskSession`) can take minutes. **Never `await` these in an HTTP handler.** Instead:
1. Validate input and persist any user-initiated state.
2. Return **`202 Accepted`** immediately with `{ id, status: 'pending' }`.
3. Run the RPC call in a detached `void (async () => { ... })()`.
4. On success/error, emit the result via `fastify.io.emit(...)` to the frontend.

## 3. Data Layer
1. **SQLite (`apps/backend/data/claw-pilot.db`, via Drizzle ORM):** Stores `Tasks`, `ActivityLogs`, `ChatMessages`, and `RecurringTasks`. Use the `db` singleton from `apps/backend/src/db/index.ts` and table refs from `apps/backend/src/db/schema.ts`. For single-table reads/writes use Drizzle's synchronous API (`db.select().from(...).all()`, `db.insert(...).values(...).run()`, etc.). For multi-step atomic writes use `db.transaction(() => { ... })`.
2. **OpenClaw Config (`~/.openclaw/openclaw.json`):** Stores Agent definitions, models, and workspace paths. Do NOT duplicate agent definitions in SQLite. Read them dynamically via the gateway RPC (`config.get`).

## 4. Strict Task Workflow Enforcement
Enforce the task lifecycle: `BACKLOG → TODO → ASSIGNED → IN_PROGRESS → REVIEW → DONE`.

`STUCK` is a special status set automatically by the boot-recovery monitor for any task that was `IN_PROGRESS` when the server last shut down but has no matching live gateway session on restart. The valid `TaskStatus` enum values (from `@claw-pilot/shared-types`) are: `BACKLOG`, `TODO`, `ASSIGNED`, `IN_PROGRESS`, `REVIEW`, `DONE`, `STUCK`.

- **The Review Gate:** AI Agents CANNOT mark tasks as `DONE`. If a `PATCH /api/tasks/:id` request attempts to set `status: 'DONE'`, verify it is a human/lead action. If requested by a worker AI, return `403 Forbidden`.
- **Auto-Transitions (Backend Logic):**
  - When `POST /api/tasks/:id/activity` is called on an `ASSIGNED` task, auto-transition the task to `IN_PROGRESS` in SQLite.
  - If the `activity` message contains the exact strings "completed" or "done", auto-transition the task to `REVIEW` in SQLite and emit a notification to the Lead Agent via the gateway.

## 5. Frontend State Management (Zustand)
- All server state must be held in a Zustand store.
- **Optimistic Updates:** For drag-and-drop Kanban actions, update the Zustand store *immediately*, then fire the `PATCH` API call. If the API fails, revert the Zustand state and show a toast error.
- **Socket.io Reactivity:** The frontend must listen to Socket.io events (`task_updated`, `activity_added`, `agent_status_changed`, `chat_message`, `agent_error`, `agent_config_generated`) and update the Zustand store accordingly so the UI reacts in real-time without polling.

## 6. Frontend UI Rules (NO NATIVE ELEMENTS)

> **Golden Rule: Never use native HTML form controls or browser dialog APIs directly in JSX. Always use the corresponding custom component from `src/components/ui/`.**

The table below maps each forbidden pattern to its approved replacement:

| ❌ Forbidden | ✅ Use instead |
| :--- | :--- |
| `window.confirm()` / `window.alert()` / `window.prompt()` | `<ConfirmDialog />` from `src/components/ui/ConfirmDialog.tsx` |
| `<select>` | `<Select />` from `src/components/ui/Select.tsx` (Radix UI, ARIA, keyboard nav, auto-positioning) |
| `<input type="file">` (bare) | Wrap in a custom accessible component |
| Empty state `<div>No items</div>` | `<EmptyState />` from `src/components/ui/EmptyState.tsx` |

The ESLint `no-alert` rule enforces the confirm/alert/prompt restriction at lint time. The `<Select />` and `<EmptyState />` restrictions are enforced by code review.

- **Never use `window.confirm()`, `window.alert()`, or `window.prompt()`**. The ESLint `no-alert` rule enforces this. Use `<ConfirmDialog />` from `src/components/ui/ConfirmDialog.tsx` instead.
- **Never use a native `<select>` element**. Use the custom `<Select />` component from `src/components/ui/Select.tsx` which provides ARIA attributes, keyboard navigation, and auto-positioning via Radix UI.
- **Never use native `<input type="file">` file pickers or browser dialogs** directly in JSX. Wrap them in custom accessible components.
- All empty states must use `<EmptyState />` from `src/components/ui/EmptyState.tsx`.

## 7. Background Monitors Pattern
- Background monitors live in `apps/backend/src/monitors/`.
- Each periodic monitor's `start*` function **must return its `NodeJS.Timeout` handle** so `index.ts` can `clearInterval` it during graceful shutdown.
- Monitors emit Socket.io events via `fastify.io?.emit(...)`.
- Use Drizzle's synchronous query API for reads and writes inside monitors. For operations that must be atomic (e.g. insert an activity row AND update a task status in one step), wrap them in `db.transaction(() => { ... })`.

**Existing monitors:**

| Monitor | File | Interval | What it does |
| :--- | :--- | :--- | :--- |
| `startSessionMonitor` | `monitors/sessionMonitor.ts` | 10 s | Polls OpenClaw sessions, diffs agent statuses, emits `agent_status_changed` when a status flips. |
| `startStuckTaskMonitor` | `monitors/stuckTaskMonitor.ts` | 60 s | Scans `IN_PROGRESS` tasks older than 24 h, posts a system alert to chat, emits `chat_message`. Tracks notified IDs in a `Set` to avoid repeat spam. |
| `bootRecovery` | `monitors/bootRecovery.ts` | On startup (once) | Marks any orphaned `IN_PROGRESS` tasks (no live gateway session) as `STUCK` and emits `task_updated`. |
| `startRecurringSchedulerMonitor` | `monitors/recurringSchedulerMonitor.ts` | Continuous (croner) | Reconciles `ACTIVE` recurring templates against running cron jobs; spawns new Tasks when schedules fire. Returns `{ timer, reconcile }` — register in `fastify.addHook('onClose', ...)`. |

**Template for a new monitor:**
```typescript
import { db } from '../db/index.js';
import { tasksTable, activitiesTable } from '../db/schema.js';

export function startMyMonitor(fastify: FastifyInstance): NodeJS.Timeout {
    return setInterval(() => {
        try {
            // Single-table read:
            const rows = db.select().from(tasksTable).where(...).all();

            // Single-table write:
            db.update(tasksTable).set({ status: 'DONE' }).where(...).run();

            // Multi-step atomic write:
            db.transaction(() => {
                db.insert(activitiesTable).values({ ... }).run();
                db.update(tasksTable).set({ ... }).where(...).run();
            });

            fastify.io?.emit('my_event', payload);
        } catch (err) {
            fastify.log.error(`myMonitor: ${err}`);
        }
    }, INTERVAL_MS);
}
```
Register it in `index.ts`:
```typescript
const myHandle = startMyMonitor(app);
// in graceful shutdown:
clearInterval(myHandle);
```

## 8. Recurring Tasks (Cron) Pattern

Recurring tasks are **templates** stored in SQLite (`recurring_tasks` table). They describe a repeating unit of work but are **not** themselves Kanban tasks. A concrete `Task` is only created when the template is triggered.

### Data model (`RecurringTask` from `@claw-pilot/shared-types`)

```typescript
{
  id: string;                 // UUID
  title: string;              // displayed name of the template
  description?: string;       // optional prompt / instructions for spawned Tasks
  schedule_type: 'HOURLY' | 'DAILY' | 'WEEKLY' | 'CUSTOM';
  schedule_value?: string;    // e.g. "monday" for WEEKLY; cron expression for CUSTOM
  assigned_agent_id?: string; // if set, spawned Task is auto-routed to this agent
  status: 'ACTIVE' | 'PAUSED';
  last_triggered_at?: string; // ISO-8601, updated on each trigger
  createdAt: string;          // ISO-8601
  updatedAt: string;
}
```

### Trigger mechanics

1. **Manual trigger** — `POST /api/recurring/:id/trigger` creates a new `Task` in `TODO` status with its description set to `"Auto-generated from recurring template: <title>"`. Returns the created `Task`.
2. **Auto-trigger** — `recurringSchedulerMonitor.ts` uses `croner` to fire schedules automatically. It must call the same `triggerRecurringTemplate()` service function as the HTTP handler (do *not* duplicate the logic). Emit `task_created` via Socket.io after writing to SQLite.

### Rules

- **Never** set a recurring template's status directly to `DONE`. Templates are paused (`PAUSED`) or active (`ACTIVE`); only concrete Tasks progress through the Kanban lifecycle.
- **Use `db.transaction(fn)`** when writing the spawned Task to SQLite inside a trigger, to keep the write atomic.
- If the trigger is fired while the template is `PAUSED`, return `409 Conflict` — do not silently create a task.
- Templates are **not** routed to the gateway automatically. If an AI agent should act on the spawned task, call `POST /api/tasks/:id/route` as a follow-up step (or set `assigned_agent_id` on the template so the scheduler can auto-route).
