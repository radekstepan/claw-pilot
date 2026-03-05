# @claw-pilot/nanoclaw-gateway

HTTP client for interfacing with NanoClaw devices. This package allows claw-pilot to connect to remote NanoClaw instances via their exposed Gateway API.

## Prerequisites

Before using this client, ensure your NanoClaw instance has the Gateway enabled:

1. **Install the gateway skill on NanoClaw:**
   ```bash
   # On your NanoClaw machine
   npx tsx scripts/apply-skill.ts .claude/skills/add-nanoclaw-gateway
   npm install express cors
   npm run build
   ```

2. **Configure NanoClaw environment (`.env`):**
   ```bash
   GATEWAY_ENABLED=true
   GATEWAY_PORT=8080
   GATEWAY_HOST=0.0.0.0
   GATEWAY_TOKEN=your-secret-token-here
   ```

3. **Restart NanoClaw:**
   ```bash
   # macOS
   launchctl kickstart -k gui/$(id -u)/com.nanoclaw

   # Linux
   systemctl --user restart nanoclaw
   ```

## Installation

```bash
npm install @claw-pilot/nanoclaw-gateway
```

## Usage

### Initialize the client

```typescript
import { NanoClawClient } from '@claw-pilot/nanoclaw-gateway';

const client = new NanoClawClient(
  'http://192.168.1.100:8080',  // Your NanoClaw device URL
  'your-secret-token-here'       // GATEWAY_TOKEN from NanoClaw .env
);
```

### Creating Agents

The client supports two formats for creating agents:

#### Option 1: Claw-pilot Abstraction (Recommended)

Use familiar claw-pilot concepts like `workspace`, `model`, and `capabilities`. The client will automatically translate these to NanoClaw's internal format.

```typescript
const agent = await client.createAgent({
  name: 'Production Agent',
  workspace: 'production',
  model: 'claude-sonnet-4-6',
  capabilities: ['code', 'browser', 'shell']
});

// This automatically generates:
// - jid: "cp-production-sonnet-4-6@claw-pilot"
// - folder: "claw_production"
// - trigger: "@code-browser-shell"
```

#### Option 2: NanoClaw-Native Format

If you need full control, you can provide NanoClaw-specific fields directly:

```typescript
const agent = await client.createAgent({
  jid: 'tg:123456789',
  name: 'My Telegram Chat',
  folder: 'telegram_main',
  trigger: '@Andy',
  isMain: true,
  requiresTrigger: false
});
```

### Updating Agents

The same dual-format support applies to updates:

```typescript
// Using claw-pilot abstraction
await client.updateAgent('agent-id', {
  name: 'Updated Name',
  workspace: 'staging',
  capabilities: ['fs', 'net']
});

// Using NanoClaw-native format
await client.updateAgent('agent-id', {
  name: 'Updated Name',
  folder: 'new_folder',
  trigger: '@NewTrigger'
});
```

### Messaging

```typescript
// Send a message to an agent
await client.sendMessage('tg:123456789', 'Hello from claw-pilot!');
```

### Tasks

```typescript
// Spawn a task with webhook callback
await client.spawnTask(
  'tg:123456789',           // agentId
  'task-001',               // taskId
  'Analyze this code...',   // prompt
  {                          // optional webhook
    url: 'https://claw-pilot.example.com/webhook',
    headers: { 'X-API-Key': 'secret' }
  }
);

// Get task status
const task = await client.getTask('tg:123456789', 'task-001');

// Cancel a task
await client.cancelTask('tg:123456789', 'task-001');
```

### Files

```typescript
// Read a file from agent's group folder
const file = await client.getAgentFile('tg:123456789', 'CLAUDE.md');

// Write a file to agent's group folder
await client.setAgentFile('tg:123456789', 'notes.txt', 'Content here');
```

### Sessions

```typescript
// Get all session IDs
const sessions = await client.getSessions();
```

### Health Check

```typescript
// Check if NanoClaw gateway is reachable
const health = await client.healthCheck();
console.log(health.status); // "ok"
```

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `getAgents()` | `GET /api/agents` | List registered groups |
| `createAgent(data)` | `POST /api/agents` | Register a group |
| `updateAgent(id, data)` | `PATCH /api/agents/:id` | Update a group |
| `deleteAgent(id)` | `DELETE /api/agents/:id` | Unregister a group |
| `sendMessage(id, msg)` | `POST /api/agents/:id/chat` | Send message via IPC |
| `spawnTask(id, taskId, prompt, webhook?)` | `POST /api/agents/:id/tasks` | Spawn task |
| `getTask(id, taskId)` | `GET /api/agents/:id/tasks/:taskId` | Get task status |
| `cancelTask(id, taskId)` | `DELETE /api/agents/:id/tasks/:taskId` | Cancel task |
| `getAgentFile(id, file)` | `GET /api/agents/:id/files/:file` | Read file |
| `setAgentFile(id, file, content)` | `PUT /api/agents/:id/files/:file` | Write file |
| `getSessions()` | `GET /api/sessions` | Get session IDs |
| `getModels()` | `GET /api/models` | List available models |
| `generateConfig(prompt, model?)` | `POST /api/generate-config` | Generate config |
| `healthCheck()` | `GET /api/health` | Health check (no auth) |

## Field Translation

When using the claw-pilot abstraction format, fields are translated as follows:

| Claw-pilot Field | Translates To | Example |
|-----------------|---------------|---------|
| `workspace` | `folder` prefix | `production` → `claw_production` |
| `model` | Part of `jid` | `claude-sonnet-4-6` → `cp-...-sonnet-4-6@claw-pilot` |
| `capabilities` | `trigger` | `['code', 'browser']` → `@code-browser` |
| `name` | `name` | (passed through) |

## Webhook Callbacks

When spawning a task with a webhook, NanoClaw will POST to your webhook URL upon task completion:

```json
{
  "type": "task_completed",
  "taskId": "task-001",
  "groupFolder": "telegram_main",
  "chatJid": "tg:123456789",
  "status": "success",
  "result": "Task completed successfully",
  "timestamp": "2026-03-05T12:00:00.000Z"
}
```

## Error Handling

```typescript
try {
  await client.getAgents();
} catch (err) {
  if (err.name === 'NetworkError') {
    // Connection failed
  } else if (err.message.includes('401')) {
    // Invalid token
  } else {
    // API error
  }
}
```

## Security

- Always use HTTPS in production
- Keep your `GATEWAY_TOKEN` secret
- Restrict `GATEWAY_HOST` to specific interfaces if needed
- Use firewall rules to limit access to the gateway port

## Testing

```bash
# Run tests
npm test

# Build
npm run build
```
