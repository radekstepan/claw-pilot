import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { db } from '../db.js';
import { CursorPageQuerySchema } from '@claw-pilot/shared-types';
import { z } from 'zod';

/**
 * GET /api/activities?cursor=<id>&limit=50
 *
 * Returns activity logs sorted newest-first with cursor-based pagination.
 * Pass the returned `nextCursor` as the `cursor` query param to fetch the
 * next page. A `null` nextCursor means you have reached the end of the log.
 */
const activityRoutes: FastifyPluginAsyncZod = async (fastify) => {
    fastify.get('/', { schema: { querystring: CursorPageQuerySchema } }, async (request, reply) => {
        const q = request.query as { cursor?: string; limit: number };
        const { cursor, limit } = q;

        const sorted = [...db.data.activities].sort(
            (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );

        const startIndex = cursor ? sorted.findIndex((a) => a.id === cursor) + 1 : 0;
        const data = sorted.slice(startIndex, startIndex + limit);
        const nextCursor = data.length === limit ? data[data.length - 1]!.id : null;

        return { data, nextCursor };
    });
};

export default activityRoutes;
