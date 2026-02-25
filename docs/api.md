# 🌐 Claw-Pilot API Specification

## 1. Agent Management API
*These endpoints interact heavily with the user's local `~/.openclaw/openclaw.json` file and the agent workspace directories.*

| Method | Endpoint | Purpose | Data Source |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/agents` | Lists all configured agents, merging their config with real-time status (`WORKING`, `IDLE`) derived from session file timestamps. | `openclaw.json` + `fs.stat` |
| `GET` | `/api/agents/:id` | Gets a single agent's configuration and status. | `openclaw.json` |
| `POST` | `/api/agents` | Creates a new agent. Creates physical `workspace` directories and writes default `SOUL.md` and `TOOLS.md`. Updates config. | `openclaw.json` + `fs.mkdir` |
| `PATCH` | `/api/agents/:id` | Updates basic agent info (name, emoji, primary model). | `openclaw.json` |
| `DELETE` | `/api/agents/:id` | Removes the agent from the config (but preserves the physical workspace folder). | `openclaw.json` |
| `GET` | `/api/agents/:id/files` | Reads the raw text of `SOUL.md`, `TOOLS.md`, and `AGENTS.md`. | `fs.readFile` |
| `PUT` | `/api/agents/:id/files` | Overwrites the contents of the agent's markdown configuration files. | `fs.writeFile` |
| `POST` | `/api/agents/generate` | **Body:** `{ description: string }`<br>Executes an OpenClaw CLI command asking the `main` Lead AI to draft a configuration for a new agent. | `child_process` |

## 2. LLM Model Management
*Handles model configurations and fallbacks.*

| Method | Endpoint | Purpose | Data Source |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/models` | Executes `openclaw models list --all --json` to get available LLMs. Maps them to friendly aliases (e.g., `sonnet`, `opus`). | `child_process` |
| `GET` | `/api/agents/:id/model-status` | Returns the agent's `primary_model`, `fallback_model`, and `failure_count`. | LowDB / Config |
| `PATCH` | `/api/agents/:id/models` | **Body:** `{ primary_model?: string, fallback_model?: string }` | `openclaw.json` |
| `POST` | `/api/agents/:id/model-failure` | Increments failure count. Automatically swaps agent to `fallback_model` if it exists, and notifies the Lead AI. | Config + `child_process` |
| `POST` | `/api/agents/:id/restore-primary-model`| Resets failure count to 0 and switches back to the primary model. | Config |

## 3. Task Kanban API (LowDB)
*These endpoints manage the core workflow. State is stored in LowDB (`db.json`).*

| Method | Endpoint | Purpose |
| :--- | :--- | :--- |
| `GET` | `/api/tasks` | Returns all tasks. Accepts query params `?status=INBOX&assignee_id=dev`. |
| `POST` | `/api/tasks` | **Body:** `{ title, description, priority, tags, assignee_id }`<br>Creates task. Auto-assigns based on tags if `assignee_id` is missing. |
| `GET` | `/api/tasks/:id` | Returns task details including nested `deliverables` and `comments`. |
| `PATCH` | `/api/tasks/:id` | Updates task fields. **Rule:** If `status === 'DONE'`, return `403 Forbidden` if requested by an AI. AI can only transition to `REVIEW`. |
| `DELETE` | `/api/tasks/:id` | Deletes a task and cascades deletion to its activities/comments in LowDB. |

## 4. Task Execution & Routing (The CLI Bridge)
*This is where Claw-Pilot interacts with OpenClaw agents to get work done.*

