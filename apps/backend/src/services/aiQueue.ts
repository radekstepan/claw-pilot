/**
 * aiQueue — SQLite-backed persistent queue for heavy AI gateway calls.
 *
 * All calls to routeChatToAgent, spawnTaskSession, and generateAgentConfig
 * must go through this module instead of being launched as unbounded detached
 * async closures. This prevents OOM/resource exhaustion when many requests
 * arrive simultaneously and ensures jobs survive server restarts.
 *
 * Concurrency is controlled by the AI_QUEUE_CONCURRENCY environment variable
 * (default: 3). Interactive chat jobs receive higher priority (1) than
 * automated task routing (0) so user-facing requests are never starved by
 * background work.
 */
import { randomUUID } from "crypto";
import { eq, and, or, isNull, lte, desc } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { env } from "../config/env.js";
import {
  db,
  aiJobs,
  chatMessages as chatTable,
  tasks as tasksTable,
  activities as activitiesTable,
} from "../db/index.js";
import type { JobPayload } from "../db/schema.js";
import type { Task } from "@claw-pilot/shared-types";
import { getGateway } from "../gateway/index.js";
import { markTaskStuck } from "./taskLifecycle.js";

const BACKOFF_BASE_MS = 30_000;
const BACKOFF_MULTIPLIER = 2;
const MAX_BACKOFF_MS = 30 * 60 * 1000;

function calculateBackoff(attempts: number): number {
  const delay = BACKOFF_BASE_MS * Math.pow(BACKOFF_MULTIPLIER, attempts - 1);
  return Math.min(delay, MAX_BACKOFF_MS);
}

export const AI_PRIORITY_HIGH = 1;
export const AI_PRIORITY_NORMAL = 0;

let workerInterval: NodeJS.Timeout | null = null;
let fastifyInstance: FastifyInstance | null = null;
let inFlightCount = 0;

function calculateStaleThreshold(): number {
  return env.AI_JOB_HEARTBEAT_INTERVAL_MS * 3;
}

function calculateHeartbeatInterval(): number {
  return env.AI_JOB_HEARTBEAT_INTERVAL_MS;
}

function calculateJobTimeout(): number {
  return env.AI_JOB_TIMEOUT_MS;
}

function logQueueStatus(size: number, pending: number): void {
  if (size > 0) {
    process.stdout.write(
      JSON.stringify({
        level: 30,
        time: Date.now(),
        msg: `[aiQueue] slot active — queued=${size} running=${pending} concurrency=${env.AI_QUEUE_CONCURRENCY}`,
      }) + "\n",
    );
  }
}

export function startQueueWorker(fastify: FastifyInstance): void {
  fastifyInstance = fastify;

  workerInterval = setInterval(async () => {
    try {
      await processStaleJobs();
      await pollAndProcessJobs();
    } catch (err) {
      fastify.log.error({ err }, "[aiQueue] worker loop error");
    }
  }, env.AI_QUEUE_POLL_MS).unref();

  fastify.log.info(
    `[aiQueue] started worker with poll interval ${env.AI_QUEUE_POLL_MS}ms, ` +
    `concurrency=${env.AI_QUEUE_CONCURRENCY}, timeout=${env.AI_JOB_TIMEOUT_MS}ms, ` +
    `heartbeat=${env.AI_JOB_HEARTBEAT_INTERVAL_MS}ms`,
  );
}

export function stopQueueWorker(): void {
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
    fastifyInstance?.log.info("[aiQueue] worker stopped");
  }
}

async function pollAndProcessJobs(): Promise<void> {
  const availableSlots = env.AI_QUEUE_CONCURRENCY - inFlightCount;
  if (availableSlots <= 0) return;

  const now = new Date().toISOString();

  const eligibleJobs = db
    .select()
    .from(aiJobs)
    .where(
      and(
        eq(aiJobs.status, "queued"),
        or(isNull(aiJobs.nextRetryAt), lte(aiJobs.nextRetryAt, now)),
      ),
    )
    .orderBy(desc(aiJobs.priority), aiJobs.createdAt)
    .limit(availableSlots)
    .all();

  if (eligibleJobs.length === 0) return;

  for (const job of eligibleJobs) {
    const jobId = String(job.id);
    const claimed = claimJob(jobId);
    if (!claimed) continue;

    inFlightCount++;
    const size = db
      .select({ id: aiJobs.id })
      .from(aiJobs)
      .where(eq(aiJobs.status, "queued"))
      .all().length;
    const pending = inFlightCount;
    logQueueStatus(size, pending);

    processJob(claimed).finally(() => {
      inFlightCount--;
    });
  }
}

function claimJob(jobId: string): Record<string, unknown> | null {
  const now = new Date().toISOString();
  const result = db
    .update(aiJobs)
    .set({ status: "running", startedAt: now, lastHeartbeatAt: now })
    .where(and(eq(aiJobs.id, jobId), eq(aiJobs.status, "queued")))
    .returning()
    .get();
  return result ?? null;
}

