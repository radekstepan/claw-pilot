# 🌐 Claw-Pilot API Specification

## 1. Agent Management API

_These endpoints communicate with the OpenClaw gateway over WebSocket RPC to read agent and file data._

| Method   | Endpoint                | Purpose                                                                                                                                                                                                                              | Data Source                             |
| :------- | :---------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------- |
| `GET`    | `/api/agents`           | Lists all configured agents, merging their config with real-time status (`WORKING`, `IDLE`) derived from live sessions.                                                                                                              | `gateway: config.get + sessions.list`   |
| `GET`    | `/api/agents/:id`       | Gets a single agent's configuration and status.                                                                                                                                                                                      | `gateway: config.get`                   |
| `POST`   | `/api/agents`           | Creates a new agent.                                                                                                                                                                                                                 | `gateway: agents.create + config.patch` |
| `PATCH`  | `/api/agents/:id`       | Updates basic agent info (name, model, etc.).                                                                                                                                                                                        | `gateway: agents.update + config.patch` |
| `DELETE` | `/api/agents/:id`       | Removes the agent.                                                                                                                                                                                                                   | `gateway: agents.delete`                |
| `GET`    | `/api/agents/:id/files` | Reads the raw text of `SOUL.md`, `TOOLS.md`, and `AGENTS.md` from the gateway's file system.                                                                                                                                         | `gateway: agents.files.get`             |
| `PUT`    | `/api/agents/:id/files` | Overwrites the contents of the agent's markdown configuration files on the gateway.                                                                                                                                                  | `gateway: agents.files.set`             |
| `POST`   | `/api/agents/generate`  | **Body:** `{ description: string }`<br>Sends a prompt to the gateway main agent session asking it to draft a configuration for a new agent. Returns `202 Accepted`. Result arrives via the `agent_config_generated` Socket.io event. | `gateway: sessions.patch + chat.send`   |

## 2. LLM Model Management

| Method | Endpoint      | Purpose                                                                                                                                                  | Data Source            |
| :----- | :------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------- |
| `GET`  | `/api/models` | Calls `models.list` on the gateway to get available LLMs. Maps them to friendly aliases (e.g., `sonnet`, `opus`). Returns 503 if gateway is unreachable. | `gateway: models.list` |

## 3. Task Kanban API (SQLite)

_These endpoints manage the core workflow. State is stored in SQLite (`claw-pilot.db`) via Drizzle ORM._

| Method   | Endpoint         | Purpose                                                                                                                                  |
| :------- | :--------------- | :--------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/tasks`     | Returns all tasks. Accepts query params `?status=TODO&assignee_id=dev`.                                                                  |
| `POST`   | `/api/tasks`     | **Body:** `{ title, description, priority, tags, assignee_id }`<br>Creates task. Auto-assigns based on tags if `assignee_id` is missing. |
| `GET`    | `/api/tasks/:id` | Returns task details including nested `deliverables`.                                                                                    |
| `PATCH`  | `/api/tasks/:id` | Updates task fields. **Rule:** If `status === 'DONE'`, return `403 Forbidden` if requested by an AI. AI can only transition to `REVIEW`. |
| `DELETE` | `/api/tasks/:id` | Deletes a task and cascades deletion to its activities in SQLite.                                                                        |

## 4. Task Execution & Routing (The Gateway Bridge)

_This is where Claw-Pilot communicates with OpenClaw agents via the WebSocket gateway RPC._

| Method | Endpoint                  | Purpose                                                                                                                                                                                                | Implementation Detail                                                                   |
| :----- | :------------------------ | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------- |
| `POST` | `/api/tasks/:id/route`    | Wakes up the assigned AI and feeds it the task in an isolated context. Returns `202 Accepted`; result arrives via Socket.io.                                                                           | `gateway: sessions.patch + chat.send` (deliver: true)                                   |
| `POST` | `/api/tasks/:id/activity` | **Body:** `{ agent_id, message }`<br>Logs progress. **Rule:** If task is `ASSIGNED`, transition to `IN_PROGRESS`. If message contains "done/completed", transition to `REVIEW` and notify the Lead AI. | Writes to SQLite `activities` table + emits WS event. Auto-notify: `gateway: chat.send` |
| `POST` | `/api/tasks/:id/review`   | **Body:** `{ action: 'approve' \| 'reject', feedback?: string }`<br>Approve moves to `DONE`. Reject moves to `IN_PROGRESS` and sends `feedback` to the agent via the gateway.                          | SQLite update + `gateway: sessions.patch + chat.send`                                   |

## 5. Squad Chat API

_Global chat for human-to-agent communication._

| Method   | Endpoint                  | Purpose                                                                                                                                                                                                                                                                                                                                                          |
| :------- | :------------------------ | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/chat`               | Retrieves chat history from SQLite. Accepts `?cursor=<id>&limit=50` for cursor-based pagination (newest first).                                                                                                                                                                                                                                                  |
| `POST`   | `/api/chat`               | **Body:** `{ agentId?, content }` — Saves a standard chat message directly.                                                                                                                                                                                                                                                                                      |
| `POST`   | `/api/chat/send-to-agent` | **Body:** `{ message, agentId? }` — Saves the user message, then asynchronously delivers it to the agent's gateway session via `chat.send` RPC. **Returns `202 Accepted`** immediately with `{ id, status: "pending" }`. The AI reply is delivered via the `chat_message` Socket.io event. If the gateway call fails, an `agent_error` event is emitted instead. |
| `DELETE` | `/api/chat`               | Wipes all chat history. Emits the `chat_cleared` Socket.io event.                                                                                                                                                                                                                                                                                                |