| Method | Endpoint | Purpose | Implementation Detail |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/tasks/:id/route` | Wakes up the assigned AI and feeds it the task in an isolated context. | Exec: `openclaw sessions spawn --agent <id> --label task-<id> --message "<msg>"` |
| `POST` | `/api/tasks/:id/activity` | **Body:** `{ agent_id, message }`<br>Logs progress. **Rule:** If task is `ASSIGNED`, transition to `IN_PROGRESS`. If message contains "done/completed", transition to `REVIEW`. | Writes to LowDB `activities` array + emits WS event. |
| `POST` | `/api/tasks/:id/complete` | Explicitly forces a task into `REVIEW` status and sends a CLI notification to the reviewer (Lead AI). | LowDB update + Exec: `openclaw agent ...` |
| `POST` | `/api/tasks/:id/review` | **Body:** `{ action: 'approve' \| 'reject', feedback?: string }`<br>Approve moves to `DONE`. Reject moves to `IN_PROGRESS` and sends `feedback` to the agent via CLI. | LowDB update + Exec: `openclaw agent ...` |
| `POST` | `/api/tasks/:id/comments` | **Body:** `{ agent_id, content }`<br>Adds a comment. If content contains `@agent_name`, uses CLI to ping that agent. | LowDB update |

## 5. Squad Chat API
*Global chat for human-to-agent communication.*

| Method | Endpoint | Purpose |
| :--- | :--- | :--- |
| `GET` | `/api/chat` | Retrieves chat history from LowDB. |
| `POST` | `/api/chat` | **Body:** `{ agent_id, content }`<br>Saves a standard chat message. |
| `POST` | `/api/chat/send-to-agent` | **Body:** `{ agent_id, message }`<br>Saves human message, executes `openclaw agent --agent <id> --message "<msg>" --json`, awaits response, saves AI response, broadcasts via WS. |

## 6. Deliverables & Recurring Tasks
*Sub-tasks and cron-like scheduled tasks.*

| Method | Endpoint | Purpose |
| :--- | :--- | :--- |
| `POST` | `/api/tasks/:id/deliverables` | **Body:** `{ title, file_path? }`<br>Adds a checklist item to a task. |
| `PATCH` | `/api/deliverables/:id/complete`| Toggles completion of a deliverable. |
| `GET` | `/api/recurring` | Lists all recurring task templates. |
| `POST` | `/api/recurring` | **Body:** `{ title, schedule_type, schedule_value... }`<br>Creates a cron template. |
| `PATCH` | `/api/recurring/:id` | Pauses/Resumes or updates a recurring task. |
| `POST` | `/api/recurring/:id/trigger` | Manually triggers a recurring task, spawning a new normal Task. |

## 7. System & Monitoring API
*Diagnostics and background service hooks.*

| Method | Endpoint | Purpose |
| :--- | :--- | :--- |
| `GET` | `/api/stats` | Returns aggregate dashboard numbers (active agents, tasks in queue, completed today). |
| `GET` | `/api/monitoring/gateway/status` | Returns the health of the OpenClaw gateway (managed by backend watchdog). |
| `POST` | `/api/monitoring/gateway/restart`| Manually triggers a restart of the OpenClaw gateway via CLI. |
| `GET` | `/api/monitoring/stuck-tasks/check`| Returns a list of tasks that have been in `IN_PROGRESS` for too long (e.g., > 24h). |

---

## 8. WebSocket Events (Socket.io)
Because the frontend must be highly reactive, your Node.js server needs to emit the following Socket.io events whenever LowDB is updated by an API call or a background monitor.

### Client Listens For (Backend Emits):
*   `task_created` (Payload: `{ id, title }`)
*   `task_updated` (Payload: `{ id, status }`)
*   `task_deleted` (Payload: `{ id }`)
*   `task_reviewed` (Payload: `{ id, action: 'approve' | 'reject' }`)
*   `activity_added` (Payload: `ActivityLog` object)
*   `chat_message` (Payload: `ChatMessage` object)
*   `agent_status_changed` (Payload: `{ agentId, status: 'WORKING' | 'IDLE' | 'OFFLINE' }`)

---

## Recommended Turborepo Structure for this API

To implement this cleanly, structure your monorepo to share the request/response payloads:

```text
claw-pilot/
├── packages/
│   ├── shared-types/      # Zod schemas & TS Interfaces for the APIs above
│   ├── eslint-config/
│   └── tsconfig/
├── apps/
│   ├── backend/           # Express + Socket.io + LowDB + CLI Bridge
│   │   ├── src/
│   │   │   ├── routes/    # (agents.ts, tasks.ts, chat.ts, etc.)
│   │   │   ├── openclaw/  # child_process wrappers
│   │   │   └── db/        # LowDB setup
│   └── frontend/          # React + Vite + Zustand + Tailwind
│       ├── src/
│       │   ├── api/       # Typed fetch/axios wrappers matching the shared-types
│       │   ├── store/     # Zustand stores updated by Socket.io
│       │   └── components/
```