async function processJob(job: Record<string, unknown>): Promise<void> {
  if (!fastifyInstance) return;
  const gw = getGateway();

  const jobId = String(job.id);
  const jobAgentId = job.agentId ? String(job.agentId) : null;
  let isTimedOut = false;

  const timeoutHandle = setTimeout(async () => {
    isTimedOut = true;
    fastifyInstance?.log.error(
      { jobId, label: String(job.label) },
      `[aiQueue] job timed out after ${env.AI_JOB_TIMEOUT_MS}ms`,
    );
    await handleJobFailure(job, new Error("Job timeout"));
  }, calculateJobTimeout());

  const heartbeatInterval = setInterval(() => {
    db.update(aiJobs)
      .set({ lastHeartbeatAt: new Date().toISOString() })
      .where(eq(aiJobs.id, jobId))
      .run();
  }, calculateHeartbeatInterval());

  if (jobAgentId) {
    fastifyInstance.io?.emit("agent_busy_changed", {
      agentId: jobAgentId,
      busy: true,
    });
  }

  try {
    const payload = job.payload as JobPayload;
    switch (payload.type) {
      case "chat": {
        const aiResponseRaw = await gw.routeChatToAgent(
          payload.data.agentId,
          payload.data.message,
        );
        const aiText: string =
          typeof aiResponseRaw === "string"
            ? aiResponseRaw
            : aiResponseRaw !== null &&
              typeof aiResponseRaw === "object" &&
              "message" in aiResponseRaw &&
              typeof (aiResponseRaw as Record<string, unknown>).message ===
              "string"
              ? ((aiResponseRaw as Record<string, unknown>).message as string)
              : JSON.stringify(aiResponseRaw);

        const aiTs = new Date().toISOString();
        const newAiMessage = {
          id: randomUUID(),
          role: "assistant" as const,
          content: aiText,
          agentId: payload.data.agentId,
          timestamp: aiTs,
        };

        db.insert(chatTable)
          .values({
            id: newAiMessage.id,
            agentId: newAiMessage.agentId,
            role: newAiMessage.role,
            content: newAiMessage.content,
            timestamp: newAiMessage.timestamp,
          })
          .run();

        fastifyInstance.io?.emit("chat_message", newAiMessage);
        break;
      }
      case "task-route":
      case "review-reject":
      case "recurring-spawn": {
        const { taskId, agentId: taskAgentId } = payload.data;
        await gw.spawnTaskSession(taskAgentId, taskId, payload.data.prompt);

        // Transition task to IN_PROGRESS and log activity
        const successNow = new Date().toISOString();
        const successActivityId = randomUUID();

        const inProgressRow = db
          .update(tasksTable)
          .set({ status: "IN_PROGRESS", updatedAt: successNow })
          .where(eq(tasksTable.id, taskId))
          .returning()
          .get();

        db.insert(activitiesTable)
          .values({
            id: successActivityId,
            taskId,
            agentId: taskAgentId,
            message: `Agent '${taskAgentId}' picked up the task and is now working on it.`,
            timestamp: successNow,
          })
          .run();

        if (fastifyInstance.io) {
          if (inProgressRow) {
            fastifyInstance.io.emit("task_updated", {
              id: inProgressRow.id,
              title: inProgressRow.title ?? undefined,
              description: inProgressRow.description ?? undefined,
              status: inProgressRow.status as Task["status"],
              priority:
                (inProgressRow.priority as Task["priority"]) ?? undefined,
              tags: inProgressRow.tags ?? undefined,
              assignee_id: inProgressRow.assignee_id ?? undefined,
              agentId: inProgressRow.agentId ?? undefined,
              deliverables: inProgressRow.deliverables ?? undefined,
              createdAt: inProgressRow.createdAt,
              updatedAt: inProgressRow.updatedAt,
            });
          }
          fastifyInstance.io.emit("activity_added", {
            id: successActivityId,
            taskId,
            agentId: taskAgentId,
            message: `Agent '${taskAgentId}' picked up the task and is now working on it.`,
            timestamp: successNow,
            taskStatus: "IN_PROGRESS",
          });
        }
        break;
      }
      case "activity-route":
        await gw.routeChatToAgent("main", payload.data.message);
        break;
      case "generate-config": {
        const config = await gw.generateAgentConfig(
          payload.data.prompt,
          payload.data.model,
        );
        fastifyInstance.io?.emit("agent_config_generated", {
          requestId: payload.data.requestId,
          config,
        });
        break;
      }
    }

    clearTimeout(timeoutHandle);
    clearInterval(heartbeatInterval);

    // If the timeout already fired, don't overwrite the failure state
    if (isTimedOut) return;

    db.update(aiJobs)
      .set({ status: "completed", completedAt: new Date().toISOString() })
      .where(eq(aiJobs.id, jobId))
      .run();

    if (jobAgentId) {
      fastifyInstance.io?.emit("agent_busy_changed", {
        agentId: jobAgentId,
        busy: false,
      });
    }

    fastifyInstance.log.info(
      { jobId, label: String(job.label) },
      "[aiQueue] job completed",
    );
  } catch (err: unknown) {
    clearTimeout(timeoutHandle);
    clearInterval(heartbeatInterval);

    // If the timeout already fired, don't double-handle the failure
    if (isTimedOut) return;

    await handleJobFailure(
      job,
      err instanceof Error ? err : new Error(String(err)),
    );
  }
}

