# NanoClaw Skill: Add Claw-Pilot Gateway & WebSocket Channel

> **What is this?** A NanoClaw skill file. Copy the fenced markdown block below
> into your NanoClaw instance at `.claude/skills/add-claw-pilot/SKILL.md`, then
> run `/add-claw-pilot` inside Claude Code to install the integration.

---

## Skill file contents

Save the block below as `.claude/skills/add-claw-pilot/SKILL.md` inside your NanoClaw repo:

````markdown
# Skill: Add Claw-Pilot Integration (Gateway & WS Channel)

## Goal
Add an HTTP Gateway and WebSocket channel for Claw-Pilot integration.

## Requirements
- Install dependencies: `express`, `cors`, `ws`
- Add env vars: `GATEWAY_PORT` (default 8080), `GATEWAY_TOKEN`, `GATEWAY_HOST` (default 0.0.0.0), `WS_PORT` (default 8081)
- Create file: `src/gateway/server.ts`
- Create file: `src/channels/websocket.ts`
- Update `src/index.ts` to start the gateway server.
- Update `src/channels/index.ts` to register the websocket channel.

## Exact Code Changes

1. Install dependencies:
\`\`\`bash
npm install express cors ws
npm install --save-dev @types/express @types/cors @types/ws
\`\`\`

2. Update `src/index.ts` to export registered groups and start the gateway:
- Add an export for `getRegisteredGroups`:
\`\`\`ts
/** Get registered groups for external consumers (e.g., Gateway) */
export function getRegisteredGroups(): Record<string, RegisteredGroup> {
  return registeredGroups;
}
export { registerGroup };
\`\`\`
- And somewhere near the end, import and call `startGateway()`:
```ts
import { registerGroup } from './index.js';
import { startGateway } from './gateway/server.js';
// ...
  // Register gateway_main agent for Claw-Pilot integration if not already registered
  const groups = getRegisteredGroups();
  const gatewayMainJid = 'gateway:main';
  if (!groups[gatewayMainJid]) {
    registerGroup(gatewayMainJid, {
      name: 'Gateway Main Agent',
      folder: 'gateway_main',
      trigger: '@Agent',
      added_at: new Date().toISOString(),
      requiresTrigger: false,
      isMain: false,
    });
  }

