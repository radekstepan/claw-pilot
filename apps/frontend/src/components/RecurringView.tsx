import { useState } from 'react';
import { Plus, Trash2, Zap, Clock, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import type { CreateRecurringPayload, RecurringTask } from '@claw-pilot/shared-types';
import { useMissionStore } from '../store/useMissionStore';
import { Badge } from './ui/Badge';

export const RecurringView = () => {
    const { recurringTasks, createRecurring, deleteRecurring, updateRecurring, triggerRecurring } = useMissionStore();

    const [isCreating, setIsCreating] = useState(false);
    const [newTitle, setNewTitle] = useState('');
    const [newScheduleType, setNewScheduleType] = useState<string>('DAILY');
    const [newScheduleValue, setNewScheduleValue] = useState('');
    const [loadingId, setLoadingId] = useState<string | null>(null);

    const handleCreate = async () => {
        if (!newTitle.trim()) {
            toast.error('Mission title is required.');
            return;
        }
        const payload: CreateRecurringPayload = {
            title: newTitle.trim(),
            schedule_type: newScheduleType,
            schedule_value: newScheduleValue.trim() || undefined,
        };
        try {
            await createRecurring(payload);
            setNewTitle('');
            setNewScheduleValue('');
            setIsCreating(false);
        } catch {
            // error toast handled in store
        }
    };

    const handleDelete = async (id: string) => {
        if (!window.confirm('Delete this scheduled mission?')) return;
        await deleteRecurring(id);
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

    return (
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
                        <div className="space-y-1">
                            <label className="text-[8px] uppercase font-bold text-slate-400 dark:text-slate-500">Schedule Type</label>
                            <select
                                value={newScheduleType}
                                onChange={(e) => setNewScheduleType(e.target.value)}
                                className="w-full bg-white dark:bg-black/20 border border-black/10 dark:border-white/10 rounded px-3 py-2 text-[11px] text-slate-900 dark:text-slate-300 outline-none focus:border-violet-500/50"
                            >
                                <option value="HOURLY">Hourly</option>
                                <option value="DAILY">Daily</option>
                                <option value="WEEKLY">Weekly</option>
                                <option value="CUSTOM">Custom (cron)</option>
                            </select>
                        </div>
                        <div className="md:col-span-2 space-y-1">
                            <label className="text-[8px] uppercase font-bold text-slate-400 dark:text-slate-500">Schedule Value <span className="text-slate-300 dark:text-slate-700 normal-case">(optional, e.g. cron expr)</span></label>
                            <input
                                type="text"
                                value={newScheduleValue}
                                onChange={(e) => setNewScheduleValue(e.target.value)}
                                placeholder="e.g. 0 9 * * 1 for every Monday at 9am"
                                className="w-full bg-white dark:bg-black/20 border border-black/10 dark:border-white/10 rounded px-3 py-2 text-[11px] text-slate-900 dark:text-slate-300 outline-none focus:border-violet-500/50 font-mono"
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
                            onClick={() => setIsCreating(false)}
                            className="px-5 py-2 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400 text-[10px] uppercase tracking-widest font-bold hover:bg-black/5 dark:hover:bg-white/5 transition-all"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            {recurringTasks.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-24 text-center">
                    <Clock size={32} className="text-slate-300 dark:text-slate-700 mb-4" />
                    <p className="text-sm font-bold text-slate-400 dark:text-slate-600 mb-1">No scheduled missions</p>
                    <p className="text-xs text-slate-400 dark:text-slate-700 max-w-xs">
                        Create a recurring template to automatically generate tasks on a schedule.
                    </p>
                </div>
            ) : (
                <div className="space-y-3">
                    {recurringTasks.map((task) => {
                        const isLoading = loadingId === task.id;
                        return (
                            <div
                                key={task.id}
                                className="flex items-center gap-4 p-4 bg-white dark:bg-white/[0.02] border border-black/[0.05] dark:border-white/[0.05] rounded group hover:border-violet-500/30 transition-all"
                            >
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="text-sm font-bold text-slate-900 dark:text-slate-200 truncate">{task.title}</span>
                                        <Badge variant={task.status === 'ACTIVE' ? 'success' : 'default'}>
                                            {task.status}
                                        </Badge>
                                    </div>
                                    <div className="flex items-center gap-2 text-[9px] font-mono text-slate-400 dark:text-slate-600">
                                        <Clock size={10} />
                                        <span>{task.schedule_type}</span>
                                        {task.schedule_value && (
                                            <>
                                                <span className="text-slate-300 dark:text-slate-700">·</span>
                                                <span>{task.schedule_value}</span>
                                            </>
                                        )}
                                    </div>
                                </div>

                                <div className="flex items-center gap-2 flex-shrink-0">
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
                        );
                    })}
                </div>
            )}
        </div>
    );
};