## 6. App Configuration API

_Persists runtime config in SQLite (gateway URL, port, auto-restart flag)._

| Method | Endpoint      | Purpose                                                                                                 |
| :----- | :------------ | :------------------------------------------------------------------------------------------------------ |
| `GET`  | `/api/config` | Returns the current `AppConfig` object.                                                                 |
| `POST` | `/api/config` | **Body:** Partial `AppConfig` — merges the supplied fields into the stored config and writes to SQLite. |

**AppConfig schema:**

```json
{
  "gatewayUrl": "http://127.0.0.1:8000",
  "apiPort": 54321,
  "autoRestart": false
}
```

## 7. Activities API

_Cursor-paginated activity log across all tasks._

| Method | Endpoint                               | Purpose                                                                        |
| :----- | :------------------------------------- | :----------------------------------------------------------------------------- |
| `GET`  | `/api/activities?cursor=<id>&limit=50` | Returns activity logs sorted newest-first. `nextCursor` is null at end of log. |

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

## 8. Sync API

_Supports incremental synchronization for frontend clients._

| Method | Endpoint                          | Purpose                                                                                                                                 |
| :----- | :-------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/api/sync?since=<ISO timestamp>` | Returns `{ tasks, activities, chatHistory, recurringTasks, activeTaskIds }` updated since the given timestamp. Use to poll for changes. |

## 9. Deliverables & Recurring Tasks

_Sub-tasks and cron-like scheduled tasks._

| Method   | Endpoint                            | Purpose                                                                                     |
| :------- | :---------------------------------- | :------------------------------------------------------------------------------------------ |
| `POST`   | `/api/tasks/:id/deliverables`       | **Body:** `{ title, file_path? }` — Adds a checklist item to a task.                        |
| `PATCH`  | `/api/deliverables/:id/complete`    | Toggles completion of a deliverable.                                                        |
| `PATCH`  | `/api/deliverables/:taskId/reorder` | **Body:** `{ ids: string[] }` — Reorders deliverables by new sequence.                      |
| `GET`    | `/api/recurring`                    | Lists all recurring task templates.                                                         |
| `POST`   | `/api/recurring`                    | **Body:** `{ title, schedule_type, schedule_value? }` — Creates a scheduled template.       |
| `PATCH`  | `/api/recurring/:id`                | **Body:** Partial `RecurringTask` — Pauses/Resumes or updates a recurring task.             |
| `DELETE` | `/api/recurring/:id`                | Deletes a recurring task template.                                                          |
| `POST`   | `/api/recurring/:id/trigger`        | Manually triggers a recurring task, spawning a new normal Task from the template.           |
| `GET`    | `/api/recurring/export`             | Exports all recurring task templates as JSON array.                                         |
| `POST`   | `/api/recurring/import`             | **Body:** Array of `RecurringTask` — Bulk import. Returns `{ imported, skipped, errors? }`. |

**RecurringTask create payload:**

```json
{
  "title": "Weekly status report",
  "schedule_type": "WEEKLY",
  "schedule_value": "monday"
}
```

Valid `schedule_type` values: `"HOURLY"` | `"DAILY"` | `"WEEKLY"` | `"CUSTOM"`. `schedule_value` is only meaningful for `"WEEKLY"` (day name, e.g., `"monday"`) and `"CUSTOM"` (cron expression).

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
  "status": "TODO",
  "priority": "MEDIUM",
  "createdAt": "2026-02-24T10:00:00.000Z",
  "updatedAt": "2026-02-24T10:00:00.000Z"
}
```

## 10. System & Monitoring API

