# Claw-Pilot AI Coding Guidelines

You are an expert full-stack developer (Node.js, Express, TypeScript, React, Tailwind, Zustand) working in a Turborepo. You are building "Claw-Pilot", a Mission Control dashboard for OpenClaw AI agents. 

Read these rules carefully before writing or modifying any code.

## 1. Monorepo Architecture & Stack
- **Workspace:** Yarn workspaces / Turborepo.
- **`packages/shared-types`**: Contains Zod schemas and TypeScript interfaces. Both frontend and backend must import types from here.
- **`apps/backend`**: Node.js, Express, Socket.io, `lowdb` (JSON file database). 
  - *Note on LowDB:* Use the modern ESM version of LowDB. Ensure `tsconfig.json` and `package.json` are set up for ESM (`"type": "module"`). Do NOT use SQL or ORMs.
- **`apps/frontend`**: React (Vite), TypeScript, TailwindCSS, Zustand. A mock UI already exists; your job is often to wire this UI to the backend and Zustand state.

## 2. The OpenClaw CLI Bridge (CRITICAL)
- **DO NOT** attempt to import an `openclaw` npm package. OpenClaw is a Python CLI tool.
- Claw-Pilot interacts with OpenClaw EXCLUSIVELY via Node's `child_process`.
- Use `import { execFile } from 'child_process'; import { promisify } from 'util'; const execFileAsync = promisify(execFile);`. Always use `execFile` (not `exec`) to prevent shell-injection attacks.

**Exact Command Patterns:**
- **Spawn a Task Session (Fresh Context):**
  `await execFileAsync('openclaw', ['sessions', 'spawn', '--agent', agentId, '--label', `task-${taskId}`, '--message', prompt]);`
- **Route Chat to Agent (Expect JSON back):**
  `const { stdout } = await execFileAsync('openclaw', ['agent', '--agent', agentId, '--message', msg, '--json']);`
- **Discover Agents:** Parse the physical file at `path.join(env.OPENCLAW_HOME, 'openclaw.json')`. **Never hardcode `os.homedir()`** — always use `env.OPENCLAW_HOME` from `apps/backend/src/config/env.ts`.

**Async CLI Rule (CRITICAL):** AI generation calls (`routeChatToAgent`, `generateAgentConfig`, `spawnTaskSession`) can take minutes. **Never `await` these in an HTTP handler.** Instead:
1. Validate input and persist any user-initiated state.
2. Return **`202 Accepted`** immediately with `{ id, status: 'pending' }`.
3. Run the CLI call in a detached `void (async () => { ... })()`.
4. On success/error, emit the result via `fastify.io.emit(...)` to the frontend.

## 3. Dual Source of Truth
1. **LowDB (`apps/backend/data/db.json`):** Stores `Tasks`, `ActivityLogs`, `ChatMessages`, and `RecurringTasks`.
2. **OpenClaw Config (`~/.openclaw/openclaw.json`):** Stores Agent definitions, models, and workspace paths. Do NOT duplicate agent definitions in LowDB. Read them dynamically.

## 4. Strict Task Workflow Enforcement
Enforce the task lifecycle: `INBOX -> ASSIGNED -> IN_PROGRESS -> REVIEW -> DONE`.
- **The Review Gate:** AI Agents CANNOT mark tasks as `DONE`. If a `PATCH /api/tasks/:id` request attempts to set `status: 'DONE'`, verify it is a human/lead action. If requested by a worker AI, return `403 Forbidden`.
- **Auto-Transitions (Backend Logic):** 
  - When `POST /api/tasks/:id/activity` is called on an `ASSIGNED` task, auto-transition the task to `IN_PROGRESS` in LowDB.
  - If the `activity` message contains the exact strings "completed" or "done", auto-transition the task to `REVIEW` in LowDB and emit a notification to the Lead Agent via CLI.

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
- Each monitor's `start*` function **must return its `NodeJS.Timeout` handle** so `index.ts` can `clearInterval` it during graceful shutdown.
- Monitors emit Socket.io events via `fastify.io` — never write directly to LowDB without going through the shared `db.write()` or `updateDb()` mutex.
- `updateDb(fn)` is the preferred mutation API: it holds the write lock for the duration of `fn` + the disk flush together, preventing interleaved writes.

**Existing monitors:**

| Monitor | File | Interval | What it does |
| :--- | :--- | :--- | :--- |
| `startSessionMonitor` | `monitors/sessionMonitor.ts` | 10 s | Polls OpenClaw sessions, diffs agent statuses, emits `agent_status_changed` when a status flips. |
| `startStuckTaskMonitor` | `monitors/stuckTaskMonitor.ts` | 60 s | Scans `IN_PROGRESS` tasks older than 24 h, posts a system alert to chat, emits `chat_message`. Tracks notified IDs in a `Set` to avoid repeat spam. |

**Template for a new monitor:**
```typescript
export function startMyMonitor(fastify: FastifyInstance): NodeJS.Timeout {
    return setInterval(async () => {
        try {
            await updateDb(async (data) => {
                // mutate data here — changes are flushed atomically after fn returns
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

Recurring tasks are **templates** stored in LowDB (`db.data.recurring`). They describe a repeating unit of work but are **not** themselves Kanban tasks. A concrete `Task` is only created when the template is triggered.

### Data model (`RecurringTask` from `@claw-pilot/shared-types`)

```typescript
{
  id: string;              // UUID
  title: string;           // displayed name of the template
  schedule_type: 'daily' | 'weekly' | 'manual';
  schedule_value?: string; // e.g. "monday" for weekly tasks
  status: 'ACTIVE' | 'PAUSED';
  createdAt: string;       // ISO-8601
  updatedAt: string;
}
```

### Trigger mechanics

1. **Manual trigger** — `POST /api/recurring/:id/trigger` creates a new `Task` in `INBOX` status with its description set to `"Auto-generated from recurring template: <title>"`. Returns the created `Task`.
2. **Auto-trigger (future)** — if a time-based scheduler is wired up, it must call the same trigger logic as the HTTP handler (do *not* duplicate it). Emit `task_created` via Socket.io after writing to LowDB.

### Rules

- **Never** set a recurring template's status directly to `DONE`. Templates are paused (`PAUSED`) or active (`ACTIVE`); only concrete Tasks progress through the Kanban lifecycle.
- **Use `updateDb(fn)`** when writing the spawned Task to LowDB inside a trigger, to keep the write atomic.
- If the trigger is fired while the template is `PAUSED`, return `409 Conflict` — do not silently create a task.
- Templates are **not** sent to the OpenClaw CLI automatically. If an AI agent should act on the spawned task, call `POST /api/tasks/:id/route` as a follow-up step.
