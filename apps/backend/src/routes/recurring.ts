import { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { db, recurringTasks as recurringTable } from "../db/index.js";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { z } from "zod";
import {
  CreateRecurringPayloadSchema,
  RecurringTaskSchema,
  RecurringTask,
} from "@claw-pilot/shared-types";
import { validateRecurringScheduleInput } from "../services/recurringSchedule.js";
import { triggerRecurringTemplate } from "../services/recurringTrigger.js";

const CreateRecurringSchema = CreateRecurringPayloadSchema;
const UpdateRecurringSchema = RecurringTaskSchema.partial();

type RecurringRow = typeof recurringTable.$inferSelect;

function rowToRecurring(row: RecurringRow): RecurringTask {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? undefined,
    schedule_type: row.schedule_type as RecurringTask["schedule_type"],
    schedule_value: row.schedule_value ?? undefined,
    assigned_agent_id: row.assigned_agent_id ?? undefined,
    status: row.status as RecurringTask["status"],
    last_triggered_at: row.last_triggered_at ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const recurringRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.get("/", async (_request, _reply) => {
    const rows = db.select().from(recurringTable).all();
    return rows.map(rowToRecurring);
  });

  fastify.post(
    "/",
    { schema: { body: CreateRecurringSchema } },
    async (request, reply) => {
      const body = request.body as z.infer<typeof CreateRecurringSchema>;
      const validation = validateRecurringScheduleInput(
        body.schedule_type,
        body.schedule_value,
      );
      if (!validation.valid) {
        return reply.status(400).send({ error: validation.error });
      }

      const now = new Date().toISOString();
      const id = randomUUID();

      db.insert(recurringTable)
        .values({
          id,
          title: body.title,
          description: body.description ?? null,
          schedule_type: validation.value.normalizedType,
          schedule_value: validation.value.normalizedValue,
          assigned_agent_id: body.assigned_agent_id ?? null,
          status: "ACTIVE",
          last_triggered_at: null,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      const row = db
        .select()
        .from(recurringTable)
        .where(eq(recurringTable.id, id))
        .get()!;
      fastify.reconcileRecurring?.();
      return reply.status(201).send(rowToRecurring(row));
    },
  );

  fastify.patch(
    "/:id",
    { schema: { body: UpdateRecurringSchema } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as z.infer<typeof UpdateRecurringSchema>;

      const existing = db
        .select()
        .from(recurringTable)
        .where(eq(recurringTable.id, id))
        .get();
      if (!existing) {
        return reply.status(404).send({ error: "Recurring task not found" });
      }

      const nextScheduleType = body.schedule_type ?? existing.schedule_type;
      const nextScheduleValue =
        body.schedule_value !== undefined
          ? body.schedule_value
          : existing.schedule_value;
      const validation = validateRecurringScheduleInput(
        nextScheduleType,
        nextScheduleValue,
      );
      if (!validation.valid) {
        return reply.status(400).send({ error: validation.error });
      }

      const updatedRow = db
        .update(recurringTable)
        .set({
          title: body.title ?? existing.title,
          description:
            body.description !== undefined
              ? body.description
              : existing.description,
          schedule_type: validation.value.normalizedType,
          schedule_value: validation.value.normalizedValue,
          assigned_agent_id:
            body.assigned_agent_id !== undefined
              ? (body.assigned_agent_id ?? null)
              : existing.assigned_agent_id,
          status: body.status ?? existing.status,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(recurringTable.id, id))
        .returning()
        .get()!;

      fastify.reconcileRecurring?.();
      return reply.send(rowToRecurring(updatedRow));
    },
  );

  fastify.delete("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };

    const existing = db
      .select({ id: recurringTable.id })
      .from(recurringTable)
      .where(eq(recurringTable.id, id))
      .get();
    if (!existing) {
      return reply.status(404).send({ error: "Recurring task not found" });
    }

    db.delete(recurringTable).where(eq(recurringTable.id, id)).run();
    fastify.reconcileRecurring?.();
    return reply.status(204).send();
  });

  fastify.post("/:id/trigger", async (request, reply) => {
    const { id } = request.params as { id: string };

    const recurringTask = db
      .select()
      .from(recurringTable)
      .where(eq(recurringTable.id, id))
      .get();
    if (!recurringTask) {
      return reply.status(404).send({ error: "Recurring task not found" });
    }

    const result = await triggerRecurringTemplate(fastify, recurringTask);
    if (result.dispatchAccepted) {
      return reply.status(202).send({ id: result.task.id, status: "pending" });
    }

    return reply.status(201).send(result.task);
  });

  const ImportPayloadSchema = z.array(RecurringTaskSchema);

  fastify.get("/export", async (_request, reply) => {
    const rows = db.select().from(recurringTable).all();
    return rows.map(rowToRecurring);
  });

  fastify.post(
    "/import",
    { schema: { body: ImportPayloadSchema } },
    async (request, reply) => {
      const body = request.body as z.infer<typeof ImportPayloadSchema>;
      let imported = 0;
      let skipped = 0;
      const errors: { id: string; error: string }[] = [];

      const existingIds = new Set(
        db
          .select({ id: recurringTable.id })
          .from(recurringTable)
          .all()
          .map((r) => r.id),
      );

      const now = new Date().toISOString();

      for (const task of body) {
        try {
          if (existingIds.has(task.id)) {
            skipped++;
            continue;
          }

          const validation = validateRecurringScheduleInput(
            task.schedule_type,
            task.schedule_value,
          );
          if (!validation.valid) {
            errors.push({ id: task.id, error: validation.error });
            continue;
          }

          db.insert(recurringTable)
            .values({
              id: task.id,
              title: task.title,
              description: task.description ?? null,
              schedule_type: validation.value.normalizedType,
              schedule_value: validation.value.normalizedValue,
              assigned_agent_id: task.assigned_agent_id ?? null,
              status: task.status,
              last_triggered_at: task.last_triggered_at ?? null,
              createdAt: task.createdAt ?? now,
              updatedAt: task.updatedAt ?? now,
            })
            .run();

          imported++;
        } catch (err) {
          errors.push({
            id: task.id,
            error: err instanceof Error ? err.message : "Unknown error",
          });
        }
      }

      fastify.reconcileRecurring?.();

      return reply.send({
        imported,
        skipped,
        errors: errors.length > 0 ? errors : undefined,
      });
    },
  );
};

export default recurringRoutes;