| Method | Endpoint                            | Purpose                                                                                                                                                                                       |
| :----- | :---------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/api/system/stats`                 | Returns aggregate dashboard numbers (active agents, tasks in queue, completed today). Sources agent count from `gateway: config.get` and task counts from SQLite.                             |
| `GET`  | `/api/system/queue-stats`           | Returns live AI job queue state: `{ size, pending, concurrency, paused }`. `size` = queued-but-not-running, `pending` = currently executing, `concurrency` = value of `AI_QUEUE_CONCURRENCY`. |
| `GET`  | `/api/monitoring/gateway/status`    | Calls `health` RPC on the gateway. Returns `{ status: 'HEALTHY', detail: {...} }` or `{ status: 'DOWN', error: '...' }`.                                                                      |
| `GET`  | `/api/monitoring/stuck-tasks/check` | Returns all `IN_PROGRESS` tasks older than 24 h.                                                                                                                                              |

---

## 11. WebSocket Events (Socket.io)

Because the frontend must be highly reactive, the Node.js server emits the following Socket.io events whenever SQLite is updated by an API call or a background monitor.

### Backend Emits → Client Listens:

| Event                    | Payload                                 | Trigger                                                              |
| :----------------------- | :-------------------------------------- | :------------------------------------------------------------------- |
| `task_created`           | `{ id, title? }`                        | `POST /api/tasks`                                                    |
| `task_updated`           | Full `Task` object                      | Any status change                                                    |
| `task_deleted`           | `{ id }`                                | `DELETE /api/tasks/:id`                                              |
| `task_reviewed`          | `{ id, action: 'approve' \| 'reject' }` | `POST /api/tasks/:id/review`                                         |
| `activity_added`         | `ActivityLog` object                    | `POST /api/tasks/:id/activity`                                       |
| `agent_status_changed`   | `Agent` object                          | Session monitor (every 10 s)                                         |
| `chat_message`           | `ChatMessage` object                    | Any message saved to SQLite                                          |
| `chat_cleared`           | _(no payload)_                          | `DELETE /api/chat`                                                   |
| `agent_error`            | `{ agentId, error }`                    | Async CLI call fails in `/send-to-agent`, activity, or review routes |
| `agent_config_generated` | `{ requestId, config }`                 | `POST /api/agents/generate` CLI succeeds                             |
| `agent_config_error`     | `{ requestId, error }`                  | `POST /api/agents/generate` CLI fails                                |

## 12. Agent Callback Protocol (Remote Setup)

When Claw-Pilot and OpenClaw run on **different machines** (e.g. OpenClaw on a VPS, Claw-Pilot on a local Mac connected via Tailscale), there is no automatic notification from the gateway when an agent finishes. The agent must call back to Claw-Pilot over HTTP.

### How it works

1. `POST /api/tasks/:id/route` dispatches the task. The backend **automatically appends** the `taskId`, the full callback URL (built from `PUBLIC_URL`), and the `API_KEY` to the bottom of the prompt the agent receives — no manual configuration of the agent is needed for it to know where to POST.
2. The agent does its work.
3. When done, the agent calls the URL it was given in the prompt:

```
POST http://<PUBLIC_URL>/api/tasks/<taskId>/activity
Authorization: Bearer <API_KEY>
Content-Type: application/json

{ "agent_id": "<agentId>", "message": "completed: <summary of what was done>" }
```

The word `completed` (or `done`) in the message body triggers the automatic `IN_PROGRESS -> REVIEW` transition, moving the task to the Review swimlane.

### What the agent receives

Every dispatched prompt ends with a section like this (injected automatically by the backend):

```
---
TASK METADATA (do not include in your work output):
taskId: 3f7a9b2c-...
When you have finished, report your result by calling:
  POST http://100.78.90.125:54321/api/tasks/3f7a9b2c-.../activity
  Authorization: Bearer <API_KEY>
  Content-Type: application/json
  Body: { "agent_id": "dev", "message": "completed: <your summary>" }
The word "completed" in the message is required to move this task to Review.
On error use: { "agent_id": "dev", "message": "error: <description>" }
```

### Optional: TOOLS.md reinforcement

The injected footer is sufficient for most agents. For extra reliability you can also add the following to the agent's **`TOOLS.md`** (editable via the Agent Files panel in Settings) to reinforce the protocol:

```
## Claw-Pilot Task Reporting

Every task prompt you receive will end with a TASK METADATA block containing a
pre-built callback URL, taskId, and Authorization header. Use those exact values.
Always include the word "completed" in your message so the task moves to Review.
On error, use: { "message": "error: <description>" }
```

### Environment variable checklist for remote access

| Variable         | Required value           | Notes                                                                                                                                                                                                  |
| :--------------- | :----------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HOST`           | `0.0.0.0`                | Must not be `127.0.0.1` — loopback is invisible to Tailscale/external interfaces                                                                                                                       |
| `PORT`           | `54321`                  | The port the agent will POST to                                                                                                                                                                        |
| `PUBLIC_URL`     | `http://100.x.x.x:54321` | **Critical for remote agents.** This exact URL is embedded by the backend into every agent prompt as the callback address. If unset, agents receive `http://localhost:54321`, which they cannot reach. |
| `API_KEY`        | any string               | The bearer token the agent includes in `Authorization`                                                                                                                                                 |
| `ALLOWED_ORIGIN` | frontend origin          | Only affects browser CORS — agent REST calls bypass CORS                                                                                                                                               |

### Future: co-located deployment

When Claw-Pilot runs in Docker on the same machine as OpenClaw, the callback URL becomes `http://claw-pilot:54321` (Docker service name). No other changes needed.
