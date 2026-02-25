import { JSONFilePreset } from 'lowdb/node';
import path from 'path';
import { Task, ActivityLog, RecurringTask, ChatMessage } from '@claw-pilot/shared-types';

export type Data = {
    tasks: Task[];
    activities: ActivityLog[];
    chat: ChatMessage[];
    recurring: RecurringTask[];
};

const defaultData: Data = { tasks: [], activities: [], chat: [], recurring: [] };

const dbPath = path.join(process.cwd(), 'data', 'db.json');
export const db = await JSONFilePreset<Data>(dbPath, defaultData);

let writeLock: Promise<void> | null = null;
const originalWrite = db.write.bind(db);

db.write = async (): Promise<void> => {
    while (writeLock) {
        await writeLock;
    }

    let releaseLock!: () => void;
    writeLock = new Promise<void>((resolve) => {
        releaseLock = resolve;
    });

    try {
        await originalWrite();
    } finally {
        writeLock = null;
        releaseLock();
    }
};

export async function updateDb(updater: (data: Data) => void | Promise<void>): Promise<void> {
    while (writeLock) {
        await writeLock;
    }

    let releaseLock!: () => void;
    writeLock = new Promise<void>((resolve) => {
        releaseLock = resolve;
    });

    try {
        await updater(db.data);
        await originalWrite();
    } finally {
        writeLock = null;
        releaseLock();
    }
}
