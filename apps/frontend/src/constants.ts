export const COLUMN_IDS = ['INBOX', 'ASSIGNED', 'IN_PROGRESS', 'REVIEW', 'DONE'];

export const COLUMN_TITLES: Record<string, string> = {
    INBOX: 'Inbox',
    ASSIGNED: 'Assigned',
    IN_PROGRESS: 'In Progress',
    REVIEW: 'Review',
    DONE: 'Done'
};

export const INITIAL_AGENTS = [
    { id: 'lead', name: 'Main Frame', role: 'Lead AI', status: 'working', model: 'Claude 3.5 Sonnet', fallback: 'GPT-4o' },
    { id: 'dev', name: 'Dev Agent', role: 'Worker', status: 'idle', model: 'GPT-4o', fallback: 'GPT-4o mini' },
    { id: 'creative', name: 'Aesthetic-1', role: 'Specialist', status: 'working', model: 'Claude 3.5 Sonnet', fallback: 'GPT-4o' },
    { id: 'ops', name: 'Ops Bot', role: 'Worker', status: 'standby', model: 'GPT-4o mini', fallback: 'Llama 3 8b' },
];

export const INITIAL_TASKS = [
    { id: 'TASK-001', title: 'Refactor Auth Middleware', status: 'IN_PROGRESS', priority: 'URGENT', assignee: 'dev', tags: ['code', 'auth'], description: 'Fix the session context bleed in the production gateway.' },
    { id: 'TASK-002', title: 'Design System Documentation', status: 'REVIEW', priority: 'NORMAL', assignee: 'creative', tags: ['design'], description: 'Finalize the Lumina Core CSS variable mapping.' },
    { id: 'TASK-003', title: 'Gateway Watchdog Script', status: 'ASSIGNED', priority: 'NORMAL', assignee: 'ops', tags: ['infra'], description: 'Implement a cron loop that checks openclaw status --json.' },
    { id: 'TASK-004', title: 'New Onboarding Flow', status: 'INBOX', priority: 'NORMAL', assignee: null, tags: ['ux'], description: 'Map out the user journey for first-time agent setup.' },
    { id: 'TASK-005', title: 'Database Migration v1.4', status: 'DONE', priority: 'URGENT', assignee: 'dev', tags: ['db'], description: 'Migrate task storage from local JSON to shared Firestore structure.' },
];

export const MOCK_ACTIVITY = [
    { id: 1, agent: 'lead', system: false, time: '14:22', text: 'Assigned TASK-001 to dev' },
    { id: 2, system: true, time: '14:15', text: 'Gateway sync completed (842ms)' },
    { id: 3, agent: 'dev', system: false, time: '13:58', text: 'Pushed commit "fix auth token bleed"' },
    { id: 4, agent: 'creative', system: false, time: '11:30', text: 'Uploaded artifact: lumina-vars.css' },
    { id: 5, system: true, time: '09:00', text: 'Sprint 42 initialized' },
];