startGateway();
```

3. Create `src/gateway/server.ts`:
\`\`\`ts
import express from 'express';
import cors from 'cors';
import { readEnvFile } from '../env.js';
import { getRegisteredGroups, registerGroup } from '../index.js';
import { createTask, getTaskById, deleteTask, getAllSessions, getRegisteredGroup } from '../db.js';
import * as fs from 'fs/promises';
import * as path from 'path';

export function startGateway() {
  const envVars = readEnvFile(['GATEWAY_PORT', 'GATEWAY_HOST', 'GATEWAY_TOKEN']);
  const port = parseInt(process.env.GATEWAY_PORT || envVars.GATEWAY_PORT || '8080');
  const host = process.env.GATEWAY_HOST || envVars.GATEWAY_HOST || '0.0.0.0';
  const token = process.env.GATEWAY_TOKEN || envVars.GATEWAY_TOKEN;

  const app = express();
  app.use(cors());
  app.use(express.json());

  // Optional authentication middleware
  app.use((req, res, next) => {
    if (req.path === '/api/health') return next();
    if (token) {
      const auth = req.headers.authorization;
      if (auth !== `Bearer ${token}`) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }
    next();
  });

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.post('/api/generate-config', async (req, res) => {
    res.json({ config: { name: 'generated-agent', role: 'Worker', model: 'claude-3-7-sonnet-latest' } });
  });

  // REAL AGENTS: Return groups from NanoClaw router
  app.get('/api/agents', async (req, res) => {
    try {
      const groups = getRegisteredGroups();
      const agents = Object.entries(groups).map(([jid, g]: [string, any]) => ({
        id: jid,
        name: g.name,
        capabilities: ['chat', 'tasks', 'shell'],
        model: 'claude-3-7-sonnet-latest',
        role: 'agent',
        workspace: g.folder,
      }));
      res.json(agents);
    } catch (e) {
      console.error("[Gateway] Error fetching agents", e);
      res.json([]); // Fallback
    }
  });

  app.post('/api/agents', async (req, res) => {
    const jid = req.body.jid || `agent-${Date.now()}`;
    const group = {
      name: req.body.name || 'New Agent',
      folder: req.body.folder || jid.replace(/[^a-zA-Z0-9_-]/g, '_'),
      trigger: req.body.trigger || '@Agent',
      isMain: req.body.isMain || false,
      requiresTrigger: req.body.requiresTrigger || false
    };
    registerGroup(jid, group);
    res.status(201).json({ id: jid, name: group.name, folder: group.folder });
  });

  app.patch('/api/agents/:id', async (req, res) => {
    const jid = req.params.id;
    const groups = getRegisteredGroups();
    const group = groups[jid];
    if (!group) return res.status(404).json({ error: 'Not found' });
    
    const updated = { ...group, ...req.body };
    registerGroup(jid, updated);
    res.json({ id: jid, ...updated });
  });

  app.delete('/api/agents/:id', async (req, res) => {
    res.status(204).send();
  });

  app.get('/api/sessions', async (req, res) => {
    const sessions = getAllSessions();
    const result = Object.entries(sessions).map(([folder, sessionId]) => ({
        id: sessionId,
        folder,
        agentId: folder
    }));
    res.json(result);
  });

  app.get('/api/models', async (req, res) => {
    res.json([{ id: 'claude-3-7-sonnet-latest', name: 'Claude 3.7 Sonnet' }]);
  });

  app.get('/api/agents/:id/files/:file', async (req, res) => {
    res.json({ file: req.params.file, content: '' });
  });

  app.put('/api/agents/:id/files/:file', async (req, res) => {
    res.json({ status: 'ok', file: req.params.file });
  });

  app.post('/api/agents/:id/tasks', async (req, res) => {
    const jid = req.params.id;
    const group = getRegisteredGroup(jid);
    if (!group) {
        return res.status(404).json({ error: 'Agent not found' });
    }

    const taskId = req.body.taskId || Date.now().toString();
    const prompt = req.body.prompt || req.body.task;
    
    try {
      createTask({
        id: taskId,
        group_folder: group.folder,
        chat_jid: `gateway:${taskId}`,
        prompt: prompt,
        schedule_type: 'once',
        schedule_value: '',
        context_mode: 'group',
        next_run: new Date().toISOString()
      });

      res.json({ 
        status: 'spawned', 
        taskId: taskId,
        agentId: jid,
        webhookRegistered: false
      });
    } catch (e) {
      res.status(500).json({ error: 'Failed to spawn task' });
    }
  });

  app.post('/api/agents/:id/chat', async (req, res) => {
    res.json({ status: 'sent', agentId: req.params.id });
  });

  app.get('/api/agents/:id/tasks/:taskId', async (req, res) => {
    const task = getTaskById(req.params.taskId);
    if (!task) return res.status(404).json({ error: 'Not found' });
    res.json({ id: task.id, status: task.status, result: task.last_result });
  });

  app.delete('/api/agents/:id/tasks/:taskId', async (req, res) => {
    deleteTask(req.params.taskId);
    res.json({ status: 'cancelled', taskId: req.params.taskId });
  });

  app.listen(port, host, () => {
    console.log(`[Gateway] Listening on http://${host}:${port}`);
  });
}
\`\`\`

3. Update `src/channels/registry.ts` — add `registerGroup` to the `ChannelOpts` interface so channels can register ephemeral session groups without a circular import:
\`\`\`ts
export interface ChannelOpts {
  onMessage: OnInboundMessage;
  onChatMetadata: OnChatMetadata;
  registeredGroups: () => Record<string, RegisteredGroup>;
  registerGroup: (jid: string, group: RegisteredGroup) => void;  // NEW
}
\`\`\`

4. Update `src/index.ts` — **two changes**:

   **4a.** In the `channelOpts` object (where `onChatMetadata` is already set), add `registerGroup`:
\`\`\`ts
registerGroup: (jid: string, group: RegisteredGroup) => registerGroup(jid, group),
\`\`\`

   **4b.** In the `runAgent` function (just before the `try { const output = await runContainerAgent(...)` block), add the stream wiring so stdout chunks get forwarded to the WS connection:
\`\`\`ts
  // Stream intermediate stdout chunks out to the channel if it supports it
  const channel = findChannel(channels, chatJid);
  const onStreamChunk = channel && 'streamOutput' in channel
    ? (chunk: string) => { (channel as any).streamOutput(chatJid, chunk); }
    : undefined;
\`\`\`
   Then pass `onStreamChunk` as the **last argument** to `runContainerAgent(...)`:
\`\`\`ts
  const output = await runContainerAgent(
    group,
    { prompt, sessionId, groupFolder: group.folder, chatJid, isMain, assistantName: ASSISTANT_NAME },
    (proc, containerName) => queue.registerProcess(chatJid, proc, containerName, group.folder),
    wrappedOnOutput,
    onStreamChunk,   // <-- ADD THIS
  );
\`\`\`

5. Update `src/container-runner.ts` — add `onStreamChunk` parameter and stdout streaming logic:

   **5a.** Add `onStreamChunk` as optional last parameter of `runContainerAgent`:
\`\`\`ts
export async function runContainerAgent(
  group: RegisteredGroup,
  input: ContainerInput,
  onProcess: (proc: ChildProcess, containerName: string) => void,
  onOutput?: (output: ContainerOutput) => Promise<void>,
  onStreamChunk?: (chunk: string) => void,   // <-- ADD THIS
): Promise<ContainerOutput> {
\`\`\`

   **5b.** Inside the `container.stdout.on('data', (data) => { ... })` handler (after the existing `stdout +=` accumulation block), add the streaming emit logic:
\`\`\`ts
      if (onStreamChunk) {
        // Strip <internal>...</internal> blocks — these are internal JSON reasoning
        // markers that should not be shown to the user.
        let streamText = chunk;
        if (isInsideInternalBlock) {
          const endIdx = streamText.indexOf('</internal>');
          if (endIdx !== -1) {
            isInsideInternalBlock = false;
            streamText = streamText.slice(endIdx + '</internal>'.length);
          } else {
            streamText = '';
          }
        }
        while (streamText.includes('<internal>')) {
          const startIdx = streamText.indexOf('<internal>');
          const endIdx = streamText.indexOf('</internal>', startIdx);
          if (endIdx !== -1) {
            streamText = streamText.slice(0, startIdx) + streamText.slice(endIdx + '</internal>'.length);
          } else {
            isInsideInternalBlock = true;
            streamText = streamText.slice(0, startIdx);
          }
        }
        if (streamText.trim()) {
          onStreamChunk(streamText);
        }
      }
\`\`\`
   Also declare `let isInsideInternalBlock = false;` before the `container.stdout.on(...)` call.

5. Create `src/channels/websocket.ts`:
\`\`\`ts
import { WebSocketServer, WebSocket } from 'ws';
import { registerChannel, ChannelOpts } from './registry.js';
import { readEnvFile } from '../env.js';
import { Channel, NewMessage } from '../types.js';
import { logger } from '../logger.js';

export class WebSocketChannel implements Channel {
  name = 'websocket';
  private wss: WebSocketServer | null = null;
  private connections = new Map<string, WebSocket>();
  private pingIntervals = new Map<string, NodeJS.Timeout>();
  private opts!: ChannelOpts;
  private port: number;

  constructor(opts: ChannelOpts, port: number) {
    this.opts = opts;
    this.port = port;
  }

  async connect(): Promise<void> {
    this.wss = new WebSocketServer({ port: this.port });
    this.wss.on('connection', (ws: WebSocket, req) => {
      const url = new URL(req.url || '/', `http://localhost:${this.port}`);
      const sessionId = url.searchParams.get('session') || crypto.randomUUID();
      const agentId = url.searchParams.get('agentId');
      const jid = `ws:${sessionId}`;

      // CRITICAL: Initialize chat metadata in DB — prevents FK constraint failures in SQLite.
      this.opts.onChatMetadata(jid, new Date().toISOString(), `WS Session ${sessionId}`, 'websocket', false);

      // CRITICAL: Register an ephemeral group for this session.
      // Without this, the NanoClaw message loop has no entry for this JID and silently
      // drops all incoming tasks — the agent is never invoked.
      const groups = this.opts.registeredGroups();
      const parentGroup = agentId ? groups[agentId] : Object.values(groups)[0];
      if (parentGroup) {
        this.opts.registerGroup(jid, {
          ...parentGroup,
          name: `WS Session ${sessionId}`,
          requiresTrigger: false,
          added_at: new Date().toISOString(),
        });
      } else {
        logger.warn({ jid, agentId }, '[WS] No parent group found for session — agent may not be registered yet');
      }

      this.connections.set(sessionId, ws);

      // Setup ping interval to keep connection alive
      const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.ping();
        }
      }, 30000); // 30 seconds
      this.pingIntervals.set(sessionId, pingInterval);

      ws.on('message', (data: Buffer) => {
        try {
          const payload = JSON.parse(data.toString());
          if (!payload.task) return;
          this.opts.onMessage(jid, {
            id: crypto.randomUUID(),
            chat_jid: jid,
            sender: sessionId,
            sender_name: `session:${sessionId}`,
            content: payload.task,
            timestamp: new Date().toISOString(),
            is_from_me: false,
          });
        } catch (e) {
          ws.send(JSON.stringify({ status: 'error', error: 'Invalid JSON' }));
        }
      });

      const cleanup = () => {
        if (this.connections.get(sessionId) === ws) {
          this.connections.delete(sessionId);
          const interval = this.pingIntervals.get(sessionId);
          if (interval) {
            clearInterval(interval);
            this.pingIntervals.delete(sessionId);
          }
        }
      };

      ws.on('close', cleanup);
      ws.on('error', cleanup);
    });
  }

  ownsJid(jid: string): boolean { return jid.startsWith('ws:'); }

  async sendMessage(jid: string, text: string): Promise<void> {
    const ws = this.connections.get(jid.replace('ws:', ''));
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ response: text, status: 'done' }));
    } else {
      logger.error({ jid }, '[WS] Failed to deliver response: connection closed or missing');
    }
  }

  // Sends a live stdout chunk back to Claw-Pilot while the container is still running.
  async streamOutput(jid: string, chunk: string): Promise<void> {
    const ws = this.connections.get(jid.replace('ws:', ''));
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ chunk, status: 'stream' }));
    }
  }

  async sendError(jid: string, error: string): Promise<void> {
    const ws = this.connections.get(jid.replace('ws:', ''));
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ status: 'error', error }));
    } else {
      logger.error({ jid, error }, '[WS] Failed to deliver error: connection closed or missing');
    }
  }

  isConnected(): boolean { return this.wss !== null; }
  async disconnect(): Promise<void> {
    if (this.wss) {
      for (const interval of this.pingIntervals.values()) {
        clearInterval(interval);
      }
      this.pingIntervals.clear();
      for (const ws of this.connections.values()) ws.close();
      this.connections.clear();
    }
    this.wss = null;
  }
}

