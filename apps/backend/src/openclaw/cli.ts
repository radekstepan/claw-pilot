import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { Agent } from '@claw-pilot/shared-types';

const execAsync = promisify(exec);

export async function spawnTaskSession(agentId: string, taskId: string, prompt: string): Promise<string> {
    try {
        const { stdout } = await execAsync(`openclaw sessions spawn --agent ${agentId} --label task-${taskId} --message "${prompt}"`);
        return stdout;
    } catch (e) {
        console.error('Failed to spawn task session:', e);
        throw e;
    }
}

export async function routeChatToAgent(agentId: string, message: string): Promise<any> {
    try {
        const { stdout } = await execAsync(`openclaw agent --agent ${agentId} --message "${message}" --json`);
        return JSON.parse(stdout);
    } catch (e) {
        console.error('Failed to route chat to agent:', e);
        throw e;
    }
}

export async function generateAgentConfig(prompt: string): Promise<any> {
    try {
        const fullPrompt = `Generate a JSON configuration for a new AI agent based on this request: ${prompt}. Return ONLY a JSON object with 'name' (string) and 'capabilities' (array of strings).`;
        const { stdout } = await execAsync(`openclaw agent --agent main --message "${fullPrompt}" --json`);

        let parsed;
        try {
            parsed = JSON.parse(stdout);
        } catch (parseError) {
            // In case CLI wraps the output in markdown code blocks like ```json ... ```
            const match = stdout.match(/`{3}(?:json)?\n([\s\S]*?)\n`{3}/);
            if (match && match[1]) {
                parsed = JSON.parse(match[1]);
            } else {
                throw new Error("Could not parse agent JSON");
            }
        }
        return parsed;
    } catch (e) {
        console.error('Failed to generate agent config:', e);
        throw e;
    }
}

export async function getAgents(): Promise<Agent[]> {
    try {
        const openclawPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');

        // try to read the file
        let content: string;
        try {
            content = await fs.readFile(openclawPath, 'utf8');
        } catch (e: any) {
            if (e.code === 'ENOENT') {
                return []; // No openclaw config found
            }
            throw e;
        }

        const parsed = JSON.parse(content);

        // Assuming openclaw.json has an `agents` property which is a map { [id]: { name, capabilities } }
        // or an array of objects
        let parsedAgents: any[] = [];
        if (Array.isArray(parsed.agents)) {
            parsedAgents = parsed.agents;
        } else if (parsed.agents && typeof parsed.agents === 'object') {
            parsedAgents = Object.entries(parsed.agents).map(([id, data]: [string, any]) => ({
                id,
                ...data
            }));
        } else if (Array.isArray(parsed)) {
            parsedAgents = parsed;
        }

        const agents: Agent[] = parsedAgents.map((a: any) => ({
            id: a.id || a.name || 'unknown-agent',
            name: a.name || a.id || 'Unknown Agent',
            status: 'OFFLINE', // Default status, overridden later by live sessions
            capabilities: a.capabilities || [],
        }));

        return agents;
    } catch (e) {
        console.error('Failed to parse openclaw configuration:', e);
        return [];
    }
}

export async function getLiveSessions(): Promise<any[]> {
    try {
        const { stdout } = await execAsync('openclaw sessions list --json');
        return JSON.parse(stdout);
    } catch (e) {
        console.error('Failed to list live sessions:', e);
        return [];
    }
}
