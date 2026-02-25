import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { db, activities as activitiesTable, encodeCursor, decodeCursor } from '../db/index.js';
import { CursorPageQuerySchema, ActivityLog } from '@claw-pilot/shared-types';
import { desc, or, lt, and, eq } from 'drizzle-orm';

type ActivityRow = typeof activitiesTable.$inferSelect;

function rowToActivity(row: ActivityRow): ActivityLog {
    return {
        id: row.id,
        taskId: row.taskId ?? '',
        agentId: row.agentId ?? undefined,
        message: row.message,
        timestamp: row.timestamp,
    };
}

/**
 * GET /api/activities?cursor=<token>&limit=50
 *
 * Returns activity logs sorted newest-first with cursor-based pagination.
 * The cursor encodes { timestamp, id } as a base64url token. A null
 * nextCursor means all records have been returned.
 */
const activityRoutes: FastifyPluginAsyncZod = async (fastify) => {
    fastify.get('/', { schema: { querystring: CursorPageQuerySchema } }, async (request, reply) => {
        const q = request.query as { cursor?: string; limit: number };
        const { cursor, limit } = q;

        let rows: ActivityRow[];

        if (cursor) {
            const { timestamp: cursorTs, id: cursorId } = decodeCursor(cursor);
            rows = db
                .select()
                .from(activitiesTable)
                .where(
                    or(
                        lt(activitiesTable.timestamp, cursorTs),
                        and(eq(activitiesTable.timestamp, cursorTs), lt(activitiesTable.id, cursorId))
                    )
                )
                .orderBy(desc(activitiesTable.timestamp), desc(activitiesTable.id))
                .limit(limit)
                .all();
        } else {
            rows = db
                .select()
                .from(activitiesTable)
                .orderBy(desc(activitiesTable.timestamp), desc(activitiesTable.id))
                .limit(limit)
                .all();
        }

        const data = rows.map(rowToActivity);
        const lastRow = rows[rows.length - 1];
        const nextCursor = rows.length === limit && lastRow
            ? encodeCursor(lastRow.timestamp, lastRow.id)
            : null;

        return { data, nextCursor };
    });
};

export default activityRoutes;
