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
                const path = frame.params?.path;
                const mockList = [
                    { id: 'main', default: true, name: 'Personal Assistant', workspace: '~/.openclaw/workspace' },
                    { id: 'architect', name: 'Architect (Mock)', role: 'Lead AI', model: 'claude-sonnet-4', capabilities: ['planning', 'review'] },
                    { id: 'developer', name: 'Developer (Mock)', role: 'Worker AI', model: 'claude-sonnet-4', capabilities: ['coding', 'testing'] }
                ];

                if (path === 'agents.list') {
                    reply({
                        hash: 'mock-hash-123',
                        value: mockList
                    });
                } else if (path === 'agents') {
                    reply({
                        hash: 'mock-hash-123',
                        value: { list: mockList }
                    });
                } else {
                    // root
                    reply({
                        hash: 'mock-hash-123',
                        value: {
                            agents: {
                                list: mockList
                            }
                        }
                    });
                }
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
                        { id: 'claude-sonnet-4', name: 'Claude Sonnet 4', alias: 'sonnet', provider: 'anthropic', available: true },
                        { id: 'claude-opus-4', name: 'Claude Opus 4', alias: 'opus', provider: 'anthropic', available: true },
                        { id: 'gpt-4o', name: 'GPT-4o', alias: 'gpt4o', provider: 'openai', available: true },
                        { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', alias: 'gemini', provider: 'google', available: false }
                    ]
                });
            } else if (method === 'config.patch') {
                const { baseHash, raw } = frame.params ?? {};
                let patchKeys = '(empty)';
                try { patchKeys = Object.keys(JSON.parse(raw ?? '{}')).join(', '); } catch { /* ignore */ }
                console.log(`[mock-gateway] config.patch: baseHash=${baseHash}, patchKeys=${patchKeys}`);
                reply({ hash: 'mock-hash-updated', ok: true });
            } else if (method === 'exec.shell') {
                const { command } = frame.params ?? {};
                console.log(`[mock-gateway] exec.shell: ${command}`);
                reply({ stdout: '', stderr: '', exitCode: 0 });
            } else if (method === 'agents.files.get') {
                const { agentId, name } = frame.params ?? {};
                const fileContents = {
                    'SOUL.md': `# ${agentId}\nYou are ${agentId}, a mock AI assistant. This content is served by the dev mock gateway.\n`,
                    'TOOLS.md': `# Tools\n## available_tools\n- description: No tools configured yet.\n`,
                    'AGENTS.md': `# Agent Network\nNo collaborators configured.\n`,
                };
                reply({ agentId, name, content: fileContents[name] ?? '' });
            } else if (method === 'agents.files.set') {
                const { agentId, name, content } = frame.params ?? {};
                console.log(`[mock-gateway] agents.files.set: agentId=${agentId}, name=${name}, content.length=${content?.length ?? 0}`);
                reply({ agentId, name, ok: true });
            } else if (method === 'agents.create') {
                const { name, workspace } = frame.params ?? {};
                console.log(`[mock-gateway] agents.create: name=${name}, workspace=${workspace}`);
                reply({ agentId: name, name, workspace });
            } else if (method === 'agents.update') {
                const { agentId, name, workspace } = frame.params ?? {};
                console.log(`[mock-gateway] agents.update: agentId=${agentId}, workspace=${workspace}`);
                reply({ agentId, name, workspace });
            } else if (method === 'agents.delete') {
                const { agentId } = frame.params ?? {};
                console.log(`[mock-gateway] agents.delete: agentId=${agentId}`);
                reply({ success: true });
            } else {
                fail(`Unknown mock method: ${method}`);
            }
        }
    });
});