async function handleJobFailure(
  job: Record<string, unknown>,
  err: Error,
): Promise<void> {
  if (!fastifyInstance) return;

  const jobId = String(job.id);
  const jobLabel = String(job.label);
  const jobAgentId = job.agentId ? String(job.agentId) : null;

  const message = err.message;
  const now = new Date().toISOString();
  const attempts = Number(job.attempts) + 1;
  const maxAttempts = Number(job.maxAttempts);

  fastifyInstance.log.error(
    {
      jobId,
      label: jobLabel,
      attempts,
      maxAttempts,
      err: message,
    },
    `[aiQueue] job failed: ${message}`,
  );

  if (attempts >= maxAttempts) {
    db.update(aiJobs)
      .set({
        status: "stuck",
        attempts,
        error: message,
        completedAt: now,
      })
      .where(eq(aiJobs.id, jobId))
      .run();

    const payload = job.payload as JobPayload;

    // For task-related jobs, mark the task as STUCK and log an activity
    if (
      payload.type === "task-route" ||
      payload.type === "review-reject" ||
      payload.type === "recurring-spawn"
    ) {
      const { taskId, agentId: taskAgentId } = payload.data;
      markTaskStuck(taskId, taskAgentId, `Agent dispatch failed — ${message}`, fastifyInstance.io);
    }

    if (payload.type !== "generate-config") {
      fastifyInstance.io?.emit("agent_error", {
        agentId: jobLabel,
        error: message,
      });
    } else {
      fastifyInstance.io?.emit("agent_config_error", {
        requestId: payload.data.requestId,
        error: message,
      });
    }

    if (jobAgentId) {
      fastifyInstance.io?.emit("agent_busy_changed", {
        agentId: jobAgentId,
        busy: false,
      });
    }
  } else {
    const backoff = calculateBackoff(attempts);
    const nextRetry = new Date(Date.now() + backoff).toISOString();

    db.update(aiJobs)
      .set({
        status: "queued",
        attempts,
        error: message,
        nextRetryAt: nextRetry,
        startedAt: null,
      })
      .where(eq(aiJobs.id, jobId))
      .run();

    if (jobAgentId) {
      fastifyInstance.io?.emit("agent_busy_changed", {
        agentId: jobAgentId,
        busy: false,
      });
    }
  }
}

async function processStaleJobs(): Promise<void> {
  if (!fastifyInstance) return;

  const staleThreshold = calculateStaleThreshold();
  const now = new Date();
  const cutoff = new Date(now.getTime() - staleThreshold).toISOString();

  const staleJobs = db
    .select()
    .from(aiJobs)
    .where(
      and(eq(aiJobs.status, "running"), lte(aiJobs.lastHeartbeatAt, cutoff)),
    )
    .all();

  for (const job of staleJobs) {
    const jobId = String(job.id);
    const jobLabel = String(job.label);
    fastifyInstance.log.warn(
      { jobId, label: jobLabel, lastHeartbeat: job.lastHeartbeatAt },
      "[aiQueue] detected stale job (process crash?)",
    );

    const attempts = Number(job.attempts) + 1;
    const maxAttempts = Number(job.maxAttempts);
    if (attempts >= maxAttempts) {
      db.update(aiJobs)
        .set({
          status: "stuck",
          attempts,
          error: "Job stale - process likely crashed mid-execution",
          completedAt: new Date().toISOString(),
        })
        .where(eq(aiJobs.id, jobId))
        .run();
    } else {
      db.update(aiJobs)
        .set({
          status: "queued",
          attempts,
          error: "Job stale - re-queuing for retry",
          nextRetryAt: null,
          startedAt: null,
          lastHeartbeatAt: null,
        })
        .where(eq(aiJobs.id, jobId))
        .run();
    }
  }
}

export function enqueueAiJob(
  label: string,
  priority: number,
  jobType: JobPayload["type"],
  data: JobPayload["data"],
  agentId?: string,
): void {
  const jobId = randomUUID();
  const now = new Date().toISOString();

  db.insert(aiJobs)
    .values({
      id: jobId,
      jobType,
      label,
      agentId: agentId || null,
      priority,
      status: "queued",
      payload: { type: jobType, data } as unknown as JobPayload,
      attempts: 0,
      maxAttempts: 3,
      nextRetryAt: null,
      startedAt: null,
      completedAt: null,
      lastHeartbeatAt: null,
      createdAt: now,
      error: null,
    })
    .run();
}
