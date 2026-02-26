import { useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import { toast } from 'sonner';
import type { ClientToServerEvents, ServerToClientEvents, Task } from '@claw-pilot/shared-types';
import { useMissionStore } from '../store/useMissionStore';
import { env } from '../config/env.js';

export function useSocketListener() {
    const {
        updateTaskLocally,
        addTaskLocally,
        deleteTaskLocally,
        addChatMessage,
        setSocketConnected,
        setGatewayOnline,
        setGatewayPairing,
        fetchInitialData,
    } = useMissionStore();

    useEffect(() => {
        const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(env.VITE_SOCKET_URL, {
            // Pass the API key in the HTTP handshake headers so the Fastify auth hook
            // can validate the Socket.io connection just like any other API request.
            extraHeaders: {
                Authorization: `Bearer ${env.VITE_API_KEY}`,
            },
            // Tighter reconnection backoff so devices that just woke from sleep
            // re-establish the socket quickly and trigger a delta sync.
            // The server-side heartbeat (10 s / 5 s) will have already detected the
            // dropped connection, so the client should be able to reconnect promptly.
            reconnectionDelay: 1_000,
            reconnectionDelayMax: 5_000,
            reconnectionAttempts: Infinity,
        });

        socket.on('connect', () => {
            console.log('Connected to WebSocket server:', socket.id);
            setSocketConnected(true);
        });

        socket.on('disconnect', () => {
            console.log('Disconnected from WebSocket server');
            setSocketConnected(false);
        });

        // Re-sync state when the socket reconnects after a dropped connection
        // (e.g. laptop woke from sleep). Uses delta sync if possible to avoid full reload.
        const handleReconnect = (attemptNumber: number) => {
            console.log(`Socket reconnected after ${attemptNumber} attempt(s) — re-syncing state`);
            const { lastSyncAt, syncData, fetchInitialData } = useMissionStore.getState();
            if (lastSyncAt) {
                syncData(lastSyncAt).catch(() => fetchInitialData());
            } else {
                fetchInitialData();
            }
        };
        socket.io.on('reconnect', handleReconnect);

        socket.on('task_created', (payload) => {
            console.log('Socket event: task_created', payload);
            const stub: Task = { id: payload.id, title: payload.title, status: 'TODO' };
            addTaskLocally(stub);
        });

        socket.on('task_updated', (task) => {
            console.log('Socket event: task_updated', task);
            updateTaskLocally(task);
            // Surface REVIEW transitions as in-app notifications
            if (task.status === 'REVIEW') {
                useMissionStore.getState().addNotification({
                    type: 'review',
                    message: `"${task.title}" is waiting for your review.`,
                    taskId: task.id,
                });
            }
        });

        socket.on('task_deleted', (payload) => {
            console.log('Socket event: task_deleted', payload);
            deleteTaskLocally(payload.id);
        });

        socket.on('activity_added', (activity) => {
            console.log('Socket event: activity_added', activity);
            useMissionStore.setState((state) => ({
                activities: [activity, ...state.activities],
            }));
        });

        socket.on('agent_status_changed', (agent) => {
            console.log('Socket event: agent_status_changed', agent);
            useMissionStore.setState((state) => ({
                agents: state.agents.map((a) => (a.id === agent.id ? { ...a, ...agent } : a)),
            }));
        });

        socket.on('agent_busy_changed', ({ agentId, busy }) => {
            console.log('Socket event: agent_busy_changed', { agentId, busy });
            useMissionStore.setState((state) => {
                const next = new Set(state.busyAgentIds);
                if (busy) next.add(agentId);
                else next.delete(agentId);
                return { busyAgentIds: next };
            });
        });

        socket.on('chat_message', (message) => {
            console.log('Socket event: chat_message', message);
            addChatMessage(message);
        });

        socket.on('chat_cleared', () => {
            console.log('Socket event: chat_cleared');
            useMissionStore.setState({ chatHistory: [], chatCursor: null });
        });

        socket.on('gateway_status', ({ online, pairingRequired, deviceId }) => {
            console.log('Socket event: gateway_status', { online, pairingRequired, deviceId });
            if (pairingRequired) {
                setGatewayPairing(true, deviceId);
            } else {
                setGatewayPairing(false);
                setGatewayOnline(online);
            }
        });

        socket.on('agent_error', ({ agentId, error }) => {
            console.log('Socket event: agent_error', { agentId, error });
            toast.error(`Agent error (${agentId}): ${error}`, {
                duration: 8000,
                description: 'The task has been marked as Stuck. Open the task to re-route it to an agent.',
            });
            useMissionStore.getState().addNotification({
                type: 'error',
                message: `Agent ${agentId}: ${error}`,
                agentId,
            });
        });

        return () => {
            socket.io.off('reconnect', handleReconnect);
            socket.disconnect();
        };
    }, [updateTaskLocally, addTaskLocally, deleteTaskLocally, addChatMessage, setSocketConnected, setGatewayOnline, setGatewayPairing, fetchInitialData]);
}
