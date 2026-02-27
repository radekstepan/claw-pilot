# 🌐 Claw-Pilot REST & Socket.io API

This document describes the API exposed by the Claw-Pilot Fastify backend to the React frontend and to remote agents calling back with status updates.

> **Gateway Reference:** For documentation on how this backend communicates downstream to the OpenClaw gateway via WebSocket RPC, see [openclaw_api.md](./openclaw_api.md).

## 1. Agent Management API

| Method   | Endpoint                | Purpose |
| :------- | :---------------------- | :------ |
| `GET`    | `/api/agents`           | Lists all configured agents, merging their config with real-time status (`WORKING`, `IDLE`, `OFFLINE`). |
| `POST`   | `/api/agents`           | Creates a new agent. Returns `202 Accepted`. |
| `PATCH`  | `/api/agents/:id`       | Updates basic agent info (name, model, capabilities, files). |
| `DELETE` | `/api/agents/:id`       | Removes the agent. |
| `GET`    | `/api/agents/:id/files` | Reads the raw text of `SOUL.md`, `TOOLS.md`, and `AGENTS.md`. |
| `PUT`    | `/api/agents/:id/files` | Overwrites the contents of the agent's markdown configuration files. |
| `POST`   | `/api/agents/generate`  | Sends a prompt to draft a configuration for a new agent. Returns `202 Accepted`. Result arrives via the `agent_config_generated` Socket.io event. |

## 2. LLM Model Management

| Method | Endpoint      | Purpose |
| :----- | :------------ | :------ |
| `GET`  | `/api/models` | Gets available LLMs from the gateway. Returns 503 if gateway is unreachable. |

## 3. Task Kanban API (SQLite)

| Method   | Endpoint         | Purpose |
| :------- | :--------------- | :------ |
| `GET`    | `/api/tasks`     | Returns all tasks. Accepts query params `?limit=200&offset=0`. |
| `POST`   | `/api/tasks`     | Creates a task. Auto-assigns if `assignee_id` is provided. |
| `PATCH`  | `/api/tasks/:id` | Updates task fields. **Rule:** If `status === 'DONE'`, returns `403` if requested by an AI. |
| `DELETE` | `/api/tasks/:id` | Deletes a task and cascades deletion to its activities. |

## 4. Task Execution & Routing

| Method | Endpoint                  | Purpose |
| :----- | :------------------------ | :------ |
| `POST` | `/api/tasks/:id/route`    | Dispatches task to an agent. Returns `202 Accepted`; result arrives via Socket.io. |
| `POST` | `/api/tasks/:id/activity` | Logs progress. **Rule:** If message contains "done/completed", auto-transitions to `REVIEW`. |
| `POST` | `/api/tasks/:id/review`   | Approve moves to `DONE`. Reject moves to `IN_PROGRESS` and re-routes task with feedback. |

## 5. Squad Chat API

| Method   | Endpoint                  | Purpose |
| :------- | :------------------------ | :------ |
| `GET`    | `/api/chat`               | Cursor-based pagination (`?cursor=<id>&limit=50`) for chat history. |
| `POST`   | `/api/chat`               | Saves a standard chat message directly. |
| `POST`   | `/api/chat/send-to-agent` | Asynchronously delivers message to an agent. Returns `202 Accepted`. |
| `DELETE` | `/api/chat`               | Wipes all chat history. |

## 6. System, Sync & Activities

| Method | Endpoint | Purpose |
| :----- | :------- | :------ |
| `GET`  | `/api/activities` | Returns activity logs sorted newest-first (`?cursor=<id>&limit=50`). |
| `GET`  | `/api/sync` | Returns `{ tasks, activities, chatHistory, recurringTasks }` updated since `?since=<ISO timestamp>`. |
| `GET`  | `/api/config` | Returns the current runtime config. |
| `POST` | `/api/config` | Updates runtime config settings (e.g., notification sounds). |
| `GET`  | `/api/system/stats` | Returns aggregate dashboard numbers. |
| `GET`  | `/api/system/queue-stats` | Returns live AI job queue state (`{ size, pending, concurrency }`). |
| `GET`  | `/api/monitoring/gateway/status` | Returns gateway health (`ONLINE`, `OFFLINE`, or `PAIRING_REQUIRED`). |

## 7. Deliverables & Recurring Tasks

| Method   | Endpoint                            | Purpose |
| :------- | :---------------------------------- | :------ |
| `POST`   | `/api/tasks/:id/deliverables`       | Adds a checklist item to a task. |
| `PATCH`  | `/api/deliverables/:id/complete`    | Toggles completion of a deliverable. |
| `PATCH`  | `/api/deliverables/:taskId/reorder` | Reorders deliverables by new sequence. |
| `GET`    | `/api/recurring`                    | Lists all recurring task templates. |
| `POST`   | `/api/recurring`                    | Creates a scheduled template. |
| `PATCH`  | `/api/recurring/:id`                | Pauses/Resumes or updates a recurring task. |
| `DELETE` | `/api/recurring/:id`                | Deletes a recurring task template. |
| `POST`   | `/api/recurring/:id/trigger`        | Manually triggers a recurring task template. |
| `POST`   | `/api/recurring/import`             | Bulk imports recurring templates. |

---

## 8. WebSocket Events (Socket.io)

Because the frontend must be highly reactive, the Node.js server emits the following Socket.io events:

| Event                    | Payload                                 |
| :----------------------- | :-------------------------------------- |
| `task_created`           | `{ id, title? }`                        |
| `task_updated`           | Full `Task` object                      |
| `task_deleted`           | `{ id }`                                |
| `task_reviewed`          | `{ id, action: 'approve' \| 'reject' }` |
| `activity_added`         | `ActivityLog` object                    |
| `agent_status_changed`   | `Agent` object                          |
| `chat_message`           | `ChatMessage` object                    |
| `agent_busy_changed`     | `{ agentId, busy: boolean }`            |
| `gateway_status`         | `{ online, pairingRequired, deviceId }` |
| `agent_error`            | `{ agentId, error }`                    |
| `agent_config_generated` | `{ requestId, config }`                 |
| `agent_config_error`     | `{ requestId, error }`                  |
| `agent_deployed`         | `{ requestId, agentId }`                |
| `agent_deploy_error`     | `{ requestId, error }`                  |

---

## 9. Agent Callback Protocol (Remote Setup)

When OpenClaw runs on a different machine than Claw-Pilot, agents must call back to Claw-Pilot over HTTP to report progress.

1. The backend automatically appends the `taskId`, `API_KEY`, and callback URL to the bottom of every dispatched prompt.
2. When the agent is done, it calls:

```http
POST http://<PUBLIC_URL>/api/tasks/<taskId>/activity
Authorization: Bearer <API_KEY>
Content-Type: application/json

{ "agent_id": "<agentId>", "message": "completed: <summary of what was done>" }
```

The word `completed` (or `done`) in the message body triggers the automatic `IN_PROGRESS -> REVIEW` transition in the backend.
