import { WebSocketServer } from 'ws';
import { randomUUID } from 'crypto';

const port = process.env.PORT ? parseInt(process.env.PORT, 10) + 10000 : 18789; // Default openclaw gateway port

const wss = new WebSocketServer({ port });

console.log(`[mock-gateway] Listening on ws://localhost:${port}`);

wss.on('connection', (ws) => {
    // 1. Send challenge
    ws.send(JSON.stringify({
        type: 'event',
        event: 'connect.challenge',
        payload: { nonce: randomUUID() }
    }));

    ws.on('message', (raw) => {
        let frame;
        try { frame = JSON.parse(raw.toString()); } catch { return; }

        if (frame.type === 'req') {
            const reqId = frame.id;
            const method = frame.method;

            const reply = (payload) => {
                ws.send(JSON.stringify({ type: 'res', id: reqId, ok: true, payload }));
            };

            const fail = (message) => {
                ws.send(JSON.stringify({ type: 'res', id: reqId, ok: false, error: { message } }));
            };

            if (method === 'connect') {
                reply({ auth: { deviceToken: 'mock-token' } });
            } else if (method === 'config.get') {
                reply({
                    config: {
                        agents: [
                            { id: 'architect', name: 'Architect (Mock)', role: 'Lead AI', model: 'claude-sonnet-4', capabilities: ['planning', 'review'] },
                            { id: 'developer', name: 'Developer (Mock)', role: 'Worker AI', model: 'claude-sonnet-4', capabilities: ['coding', 'testing'] }
                        ]
                    }
                });
            } else if (method === 'sessions.list') {
                reply({
                    sessions: [
                        { agentId: 'architect', agent: 'architect', status: 'IDLE', key: 'session-001' },
                        { agentId: 'developer', agent: 'developer', status: 'WORKING', key: 'session-002' },
                    ]
                });
            } else if (method === 'sessions.patch') {
                reply({});
            } else if (method === 'chat.send') {
                setTimeout(() => {
                    reply({ message: `[mock-gateway] Received chat for session ${frame.params?.sessionKey}. Simulated response — no real LLM was invoked.` });
                }, 600);
            } else if (method === 'models.list') {
                reply({
                    models: [
                        { id: 'claude-sonnet-4', alias: 'sonnet', provider: 'anthropic', available: true },
                        { id: 'claude-opus-4', alias: 'opus', provider: 'anthropic', available: true },
                        { id: 'gpt-4o', alias: 'gpt4o', provider: 'openai', available: true },
                        { id: 'gemini-2.5-pro', alias: 'gemini', provider: 'google', available: false }
                    ]
                });
            } else {
                fail(`Unknown mock method: ${method}`);
            }
        }
    });
});
