import { FastifyInstance } from 'fastify';
import { Cron } from 'croner';
import { eq } from 'drizzle-orm';
import { db, recurringTasks as recurringTable } from '../db/index.js';
import { validateRecurringScheduleInput } from '../services/recurringSchedule.js';
import { triggerRecurringTemplate } from '../services/recurringTrigger.js';

const RECONCILE_INTERVAL_MS = 60_000;

interface ScheduledRecurringJob {
    fingerprint: string;
    job: Cron;
}

export interface RecurringSchedulerHandle {
    timer: NodeJS.Timeout;
    reconcile: () => void;
}

export function startRecurringSchedulerMonitor(fastify: FastifyInstance): RecurringSchedulerHandle {
    const jobs = new Map<string, ScheduledRecurringJob>();

    const stopJob = (recurringId: string): void => {
        const existing = jobs.get(recurringId);
        if (!existing) return;
        existing.job.stop();
        jobs.delete(recurringId);
    };

    const reconcile = (): void => {
        try {
            const allTemplates = db.select().from(recurringTable).all();
            const activeTemplateIds = new Set<string>();

            for (const template of allTemplates) {
                if (template.status !== 'ACTIVE') {
                    stopJob(template.id);
                    continue;
                }

                const validation = validateRecurringScheduleInput(template.schedule_type, template.schedule_value);
                if (!validation.valid) {
                    stopJob(template.id);
                    fastify.log.warn(`recurringScheduler: skipping template '${template.id}' due to invalid schedule: ${validation.error}`);
                    continue;
                }

                activeTemplateIds.add(template.id);
                const fingerprint = validation.value.expression;
                const existing = jobs.get(template.id);

                if (existing?.fingerprint === fingerprint) {
                    continue;
                }

                stopJob(template.id);

                const templateId = template.id;
                const job = new Cron(validation.value.expression, { protect: true }, () => {
                    const fresh = db.select().from(recurringTable).where(eq(recurringTable.id, templateId)).get();
                    if (!fresh || fresh.status !== 'ACTIVE') return;
                    void triggerRecurringTemplate(fastify, fresh)
                        .then((result) => {
                            fastify.log.info(
                                `recurringScheduler: triggered template '${templateId}' -> task ${result.task.id}${result.dispatchAccepted ? ` (dispatched to ${fresh.assigned_agent_id})` : ''}`,
                            );
                        })
                        .catch((err: unknown) => {
                            fastify.log.error(err, `recurringScheduler: failed to trigger template '${templateId}'`);
                        });
                });

                jobs.set(template.id, { fingerprint, job });
                fastify.log.info(`recurringScheduler: scheduled template '${template.id}' with '${validation.value.expression}'`);
            }

            for (const [id] of jobs) {
                if (!activeTemplateIds.has(id)) {
                    stopJob(id);
                }
            }
        } catch (err: unknown) {
            fastify.log.error(`recurringSchedulerMonitor error: ${err instanceof Error ? err.message : String(err)}`);
        }
    };

    reconcile();
    const reconcileTimer = setInterval(reconcile, RECONCILE_INTERVAL_MS);

    fastify.addHook('onClose', async () => {
        clearInterval(reconcileTimer);
        for (const [id, entry] of jobs) {
            entry.job.stop();
            jobs.delete(id);
        }
    });

    return { timer: reconcileTimer, reconcile };
}
