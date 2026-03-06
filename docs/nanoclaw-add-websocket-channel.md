# NanoClaw Skill: Add WebSocket Channel for Claw-Pilot

> **What is this?** A NanoClaw skill file. Copy the fenced markdown block below
> into your NanoClaw instance at `.claude/skills/add-websocket/SKILL.md`, then
> run `/add-websocket` inside Claude Code to install the channel.
>
> This is the **server side** of the integration. Claw-Pilot's
> `NanoClawChannelClient` (in `packages/nanoclaw-gateway`) is the client side.

---

## Skill file contents

Save the block below as `.claude/skills/add-websocket/SKILL.md` inside your
NanoClaw repo:

````markdown
# Skill: Add WebSocket Channel (Claw-Pilot Integration)

## Goal
Add a new channel called "websocket" that exposes a WebSocket server. External
clients (Claw-Pilot) connect, send tasks, and receive responses/errors in real
time over the same connection. It integrates with the existing Channel
abstraction exactly like Telegram or WhatsApp.

## Requirements
- Install dependency: `ws` (lightweight WebSocket library)
- Add env var: `WS_PORT` (default 8080)
- Create file: `src/channels/websocket.ts`
- Register it so it appears in the channel registry
- Support JSON protocol:
  - Client → Server: `{ "task": "string", "sessionId": "string" }`
  - Server → Client: `{ "response": "string", "status": "done" }` on success
  - Server → Client: `{ "error": "string", "status": "error" }` on failure
- Each WS connection maps to a virtual JID `ws:<sessionId>`
- Use the ChannelOpts callbacks for incoming messages
- Support multiple simultaneous clients
- Graceful shutdown on connect() error

## Important Fixes / Lessons Learned

1. **Import requires `.js` extension** — TypeScript ESM requires explicit `.js` extension in imports. Without it, the compiled JS fails with `ERR_MODULE_NOT_FOUND`.

2. **Use `readEnvFile` for environment variables** — Don't use `process.env.WS_PORT` directly. Systemd services don't inherit shell environment variables; use NanoClaw's `readEnvFile` helper instead.

```ts
import { readEnvFile } from '../env.js';

const envVars = readEnvFile(['WS_PORT']);
const port = parseInt(process.env.WS_PORT || envVars.WS_PORT || '8080');

if (!envVars.WS_PORT && !process.env.WS_PORT) {
  // skip channel
}
```

3. **Install missing build dependencies** — If build fails with missing `grammy`, run `npm install grammy` first. This is a pre-existing issue with the Telegram channel dependency.

## Exact Code Changes

1. Install dependencies:
```bash
npm install ws
npm install --save-dev @types/ws
npm install grammy  # only if build fails
```

2. Create `src/channels/websocket.ts`:

```ts
import { WebSocketServer, WebSocket } from 'ws';
import { registerChannel, ChannelOpts } from './registry.js';
import { readEnvFile } from '../env.js';
import { Channel, NewMessage } from '../types.js';

export class WebSocketChannel implements Channel {
  name = 'websocket';
  private wss: WebSocketServer | null = null;
  private connections = new Map<string, WebSocket>(); // sessionId → ws
  private opts!: ChannelOpts;
  private port: number = 8080;

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
      console.log(`[WS] Client connected: ${jid}`);

      ws.on('message', (data: Buffer) => {
        try {
          const payload = JSON.parse(data.toString());
          if (!payload.task) return;

          const message: NewMessage = {
            id: crypto.randomUUID(),
            chat_jid: jid,
            sender: sessionId,
            sender_name: `session:${sessionId}`,
            content: payload.task,
            timestamp: new Date().toISOString(),
            is_from_me: false,
          };

          this.opts.onMessage(jid, message);
        } catch (e) {
          ws.send(JSON.stringify({ status: 'error', error: 'Invalid JSON' }));
        }
      });

      ws.on('close', () => {
        this.connections.delete(sessionId);
        console.log(`[WS] Client disconnected: ${jid}`);
      });

      ws.on('error', (err) => {
        console.error(`[WS] Socket error for ${jid}:`, err.message);
        this.connections.delete(sessionId);
      });
    });

    this.wss.on('error', (err) => {
      console.error('[WS] Server error:', err.message);
    });
    console.log(`[WS] Server listening on ws://localhost:${this.port}`);
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('ws:');
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    const sessionId = jid.replace('ws:', '');
    const ws = this.connections.get(sessionId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ response: text, status: 'done' }));
    }
  }

  async sendError(jid: string, error: string): Promise<void> {
    const sessionId = jid.replace('ws:', '');
    const ws = this.connections.get(sessionId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ status: 'error', error }));
    }
  }

  isConnected(): boolean {
    return this.wss !== null;
  }

  async disconnect(): Promise<void> {
    if (this.wss) {
      // Close all client connections
      for (const ws of Array.from(this.connections.values())) {
        ws.close();
      }
      this.connections.clear();
      this.wss.close();
      this.wss = null;
      console.log('[WS] Server stopped');
    }
  }
}

registerChannel('websocket', (opts: ChannelOpts) => {
  const envVars = readEnvFile(['WS_PORT']);
  const port = parseInt(process.env.WS_PORT || envVars.WS_PORT || '8080');

  if (!envVars.WS_PORT && !process.env.WS_PORT) {
    console.warn('[WS] WS_PORT not set - skipping WebSocket channel');
    return null;
  }
  return new WebSocketChannel(opts, port);
});
```

3. Update `src/channels/index.ts` - use `.js` extension:

```ts
import './websocket.js'; // ← note the .js extension
```

4. Add to `.env`:
```bash
WS_PORT=8080
```

5. Build and restart:
```bash
npm run build
systemctl --user restart nanoclaw
```

## Verify it's working

```bash
# Check the WebSocket is listening
ss -tlnp | grep 8080

# Or test with a client
wscat -c ws://localhost:8080?session=test
```

## Troubleshooting

**"No channels connected" fatal error:**
- Check that `.env` contains `WS_PORT=8080`
- Verify port is listening: `ss -tlnp | grep 8080`

**Build fails with "Cannot find module 'grammy'":**
- Run `npm install grammy` (pre-existing dependency issue)

**Import error "ERR_MODULE_NOT_FOUND":**
- Make sure import in `index.ts` has `.js` extension: `import './websocket.js'`

## Protocol summary

```
Claw-Pilot (client)                    NanoClaw (server)
─────────────────                      ─────────────────
ws connect ?session=task:42   ──────►  register jid ws:task:42
{ task: "do X", sessionId }   ──────►  onIncomingMessage → agent
                              ◄──────  { response: "done!", status: "done" }
                              ◄──────  { error: "oops", status: "error" }
```

## Security notes
- This channel is for local/self-hosted use behind a private network or VPN.
- For production: check `Authorization` header or `?token=` query param on
  connection to authenticate Claw-Pilot.

Apply these changes now.
````

---

## How Claw-Pilot connects

Once the skill is installed on NanoClaw, set these in Claw-Pilot's `.env`:

```bash
BACKEND_TYPE=nanoclaw
GATEWAY_URL=ws://<nanoclaw-host>:8080
GATEWAY_TOKEN=<optional-token>
```

Claw-Pilot's `NanoClawChannelClient` will connect and send tasks/chat over
the WebSocket. The HTTP REST endpoints (agents CRUD, files, models) still use
the same host on NanoClaw's regular HTTP port.
