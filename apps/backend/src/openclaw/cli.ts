import { execFile } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { Agent } from '@claw-pilot/shared-types';
import { env } from '../config/env.js';

const execFileAsync = promisify(execFile);

/**
 * Timeout (ms) for fast/informational CLI calls: sessions list, models list, --version, etc.
 * Driven by the Zod-validated env config (CLI_TIMEOUT, default 15 000 ms).
 */
const CLI_TIMEOUT = env.CLI_TIMEOUT;

/**
 * Timeout (ms) for heavy AI calls: chat routing, agent generation, session spawn.
 * Driven by the Zod-validated env config (AI_TIMEOUT, default 120 000 ms).
 */
const AI_TIMEOUT = env.AI_TIMEOUT;

/** Shape returned by `openclaw sessions list --json`. */
interface LiveSession {
    agent?: string;
    agentId?: string;
    status?: string;
}

/**
 * Extracts and parses JSON from an openclaw CLI stdout string.
 * Handles both raw JSON and JSON wrapped in a markdown code fence (``` or ```json).
 * @internal exported for unit testing
 */
export function extractJsonFromStdout(stdout: string): unknown {
    try {
        return JSON.parse(stdout);
    } catch {
        const match = stdout.match(/`{3}(?:json)?\n([\s\S]*?)\n`{3}/);
        if (match && match[1]) {
            return JSON.parse(match[1]);
        }
        throw new Error('Could not parse agent JSON from stdout');
    }
}

/**
 * Normalises the three possible shapes of the `agents` field in openclaw.json into
 * a flat Agent array:
 *   1. `{ agents: Agent[] }` — plain array
 *   2. `{ agents: { [id]: AgentData } }` — object map
 *   3. `Agent[]` — top-level array (no `agents` key)
 * @internal exported for unit testing
 */
export function parseOpenclawConfig(parsed: unknown): Agent[] {
    let raw: unknown[] = [];
    if (
        parsed !== null &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed)
    ) {
        const obj = parsed as Record<string, unknown>;
        if (Array.isArray(obj.agents)) {
            raw = obj.agents as unknown[];
        } else if (obj.agents !== undefined && typeof obj.agents === 'object') {
            raw = Object.entries(obj.agents as Record<string, unknown>).map(
                ([id, data]) => ({ id, ...(data as object) })
            );
        } else {
            // Bare top-level object treated as a single agent map
            raw = Object.entries(obj).map(([id, data]) => ({ id, ...(data as object) }));
        }
    } else if (Array.isArray(parsed)) {
        raw = parsed;
    }

    return raw.map((a: unknown) => {
        const agent = a as Record<string, unknown>;
        return {
            id: String(agent.id ?? agent.name ?? 'unknown-agent'),
            name: String(agent.name ?? agent.id ?? 'Unknown Agent'),
            status: 'OFFLINE' as const,
            capabilities: Array.isArray(agent.capabilities) ? (agent.capabilities as string[]) : [],
            role: typeof agent.role === 'string' ? agent.role : undefined,
            model: typeof agent.model === 'string' ? agent.model : undefined,
            fallback: typeof agent.fallback === 'string' ? agent.fallback : undefined,
        };
    });
}

export async function spawnTaskSession(agentId: string, taskId: string, prompt: string): Promise<string> {
    try {
        const { stdout } = await execFileAsync('openclaw', ['sessions', 'spawn', '--agent', agentId, '--label', `task-${taskId}`, '--message', prompt], { timeout: AI_TIMEOUT });
        return stdout;
    } catch (e) {
        console.error('Failed to spawn task session:', e);
        throw e;
    }
}

export async function routeChatToAgent(agentId: string, message: string): Promise<unknown> {
    try {
        const { stdout } = await execFileAsync('openclaw', ['agent', '--agent', agentId, '--message', message, '--json'], { timeout: AI_TIMEOUT });
        return JSON.parse(stdout);
    } catch (e) {
        console.error('Failed to route chat to agent:', e);
        throw e;
    }
}

export async function generateAgentConfig(prompt: string): Promise<unknown> {
    try {
        const fullPrompt = `Generate a JSON configuration for a new AI agent based on this request: ${prompt}. Return ONLY a JSON object with 'name' (string) and 'capabilities' (array of strings).`;
        const { stdout } = await execFileAsync('openclaw', ['agent', '--agent', 'main', '--message', fullPrompt, '--json'], { timeout: AI_TIMEOUT });
        return extractJsonFromStdout(stdout);
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
        } catch (e: unknown) {
            if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
                return []; // No openclaw config found
            }
            throw e;
        }

        const parsed = JSON.parse(content);
        return parseOpenclawConfig(parsed);
    } catch (e) {
        console.error('Failed to parse openclaw configuration:', e);
        return [];
    }
}

export async function getLiveSessions(): Promise<LiveSession[]> {
    try {
        const { stdout } = await execFileAsync('openclaw', ['sessions', 'list', '--json'], { timeout: CLI_TIMEOUT });
        return JSON.parse(stdout) as LiveSession[];
    } catch (e) {
        console.error('Failed to list live sessions:', e);
        return [];
    }
}

export async function getModels(): Promise<unknown> {
    try {
        const { stdout } = await execFileAsync('openclaw', ['models', 'list', '--all', '--json'], { timeout: CLI_TIMEOUT });
        return JSON.parse(stdout);
    } catch (e) {
        console.error('Failed to list models:', e);
        return [];
    }
}
