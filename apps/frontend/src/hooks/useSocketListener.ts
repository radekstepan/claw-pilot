import { useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
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
        fetchInitialData,
    } = useMissionStore();

    useEffect(() => {
        const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(env.VITE_SOCKET_URL, {
            // Pass the API key in the HTTP handshake headers so the Fastify auth hook
            // can validate the Socket.io connection just like any other API request.
            extraHeaders: {
                Authorization: `Bearer ${env.VITE_API_KEY}`,
            },
        });

        socket.on('connect', () => {
            console.log('Connected to WebSocket server:', socket.id);
            setSocketConnected(true);
        });

        socket.on('disconnect', () => {
            console.log('Disconnected from WebSocket server');
            setSocketConnected(false);
        });

        // Re-sync all state when the socket reconnects after a dropped connection
        // (e.g. laptop woke from sleep). This replays any events missed while offline.
        const handleReconnect = (attemptNumber: number) => {
            console.log(`Socket reconnected after ${attemptNumber} attempt(s) — re-syncing state`);
            fetchInitialData();
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

        socket.on('chat_message', (message) => {
            console.log('Socket event: chat_message', message);
            addChatMessage(message);
        });

        socket.on('chat_cleared', () => {
            console.log('Socket event: chat_cleared');
            useMissionStore.setState({ chatHistory: [], chatCursor: null });
        });

        return () => {
            socket.io.off('reconnect', handleReconnect);
            socket.disconnect();
        };
    }, [updateTaskLocally, addTaskLocally, deleteTaskLocally, addChatMessage, setSocketConnected, fetchInitialData]);
}
