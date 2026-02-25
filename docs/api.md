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
| `GET`  | `/api/chat` | Retrieves chat history from LowDB. Accepts `?cursor=<id>&limit=50` for cursor-based pagination (newest first). |
| `POST` | `/api/chat` | **Body:** `{ agentId?, content }` — Saves a standard chat message directly. |
| `POST` | `/api/chat/send-to-agent` | **Body:** `{ message, agentId? }` — Saves the user message, then asynchronously routes it to the OpenClaw CLI agent. **Returns `202 Accepted`** immediately with `{ id, status: "pending" }`. The AI reply is delivered via the `chat_message` Socket.io event when the CLI process completes. If the CLI fails, an `agent_error` event is emitted instead. |
| `DELETE` | `/api/chat` | Wipes all chat history. Emits the `chat_cleared` Socket.io event. |

## 6. App Configuration API
*Persists runtime config in LowDB (gateway URL, port, auto-restart flag).*

| Method | Endpoint | Purpose |
| :--- | :--- | :--- |
| `GET`  | `/api/config` | Returns the current `AppConfig` object. |
| `POST` | `/api/config` | **Body:** Partial `AppConfig` — merges the supplied fields into the stored config and writes to LowDB. |

**AppConfig schema:**
```json
{
  "gatewayUrl": "http://127.0.0.1:8000",
  "apiPort": 54321,
  "autoRestart": false
}
```

## 7. Activities API
*Cursor-paginated activity log across all tasks.*

| Method | Endpoint | Purpose |
| :--- | :--- | :--- |
| `GET` | `/api/activities?cursor=<id>&limit=50` | Returns activity logs sorted newest-first. `nextCursor` is null at end of log. |

**Response shape:**
```json
{
  "data": [
    {
      "id": "uuid",
      "task_id": "uuid",
      "agent_id": "dev",
      "message": "Started working on the auth module.",
      "timestamp": "2026-02-24T09:30:00.000Z"
    }
  ],
  "nextCursor": "uuid-of-oldest-item-in-page"
}
```

When `nextCursor` is `null`, the client has reached the beginning of the log. Pass `cursor=<nextCursor>` in the next request to paginate backwards.

## 8. Deliverables & Recurring Tasks
*Sub-tasks and cron-like scheduled tasks.*

| Method | Endpoint | Purpose |
| :--- | :--- | :--- |
| `POST`  | `/api/tasks/:id/deliverables` | **Body:** `{ title, file_path? }` — Adds a checklist item to a task. |
| `PATCH` | `/api/deliverables/:id/complete` | Toggles completion of a deliverable. |
| `GET`   | `/api/recurring` | Lists all recurring task templates. |
| `POST`  | `/api/recurring` | **Body:** `{ title, schedule_type, schedule_value? }` — Creates a scheduled template. |
| `PATCH` | `/api/recurring/:id` | **Body:** Partial `RecurringTask` — Pauses/Resumes or updates a recurring task. |
| `DELETE`| `/api/recurring/:id` | Deletes a recurring task template. |
| `POST`  | `/api/recurring/:id/trigger` | Manually triggers a recurring task, spawning a new normal Task from the template. |

**RecurringTask create payload:**
```json
{
  "title": "Weekly status report",
  "schedule_type": "weekly",
  "schedule_value": "monday"
}
```

Valid `schedule_type` values: `"daily"` | `"weekly"` | `"manual"`. `schedule_value` is only meaningful for `"weekly"` (day name, e.g., `"monday"`).

**RecurringTask PATCH payload** (pause/resume or rename):
```json
{
  "status": "PAUSED"
}
```
or
```json
{
  "status": "ACTIVE",
  "title": "Renamed weekly report"
}
```

**`POST /api/recurring/:id/trigger` response** — returns the newly-spawned `Task`:
```json
{
  "id": "uuid",
  "title": "Weekly status report",
  "description": "Auto-generated from recurring template: Weekly status report",
  "status": "INBOX",
  "priority": "MEDIUM",
  "createdAt": "2026-02-24T10:00:00.000Z",
  "updatedAt": "2026-02-24T10:00:00.000Z"
}
```

## 9. System & Monitoring API

| Method | Endpoint | Purpose |
| :--- | :--- | :--- |
| `GET` | `/api/system/stats` | Returns aggregate dashboard numbers (active agents, tasks in queue, completed today). |

---

## 10. WebSocket Events (Socket.io)
Because the frontend must be highly reactive, the Node.js server emits the following Socket.io events whenever LowDB is updated by an API call or a background monitor.

### Backend Emits → Client Listens:
| Event | Payload | Trigger |
| :--- | :--- | :--- |
| `task_created` | `{ id, title? }` | `POST /api/tasks` |
| `task_updated` | Full `Task` object | Any status change |
| `task_deleted` | `{ id }` | `DELETE /api/tasks/:id` |
| `task_reviewed` | `{ id, action: 'approve' \| 'reject' }` | `POST /api/tasks/:id/review` |
| `activity_added` | `ActivityLog` object | `POST /api/tasks/:id/activity` |
| `agent_status_changed` | `Agent` object | Session monitor (every 10 s) |
| `chat_message` | `ChatMessage` object | Any message saved to LowDB |
| `chat_cleared` | _(no payload)_ | `DELETE /api/chat` |
| `agent_error` | `{ agentId, error }` | Async CLI call fails in `/send-to-agent`, activity, or review routes |
| `agent_config_generated` | `{ requestId, config }` | `POST /api/agents/generate` CLI succeeds |
| `agent_config_error` | `{ requestId, error }` | `POST /api/agents/generate` CLI fails |