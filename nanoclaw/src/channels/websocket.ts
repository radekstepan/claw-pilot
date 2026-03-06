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
    }
    this.wss = null;
  }
}
