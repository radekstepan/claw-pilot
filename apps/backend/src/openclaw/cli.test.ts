import { describe, it, expect } from 'vitest';
import { extractJsonFromStdout, parseOpenclawConfig } from './cli.js';

// ─── extractJsonFromStdout ───────────────────────────────────────────────────

describe('extractJsonFromStdout', () => {
    it('parses clean JSON directly', () => {
        const input = JSON.stringify({ name: 'Coder', capabilities: ['typescript'] });
        const result = extractJsonFromStdout(input);
        expect(result).toEqual({ name: 'Coder', capabilities: ['typescript'] });
    });

    it('extracts JSON from a ```json fenced code block', () => {
        const json = JSON.stringify({ name: 'Tester', capabilities: ['vitest'] });
        const input = '```json\n' + json + '\n```';
        const result = extractJsonFromStdout(input);
        expect(result).toEqual({ name: 'Tester', capabilities: ['vitest'] });
    });

    it('extracts JSON from an unfenced ``` code block (no language tag)', () => {
        const json = JSON.stringify({ name: 'Writer', capabilities: ['markdown'] });
        const input = '```\n' + json + '\n```';
        const result = extractJsonFromStdout(input);
        expect(result).toEqual({ name: 'Writer', capabilities: ['markdown'] });
    });

    it('handles multi-line JSON inside a fenced block', () => {
        const input = '```json\n{\n  "name": "Multi",\n  "capabilities": ["a", "b"]\n}\n```';
        const result = extractJsonFromStdout(input) as { name: string; capabilities: string[] };
        expect(result.name).toBe('Multi');
        expect(result.capabilities).toHaveLength(2);
    });

    it('throws when stdout is neither valid JSON nor a fenced block', () => {
        expect(() => extractJsonFromStdout('not json, no fence')).toThrow('Could not parse agent JSON from stdout');
    });
});

// ─── parseOpenclawConfig ─────────────────────────────────────────────────────

describe('parseOpenclawConfig', () => {
    it('parses a config with agents as an array (format 1)', () => {
        const input = {
            agents: [
                { id: 'a1', name: 'Alpha', capabilities: ['code'], model: 'gpt-4o' },
                { id: 'a2', name: 'Beta' },
            ],
        };
        const agents = parseOpenclawConfig(input);
        expect(agents).toHaveLength(2);
        expect(agents[0].id).toBe('a1');
        expect(agents[0].model).toBe('gpt-4o');
        expect(agents[1].name).toBe('Beta');
        expect(agents.every(a => a.status === 'OFFLINE')).toBe(true);
    });

    it('parses a config with agents as an object map (format 2)', () => {
        const input = {
            agents: {
                'agent-x': { name: 'Xavier', capabilities: ['design'], role: 'designer' },
                'agent-y': { name: 'Yara', capabilities: [] },
            },
        };
        const agents = parseOpenclawConfig(input);
        expect(agents).toHaveLength(2);
        const xavier = agents.find(a => a.id === 'agent-x');
        expect(xavier).toBeDefined();
        expect(xavier?.name).toBe('Xavier');
        expect(xavier?.role).toBe('designer');
    });

    it('parses a top-level array (format 3)', () => {
        const input = [
            { id: 'solo', name: 'Solo Agent', capabilities: ['all'] },
        ];
        const agents = parseOpenclawConfig(input);
        expect(agents).toHaveLength(1);
        expect(agents[0].id).toBe('solo');
    });

    it('returns an empty array for an empty agents list', () => {
        expect(parseOpenclawConfig({ agents: [] })).toHaveLength(0);
    });

    it('returns an empty array for null/undefined/unknown input', () => {
        expect(parseOpenclawConfig(null)).toHaveLength(0);
        expect(parseOpenclawConfig(undefined)).toHaveLength(0);
        expect(parseOpenclawConfig(42)).toHaveLength(0);
    });

    it('falls back to id when name is missing', () => {
        const input = { agents: [{ id: 'mysterious' }] };
        const agents = parseOpenclawConfig(input);
        expect(agents[0].name).toBe('mysterious');
    });
});
