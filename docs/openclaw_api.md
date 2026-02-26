# OpenClaw Gateway RPC API

This document describes how openclaw-mission-control communicates with the OpenClaw gateway. All communication uses **WebSocket RPC** — there is no REST HTTP client. Every call opens a fresh WebSocket connection, performs a challenge/response authentication handshake, sends one RPC method request, reads the response, and closes.

## Table of Contents

- [Connection Overview](#connection-overview)
- [Wire Protocol](#wire-protocol)
- [Authentication](#authentication)
  - [Mode A — Device Pairing (the only mode)](#mode-a--device-pairing-the-only-mode)
  - [Connect Request Shape](#connect-request-shape)
- [Calling an RPC Method](#calling-an-rpc-method)
- [Events](#events)
- [RPC Method Reference](#rpc-method-reference)
  - [Health](#health)
  - [Sessions](#sessions)
  - [Chat](#chat)
  - [Agents](#agents)
  - [Agent Files](#agent-files)
  - [Configuration](#configuration)
  - [Full Method Catalogue](#full-method-catalogue)
- [Session Key Conventions](#session-key-conventions)
- [Version Compatibility](#version-compatibility)
- [Related Docs](#related-docs)

---

## Connection Overview

The OpenClaw gateway exposes a WebSocket server, default port **18789**.

| Scheme | Example URL |
|--------|-------------|
| Plaintext | `ws://host:18789` |
| TLS | `wss://host:18789` |

If a bearer token is configured, it is appended as a query parameter:

```
wss://host:18789?token=<token>
```

Each RPC call follows this lifecycle:

```
client                                    gateway
  │──── WebSocket connect ──────────────────→│
  │←─── event: connect.challenge ───────────│  always arrives; contains nonce to sign
  │──── req: connect (device block) ────────→│  authentication handshake
  │←─── res: connect ───────────────────────│  ok + optional auth.deviceToken
  │──── req: <method> ──────────────────────→│  actual RPC call
  │←─── res: <method> ──────────────────────│
  │──── close ──────────────────────────────→│
```

Connections are **not** kept alive between calls. The gateway is stateless from the client's perspective — each call is self-contained.

---

## Wire Protocol

All messages are JSON-encoded text frames.

### Request frame

```json
{
  "type": "req",
  "id": "<uuid-v4>",
  "method": "<method-name>",
  "params": { }
}
```

### Response frame (success)

```json
{
  "type": "res",
  "id": "<uuid-v4>",
  "ok": true,
  "payload": { }
}
```

### Response frame (error)

```json
{
  "type": "res",
  "id": "<uuid-v4>",
  "ok": false,
  "error": {
    "message": "Human-readable error description"
  }
}
```

### Event frame (server-push)

```json
{
  "type": "event",
  "event": "<event-name>",
  "payload": { }
}
```

The client matches responses to requests by `id`. Any frame with `ok: false` or a top-level `error` key is treated as a fatal error for that call.

---

## Authentication

Claw-Pilot uses **Mode A (Device Pairing)** — the gateway's standard authentication flow for all operator clients, including the official CLI, macOS app, and this dashboard. There is no "Mode B" bypass; every connection requires a stable device identity.

### Mode A — Device Pairing (the only mode)

On first startup, Claw-Pilot generates a persistent **Ed25519 key pair** and writes it to:

```
apps/backend/data/device-identity.json
```

Path configurable via `OPENCLAW_DEVICE_IDENTITY_PATH` environment variable.

The **device ID** is a stable UUID generated once and stored in the same file.  
The **signature** covers the raw nonce bytes from the gateway's `connect.challenge` event, signed with Ed25519.

#### First-time connection flow (pairing)

```
client                                    gateway
  │──── WebSocket connect ──────────────────→│
  │←─── event: connect.challenge ───────────│  contains nonce
  │──── req: connect (device block) ────────→│
  │←─── close (1008: pairing required) ─────│  gateway registers pending request
  │                                          │
  │   [user runs: openclaw devices approve]  │
  │                                          │
  │──── WebSocket connect ──────────────────→│
  │←─── event: connect.challenge ───────────│
  │──── req: connect (device block) ────────→│
  │←─── res: connect { auth.deviceToken } ──│  ← save this token
  │──── req: <method> ──────────────────────→│
  │←─── res: <method> ──────────────────────│
  │──── close ──────────────────────────────→│
```

#### Subsequent connections (deviceToken in hand)

```
client                                    gateway
  │──── WebSocket connect ──────────────────→│
  │←─── event: connect.challenge ───────────│
  │──── req: connect (device + deviceToken) →│  auto-approved — no manual step
  │←─── res: connect ───────────────────────│
  │──── req: <method> ──────────────────────→│
  │←─── res: <method> ──────────────────────│
  │──── close ──────────────────────────────→│
```

The `deviceToken` is persisted in `data/device-identity.json` automatically after first approval. All future connections are auto-approved — no repeated manual step.

#### Approving a pairing request (one-time setup)

When the UI shows **"Pair Device"** in the header, SSH into the gateway machine and run:

```bash
openclaw devices list            # find the pending request for device claw-pilot
openclaw devices approve --latest  # approve it (or by ID if multiple are pending)
```

The UI banner shows the exact device ID to look for. Pending requests expire after ~5 minutes, but Claw-Pilot will automatically re-attempt the connection on the next health check (every 10 s) and create a new pending request if needed.

#### Useful device management commands

```bash
openclaw devices list --json               # machine-readable list
openclaw devices reject <requestId>        # reject a specific request
openclaw devices revoke --device <id> --role operator   # remove permanent access
openclaw devices rotate --device <id> --role operator   # issue a fresh deviceToken
```

### Connect Request Shape

After receiving the `connect.challenge` event, sign the nonce and send:

```json
{
  "type": "req",
  "id": "<uuid-v4>",
  "method": "connect",
  "params": {
    "minProtocol": 3,
    "maxProtocol": 3,
    "role": "operator",
    "scopes": [
      "operator.read",
      "operator.admin",
      "operator.approvals",
      "operator.pairing"
    ],
    "client": {
      "id": "gateway-client",
      "mode": "backend",
      "version": "1.0.0",
      "platform": "node"
    },
    "device": {
      "id": "<sha256-hex-of-raw-public-key>",
      "publicKey": "<base64url-no-padding-raw-32-byte-Ed25519-public-key>",
      "signature": "<base64url-no-padding-Ed25519-signature-over-canonical-payload>",
      "signedAt": 1700000000000,
      "nonce": "<nonce-from-connect.challenge-event>"
    },
    "auth": {
      "token": "<deviceToken-after-first-approval | OPENCLAW_GATEWAY_TOKEN-for-initial>"
    }
  }
}
```

Notes:
- `device` is always present. `auth.token` is the `deviceToken` (from the identity file) once pairing is complete, or `OPENCLAW_GATEWAY_TOKEN` (env var) for the initial connection attempt.
- `auth` may be omitted if neither token is set.
- `device.publicKey` is the raw 32-byte Ed25519 public key encoded as **base64url without padding** (not SPKI DER, not standard base64).
- `device.id` is `SHA-256(raw_public_key).hex()` — a 64-character hex string derived from the public key.
- The **signature canonical payload** is a pipe-delimited UTF-8 string signed with Ed25519:
  ```
  v2|{deviceId}|gateway-client|backend|operator|{scope1,scope2,...}|{signedAtMs}|{authToken}|{nonce}
  ```
  Where scopes are `operator.read,operator.admin,operator.approvals,operator.pairing` and `authToken` is the active auth token or empty string. The signature is returned as base64url without padding.
- This matches `build_device_auth_payload` in the OpenClaw Python client (`device_identity.py`).

On first successful connect after approval, the gateway response `payload.auth.deviceToken` is automatically saved to `data/device-identity.json`.

---

## Calling an RPC Method

After the `connect` handshake, send the method request in the same socket:

```json
{
  "type": "req",
  "id": "<uuid-v4>",
  "method": "sessions.patch",
  "params": {
    "key": "mc:lead-abc123:main",
    "label": "Board Lead"
  }
}
```

Await the matching `res` frame. On `ok: true`, the `payload` field contains the result. On `ok: false`, the `error.message` field describes the failure.

---

## Events

The gateway may push event frames at any time during the connection lifetime. The known event types are:

| Event | Description |
|-------|-------------|
| `connect.challenge` | Sent immediately after the WebSocket connection is established; contains `payload.nonce` for device signature |
| `agent` | Agent lifecycle or output event |
| `chat` | Incoming chat message from an agent |
| `presence` | Presence/online-status change |
| `tick` | Periodic heartbeat tick |
| `talk.mode` | Voice/talk mode state change |
| `shutdown` | Gateway is shutting down |
| `health` | Gateway health status change |
| `heartbeat` | Agent heartbeat event |
| `cron` | Cron job event |
| `node.pair.requested` | A node pairing request arrived |
| `node.pair.resolved` | A node pairing request was resolved |
| `node.invoke.request` | Request to invoke a node |
| `device.pair.requested` | A device pairing request arrived |
| `device.pair.resolved` | A device pairing request was resolved |
| `voicewake.changed` | Voice wake word config changed |
| `exec.approval.requested` | An execution step is awaiting approval |
| `exec.approval.resolved` | An execution approval was resolved |

---

## RPC Method Reference

The methods below are those actively used by Mission Control, with documented parameters.

### Health

#### `health`

Check gateway reachability. Returns a health summary.

```json
{ "params": {} }
```

---

### Sessions

#### `sessions.list`

List all active sessions on the gateway.

```json
{ "params": {} }
```

**Response `payload`**: array of session objects.

#### `sessions.patch`

Create or update a session (upsert by key).

```json
{
  "params": {
    "key": "mc:lead-<board-id>:main",
    "label": "Human-readable label"
  }
}
```

`label` is optional.

#### `sessions.reset`

Reset a session's context without deleting it.

```json
{
  "params": {
    "key": "mc:lead-<board-id>:main"
  }
}
```

#### `sessions.delete`

Delete a session permanently.

```json
{
  "params": {
    "key": "mc:lead-<board-id>:main"
  }
}
```

#### `sessions.preview`

Preview a session (see full catalogue — params gateway-defined).

#### `sessions.compact`

Compact a session's context (see full catalogue — params gateway-defined).

---

### Chat

#### `chat.send`

Deliver a message to an agent session.

```json
{
  "params": {
    "sessionKey": "mc:lead-<board-id>:main",
    "message": "Your message text",
    "deliver": false,
    "idempotencyKey": "<uuid-v4>"
  }
}
```

- `deliver`: when `true`, the message is delivered as a user-visible turn; when `false`, it is injected silently.
- `idempotencyKey`: ensures exactly-once delivery on retries.

#### `chat.history`

Fetch message history for a session.

```json
{
  "params": {
    "sessionKey": "mc:lead-<board-id>:main",
    "limit": 50
  }
}
```

`limit` is optional.

**Response `payload`**: object containing a `messages` array.

#### `chat.abort`

Abort a running chat turn (params gateway-defined).

---

### Agents

#### `agents.create`

Register a new agent on the gateway.

```json
{
  "params": {
    "name": "<agent-id>",
    "workspace": "/path/to/workspace"
  }
}
```

Returns an error if the agent ID already exists (Mission Control treats duplicate/conflict errors as non-fatal and falls through to `agents.update`).

#### `agents.update`

Update an existing agent's name and workspace path.

```json
{
  "params": {
    "agentId": "<agent-id>",
    "name": "<display-name>",
    "workspace": "/path/to/workspace"
  }
}
```

#### `agents.delete`

Delete an agent and optionally its files from disk.

```json
{
  "params": {
    "agentId": "<agent-id>",
    "deleteFiles": true
  }
}
```

#### `agents.list`

List all registered agents (no params in Mission Control usage).

---

### Agent Files

Agent files are Markdown documents (rendered from Jinja2 templates) that configure an agent's identity, memory, tools, etc. See [backend/templates/](../backend/templates/).

#### `agents.files.list`

List files attached to an agent.

```json
{
  "params": {
    "agentId": "<agent-id>"
  }
}
```

**Response `payload`**: `{ "files": [ { "name": "SOUL.md", ... }, ... ] }`

#### `agents.files.get`

Fetch the content of a specific agent file.

```json
{
  "params": {
    "agentId": "<agent-id>",
    "name": "SOUL.md"
  }
}
```

**Response `payload`**: `{ "content": "...", "name": "SOUL.md" }`

#### `agents.files.set`

Write or overwrite an agent file.

```json
{
  "params": {
    "agentId": "<agent-id>",
    "name": "SOUL.md",
    "content": "# Agent Soul\n..."
  }
}
```

#### `agents.files.delete`

Delete an agent file.

```json
{
  "params": {
    "agentId": "<agent-id>",
    "name": "SOUL.md"
  }
}
```

---

### Configuration

#### `config.get`

Read the full gateway configuration.

```json
{ "params": {} }
```

**Response `payload`**:

```json
{
  "hash": "<config-hash>",
  "config": { ... },
  "parsed": { ... }
}
```

Mission Control reads `payload.config` (or `payload.parsed`) to find `agents.list` and `channels` settings.

#### `config.patch`

Apply a JSON merge-patch to the gateway configuration.

```json
{
  "params": {
    "raw": "{\"agents\":{\"list\":[...]}}",
    "baseHash": "<hash-from-config.get>"
  }
}
```

- `raw`: a JSON string (not an object) containing the merge-patch.
- `baseHash`: optional; the hash from the most recent `config.get` response. When provided, the gateway applies optimistic locking — the patch is rejected if the config has changed since that hash was read.

---

## Full Method Catalogue

The following 86 method names are recognized by the gateway. Methods not covered in the reference section above have gateway-defined parameter and response shapes.

> Methods marked with ✓ are actively called by Mission Control.

| Method | Used |
|--------|------|
| `health` | ✓ |
| `logs.tail` | |
| `channels.status` | |
| `channels.logout` | |
| `status` | |
| `usage.status` | |
| `usage.cost` | |
| `tts.status` | |
| `tts.providers` | |
| `tts.enable` | |
| `tts.disable` | |
| `tts.convert` | |
| `tts.setProvider` | |
| `config.get` | ✓ |
| `config.set` | |
| `config.apply` | |
| `config.patch` | ✓ |
| `config.schema` | |
| `exec.approvals.get` | |
| `exec.approvals.set` | |
| `exec.approvals.node.get` | |
| `exec.approvals.node.set` | |
| `exec.approval.request` | |
| `exec.approval.resolve` | |
| `wizard.start` | |
| `wizard.next` | |
| `wizard.cancel` | |
| `wizard.status` | |
| `talk.mode` | |
| `models.list` | |
| `agents.list` | |
| `agents.create` | ✓ |
| `agents.update` | ✓ |
| `agents.delete` | ✓ |
| `agents.files.list` | ✓ |
| `agents.files.get` | ✓ |
| `agents.files.set` | ✓ |
| `agents.files.delete` | ✓ |
| `skills.status` | |
| `skills.bins` | |
| `skills.install` | |
| `skills.update` | |
| `update.run` | |
| `voicewake.get` | |
| `voicewake.set` | |
| `sessions.list` | ✓ |
| `sessions.preview` | |
| `sessions.patch` | ✓ |
| `sessions.reset` | ✓ |
| `sessions.delete` | ✓ |
| `sessions.compact` | |
| `last-heartbeat` | |
| `set-heartbeats` | |
| `wake` | |
| `node.pair.request` | |
| `node.pair.list` | |
| `node.pair.approve` | |
| `node.pair.reject` | |
| `node.pair.verify` | |
| `device.pair.list` | |
| `device.pair.approve` | |
| `device.pair.reject` | |
| `device.token.rotate` | |
| `device.token.revoke` | |
| `node.rename` | |
| `node.list` | |
| `node.describe` | |
| `node.invoke` | |
| `node.invoke.result` | |
| `node.event` | |
| `cron.list` | |
| `cron.status` | |
| `cron.add` | |
| `cron.update` | |
| `cron.remove` | |
| `cron.run` | |
| `cron.runs` | |
| `system-presence` | |
| `system-event` | |
| `send` | |
| `agent` | |
| `agent.identity.get` | |
| `agent.wait` | |
| `browser.request` | |
| `chat.history` | ✓ |
| `chat.abort` | |
| `chat.send` | ✓ |

The gateway may also expose additional methods at runtime via channel plugins — these are not part of the base catalogue.

---

## Session Key Conventions

Mission Control uses deterministic session key strings to identify agent sessions on the gateway:

| Agent type | Session key format |
|------------|--------------------|
| Gateway main agent | `mc-gateway:{gateway_id}:main` |
| Board lead agent | `mc:lead-{board_id}:main` |
| Board non-lead agent | `mc:mc-{agent_id}:main` |

The gateway main agent is also registered using the agent ID `mc-gateway-{gateway_id}` for RPC calls like `agents.create` and `agents.files.set`.

---

## Version Compatibility

Before provisioning agents, Mission Control reads the connect response's `server.version` field and compares it against a minimum CalVer version (default: `2026.1.30`, configurable via the `gateway_min_version` application setting).

If the gateway version is below the minimum, provisioning is refused with a descriptive error.

The version string is read from the `connect` response payload — the same response returned by the authentication handshake, before any additional RPC call.

---

## Related Docs

- [docs/openclaw_gateway_ws.md](openclaw_gateway_ws.md) — TLS configuration and gateway URL options
- [docs/openclaw_baseline_config.md](openclaw_baseline_config.md) — `openclaw.json` gateway settings reference (port, auth mode, bind address)
- [backend/app/services/openclaw/gateway_rpc.py](../backend/app/services/openclaw/gateway_rpc.py) — low-level WebSocket client; protocol constants and all RPC primitives
- [backend/app/services/openclaw/device_identity.py](../backend/app/services/openclaw/device_identity.py) — Ed25519 key pair lifecycle and connect-signature builder
- [backend/app/services/openclaw/provisioning.py](../backend/app/services/openclaw/provisioning.py) — agent lifecycle orchestration (create / update / file push / delete)
- [backend/app/services/openclaw/session_service.py](../backend/app/services/openclaw/session_service.py) — session listing, history, and message delivery for the API layer
- [backend/templates/](../backend/templates/) — Jinja2 templates rendered and pushed to agents via `agents.files.set`
