import { FastifyInstance } from 'fastify';
import { getAgents, getLiveSessions, GatewayOfflineError, GatewayPairingRequiredError } from '../openclaw/cli.js';
import { Agent } from '@claw-pilot/shared-types';

export function startSessionMonitor(fastify: FastifyInstance): NodeJS.Timeout {
    const previousAgentStatuses: Record<string, string> = {};
    /** Tri-state: null = unknown (first tick), true = online, false = offline */
    let gatewayOnline: boolean | null = null;
    /** True when the device is awaiting pairing approval on the gateway machine. */
    let pairingPending = false;

    function emitGatewayStatus(online: boolean, pairingRequired = false, deviceId?: string) {
        const changed = gatewayOnline !== online || pairingPending !== pairingRequired;
        if (!changed) return;
        gatewayOnline = online;
        pairingPending = pairingRequired;
        if (fastify.io) {
            fastify.io.emit('gateway_status', { online, pairingRequired, deviceId });
        }
        if (pairingRequired) {
            fastify.log.warn(`[sessionMonitor] Device pairing required — run: openclaw devices approve --latest (deviceId: ${deviceId})`);
        } else if (online) {
            fastify.log.info('[sessionMonitor] OpenClaw gateway is back online');
        } else {
            fastify.log.warn('[sessionMonitor] OpenClaw gateway is unreachable — AI features offline');
        }
    }

    return setInterval(async () => {
        let agents: Agent[] = [];
        let sessions: Awaited<ReturnType<typeof getLiveSessions>> = [];

        try {
            [agents, sessions] = await Promise.all([getAgents(), getLiveSessions()]);
            emitGatewayStatus(true);
        } catch (error: unknown) {
            if (error instanceof GatewayPairingRequiredError) {
                emitGatewayStatus(false, true, error.deviceId);
            } else if (error instanceof GatewayOfflineError) {
                emitGatewayStatus(false);
                // Suppress noisy stack trace — one terse line is enough
                fastify.log.warn(`[sessionMonitor] ${error.message}`);
            } else {
                fastify.log.error(`[sessionMonitor] Unexpected error: ${error instanceof Error ? error.message : String(error)}`);
            }
            return;
        }

        const activeSessions = sessions.filter(s => s.status === 'WORKING' || s.status === 'IDLE');
        const isFirstTick = Object.keys(previousAgentStatuses).length === 0;

        for (const agent of agents) {
            const session = activeSessions.find(s => s.agent === agent.id || s.agentId === agent.id);
            const currentStatus = session ? (session.status === 'WORKING' ? 'WORKING' : 'IDLE') : 'OFFLINE';
            const previousStatus = previousAgentStatuses[agent.id];

            // Emit on first tick (cold start) OR whenever status changes
            if (isFirstTick || previousStatus !== currentStatus) {
                const updatedAgent: Agent = { ...agent, status: currentStatus };
                if (fastify.io) {
                    fastify.io.emit('agent_status_changed', updatedAgent);
                    if (!isFirstTick) {
                        fastify.log.info(`[sessionMonitor] Agent ${agent.id}: ${previousStatus} → ${currentStatus}`);
                    }
                }
            }

            previousAgentStatuses[agent.id] = currentStatus;
        }
    }, 10_000);
}
