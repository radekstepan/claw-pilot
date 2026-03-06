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
\`\`\`
- And somewhere near the end, import and call `startGateway()`:
\`\`\`ts
import { startGateway } from './gateway/server.js';
// ...
startGateway();
\`\`\`

3. Create `src/gateway/server.ts`:
\`\`\`ts
import express from 'express';
import cors from 'cors';
import { readEnvFile } from '../env.js';
import { getRegisteredGroups } from '../index.js';
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
      const agents = Object.values(groups).map((g: any) => ({
        id: g.jid,
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
    // Register a new agent
    res.status(201).json({ id: req.body.jid || 'new-agent', name: req.body.name });
  });

  app.patch('/api/agents/:id', async (req, res) => {
    res.json({ id: req.params.id, ...req.body });
  });

  app.delete('/api/agents/:id', async (req, res) => {
    res.status(204).send();
  });

  app.get('/api/sessions', async (req, res) => {
    res.json([]);
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
    res.json({ 
      status: 'spawned', 
      taskId: req.body.taskId || Date.now().toString(),
      agentId: req.params.id,
      webhookRegistered: !!req.body.webhook
    });
  });

  app.post('/api/agents/:id/chat', async (req, res) => {
    res.json({ status: 'sent', agentId: req.params.id });
  });

  app.get('/api/agents/:id/tasks/:taskId', async (req, res) => {
    res.json({ id: req.params.taskId, status: 'running' });
  });

  app.delete('/api/agents/:id/tasks/:taskId', async (req, res) => {
    res.json({ status: 'cancelled', taskId: req.params.taskId });
  });

  app.listen(port, host, () => {
    console.log(`[Gateway] Listening on http://${host}:${port}`);
  });
}
\`\`\`

3. Create `src/channels/websocket.ts`:
\`\`\`ts
import { WebSocketServer, WebSocket } from 'ws';
import { registerChannel, ChannelOpts } from './registry.js';
import { readEnvFile } from '../env.js';
import { Channel, NewMessage } from '../types.js';

export class WebSocketChannel implements Channel {
  name = 'websocket';
  private wss: WebSocketServer | null = null;
  private connections = new Map<string, WebSocket>();
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
      const jid = `ws:${sessionId}`;

      this.connections.set(sessionId, ws);
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

      ws.on('close', () => this.connections.delete(sessionId));
      ws.on('error', () => this.connections.delete(sessionId));
    });
  }

  ownsJid(jid: string): boolean { return jid.startsWith('ws:'); }

  async sendMessage(jid: string, text: string): Promise<void> {
    const ws = this.connections.get(jid.replace('ws:', ''));
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ response: text, status: 'done' }));
    }
  }

  async sendError(jid: string, error: string): Promise<void> {
    const ws = this.connections.get(jid.replace('ws:', ''));
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ status: 'error', error }));
    }
  }

  isConnected(): boolean { return this.wss !== null; }
  async disconnect(): Promise<void> {
    if (this.wss) {
      for (const ws of this.connections.values()) ws.close();
      this.connections.clear();
      this.wss.close();
      this.wss = null;
    }
  }
}

registerChannel('websocket', (opts: ChannelOpts) => {
  const envVars = readEnvFile(['WS_PORT']);
  const port = parseInt(process.env.WS_PORT || envVars.WS_PORT || '8081');
  return new WebSocketChannel(opts, port);
});
\`\`\`

4. Update `src/channels/index.ts` to include the WebSocket channel:
\`\`\`ts
import './websocket.js';
\`\`\`

5. Add to `.env`:
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
