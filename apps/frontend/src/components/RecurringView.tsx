import { useState } from 'react';
import { Plus, Trash2, Zap, Clock, Loader2, RefreshCw, Bot, Pencil, Check, X } from 'lucide-react';
import { toast } from 'sonner';
import type { CreateRecurringPayload, RecurringTask, RecurringScheduleType } from '@claw-pilot/shared-types';
import { useMissionStore } from '../store/useMissionStore';
import { Badge } from './ui/Badge';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { Select } from './ui/Select';
import { EmptyState } from './ui/EmptyState';

const SCHEDULE_TYPE_OPTIONS = [
    { value: 'HOURLY', label: 'Hourly' },
    { value: 'DAILY', label: 'Daily' },
    { value: 'WEEKLY', label: 'Weekly' },
    { value: 'CUSTOM', label: 'Custom (cron)' },
];

export const RecurringView = () => {
    const { recurringTasks, createRecurring, deleteRecurring, updateRecurring, triggerRecurring, agents } = useMissionStore();

    const [isCreating, setIsCreating] = useState(false);
    const [newTitle, setNewTitle] = useState('');
    const [newDescription, setNewDescription] = useState('');
    const [newScheduleType, setNewScheduleType] = useState<RecurringScheduleType>('DAILY');
    const [newScheduleValue, setNewScheduleValue] = useState('');
    const [newAssignedAgentId, setNewAssignedAgentId] = useState('');
    const [loadingId, setLoadingId] = useState<string | null>(null);
    const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

    // Edit state
    const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
    const [editTitle, setEditTitle] = useState('');
    const [editDescription, setEditDescription] = useState('');
    const [editScheduleType, setEditScheduleType] = useState<RecurringScheduleType>('DAILY');
    const [editScheduleValue, setEditScheduleValue] = useState('');
    const [editAssignedAgentId, setEditAssignedAgentId] = useState('');

    const agentOptions = [
        { value: '', label: '— None (manual routing) —' },
        ...agents.map((a) => ({ value: a.id, label: a.name })),
    ];

    const handleCreate = async () => {
        if (!newTitle.trim()) {
            toast.error('Mission title is required.');
            return;
        }
        const payload: CreateRecurringPayload = {
            title: newTitle.trim(),
            description: newDescription.trim() || undefined,
            schedule_type: newScheduleType,
            schedule_value: newScheduleValue.trim() || undefined,
            assigned_agent_id: newAssignedAgentId || undefined,
        };
        try {
            await createRecurring(payload);
            setNewTitle('');
            setNewDescription('');
            setNewScheduleValue('');
            setNewAssignedAgentId('');
            setIsCreating(false);
        } catch {
            // error toast handled in store
        }
    };

    const handleDelete = async (id: string) => {
        setPendingDeleteId(id);
    };

    const confirmDelete = async () => {
        if (!pendingDeleteId) return;
        await deleteRecurring(pendingDeleteId);
        setPendingDeleteId(null);
    };

    const handleTogglePause = async (task: RecurringTask) => {
        setLoadingId(task.id);
        try {
            await updateRecurring(task.id, {
                status: task.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE',
            });
        } finally {
            setLoadingId(null);
        }
    };

    const handleTrigger = async (id: string) => {
        setLoadingId(id);
        try {
            await triggerRecurring(id);
        } finally {
            setLoadingId(null);
        }
    };

    const openEdit = (task: RecurringTask) => {
        setEditingTaskId(task.id);
        setEditTitle(task.title);
        setEditDescription(task.description ?? '');
        setEditScheduleType(task.schedule_type);
        setEditScheduleValue(task.schedule_value ?? '');
        setEditAssignedAgentId(task.assigned_agent_id ?? '');
    };

    const cancelEdit = () => {
        setEditingTaskId(null);
    };

    const handleSaveEdit = async () => {
        if (!editingTaskId) return;
        if (!editTitle.trim()) {
            toast.error('Mission title is required.');
            return;
        }
        setLoadingId(editingTaskId);
        try {
            await updateRecurring(editingTaskId, {
                title: editTitle.trim(),
                description: editDescription.trim() || undefined,
                schedule_type: editScheduleType,
                schedule_value: editScheduleValue.trim() || undefined,
                assigned_agent_id: editAssignedAgentId || undefined,
            });
            setEditingTaskId(null);
        } finally {
            setLoadingId(null);
        }
    };

    return (
        <>
        <div className="flex-1 overflow-y-auto custom-scrollbar p-6 md:p-10 max-w-4xl mx-auto w-full">
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">Scheduled Missions</h1>
                    <p className="text-xs text-slate-500 dark:text-slate-500 mt-1">
                        Cron-like task templates that auto-generate tasks on a schedule.
                    </p>
                </div>
                <button
                    onClick={() => setIsCreating(!isCreating)}
                    className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white text-[10px] uppercase tracking-widest font-bold hover:bg-violet-500 transition-all"
                >
                    <Plus size={14} />
                    New Mission
                </button>
            </div>

            {isCreating && (
                <div className="mb-6 p-6 border border-violet-500/30 bg-violet-500/[0.03] rounded animate-fadeIn">
                    <h3 className="text-[10px] uppercase tracking-[0.2em] font-bold text-violet-600 dark:text-violet-400 mb-4">New Scheduled Mission</h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                        <div className="md:col-span-3 space-y-1">
                            <label className="text-[8px] uppercase font-bold text-slate-400 dark:text-slate-500">Mission Title *</label>
                            <input
                                type="text"
                                value={newTitle}
                                onChange={(e) => setNewTitle(e.target.value)}
                                placeholder="e.g. Daily security audit"
                                className="w-full bg-white dark:bg-black/20 border border-black/10 dark:border-white/10 rounded px-3 py-2 text-[11px] text-slate-900 dark:text-slate-300 outline-none focus:border-violet-500/50"
                                autoFocus
                            />
                        </div>
                        <div className="md:col-span-3 space-y-1">
                            <label className="text-[8px] uppercase font-bold text-slate-400 dark:text-slate-500">Task Content / Instructions <span className="text-slate-300 dark:text-slate-700 normal-case">(what the agent should do)</span></label>
                            <textarea
                                value={newDescription}
                                onChange={(e) => setNewDescription(e.target.value)}
                                placeholder="Describe what should happen each time this mission triggers…"
                                rows={3}
                                className="w-full bg-white dark:bg-black/20 border border-black/10 dark:border-white/10 rounded px-3 py-2 text-[11px] text-slate-900 dark:text-slate-300 outline-none focus:border-violet-500/50 resize-y"
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-[8px] uppercase font-bold text-slate-400 dark:text-slate-500">Schedule Type</label>
                            <Select
                                value={newScheduleType}
                                onValueChange={(v) => setNewScheduleType(v as RecurringScheduleType)}
                                options={SCHEDULE_TYPE_OPTIONS}
                                placeholder="— Schedule Type —"
                            />
                        </div>
                        <div className="md:col-span-2 space-y-1">
                            <label className="text-[8px] uppercase font-bold text-slate-400 dark:text-slate-500">Cron Expression <span className="text-slate-300 dark:text-slate-700 normal-case">(required for Custom)</span></label>
                            <input
                                type="text"
                                value={newScheduleValue}
                                onChange={(e) => setNewScheduleValue(e.target.value)}
                                placeholder={newScheduleType === 'CUSTOM' ? '*/15 * * * *  (required)' : 'Not needed for preset schedules'}
                                disabled={newScheduleType !== 'CUSTOM'}
                                className="w-full bg-white dark:bg-black/20 border border-black/10 dark:border-white/10 rounded px-3 py-2 text-[11px] text-slate-900 dark:text-slate-300 outline-none focus:border-violet-500/50 font-mono disabled:opacity-40"
                            />
                        </div>
                        <div className="md:col-span-3 space-y-1">
                            <label className="text-[8px] uppercase font-bold text-slate-400 dark:text-slate-500">Pre-assigned Agent <span className="text-slate-300 dark:text-slate-700 normal-case">(auto-routed when triggered)</span></label>
                            <Select
                                value={newAssignedAgentId}
                                onValueChange={setNewAssignedAgentId}
                                options={agentOptions}
                                placeholder="— None (manual routing) —"
                            />
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={handleCreate}
                            className="px-5 py-2 bg-violet-600 text-white text-[10px] uppercase tracking-widest font-bold hover:bg-violet-500 transition-all"
                        >
                            Create Mission
                        </button>
                        <button
                            onClick={() => { setIsCreating(false); setNewTitle(''); setNewDescription(''); setNewScheduleValue(''); setNewAssignedAgentId(''); }}
                            className="px-5 py-2 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400 text-[10px] uppercase tracking-widest font-bold hover:bg-black/5 dark:hover:bg-white/5 transition-all"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            {recurringTasks.length === 0 ? (
                <EmptyState
                    icon={Clock}
                    title="No scheduled missions"
                    description="Create a recurring template to automatically generate tasks on a schedule."
                    action={{ label: '+ New Mission', onClick: () => setIsCreating(true) }}
                />
            ) : (
                <div className="space-y-3">
                    {recurringTasks.map((task) => {
                        const isLoading = loadingId === task.id;
                        const isEditing = editingTaskId === task.id;
                        return (
                            <div
                                key={task.id}
                                className="p-4 bg-white dark:bg-white/[0.02] border border-black/[0.05] dark:border-white/[0.05] rounded group hover:border-violet-500/30 transition-all"
                            >
                                {isEditing ? (
                                    /* ── Inline edit form ── */
                                    <div className="space-y-3">
                                        <h3 className="text-[9px] uppercase tracking-[0.2em] font-bold text-violet-500 mb-2">Edit Scheduled Mission</h3>
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                            <div className="md:col-span-3 space-y-1">
                                                <label className="text-[8px] uppercase font-bold text-slate-400 dark:text-slate-500">Mission Title *</label>
                                                <input
                                                    type="text"
                                                    value={editTitle}
                                                    onChange={(e) => setEditTitle(e.target.value)}
                                                    className="w-full bg-white dark:bg-black/20 border border-black/10 dark:border-white/10 rounded px-3 py-2 text-[11px] text-slate-900 dark:text-slate-300 outline-none focus:border-violet-500/50"
                                                    autoFocus
                                                />
                                            </div>
                                            <div className="md:col-span-3 space-y-1">
                                                <label className="text-[8px] uppercase font-bold text-slate-400 dark:text-slate-500">Task Content / Instructions</label>
                                                <textarea
                                                    value={editDescription}
                                                    onChange={(e) => setEditDescription(e.target.value)}
                                                    rows={3}
                                                    className="w-full bg-white dark:bg-black/20 border border-black/10 dark:border-white/10 rounded px-3 py-2 text-[11px] text-slate-900 dark:text-slate-300 outline-none focus:border-violet-500/50 resize-y"
                                                />
                                            </div>
                                            <div className="space-y-1">
                                                <label className="text-[8px] uppercase font-bold text-slate-400 dark:text-slate-500">Schedule Type</label>
                                                <Select
                                                    value={editScheduleType}
                                                    onValueChange={(v) => setEditScheduleType(v as RecurringScheduleType)}
                                                    options={SCHEDULE_TYPE_OPTIONS}
                                                    placeholder="— Schedule Type —"
                                                />
                                            </div>
                                            <div className="md:col-span-2 space-y-1">
                                                <label className="text-[8px] uppercase font-bold text-slate-400 dark:text-slate-500">Cron Expression <span className="text-slate-300 dark:text-slate-700 normal-case">(required for Custom)</span></label>
                                                <input
                                                    type="text"
                                                    value={editScheduleValue}
                                                    onChange={(e) => setEditScheduleValue(e.target.value)}
                                                    placeholder={editScheduleType === 'CUSTOM' ? '*/15 * * * *  (required)' : 'Not needed for preset schedules'}
                                                    disabled={editScheduleType !== 'CUSTOM'}
                                                    className="w-full bg-white dark:bg-black/20 border border-black/10 dark:border-white/10 rounded px-3 py-2 text-[11px] text-slate-900 dark:text-slate-300 outline-none focus:border-violet-500/50 font-mono disabled:opacity-40"
                                                />
                                            </div>
                                            <div className="md:col-span-3 space-y-1">
                                                <label className="text-[8px] uppercase font-bold text-slate-400 dark:text-slate-500">Pre-assigned Agent</label>
                                                <Select
                                                    value={editAssignedAgentId}
                                                    onValueChange={setEditAssignedAgentId}
                                                    options={agentOptions}
                                                    placeholder="— None (manual routing) —"
                                                />
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2 pt-1">
                                            <button
                                                onClick={handleSaveEdit}
                                                disabled={isLoading}
                                                className="flex items-center gap-1.5 px-4 py-1.5 bg-violet-600 text-white text-[9px] uppercase tracking-widest font-bold hover:bg-violet-500 transition-all rounded-sm disabled:opacity-50"
                                            >
                                                {isLoading ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />}
                                                Save
                                            </button>
                                            <button
                                                onClick={cancelEdit}
                                                disabled={isLoading}
                                                className="flex items-center gap-1.5 px-4 py-1.5 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400 text-[9px] uppercase tracking-widest font-bold hover:bg-black/5 dark:hover:bg-white/5 transition-all rounded-sm disabled:opacity-50"
                                            >
                                                <X size={10} />
                                                Cancel
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    /* ── Read-only row ── */
                                    <div className="flex items-center gap-4">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="text-sm font-bold text-slate-900 dark:text-slate-200 truncate">{task.title}</span>
                                                <Badge variant={task.status === 'ACTIVE' ? 'success' : 'default'}>
                                                    {task.status}
                                                </Badge>
                                            </div>
                                            {task.description && (
                                                <p className="text-[10px] text-slate-500 dark:text-slate-400 mb-1 line-clamp-2">{task.description}</p>
                                            )}
                                            {task.assigned_agent_id && (
                                                <div className="flex items-center gap-1 mb-1">
                                                    <Bot size={9} className="text-violet-500 dark:text-violet-400 flex-shrink-0" />
                                                    <span className="text-[9px] font-mono text-violet-600 dark:text-violet-400">
                                                        {agents.find((a) => a.id === task.assigned_agent_id)?.name ?? task.assigned_agent_id}
                                                    </span>
                                                </div>
                                            )}
                                            <div className="flex items-center gap-2 text-[9px] font-mono text-slate-400 dark:text-slate-600">
                                                <Clock size={10} />
                                                <span>{task.schedule_type}</span>
                                                {task.schedule_value && (
                                                    <>
                                                        <span className="text-slate-300 dark:text-slate-700">·</span>
                                                        <span>{task.schedule_value}</span>
                                                    </>
                                                )}
                                                {task.last_triggered_at && (
                                                    <>
                                                        <span className="text-slate-300 dark:text-slate-700">·</span>
                                                        <span>last run {new Date(task.last_triggered_at).toLocaleString()}</span>
                                                    </>
                                                )}
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-2 flex-shrink-0">
                                            {/* Edit */}
                                            <button
                                                onClick={() => openEdit(task)}
                                                title="Edit scheduled mission"
                                                className="p-1.5 text-slate-400 hover:text-violet-500 transition-colors opacity-0 group-hover:opacity-100"
                                            >
                                                <Pencil size={13} />
                                            </button>

                                            {/* Trigger Now */}
                                            <button
                                                onClick={() => handleTrigger(task.id)}
                                                disabled={isLoading}
                                                title="Trigger now — create a task from this template"
                                                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600/10 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-[9px] uppercase font-bold hover:bg-emerald-600/20 transition-all rounded-sm disabled:opacity-50"
                                            >
                                                {isLoading ? <Loader2 size={10} className="animate-spin" /> : <Zap size={10} />}
                                                Trigger
                                            </button>

                                            {/* Pause / Resume */}
                                            <button
                                                onClick={() => handleTogglePause(task)}
                                                disabled={isLoading}
                                                title={task.status === 'ACTIVE' ? 'Pause' : 'Resume'}
                                                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 dark:bg-white/[0.04] text-slate-600 dark:text-slate-400 text-[9px] uppercase font-bold hover:bg-slate-200 dark:hover:bg-white/[0.07] transition-all rounded-sm disabled:opacity-50"
                                            >
                                                {isLoading ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
                                                {task.status === 'ACTIVE' ? 'Pause' : 'Resume'}
                                            </button>

                                            {/* Delete */}
                                            <button
                                                onClick={() => handleDelete(task.id)}
                                                title="Delete scheduled mission"
                                                className="p-1.5 text-slate-400 hover:text-rose-500 transition-colors opacity-0 group-hover:opacity-100"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>

        <ConfirmDialog
            open={pendingDeleteId !== null}
            title="Delete Mission"
            message="Delete this scheduled mission? This cannot be undone."
            confirmLabel="Delete"
            variant="danger"
            onConfirm={confirmDelete}
            onCancel={() => setPendingDeleteId(null)}
        />
    </>
    );
};
