# Agent Creation Protocol

This document describes how Mission Control (MC) creates agents through the OpenClaw gateway using WebSocket RPC. It is intended as a self-contained implementation reference for anyone building a compatible MC client in another codebase.

**Control flow direction**: MC is always the WebSocket **client**. The gateway is the server. All agent creation and file operations flow **MC → gateway**. The gateway never pushes RPC calls to create agents in MC; it only emits events (e.g., `heartbeat`) that MC ingests.

---

## Table of Contents

1. [Gateway Configuration](#1-gateway-configuration)
2. [WebSocket Connection & Auth Handshake](#2-websocket-connection--auth-handshake)
3.[RPC Message Envelope](#3-rpc-message-envelope)
4. [Method & Event Reference](#4-method--event-reference)
5. [Agent IDs & Session Keys](#5-agent-ids--session-keys)
6. [Agent Creation: Full RPC Sequence](#6-agent-creation-full-rpc-sequence)
7. [API-Level Parameters (`AgentCreate`)](#7-api-level-parameters-agentcreate)
8. [Workspace Files per Agent Type](#8-workspace-files-per-agent-type)
9. [Template Context Variables](#9-template-context-variables)
10.[Board Lead → Worker Spawn Flow](#10-board-lead--worker-spawn-flow)
11.[Updating Agents & Re-provisioning](#11-updating-agents--re-provisioning)
12. [Agent Deletion](#12-agent-deletion)
13. [Source File Map](#13-source-file-map)

---

## 1. Gateway Configuration

Every gateway connection is described by four properties:

| Property | Type | Description |
|---|---|---|
| `url` | `str` | WebSocket endpoint, e.g. `wss://localhost:18789` or `ws://gateway:18789` |
| `token` | `str \| None` | Optional bearer auth token |
| `allow_insecure_tls` | `bool` | Skip TLS certificate verification for `wss://` (default `false`) |
| `disable_device_pairing` | `bool` | Use `control_ui` connect mode instead of device keypair auth (default `false`) |
| `workspace_root` | `str` | Root directory for agent workspaces on the gateway host, e.g. `~/.openclaw` |

**URL construction**: when `token` is set, it is appended as a query parameter:

```
wss://gateway.example.com?token=<token>
```

Source: [gateway_rpc.py](../backend/app/services/openclaw/gateway_rpc.py), [gateway_resolver.py](../backend/app/services/openclaw/gateway_resolver.py)

---

## 2. WebSocket Connection & Auth Handshake

Each RPC call opens a **new** WebSocket connection (connections are not pooled). The handshake sequence is:

### Step 1 — Open WebSocket

```
GET wss://gateway.example.com?token=<optional-token>
```

For `wss://` with `allow_insecure_tls=true`, skip hostname and certificate verification.

For `disable_device_pairing=true` (control-UI mode), derive the HTTP `Origin` header from the gateway URL:
- `ws://host` → `Origin: http://host`
- `wss://host` → `Origin: https://host`

### Step 2 — Receive `connect.challenge` (optional, 2 s timeout)

The gateway may send an event immediately after the WebSocket opens:

```json
{
  "type": "event",
  "event": "connect.challenge",
  "payload": {
    "nonce": "<challenge-string>"   // optional; include in connect params if present
  }
}
```

If no message arrives within 2 seconds, proceed without a nonce.

### Step 3 — Send `connect` request

#### Device mode (default, `disable_device_pairing=false`)

```json
{
  "type": "req",
  "id": "<uuid>",
  "method": "connect",
  "params": {
    "minProtocol": 3,
    "maxProtocol": 3,
    "role": "operator",
    "scopes": ["operator.read", "operator.admin", "operator.approvals", "operator.pairing"],
    "client": {
      "id": "gateway-client",
      "version": "1.0.0",
      "platform": "python",
      "mode": "backend"
    },
    "device": {
      "id": "<device-uuid>",
      "publicKey": "<base64url-ed25519-raw-public-key>",
      "signature": "<base64url-ed25519-signature-over-payload>",
      "signedAt": 1740000000000,
      "nonce": "<challenge-nonce-if-received>"   // omit if no challenge was received
    },
    "auth": { "token": "<gateway-token>" }       // omit if no token
  }
}
```

**Device identity** is a persisted Ed25519 keypair. The signed payload covers:
`device_id`, `client_id`, `client_mode`, `role`, `scopes`, `signed_at_ms`, optional `token` and `nonce`.

Source:[device_identity.py](../backend/app/services/openclaw/device_identity.py)

#### Control-UI mode (`disable_device_pairing=true`)

```json
{
  "type": "req",
  "id": "<uuid>",
  "method": "connect",
  "params": {
    "minProtocol": 3,
    "maxProtocol": 3,
    "role": "operator",
    "scopes": ["operator.read", "operator.admin", "operator.approvals", "operator.pairing"],
    "client": {
      "id": "openclaw-control-ui",
      "version": "1.0.0",
      "platform": "python",
      "mode": "ui"
    },
    "auth": { "token": "<gateway-token>" }       // omit if no token
  }
}
```

No `device` block. The `Origin` HTTP header (set during WebSocket upgrade) carries authentication.

### Step 4 — Receive connect response

```json
{
  "type": "res",
  "id": "<matching-uuid>",
  "ok": true,
  "payload": { ... }
}
```

A response with `"ok": false` (or an `"error"` key) indicates auth failure — do not proceed.

---

## 3. RPC Message Envelope

All communication after the handshake uses the same three message shapes.

### Request (MC → gateway)

```json
{
  "type": "req",
  "id": "<uuid>",
  "method": "<method-name>",
  "params": { ... }
}
```

### Response (gateway → MC)

```json
{
  "type": "res",
  "id": "<matching-uuid>",
  "ok": true,
  "payload": { ... }
}
```

Error response:

```json
{
  "type": "res",
  "id": "<matching-uuid>",
  "ok": false,
  "error": { "message": "human-readable error" }
}
```

### Event (gateway → MC, unsolicited)

```json
{
  "type": "event",
  "event": "<event-name>",
  "payload": { ... }
}
```

Events are received interleaved with response messages. When awaiting a response to a specific `id`, discard any messages whose `id` does not match.

---

## 4. Method & Event Reference

### Agent methods

| Method | Description |
|---|---|
| `agents.list` | List all registered agents |
| `agents.create` | Register a new agent (idempotent — returns error if already exists) |
| `agents.update` | Update agent display name or workspace path |
| `agents.delete` | Remove agent registration and optionally its workspace files |
| `agents.files.list` | List workspace files for an agent |
| `agents.files.get` | Fetch a workspace file's content |
| `agents.files.set` | Write/overwrite a workspace file |
| `agents.files.delete` | Delete a workspace file |

### Session methods

| Method | Description |
|---|---|
| `sessions.list` | List active sessions |
| `sessions.patch` | Create or update a session (idempotent) |
| `sessions.reset` | Clear session history |
| `sessions.delete` | Delete a session |
| `sessions.compact` | Compact session history |
| `sessions.preview` | Preview session content |

### Chat methods

| Method | Description |
|---|---|
| `chat.send` | Send a message into a session |
| `chat.history` | Fetch chat history |
| `chat.abort` | Abort in-progress chat |

### Config methods

| Method | Description |
|---|---|
| `config.get` | Fetch current gateway config + hash |
| `config.patch` | Patch gateway config (supply `baseHash` to prevent race conditions) |
| `config.set` | Replace gateway config |
| `config.apply` | Apply and save pending config |
| `config.schema` | Fetch config JSON schema |

### Other relevant methods

| Method | Description |
|---|---|
| `health` | Gateway health check |
| `status` | Gateway runtime status |
| `last-heartbeat` | Fetch last agent heartbeat record |
| `set-heartbeats` | Bulk-set heartbeat configs |
| `wake` | Wake an agent session |

### Events emitted by gateway

| Event | When |
|---|---|
| `connect.challenge` | Immediately after WebSocket open (auth challenge) |
| `agent` | Agent state change |
| `chat` | New chat message or update |
| `heartbeat` | Agent heartbeat tick |
| `health` | Gateway health update |
| `presence` | User/agent presence change |
| `tick` | Periodic timer tick |
| `shutdown` | Gateway shutting down |
| `exec.approval.requested` | Tool execution approval needed |
| `exec.approval.resolved` | Approval decision |
| `node.pair.requested` | Node pair request |
| `node.pair.resolved` | Node pair resolved |
| `device.pair.requested` | Device pair request |
| `device.pair.resolved` | Device pair resolved |

Source:[gateway_rpc.py](../backend/app/services/openclaw/gateway_rpc.py) (`GATEWAY_METHODS`, `GATEWAY_EVENTS`)

---

## 5. Agent IDs & Session Keys

All naming is deterministic — derived from stable UUIDs, never from human-provided display names.

### Agent types

| Type | Description |
|---|---|
| **Gateway main** | One per gateway. Represents the gateway itself as an MC entity. |
| **Board lead** | One per board. Spawns and coordinates worker agents. |
| **Board worker** | Many per board. Created by lead agents or human operators. |

### Session key formulas

Session keys are the primary routing identifier used by the gateway.

| Agent type | Session key |
|---|---|
| Gateway main | `agent:mc-gateway-<gateway-uuid>:main` |
| Board lead | `agent:lead-<board-uuid>:main` |
| Board worker | `agent:mc-<agent-uuid>:main` |

### Gateway agent ID (used in all RPC calls)

The gateway agent ID is derived from the session key by taking the middle segment (between the first and last `:`):

| Agent type | Gateway agent ID |
|---|---|
| Gateway main | `mc-gateway-<gateway-uuid>` |
| Board lead | `lead-<board-uuid>` |
| Board worker | `mc-<agent-uuid>` |

Python derivation:
```python
agent_id = session_key.split(":")[1]
```

### Workspace path formula

```
<gateway.workspace_root>/workspace-<slugify(agent_id)>
```

**Special case**: gateway-main agent IDs that begin with `mc-gateway-` have the `mc-` prefix stripped for the workspace path to preserve backwards compatibility with existing on-disk layouts:

```
# gateway main agent
workspace_root/workspace-gateway-<gateway-uuid>

# board lead
workspace_root/workspace-lead-<board-uuid>

# board worker
workspace_root/workspace-mc-<agent-uuid>
```

Source:[internal/session_keys.py](../backend/app/services/openclaw/internal/session_keys.py), [internal/agent_key.py](../backend/app/services/openclaw/internal/agent_key.py), [provisioning.py `_workspace_path`](../backend/app/services/openclaw/provisioning.py)

---

## 6. Agent Creation: Full RPC Sequence

Each step is a separate WebSocket call (new connection per call). Steps are executed in order.

### Step 1 — Register the agent (`agents.create`)

```json
Method: "agents.create"
Params: {
  "name": "mc-<agent-uuid>",
  "workspace": "/path/to/workspace-mc-<agent-uuid>"
}
```

**Idempotent**: if the gateway returns an error containing `already`, `exist`, `duplicate`, or `conflict`, treat it as success and continue.

### Step 2 — Set display name (`agents.update`)

```json
Method: "agents.update"
Params: {
  "agentId": "mc-<agent-uuid>",
  "name": "My Agent Display Name",
  "workspace": "/path/to/workspace-mc-<agent-uuid>"
}
```

### Step 3 — Register heartbeat in gateway config

#### 3a — Fetch current config hash

```json
Method: "config.get"
Params: {}
```

Response contains `"hash"` and `"config"` (or `"parsed"`). Extract:
- `hash` → use as `baseHash` in the patch call (optimistic concurrency)
- `config.agents.list` → array of existing agent heartbeat registrations

#### 3b — Patch config with new agent heartbeat

The patch merges the new agent into the existing `agents.list`, updating in-place if already present.

```json
Method: "config.patch"
Params: {
  "raw": "{\"agents\":{\"list\":[...existing entries..., {\"id\":\"mc-<agent-uuid>\",\"workspace\":\"/path/to/workspace-mc-<agent-uuid>\",\"heartbeat\":{\"every\":\"10m\",\"target\":\"last\",\"includeReasoning\":false}}]}}",
  "baseHash": "<hash-from-config.get>"
}
```

**Default heartbeat config**:

```json
{
  "every": "10m",
  "target": "last",
  "includeReasoning": false
}
```

Override any of these via the `heartbeat_config` field on the agent (see [§7](#7-api-level-parameters-agentcreate)).

### Step 4 — List existing workspace files

```json
Method: "agents.files.list"
Params: { "agentId": "mc-<agent-uuid>" }
```

Response: `{ "files": [ { "name": "IDENTITY.md", ... }, ... ] }`

This is used to determine which files already exist. Files in `PRESERVE_AGENT_EDITABLE_FILES` (`USER.md`, `MEMORY.md`) are **not overwritten** if they already exist (they may contain human-edited or agent-edited content).

### Step 5 — Write workspace files (`agents.files.set`)

One call per file. Files are Jinja2-rendered from templates in [backend/templates/](../backend/templates/).

```json
Method: "agents.files.set"
Params: {
  "agentId": "mc-<agent-uuid>",
  "name": "IDENTITY.md",
  "content": "<rendered file content>"
}
```

Repeated for each file in the agent's file set (see [§8](#8-workspace-files-per-agent-type)).

Files preserved on update (not overwritten if they exist):
- `USER.md` — human-provided context, onboarding notes
- `MEMORY.md` — agent's curated long-term memory

### Step 6 — Ensure session exists (`sessions.patch`)

```json
Method: "sessions.patch"
Params: {
  "key": "agent:mc-<agent-uuid>:main",
  "label": "My Agent Display Name"
}
```

Creates the session if it does not exist, or updates the label if it does. Idempotent.

### Step 7 — Send wakeup message (`chat.send`)

```json
Method: "chat.send"
Params: {
  "sessionKey": "agent:mc-<agent-uuid>:main",
  "message": "Hello My Agent Display Name. Your workspace has been provisioned.\n\nStart the agent...",
  "deliver": true,
  "idempotencyKey": "<uuid>"
}
```

`"deliver": true` causes the gateway to route the message to the agent for processing. Set `"deliver": false` to inject a message into the session history without triggering a response.

Source: [provisioning.py `OpenClawGatewayControlPlane.upsert_agent`](../backend/app/services/openclaw/provisioning.py), [provisioning.py `apply_agent_lifecycle`](../backend/app/services/openclaw/provisioning.py)

---

## 7. API-Level Parameters (`AgentCreate`)

These are the parameters accepted by `POST /agents` — the HTTP entry point that triggers the full RPC sequence above.

### `AgentCreate` / `AgentBase` fields

| Field | Type | Default | Description |
|---|---|---|---|
| `board_id` | `UUID \| null` | `null` | Board scope. Required for board-scoped agents. |
| `name` | `string` (non-empty) | — | Human-readable display name. |
| `status` | `string` | `"provisioning"` | Lifecycle state (`"provisioning"`, `"active"`, `"paused"`, `"retired"`). |
| `heartbeat_config` | `object \| null` | `null` | Overrides for default heartbeat policy (see below). |
| `identity_profile` | `object \| null` | `null` | Role profile hints injected into templates (see below). |
| `identity_template` | `string \| null` | `null` | Raw Jinja2 override for `IDENTITY.md`. Replaces the default template. |
| `soul_template` | `string \| null` | `null` | Raw Jinja2 override for `SOUL.md`. Replaces the default template. |

### `heartbeat_config` fields

Merged over the default `{"every": "10m", "target": "last", "includeReasoning": false}`:

| Key | Example | Description |
|---|---|---|
| `every` | `"5m"`, `"30s"` | Heartbeat interval (duration string) |
| `target` | `"last"`, `"all"` | Which session(s) to heartbeat |
| `includeReasoning` | `true` / `false` | Include reasoning in heartbeat output |

### `identity_profile` fields

Standard fields (with defaults used in templates when not provided):

| Field | Default | Context variable |
|---|---|---|
| `role` | `"Generalist"` | `identity_role` |
| `communication_style` | `"direct, concise, practical"` | `identity_communication_style` |
| `emoji` | `":gear:"` | `identity_emoji` |

Extended fields (all default to empty string):

| Field | Context variable | Purpose |
|---|---|---|
| `autonomy_level` | `identity_autonomy_level` | How independently the agent acts |
| `verbosity` | `identity_verbosity` | Output length/detail level |
| `output_format` | `identity_output_format` | Preferred output format |
| `update_cadence` | `identity_update_cadence` | How often the agent reports progress |
| `purpose` | `identity_purpose` | Agent's reason for existing (charter) |
| `personality` | `identity_personality` | Distinct personality traits |
| `custom_instructions` | `identity_custom_instructions` | Free-form additional instructions |

Source: [constants.py](../backend/app/services/openclaw/constants.py) (`DEFAULT_IDENTITY_PROFILE`, `EXTRA_IDENTITY_PROFILE_FIELDS`), [schemas/agents.py](../backend/app/schemas/agents.py)

---

## 8. Workspace Files per Agent Type

The gateway writes one directory per agent at `<workspace_root>/workspace-<agent-key>/`.

### Board worker (non-lead)

| File | Template | Preserved on update |
|---|---|---|
| `IDENTITY.md` | `BOARD_IDENTITY.md.j2` | No (overwritten) |
| `SOUL.md` | `BOARD_SOUL.md.j2` | No |
| `TOOLS.md` | `BOARD_TOOLS.md.j2` | No |
| `AGENTS.md` | `BOARD_AGENTS.md.j2` | No |
| `HEARTBEAT.md` | `BOARD_HEARTBEAT.md.j2` | No |
| `USER.md` | `BOARD_USER.md.j2` | **Yes** — skip if file already exists |
| `MEMORY.md` | `BOARD_MEMORY.md.j2` | **Yes** — skip if file already exists |

### Board lead

Same as worker, plus:

| File | Template | Preserved on update |
|---|---|---|
| `BOOTSTRAP.md` | `BOARD_BOOTSTRAP.md.j2` | No (written only on first provision) |

`BOOTSTRAP.md` is only written when `force_bootstrap=True` or when the file does not yet exist. On subsequent updates it is left untouched.

### Template location

Templates live in [backend/templates/](../backend/templates/) as `BOARD_*.md.j2` Jinja2 files. `identity_template` and `soul_template` on the agent override `IDENTITY.md` and `SOUL.md` respectively (rendered with the same context).

Source: [constants.py](../backend/app/services/openclaw/constants.py) (`DEFAULT_GATEWAY_FILES`, `LEAD_GATEWAY_FILES`, `PRESERVE_AGENT_EDITABLE_FILES`)

---

## 9. Template Context Variables

All Jinja2 workspace file templates receive the following context. All values are strings.

### Agent identity

| Variable | Description |
|---|---|
| `agent_name` | Agent display name |
| `agent_id` | Agent UUID (as string) |
| `session_key` | Agent's session key (e.g. `agent:mc-<uuid>:main`) |
| `workspace_path` | Absolute path to the agent's workspace directory |
| `workspace_root` | Gateway workspace root |
| `is_board_lead` | `"true"` or `"false"` |
| `is_main_agent` | `"true"` or `"false"` (only `true` for gateway-main agents) |
| `auth_token` | Agent's `AUTH_TOKEN` — written into `TOOLS.md` so the agent can authenticate back to MC |
| `base_url` | MC base URL (e.g. `https://mission-control.example.com`) |
| `main_session_key` | Session key of the gateway main agent |

### Board context

| Variable | Description |
|---|---|
| `board_id` | Board UUID (as string) |
| `board_name` | Board display name |
| `board_type` | Board type |
| `board_objective` | Board objective text |
| `board_success_metrics` | Board success metrics as JSON string |
| `board_target_date` | ISO-formatted target date or empty string |
| `board_goal_confirmed` | `"true"` or `"false"` |
| `board_rule_require_approval_for_done` | `"true"` or `"false"` |
| `board_rule_require_review_before_done` | `"true"` or `"false"` |
| `board_rule_block_status_changes_with_pending_approval` | `"true"` or `"false"` |
| `board_rule_only_lead_can_change_status` | `"true"` or `"false"` |
| `board_rule_max_agents` | Max agents as string |

### User context

| Variable | Description |
|---|---|
| `user_name` | Human operator display name |
| `user_preferred_name` | First name or short name |
| `user_pronouns` | User pronouns (may be empty) |
| `user_timezone` | User timezone string (may be empty) |
| `user_notes` | Free-form notes about the user (may be empty) |
| `user_context` | Additional user context (may be empty) |

### Identity profile context

| Variable | Source field | Default |
|---|---|---|
| `identity_role` | `identity_profile.role` | `"Generalist"` |
| `identity_communication_style` | `identity_profile.communication_style` | `"direct, concise, practical"` |
| `identity_emoji` | `identity_profile.emoji` | `":gear:"` |
| `identity_autonomy_level` | `identity_profile.autonomy_level` | `""` |
| `identity_verbosity` | `identity_profile.verbosity` | `""` |
| `identity_output_format` | `identity_profile.output_format` | `""` |
| `identity_update_cadence` | `identity_profile.update_cadence` | `""` |
| `identity_purpose` | `identity_profile.purpose` | `""` |
| `identity_personality` | `identity_profile.personality` | `""` |
| `identity_custom_instructions` | `identity_profile.custom_instructions` | `""` |

### Worker-only variables

| Variable | Description |
|---|---|
| `directory_role_soul_markdown` | Role-specific soul content fetched from an external souls directory (may be empty) |
| `directory_role_soul_source_url` | URL of the souls directory page (may be empty) |

Source: [provisioning.py](../backend/app/services/openclaw/provisioning.py)

---

## 10. Board Lead → Worker Spawn Flow

Board lead agents run inside the gateway and call **back** to MC's REST API to create workers. This is the only gateway→MC direction in the agent creation flow.

1. The lead agent is provisioned with an `AUTH_TOKEN` written into its `TOOLS.md` file.
2. The lead uses that token as a bearer token on MC's HTTP API.
3. To spawn a worker, the lead calls:

```http
POST /agent/agents
Authorization: Bearer <AUTH_TOKEN>
Content-Type: application/json

{
  "name": "Worker Agent Name",
  "board_id": "<board-uuid>",
  "identity_profile": { "role": "...", ... },
  "heartbeat_config": { ... }
}
```

4. MC validates the token, resolves the lead agent, enforces `board.max_agents`, and runs the full RPC provisioning sequence (§6) for the new worker.
5. The lead respects `board_rule_max_agents` — MC rejects the creation request if the board is at capacity.

This is handled by [`AgentLifecycleService.create_agent`](../backend/app/services/openclaw/provisioning_db.py) with the actor being the lead agent itself.

---

## 11. Updating Agents & Re-provisioning

`PATCH /agents/{agent_id}` accepts `AgentUpdate` fields (same fields as `AgentCreate`, all optional). After persisting the DB changes, MC re-runs the full provisioning sequence (steps 1–7 in §6) with `action="update"`.

**Update-specific behavior**:
- Preserved files (`USER.md`, `MEMORY.md`) are still skipped if they already exist on disk.
- The wakeup message verb changes from `"provisioned"` to `"updated"`.
- Pass `reset_session=True` to clear session history before waking the agent.

Editable fields via `AgentUpdate`:

| Field | Description |
|---|---|
| `name` | Rename the agent (updates gateway display name) |
| `status` | Change lifecycle status |
| `heartbeat_config` | Update heartbeat policy (re-patches gateway config) |
| `identity_profile` | Update role/personality context (re-renders all workspace files) |
| `identity_template` | Replace `IDENTITY.md` Jinja2 content |
| `soul_template` | Replace `SOUL.md` Jinja2 content |
| `board_id` | Reassign to a different board |

---

## 12. Agent Deletion

`DELETE /agents/{agent_id}` runs:

1. `agents.delete` RPC → removes the agent registration on the gateway and optionally deletes workspace files.
2. `sessions.delete` RPC → deletes the session and its history.
3. DB soft-delete of the agent record.

```json
Method: "agents.delete"
Params: {
  "agentId": "mc-<agent-uuid>",
  "deleteFiles": true
}
```

```json
Method: "sessions.delete"
Params: { "key": "agent:mc-<agent-uuid>:main" }
```

Errors matching `not found` / `missing` / `no such` / `unknown agent` are silently ignored (idempotent delete).

---

## 13. Source File Map

| File | What it contains |
|---|---|
| [gateway_rpc.py](../backend/app/services/openclaw/gateway_rpc.py) | All RPC protocol constants, WS connection/auth, `_send_request`, `_ensure_connected`, `GATEWAY_METHODS`, `GATEWAY_EVENTS` |
|[provisioning.py](../backend/app/services/openclaw/provisioning.py) | `OpenClawGatewayControlPlane` (per-method RPC calls), `apply_agent_lifecycle`, `_build_context`, `_render_agent_files`, `_workspace_path` |
| [provisioning_db.py](../backend/app/services/openclaw/provisioning_db.py) | `AgentLifecycleService.create_agent` (DB orchestration layer, calls provisioning.py) |
| [constants.py](../backend/app/services/openclaw/constants.py) | `DEFAULT_HEARTBEAT_CONFIG`, `DEFAULT_IDENTITY_PROFILE`, `DEFAULT_GATEWAY_FILES`, `LEAD_GATEWAY_FILES`, `PRESERVE_AGENT_EDITABLE_FILES`, template maps |
| [internal/session_keys.py](../backend/app/services/openclaw/internal/session_keys.py) | Session key formulas for all agent types |
| [internal/agent_key.py](../backend/app/services/openclaw/internal/agent_key.py) | `agent_key()` — derives gateway agent ID from session key |
|[device_identity.py](../backend/app/services/openclaw/device_identity.py) | Ed25519 device keypair generation and payload signing |
| [schemas/agents.py](../backend/app/schemas/agents.py) | `AgentCreate`, `AgentUpdate` Pydantic schemas |
|[backend/templates/](../backend/templates/) | Jinja2 workspace file templates (`BOARD_*.md.j2`) |