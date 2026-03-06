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
      const jid = `ws:${sessionId}`;

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
