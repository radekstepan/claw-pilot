/**
 * setup-mock-env.mjs — run before `tsx watch src/index.ts` in dev:mock mode.
 *
 * Creates a minimal ~/.openclaw-mock directory that satisfies the backend's
 * OPENCLAW_HOME expectations without requiring a real OpenClaw installation.
 *
 * The `openclaw` binary itself is faked via PATH prepending (see package.json).
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

const mockHome = path.join(os.homedir(), '.openclaw-mock');
const workspaces = path.join(mockHome, 'workspaces');

fs.mkdirSync(workspaces, { recursive: true });

const mockConfig = {
    agents: [
        { id: 'architect', name: 'Architect', role: 'Lead AI',   model: 'claude-sonnet-4', capabilities: ['planning', 'review'] },
        { id: 'developer', name: 'Developer', role: 'Worker AI', model: 'claude-sonnet-4', capabilities: ['coding', 'testing'] },
    ],
};

fs.writeFileSync(
    path.join(mockHome, 'openclaw.json'),
    JSON.stringify(mockConfig, null, 2),
    'utf-8',
);

console.log('[mock] OPENCLAW_HOME =>', mockHome);
console.log('[mock] Agents registered:', mockConfig.agents.map(a => a.id).join(', '));
