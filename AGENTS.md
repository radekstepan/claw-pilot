# Claw-Pilot AI Coding Guidelines

You are an expert full-stack developer (Node.js, Express, TypeScript, React, Tailwind, Zustand) working in a Turborepo. You are building "Claw-Pilot", a Mission Control dashboard for OpenClaw AI agents. 

Read these rules carefully before writing or modifying any code.

## 1. Monorepo Architecture & Stack
- **Workspace:** Yarn workspaces / Turborepo.
- **`packages/shared-types`**: Contains Zod schemas and TypeScript interfaces. Both frontend and backend must import types from here.
- **`apps/backend`**: Node.js, Fastify, Socket.io, **Drizzle ORM + SQLite** (`better-sqlite3`, WAL mode). The database file lives at `apps/backend/data/claw-pilot.db`. Do NOT use raw SQL strings — use the Drizzle query builder.
- **`apps/frontend`**: React (Vite), TypeScript, TailwindCSS, Zustand.

## 2. The OpenClaw Gateway Client (CRITICAL)
- **DO NOT** attempt to import an `openclaw` npm package. OpenClaw is a Python CLI tool with a **WebSocket RPC gateway**.
- Claw-Pilot communicates with OpenClaw EXCLUSIVELY via WebSocket JSON-RPC, using the `gatewayCall` helper in `apps/backend/src/openclaw/cli.ts`.
- **Never use `child_process` / `execFile`** to shell out to the `openclaw` binary.

**Reference:** See `docs/openclaw_api.md` for exact RPC payloads, authentication handshakes, and session key formats.

**Async RPC Rule (CRITICAL):** AI generation calls (`routeChatToAgent`, `generateAgentConfig`, `spawnTaskSession`) can take minutes. **Never `await` these in an HTTP handler.** Instead:
1. Validate input and persist any user-initiated state.
2. Return **`202 Accepted`** immediately with `{ id, status: 'pending' }`.
3. Dispatch the task using the `enqueueAiJob` helper from `src/services/aiQueue.ts`.
4. On success/error, emit the result via `fastify.io.emit(...)` to the frontend.

## 3. Database Migrations (Drizzle Kit)
After modifying `apps/backend/src/db/schema.ts`, you **must** generate a migration:
```bash
cd apps/backend
npx tsx node_modules/.bin/drizzle-kit generate
```
> **Why `tsx`?** The backend uses `"type": "module"` (ESM). Running `drizzle-kit` directly fails with `require is not defined`. Wrapping it with `tsx` fixes the CJS/ESM interop.

Do NOT hand-write migration SQL files or edit `drizzle/meta/_journal.json` manually — always let `drizzle-kit generate` produce them.

## 4. Data Layer
1. **SQLite (`apps/backend/data/claw-pilot.db`, via Drizzle ORM):** Stores `Tasks`, `ActivityLogs`, `ChatMessages`, and `RecurringTasks`. Use the `db` singleton from `apps/backend/src/db/index.ts`. For multi-step atomic writes use `db.transaction(() => { ... })`.
2. **OpenClaw Config (`~/.openclaw/openclaw.json`):** Stores Agent definitions. Do NOT duplicate agent definitions in SQLite. Read/write them dynamically via the gateway RPC (`config.get` / `config.patch`).

## 5. Strict Task Workflow Enforcement
Enforce the task lifecycle: `BACKLOG → TODO → ASSIGNED → IN_PROGRESS → REVIEW → DONE`.

- **The Review Gate:** AI Agents CANNOT mark tasks as `DONE`. If a `PATCH /api/tasks/:id` request attempts to set `status: 'DONE'`, verify it is a human/lead action. If requested by a worker AI, return `403 Forbidden`.
- **Auto-Transitions (Backend Logic):**
  - When `POST /api/tasks/:id/activity` is called on an `ASSIGNED` task, auto-transition the task to `IN_PROGRESS`.
  - If the `activity` message contains the strings "completed" or "done", auto-transition the task to `REVIEW` and notify the main agent.

## 6. Frontend State Management (Zustand)
- All server state must be held in a Zustand store (`useMissionStore.ts`).
- **Optimistic Updates:** For drag-and-drop actions, update the Zustand store *immediately*, then fire the `PATCH` API call. If the API fails, revert the state and show a toast error.
- **Socket.io Reactivity:** The frontend must listen to Socket.io events to update the Zustand store so the UI reacts in real-time without polling.

## 7. Frontend UI Rules (NO NATIVE ELEMENTS)

> **Golden Rule: Never use native HTML form controls or browser dialog APIs directly in JSX. Always use the corresponding custom component from `src/components/ui/`.**

| ❌ Forbidden | ✅ Use instead |
| :--- | :--- |
| `window.confirm()` / `window.alert()` / `window.prompt()` | `<ConfirmDialog />` from `src/components/ui/ConfirmDialog.tsx` |
| `<select>` | `<Select />` from `src/components/ui/Select.tsx` |
| Empty state `<div>No items</div>` | `<EmptyState />` from `src/components/ui/EmptyState.tsx` |

## 8. Background Monitors Pattern
- Background monitors live in `apps/backend/src/monitors/`.
- Each periodic monitor's `start*` function **must return its handle/interval** so `index.ts` can clear it during graceful shutdown.
- Monitors emit Socket.io events via `fastify.io?.emit(...)`.
- Use `db.transaction(() => { ... })` for operations that must be atomic.

## 9. Recurring Tasks (Cron) Pattern
Recurring tasks are **templates** stored in SQLite. They describe a repeating unit of work but are **not** Kanban tasks. 

- **Trigger mechanics:** `recurringSchedulerMonitor.ts` uses `croner` to fire schedules automatically and calls `triggerRecurringTemplate()`.
- **Rules:** Never set a recurring template's status directly to `DONE` (they are only `ACTIVE` or `PAUSED`). Wrap task generation in `db.transaction()`.
