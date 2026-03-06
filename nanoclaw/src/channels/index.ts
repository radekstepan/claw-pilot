// Channel self-registration barrel file.
// Each import triggers the channel module's registerChannel() call.

// discord

// gmail

// slack

// telegram

// whatsapp

// websocket
import { registerChannel } from './registry.js';
import { WebSocketChannel } from './websocket.js';

registerChannel('websocket', (opts) => {
  return new WebSocketChannel(opts, parseInt(process.env.WS_PORT || '8081'));
});
