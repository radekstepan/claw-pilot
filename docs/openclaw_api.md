# OpenClaw Gateway RPC API

This document describes how Claw-Pilot communicates with the OpenClaw gateway. All communication uses **WebSocket RPC** — there is no REST HTTP client for the gateway. Every call opens a fresh WebSocket connection, performs a challenge/response authentication handshake, sends one RPC method request, reads the response, and closes.

## Table of Contents

- [Connection Overview](#connection-overview)
- [Authentication (Device Pairing)](#authentication-device-pairing)
- [Wire Protocol](#wire-protocol)
- [Agent Management](#agent-management)
-[Agent Files](#agent-files)
- [Task Routing & Chat](#task-routing--chat)
-[System & Config](#system--config)

---

## Connection Overview

The OpenClaw gateway exposes a WebSocket server, default port **18789**.

| Scheme | Example URL |
|--------|-------------|
| Plaintext | `ws://localhost:18789` |
| TLS | `wss://localhost:18789` |

Each RPC call follows this lifecycle:

```text
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

## Authentication (Device Pairing)

Claw-Pilot uses **Mode A (Device Pairing)** — the gateway's standard authentication flow for all operator clients. 

On first startup, Claw-Pilot generates a persistent **Ed25519 key pair** and writes it to:
`apps/backend/data/device-identity.json`

The **device ID** is a stable UUID generated once. The **signature** covers the raw nonce bytes from the gateway's `connect.challenge` event, signed with Ed25519.

### First-time connection flow (pairing)

```text
client                                    gateway
  │──── WebSocket connect ──────────────────→│
  │←─── event: connect.challenge ───────────│  contains nonce
  │──── req: connect (device block) ────────→│
  │←─── close (1008: pairing required) ─────│  gateway registers pending request
  │                                          │
  │[user runs: openclaw devices approve]  │
  │                                          │
  │──── WebSocket connect ──────────────────→│
  │←─── event: connect.challenge ───────────│
  │──── req: connect (device block) ────────→│
  │←─── res: connect { auth.deviceToken } ──│  ← save this token
  │──── req: <method> ──────────────────────→│
  │←─── res: <method> ──────────────────────│
  │──── close ──────────────────────────────→│
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
    "scopes":["operator.read", "operator.admin", "operator.approvals", "operator.pairing"],
    "client": {
      "id": "gateway-client",
      "mode": "backend",
      "version": "1.0.0",
      "platform": "node"
    },
    "caps": [],
    "commands":[],
    "permissions": {},
    "locale": "en-US",
    "userAgent": "claw-pilot/1.0.0",
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
  "error": { "message": "Human-readable error description" }
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

---

## Agent Management

Claw-Pilot orchestrates agents via the gateway. See `apps/backend/src/openclaw/cli.ts` for implementation.

### List Agents
`config.get`
Returns the full gateway config. Claw-Pilot parses `payload.config.agents.list` to extract agents. It combines this with `sessions.list` to determine if an agent is `WORKING`, `IDLE`, or `OFFLINE`.

### Create Agent
1. `agents.create` (registers the agent and scaffolds its directory):
```json
{
  "params": {
    "name": "data-viz-expert",
    "workspace": "~/.openclaw/workspace/data-viz-expert"
  }
}
```
2. `config.get` (fetch `baseHash`)
3. `config.patch` (to add `model` and `tools.allow` [capabilities]):
```json
{
  "params": {
    "baseHash": "<hash>",
    "raw": "{\"agents\":{\"list\":[...updated list...]}}"
  }
}
```

### Update Agent
1. `agents.update` (to change name/workspace):
```json
{
  "params": {
    "agentId": "data-viz-expert",
    "name": "Data Expert",
    "workspace": "~/.openclaw/workspace/data-viz-expert"
  }
}
```
2. `config.patch` (to update model/capabilities, using `config.get` first for the `baseHash`).

### Delete Agent
`agents.delete`
```json
{
  "params": {
    "agentId": "data-viz-expert",
    "deleteFiles": true
  }
}
```

---

## Agent Files

Agent files (`SOUL.md`, `TOOLS.md`, `AGENTS.md`) define behavior and capabilities.

### List Files
`agents.files.list`
```json
{
  "params": { "agentId": "data-viz-expert" }
}
```

### Get File
`agents.files.get`
```json
{
  "params": { "agentId": "data-viz-expert", "name": "SOUL.md" }
}
```

### Set File
`agents.files.set`
```json
{
  "params": { 
    "agentId": "data-viz-expert", 
    "name": "SOUL.md",
    "content": "You are a data visualization expert..."
  }
}
```

---

## Task Routing & Chat

Mission Control routes tasks to agents and sends chat messages using sessions.

### Session Keys

Claw-Pilot uses deterministic session key strings to identify agent sessions on the gateway:

| Agent type | Session key format |
|------------|--------------------|
| Gateway main agent | `mc-gateway:{OPENCLAW_GATEWAY_ID}:main` |
| Agent Chat Session | `mc:mc-{agent_id}:main` |
| Task Session       | `task-{taskId}` |

### Send Chat Message
1. `sessions.patch`: Ensure the session exists.
```json
{
  "params": { "key": "mc:mc-coder:main" }
}
```
2. `chat.send`: Send the message.
```json
{
  "params": {
    "sessionKey": "mc:mc-coder:main",
    "message": "Hello!",
    "deliver": false,
    "idempotencyKey": "<uuid>"
  }
}
```

### Spawn Task Session (Route Task)
When routing a Kanban task to an agent, Claw-Pilot creates an isolated session for that specific task:
1. `sessions.patch`: `key` is `task-{taskId}`, `label` is `task-{taskId}`.
2. `chat.send`: The prompt includes the task description and callback instructions. `deliver: true` is used to trigger the agent's work loop immediately.

---

## System & Config

### Gateway Health
`health`
```json
{ "params": {} }
```

### Active Sessions
`sessions.list`
```json
{ "params": {} }
```

### Available Models
`models.list`
```json
{ "params": {} }
```
