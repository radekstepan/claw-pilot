import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSocketChannel } from './websocket.js';
import { ChannelOpts } from './registry.js';
import { WebSocketServer, WebSocket } from 'ws';
import { logger } from '../logger.js';

vi.mock('ws', () => {
    const wsInstance = {
        on: vi.fn(),
        send: vi.fn(),
        ping: vi.fn(),
        close: vi.fn(),
        readyState: 1, // WebSocket.OPEN
    };
    const wssInstance = {
        on: vi.fn(),
        close: vi.fn(),
    };
    const WebSocketServer = vi.fn(function () {
        return wssInstance;
    });
    const WebSocket = function () { };
    Object.assign(WebSocket, {
        OPEN: 1,
        CLOSED: 3,
    });
    return {
        WebSocketServer,
        WebSocket,
        default: WebSocket,
        ...wsInstance,
    };
});

vi.mock('../logger.js', () => ({
    logger: {
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
    },
}));

describe('WebSocketChannel', () => {
    let channel: WebSocketChannel;
    let mockOpts: ChannelOpts;

    beforeEach(() => {
        vi.useFakeTimers();
        mockOpts = {
            onMessage: vi.fn(),
            onChatMetadata: vi.fn(),
            registeredGroups: vi.fn(() => ({})),
        };
        channel = new WebSocketChannel(mockOpts, 8080);
        vi.clearAllMocks();
    });

    afterEach(async () => {
        await channel.disconnect();
        vi.useRealTimers();
    });

    it('connects and initializes WebSocketServer', async () => {
        await channel.connect();
        expect(WebSocketServer).toHaveBeenCalledWith({ port: 8080 });
        expect(channel.isConnected()).toBe(true);
    });

    it('disconnects and clears ping intervals', async () => {
        await channel.connect();
        await channel.disconnect();
        expect(channel.isConnected()).toBe(false);
    });

    it('owns ws: JIDs', () => {
        expect(channel.ownsJid('ws:12345')).toBe(true);
        expect(channel.ownsJid('tg:12345')).toBe(false);
    });

    it('logs error when sending message to missing connection', async () => {
        await channel.connect();
        await channel.sendMessage('ws:nonexistent', 'hello');
        expect(logger.error).toHaveBeenCalledWith(
            { jid: 'ws:nonexistent' },
            '[WS] Failed to deliver response: connection closed or missing'
        );
    });

    it('logs error when sending error to missing connection', async () => {
        await channel.connect();
        await channel.sendError('ws:nonexistent', 'some error');
        expect(logger.error).toHaveBeenCalledWith(
            { jid: 'ws:nonexistent', error: 'some error' },
            '[WS] Failed to deliver error: connection closed or missing'
        );
    });
});
