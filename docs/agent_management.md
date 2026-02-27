**OpenClaw Agents Management Documentation**  
**Listing, Creating & Editing Agents** (February 2026)

This is a consolidated reference pulled directly from the official documentation:

- https://docs.openclaw.ai/concepts/multi-agent  
- https://docs.openclaw.ai/cli/agents  
- https://docs.openclaw.ai/gateway/configuration-reference  
- https://docs.openclaw.ai/gateway/configuration  

### 1. Overview
OpenClaw supports **multiple isolated agents** running side-by-side on one gateway.  
Each agent has:
- Its own workspace (`SOUL.md`, `AGENTS.md`, `USER.md`, skills, notes)
- Dedicated `agentDir` (auth profiles, model cache)
- Separate session store

The primary config lives in `~/.openclaw/openclaw.json` under `agents.list` and `bindings`.

### 2. Listing Agents

#### CLI (Recommended for humans)
```bash
openclaw agents list                # basic list
openclaw agents list --bindings     # shows routing rules too
openclaw agents list --json         # machine-readable
```

#### Via WebSocket RPC (for your custom client)
Use **`config.get`**:

**Request**
```json
{
  "type": "req",
  "id": "list-agents",
  "method": "config.get",
  "params": {}
}
```

**Successful Response**
```json
{
  "type": "res",
  "id": "list-agents",
  "ok": true,
  "payload": {
    "hash": "sha256-abc123def4567890...",   // ← save this for edits
    "value": {
      "agents": {
        "list":[
          {
            "id": "main",
            "default": true,
            "name": "Main Agent",
            "workspace": "~/.openclaw/workspace",
            "agentDir": "~/.openclaw/agents/main/agent",
            "identity": { "name": "Samantha", ... },
            "sandbox": { "mode": "off" },
            ...
          },
          {
            "id": "work",
            "name": "Work Assistant",
            "workspace": "~/.openclaw/workspace-work",
            ...
          }
        ]
      }
    }
  }
}
```

**Required scopes**: `operator.read` or `operator.config`

### 3. Creating a New Agent

#### CLI (Recommended – does everything automatically)
```bash
openclaw agents add <id>

# Full options
openclaw agents add work \
  --workspace ~/.openclaw/workspace-work \
  --name "Work Assistant" \
  --description "Handles work tasks, calendar, emails"
```

This command:
- Adds the entry to `agents.list`
- Creates the workspace folder + template files (`SOUL.md`, `AGENTS.md`, etc.)
- Creates `~/.openclaw/agents/<id>/agent` directory
- Hot-reloads the router

#### Via WebSocket RPC (`config.patch`)
There is **no** `agents.add` RPC. You must edit the config manually.

**Step-by-step:**

1. **Get current config + hash**
   ```json
   { "method": "config.get", "params": {} }
   ```

2. **Patch to add new agent** (use `raw` as JSON5 string)
   ```json
   {
     "type": "req",
     "id": "add-agent",
     "method": "config.patch",
     "params": {
       "baseHash": "sha256-abc123def4567890...",
       "raw": "{\"agents\":{\"list\":[ /* keep ALL existing agents here */, {\"id\":\"work\",\"name\":\"Work Assistant\",\"workspace\":\"~/.openclaw/workspace-work\",\"default\":false}]}}"
     }
   }
   ```

**Important**: After the patch you must still create the workspace folder + templates (the RPC does **not** do this).  
Recommended way inside your WS client:
- Use `exec.shell` or `exec.run` tool to run:
  ```bash
  mkdir -p ~/.openclaw/workspace-work
  cp -r ~/.openclaw/workspace/.openclaw/templates/* ~/.openclaw/workspace-work/ || true
  ```

### 4. Editing / Updating Agents

Use the same **`config.patch`** (or `config.apply` for full replace).

#### Examples

**Change name & identity**
```json
{
  "method": "config.patch",
  "params": {
    "baseHash": "<hash-from-get>",
    "raw": "{\"agents\":{\"list\":[ { \"id\": \"main\", ... }, { \"id\": \"work\", \"name\": \"Operations Bot\", \"identity\": { \"name\": \"Max\", \"emoji\": \"robot\", \"theme\": \"professional\" } } ]}}"
  }
}
```

**Add per-agent sandbox / tool restrictions**
```json
"raw": "{\"agents\":{\"list\":[ ..., { \"id\": \"work\", \"sandbox\": { \"mode\": \"all\", \"scope\": \"agent\" }, \"tools\": { \"allow\": [\"read\", \"exec\"], \"deny\":[\"browser\", \"canvas\"] } } ]}}"
```

Changes to `agents.list` and `bindings` are **hot-reloaded** instantly (no gateway restart needed in most cases).

### 5. Rate Limits & Best Practices (WS)
- All write RPCs (`config.patch`, `config.apply`) are limited to **3 writes per 60 seconds** per device+IP.
- Always use the `baseHash` from `config.get` to prevent race conditions.
- Never reuse the same `agentDir` across agents.
- Test routing after changes:
  ```bash
  openclaw agents list --bindings
  openclaw channels status --probe
  ```

### 6. Full Schema Snippet (from configuration-reference)
```json
{
  "agents": {
    "list":[
      {
        "id": "string",
        "default": true,
        "name": "string",
        "workspace": "string",
        "agentDir": "string",
        "model": "string",
        "identity": { ... },
        "sandbox": { ... },
        "tools": { "allow": [], "deny":[], ... },
        "groupChat": { "mentionPatterns": [] }
      }
    ]
  },
  "bindings":[
    {
      "agentId": "string",
      "match": {
        "channel": "string",
        "accountId": "string",
        "peer": { ... }
      }
    }
  ]
}
```

You now have **complete, production-ready documentation** for listing, creating, and editing agents — both via CLI (easiest) and via WebSocket RPC (for your custom controller).
