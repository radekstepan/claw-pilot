import { JSONFilePreset } from 'lowdb/node';
import path from 'path';
import { Task, ActivityLog } from '@claw-pilot/shared-types';

export type Data = {
    tasks: Task[];
    activities: ActivityLog[];
    chat: any[];
    recurring: any[];
};

const defaultData: Data = { tasks: [], activities: [], chat: [], recurring: [] };

const dbPath = path.join(process.cwd(), 'data', 'db.json');
export const db = await JSONFilePreset<Data>(dbPath, defaultData);