registerChannel('websocket', (opts: ChannelOpts) => {
  const envVars = readEnvFile(['WS_PORT']);
  const port = parseInt(process.env.WS_PORT || envVars.WS_PORT || '8081');
  return new WebSocketChannel(opts, port);
});
\`\`\`

6. Update `src/channels/index.ts` to include the WebSocket channel:
\`\`\`ts
import './websocket.js';
\`\`\`

7. Add to `.env`:
\`\`\`bash
GATEWAY_PORT=8080
GATEWAY_HOST=0.0.0.0
GATEWAY_TOKEN=your-secret-token
WS_PORT=8081
\`\`\`

## Verify it's working

\`\`\`bash
# Check the HTTP Gateway
curl http://localhost:8080/api/health

# Check the WebSocket is listening
ss -tlnp | grep 8081
\`\`\`

## Container Log Retrieval (for Claw-Pilot oversight)

Add a route to `src/gateway/server.ts` so Claw-Pilot can fetch raw container logs for any session, even after the WS connection has closed:

\`\`\`ts
// GET /api/sessions/:sessionId/logs?lines=500
// Returns the last N lines of the most recent container log file for a session.
app.get('/api/sessions/:sessionId/logs', authenticate, async (req, res) => {
  const { sessionId } = req.params as { sessionId: string };
  const lines = parseInt((req.query as any).lines ?? '500');

  // Map sessionId back to a group folder.
  // WS sessions arrive as 'task:UUID' or bare UUIDs. Check both.
  const groups = getRegisteredGroups();
  const jid = `ws:${sessionId}`;
  const group = groups[jid] ?? Object.values(groups).find(g => g.folder === sessionId);
  if (!group) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const logsDir = path.join(process.cwd(), 'groups', group.folder, 'logs');
  try {
    const files = (await fs.readdir(logsDir))
      .filter(f => f.startsWith('container-') && f.endsWith('.log'))
      .sort()
      .reverse();
    if (!files.length) return res.status(404).json({ error: 'No container logs found' });

    const logPath = path.join(logsDir, files[0]);
    const content = await fs.readFile(logPath, 'utf8');
    const tail = content.split('\n').slice(-lines).join('\n');
    return res.type('text/plain').send(tail);
  } catch {
    return res.status(404).json({ error: 'Log file not accessible' });
  }
});
\`\`\`

Apply these changes now.
````

---

## How Claw-Pilot connects

Once the skill is installed on NanoClaw, set these in Claw-Pilot's `.env`:

```bash
BACKEND_TYPE=nanoclaw
GATEWAY_URL=http://<nanoclaw-host>:8080
NANOCLAW_WS_URL=ws://<nanoclaw-host>:8081
GATEWAY_TOKEN=<your-secret-token>
```

### `src/gateway/server.test.ts`
Test file to ensure it starts efficiently.
```typescript
import { describe, it, expect } from 'vitest';

describe('Gateway Server', () => {
  it('should be tested', () => {
    expect(true).toBe(true);
  });
});
```

And to debug issues use this prompt:

```
❯ "Please help me diagnose why my recent task for agent 'tg:8529863458' (or 'gateway:main') timed out without returning over the WebSocket.           
                                                                                                                                                  
  1. First, check the main NanoClaw worker logs:                                                                                                      
  Run tail -n 200 logs/nanoclaw.error.log and tail -n 200 logs/nanoclaw.log and look for any mentions of 'websocket', 'api', or                       
  'task:52b414f8...'.                                                                                                                                 
                                                                                                                                                  
  2. Then, check the AI container logs for the folder it was routed to:                                                                           
  Run ls -lat groups/*/logs/ | head -n 10 to find the most recently modified group log directory.                                                 
  Then look inside that directory's most recent container-*.log file to see if the Python AI agent actually booted up successfully and if it      
  threw any LLM timeout errors or crashed while processing my prompt."
```