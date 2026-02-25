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
- Use `import { exec } from 'child_process'; import { promisify } from 'util'; const execAsync = promisify(exec);`.

**Exact Command Patterns:**
- **Spawn a Task Session (Fresh Context):**
  `await execAsync('openclaw sessions spawn --agent ${agentId} --label task-${taskId} --message "${prompt}"');`
- **Route Chat to Agent (Expect JSON back):**
  `const { stdout } = await execAsync('openclaw agent --agent ${agentId} --message "${msg}" --json');`
- **Discover Agents:** Parse the physical file at `os.homedir() + '/.openclaw/openclaw.json'`.

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
- **Socket.io Reactivity:** The frontend must listen to Socket.io events (`task_updated`, `activity_added`, `agent_status_changed`) and update the Zustand store accordingly so the UI reacts in real-time without polling.
