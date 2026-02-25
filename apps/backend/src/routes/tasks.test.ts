/**
 * Integration tests for the core task workflow.
 *
 * Every test uses `fastify.inject()` — no TCP socket, no port binding.
 * A fresh in-memory SQLite database (better-sqlite3 `:memory:`) is installed
 * before each test via `setTestDb()` + `runMigrations()` so tests are fully
 * isolated and leave no files on disk.
 */
import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';
import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { setTestDb, runMigrations } from '../db/index.js';

// ---------------------------------------------------------------------------
// Prevent actual openclaw CLI calls from activity / review routes.
// vi.mock() is hoisted to the top of the module by Vitest automatically.
// ---------------------------------------------------------------------------
vi.mock('../openclaw/cli.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../openclaw/cli.js')>();
    return {
        ...actual,
        routeChatToAgent: vi.fn().mockResolvedValue({ response: 'mock' }),
        getLiveSessions: vi.fn().mockResolvedValue([]),
        getAgents: vi.fn().mockResolvedValue([]),
    };
});

// ---------------------------------------------------------------------------
// Auth header used in every authenticated request
// (must match process.env.API_KEY set in vitest.config.ts → test.env)
// ---------------------------------------------------------------------------
const AUTH = { Authorization: 'Bearer test-api-key' };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates a fresh in-memory SQLite database with migrations applied. */
function createTestDb(): Database.Database {
    const mem = new Database(':memory:');
    setTestDb(mem);
    runMigrations();
    return mem;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Task routes — integration', () => {
    let app: FastifyInstance;

    beforeEach(async () => {
        // Install a fresh, isolated in-memory DB before every test.
        createTestDb();
        app = await buildApp();
    });

    afterEach(async () => {
        await app.close();
    });

    // -----------------------------------------------------------------------
    // POST /api/tasks
    // -----------------------------------------------------------------------
    describe('POST /api/tasks', () => {
        it('creates a task and returns 201 with the task body', async () => {
            const res = await app.inject({
                method: 'POST',
                url: '/api/tasks',
                headers: AUTH,
                payload: { title: 'Integration Test Task', priority: 'HIGH' },
            });

            expect(res.statusCode).toBe(201);
            const body = res.json();
            expect(body).toMatchObject({
                title: 'Integration Test Task',
                priority: 'HIGH',
                status: 'TODO',
            });
            expect(typeof body.id).toBe('string');
            expect(body.id.length).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // PATCH /api/tasks/:id
    // -----------------------------------------------------------------------
    describe('PATCH /api/tasks/:id', () => {
        it('Review Gate: blocks an AI agent from marking a task DONE → 403', async () => {
            const { id } = (
                await app.inject({
                    method: 'POST',
                    url: '/api/tasks',
                    headers: AUTH,
                    payload: { title: 'Blocked by Review Gate' },
                })
            ).json<{ id: string }>();

            const res = await app.inject({
                method: 'PATCH',
                url: `/api/tasks/${id}`,
                headers: AUTH,
                payload: { status: 'DONE', agentId: 'worker-agent-001' },
            });

            expect(res.statusCode).toBe(403);
            expect(res.json<{ error: string }>().error).toMatch(/AI agents are not allowed/);
        });

        it('allows a human (no agentId) to mark a task DONE → 200', async () => {
            const { id } = (
                await app.inject({
                    method: 'POST',
                    url: '/api/tasks',
                    headers: AUTH,
                    payload: { title: 'Human Done Task' },
                })
            ).json<{ id: string }>();

            const res = await app.inject({
                method: 'PATCH',
                url: `/api/tasks/${id}`,
                headers: AUTH,
                payload: { status: 'DONE' },
            });

            expect(res.statusCode).toBe(200);
            expect(res.json<{ status: string }>().status).toBe('DONE');
        });

        it('returns 404 for a non-existent task', async () => {
            const res = await app.inject({
                method: 'PATCH',
                url: '/api/tasks/no-such-task-id',
                headers: AUTH,
                payload: { status: 'IN_PROGRESS' },
            });
            expect(res.statusCode).toBe(404);
        });
    });

    // -----------------------------------------------------------------------
    // POST /api/tasks/:id/activity  (auto-transition rules)
    // -----------------------------------------------------------------------
    describe('POST /api/tasks/:id/activity', () => {
        async function getTask(id: string) {
            const res = await app.inject({ method: 'GET', url: '/api/tasks', headers: AUTH });
            return res.json<{ data: Array<{ id: string; status: string }> }>().data.find(
                (t) => t.id === id,
            );
        }

        it('auto-transitions an ASSIGNED task to IN_PROGRESS', async () => {
            const { id } = (
                await app.inject({
                    method: 'POST',
                    url: '/api/tasks',
                    headers: AUTH,
                    payload: { title: 'ASSIGNED Task', status: 'ASSIGNED' },
                })
            ).json<{ id: string }>();

            const res = await app.inject({
                method: 'POST',
                url: `/api/tasks/${id}/activity`,
                headers: AUTH,
                payload: { message: 'Starting work on this task' },
            });

            expect(res.statusCode).toBe(201);
            expect((await getTask(id))?.status).toBe('IN_PROGRESS');
        });

        it('transitions to REVIEW when message contains "completed"', async () => {
            const { id } = (
                await app.inject({
                    method: 'POST',
                    url: '/api/tasks',
                    headers: AUTH,
                    payload: { title: 'Nearly Done', status: 'IN_PROGRESS' },
                })
            ).json<{ id: string }>();

            await app.inject({
                method: 'POST',
                url: `/api/tasks/${id}/activity`,
                headers: AUTH,
                payload: { message: 'Task completed successfully' },
            });

            expect((await getTask(id))?.status).toBe('REVIEW');
        });

        it('transitions to REVIEW when message contains "done"', async () => {
            const { id } = (
                await app.inject({
                    method: 'POST',
                    url: '/api/tasks',
                    headers: AUTH,
                    payload: { title: 'Also Done', status: 'IN_PROGRESS' },
                })
            ).json<{ id: string }>();

            await app.inject({
                method: 'POST',
                url: `/api/tasks/${id}/activity`,
                headers: AUTH,
                payload: { message: 'All done!' },
            });

            expect((await getTask(id))?.status).toBe('REVIEW');
        });

        it('returns 404 for a non-existent task', async () => {
            const res = await app.inject({
                method: 'POST',
                url: '/api/tasks/ghost/activity',
                headers: AUTH,
                payload: { message: 'hello' },
            });
            expect(res.statusCode).toBe(404);
        });
    });

    // -----------------------------------------------------------------------
    // POST /api/tasks/:id/review  (human approval gate)
    // -----------------------------------------------------------------------
    describe('POST /api/tasks/:id/review', () => {
        async function getTaskStatus(id: string): Promise<string | undefined> {
            const res = await app.inject({ method: 'GET', url: '/api/tasks', headers: AUTH });
            return res.json<{ data: Array<{ id: string; status: string }> }>().data.find(
                (t) => t.id === id,
            )?.status;
        }

        it('approve: transitions task to DONE', async () => {
            const { id } = (
                await app.inject({
                    method: 'POST',
                    url: '/api/tasks',
                    headers: AUTH,
                    payload: { title: 'Awaiting Approval', status: 'REVIEW' },
                })
            ).json<{ id: string }>();

            const res = await app.inject({
                method: 'POST',
                url: `/api/tasks/${id}/review`,
                headers: AUTH,
                payload: { action: 'approve' },
            });

            expect(res.statusCode).toBe(200);
            expect(res.json<{ status: string }>().status).toBe('DONE');
            expect(await getTaskStatus(id)).toBe('DONE');
        });

        it('reject: transitions task back to IN_PROGRESS', async () => {
            const { id } = (
                await app.inject({
                    method: 'POST',
                    url: '/api/tasks',
                    headers: AUTH,
                    payload: { title: 'Needs More Work', status: 'REVIEW' },
                })
            ).json<{ id: string }>();

            const res = await app.inject({
                method: 'POST',
                url: `/api/tasks/${id}/review`,
                headers: AUTH,
                payload: { action: 'reject', feedback: 'Please revisit the error handling.' },
            });

            expect(res.statusCode).toBe(200);
            expect(res.json<{ status: string }>().status).toBe('IN_PROGRESS');
            expect(await getTaskStatus(id)).toBe('IN_PROGRESS');
        });
    });

    // -----------------------------------------------------------------------
    // DELETE /api/tasks/:id
    // -----------------------------------------------------------------------
    describe('DELETE /api/tasks/:id', () => {
        it('deletes a task and returns 204', async () => {
            const { id } = (
                await app.inject({
                    method: 'POST',
                    url: '/api/tasks',
                    headers: AUTH,
                    payload: { title: 'Task to Delete' },
                })
            ).json<{ id: string }>();

            expect(
                (await app.inject({ method: 'DELETE', url: `/api/tasks/${id}`, headers: AUTH }))
                    .statusCode,
            ).toBe(204);

            // Verify it's gone.
            const allTasks = (
                await app.inject({ method: 'GET', url: '/api/tasks', headers: AUTH })
            ).json<{ data: Array<{ id: string }> }>().data;
            expect(allTasks.find((t) => t.id === id)).toBeUndefined();
        });

        it('returns 404 for a non-existent task', async () => {
            const res = await app.inject({
                method: 'DELETE',
                url: '/api/tasks/ghost-id',
                headers: AUTH,
            });
            expect(res.statusCode).toBe(404);
        });
    });

    // -----------------------------------------------------------------------
    // Auth enforcement
    // -----------------------------------------------------------------------
    describe('Auth enforcement', () => {
        it('returns 401 when Authorization header is absent', async () => {
            const res = await app.inject({ method: 'GET', url: '/api/tasks' });
            expect(res.statusCode).toBe(401);
        });

        it('returns 401 when API key is wrong', async () => {
            const res = await app.inject({
                method: 'GET',
                url: '/api/tasks',
                headers: { Authorization: 'Bearer definitely-wrong-key' },
            });
            expect(res.statusCode).toBe(401);
        });

        it('public health-check GET / requires no auth → 200', async () => {
            const res = await app.inject({ method: 'GET', url: '/' });
            expect(res.statusCode).toBe(200);
        });
    });
});
