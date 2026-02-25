import { useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@claw-pilot/shared-types';
import { useMissionStore } from '../store/useMissionStore';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL ?? 'http://localhost:54321';

export function useSocketListener() {
    const { updateTaskLocally, addChatMessage, setSocketConnected } = useMissionStore();

    useEffect(() => {
        const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(SOCKET_URL);

        socket.on('connect', () => {
            console.log('Connected to WebSocket server:', socket.id);
            setSocketConnected(true);
        });

        socket.on('disconnect', () => {
            console.log('Disconnected from WebSocket server');
            setSocketConnected(false);
        });

        socket.on('task_updated', (task) => {
            console.log('Socket event: task_updated', task);
            updateTaskLocally(task);
        });

        socket.on('chat_message', (message) => {
            console.log('Socket event: chat_message', message);
            addChatMessage(message);
        });

        return () => {
            socket.disconnect();
        };
    }, [updateTaskLocally, addChatMessage]);
}
