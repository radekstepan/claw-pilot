import { useState, useEffect } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { X, CheckCircle2, Circle, ThumbsUp, ThumbsDown, Loader2, AlertTriangle, Trash2, Package, Zap, ScrollText } from 'lucide-react';
import { toast } from 'sonner';
import type { Agent, Task, ActivityLog } from '@claw-pilot/shared-types';
import { Badge } from '../ui/Badge';
import { StatusDot } from '../ui/StatusDot';
import { COLUMN_TITLES } from '../../constants';
import { useMissionStore } from '../../store/useMissionStore';
import { api } from '../../api/client';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Select } from '../ui/Select';
import { EmptyState } from '../ui/EmptyState';
import { MarkdownContent } from '../ui/MarkdownContent';

const updateFormSchema = z.object({
    title: z.string().min(1, 'Title cannot be empty.'),
    description: z.string().optional(),
    priority: z.string().optional(),
    assignee_id: z.string().optional(),
});
type UpdateFormValues = z.infer<typeof updateFormSchema>;

const NONE_VALUE = '__NONE__';

const PRIORITY_OPTIONS = [
    { value: NONE_VALUE, label: '— None —' },
    { value: 'LOW', label: 'LOW' },
    { value: 'MEDIUM', label: 'MEDIUM' },
    { value: 'HIGH', label: 'HIGH' },
];

interface TaskModalProps {
    task: Task | null;
    onClose: () => void;
    agents: Agent[];
}

export const TaskModal = ({ task, onClose, agents }: TaskModalProps) => {
    const [feedback, setFeedback] = useState('');
    const [showFeedbackInput, setShowFeedbackInput] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [isRouting, setIsRouting] = useState(false);
    const [routeAgentId, setRouteAgentId] = useState<string>(task?.agentId ?? task?.assignee_id ?? '');
    const [taskActivities, setTaskActivities] = useState<ActivityLog[]>([]);
    const [activitiesLoading, setActivitiesLoading] = useState(false);
    const [descPreview, setDescPreview] = useState(false);
    const [showRetryPrompt, setShowRetryPrompt] = useState(false);
    const [retryPrompt, setRetryPrompt] = useState(() =>
        task ? `${task.title}\n\n${task.description || ''}`.trim() : ''
    );
    const [showRejectPrompt, setShowRejectPrompt] = useState(false);
    const [rejectPrompt, setRejectPrompt] = useState(() =>
        task ? `A human reviewer rejected your previous attempt with this feedback:\n\nPlease redo the task taking this feedback into account.\n\nOriginal task:\n${task.title}\n${task.description || ''}` : ''
    );

    const {
        register,
        handleSubmit,
        control,
        watch,
        formState: { errors },
    } = useForm<UpdateFormValues>({
        resolver: zodResolver(updateFormSchema),
        defaultValues: {
            title: task?.title ?? '',
            description: task?.description ?? '',
            priority: task?.priority || NONE_VALUE,
            assignee_id: task?.assignee_id || NONE_VALUE,
        },
    });

    const assigneeId = watch('assignee_id');

    const { updateTaskLocally, updateTask, deleteTask, toggleDeliverable, routeTask } = useMissionStore();

    useEffect(() => {
        if (!task) return;
        setActivitiesLoading(true);
        api.getTaskActivities(task.id)
            .then(setTaskActivities)
            .catch(() => setTaskActivities([]))
            .finally(() => setActivitiesLoading(false));
    }, [task?.id]);

    if (!task) return null;
    const agent = agents.find(a => a.id === (assigneeId || task.assignee_id));

    const agentOptions = [
        { value: NONE_VALUE, label: '— Unassigned —' },
        ...agents.filter(a => !!a.id).map(a => ({ value: a.id, label: a.name })),
    ];

    const handleRouteToAgent = async () => {
        if (!routeAgentId) {
            return;
        }
        setIsRouting(true);
        try {
            await routeTask(task!.id, routeAgentId, showRetryPrompt ? retryPrompt : undefined);
            onClose();
        } catch {
            // error toast is handled in store
        } finally {
            setIsRouting(false);
        }
    };

    const handleApprove = async () => {
        setIsSubmitting(true);
        const snapshot = { ...task };
        updateTaskLocally({ ...task, status: 'DONE' });
        try {
            await api.reviewTask(task.id, 'approve');
            toast.success('Task approved and moved to DONE.');
            onClose();
        } catch {
            updateTaskLocally(snapshot);
            toast.error('Failed to approve task. Changes reverted.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleReject = async () => {
        if (!showFeedbackInput && !showRejectPrompt) {
            setShowFeedbackInput(true);
            return;
        }
        if (showFeedbackInput && !feedback.trim()) {
            toast.error('Please provide feedback before rejecting.');
            return;
        }
        if (showRejectPrompt && !rejectPrompt.trim()) {
            toast.error('Please provide a prompt before rejecting.');
            return;
        }
        setIsSubmitting(true);
        const snapshot = { ...task };
        updateTaskLocally({ ...task, status: 'IN_PROGRESS' });
        try {
            await api.reviewTask(
                task.id,
                'reject',
                showRejectPrompt ? undefined : feedback,
                showRejectPrompt ? rejectPrompt : undefined
            );
            toast.success('Task rejected. Agent has been notified with your feedback.');
            onClose();
        } catch {
            updateTaskLocally(snapshot);
            toast.error('Failed to reject task. Changes reverted.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleUpdateTask = async (data: UpdateFormValues) => {
        setIsSubmitting(true);
        try {
            const patch: Partial<Task> = {
                title: data.title || undefined,
                description: data.description || undefined,
                priority: data.priority === NONE_VALUE ? undefined : (data.priority as Task['priority']),
                assignee_id: data.assignee_id === NONE_VALUE ? undefined : data.assignee_id,
            };
            await updateTask(task.id, patch);
            toast.success('Task updated.');
            onClose();
        } catch {
            // error toast handled in store
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDeleteTask = async () => {
        setIsDeleting(true);
        try {
            await deleteTask(task.id);
            onClose();
        } catch {
            // error toast handled in store
        } finally {
            setIsDeleting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <div className="absolute inset-0 bg-slate-900/50 dark:bg-black/80" onClick={onClose} />
            <div className="relative w-full max-w-2xl bg-white dark:bg-[#0c0a14] border border-black/10 dark:border-white/10 shadow-2xl flex flex-col max-h-[90vh] animate-fadeIn">

                <div className="p-6 border-b border-black/[0.04] dark:border-white/[0.04] flex items-start justify-between">
                    <div className="flex-1 min-w-0 pr-4">
                        <div className="flex items-center gap-2 mb-2">
                            <span className="text-[10px] font-mono text-violet-600 dark:text-violet-400">{task.id}</span>
                            <div className="h-1 w-1 rounded-full bg-slate-200 dark:bg-slate-700" />
                            <Badge variant={task.status === 'DONE' ? 'success' : task.status === 'STUCK' ? 'danger' : 'violet'}>{COLUMN_TITLES[task.status]}</Badge>
                        </div>
                        <input
                            type="text"
                            {...register('title')}
                            className="text-xl font-bold text-slate-900 dark:text-white tracking-tight bg-transparent border-none outline-none w-full focus:ring-1 focus:ring-violet-500/50 rounded px-1 -ml-1 aria-[invalid=true]:ring-1 aria-[invalid=true]:ring-rose-500/50"
                            aria-invalid={errors.title ? 'true' : 'false'}
                        />
                        {errors.title && (
                            <p className="text-rose-400 text-[10px] mt-1" role="alert">{errors.title.message}</p>
                        )}
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                            onClick={() => setShowDeleteConfirm(true)}
                            disabled={isDeleting}
                            title="Delete task"
                            className="p-2 text-slate-400 hover:text-rose-500 transition-colors disabled:opacity-50"
                        >
                            {isDeleting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                        </button>
                        <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors">
                            <X size={20} />
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-6 flex flex-col md:flex-row gap-8">
                    <div className="flex-1">

                        {task.status === 'STUCK' && (
                            <section className="mb-8 p-4 border border-rose-500/30 bg-rose-500/[0.04] rounded">
                                <div className="flex items-center gap-2 mb-3">
                                    <AlertTriangle size={14} className="text-rose-500" />
                                    <h3 className="text-[10px] uppercase tracking-[0.2em] font-bold text-rose-600 dark:text-rose-400">Agent Error — Task Stuck</h3>
                                </div>
                                {(() => {
                                    const lastError = taskActivities.find(a => a.message.startsWith('error:'));
                                    return lastError ? (
                                        <p className="text-xs text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800/40 rounded p-2 mb-4 leading-relaxed font-mono">
                                            {lastError.message}
                                        </p>
                                    ) : (
                                        <p className="text-xs text-slate-600 dark:text-slate-400 mb-4 leading-relaxed">
                                            The agent encountered an error and could not complete this task.
                                        </p>
                                    );
                                })()}
                                <p className="text-xs text-slate-600 dark:text-slate-400 mb-4 leading-relaxed">
                                    Re-route this task to retry with the same or a different agent.
                                </p>
                                {agents.length === 0 ? (
                                    <EmptyState icon={AlertTriangle} title="No agents available" description="No agents are connected. Check the gateway." />
                                ) : (
                                    <div className="flex flex-col gap-3">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <input
                                                    type="checkbox"
                                                    id="editRetryPrompt"
                                                    checked={showRetryPrompt}
                                                    onChange={(e) => setShowRetryPrompt(e.target.checked)}
                                                    className="w-3 h-3 text-rose-600 focus:ring-rose-500 border-rose-300 rounded"
                                                />
                                                <label htmlFor="editRetryPrompt" className="text-[10px] uppercase tracking-wider font-bold text-rose-600/80 cursor-pointer">Edit Prompt</label>
                                            </div>
                                        </div>
                                        {showRetryPrompt && (
                                            <textarea
                                                rows={4}
                                                value={retryPrompt}
                                                onChange={(e) => setRetryPrompt(e.target.value)}
                                                className="w-full bg-white dark:bg-white/[0.03] border border-rose-500/20 rounded-sm p-3 text-xs text-slate-900 dark:text-slate-200 placeholder:text-slate-400 focus:border-rose-500/50 outline-none resize-y"
                                            />
                                        )}
                                        <div className="flex items-center gap-2">
                                            <div className="flex-1">
                                                <Select
                                                    value={routeAgentId || '__NONE__'}
                                                    onValueChange={(v) => setRouteAgentId(v === '__NONE__' ? '' : v)}
                                                    options={[
                                                        { value: '__NONE__', label: '— Pick an agent —' },
                                                        ...agents.filter(a => !!a.id).map(a => ({ value: a.id, label: a.name })),
                                                    ]}
                                                    placeholder="— Pick an agent —"
                                                />
                                            </div>
                                            <button
                                                onClick={handleRouteToAgent}
                                                disabled={isRouting || !routeAgentId}
                                                className="flex items-center gap-1.5 px-4 py-2 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-[10px] uppercase tracking-widest font-bold transition-all rounded-sm whitespace-nowrap"
                                            >
                                                {isRouting ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
                                                Retry
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </section>
                        )}

                        {task.status !== 'IN_PROGRESS' && task.status !== 'REVIEW' && task.status !== 'DONE' && task.status !== 'STUCK' && (
                            <section className="mb-8 p-4 border border-violet-500/20 bg-violet-500/[0.04] rounded">
                                <div className="flex items-center gap-2 mb-3">
                                    <Zap size={14} className="text-violet-500" />
                                    <h3 className="text-[10px] uppercase tracking-[0.2em] font-bold text-violet-600 dark:text-violet-400">Dispatch to Agent</h3>
                                </div>
                                <p className="text-xs text-slate-600 dark:text-slate-400 mb-4 leading-relaxed">
                                    Route this task to an AI agent. The agent will receive the title and description as its prompt and begin working immediately.
                                </p>
                                {agents.length === 0 ? (
                                    <EmptyState icon={Zap} title="No agents available" description="No agents are connected. Check the gateway." />
                                ) : (
                                    <div className="flex items-center gap-2">
                                        <div className="flex-1">
                                            <Select
                                                value={routeAgentId || '__NONE__'}
                                                onValueChange={(v) => setRouteAgentId(v === '__NONE__' ? '' : v)}
                                                options={[
                                                    { value: '__NONE__', label: '— Pick an agent —' },
                                                    ...agents.filter(a => !!a.id).map(a => ({ value: a.id, label: a.name })),
                                                ]}
                                                placeholder="— Pick an agent —"
                                            />
                                        </div>
                                        <button
                                            onClick={handleRouteToAgent}
                                            disabled={isRouting || !routeAgentId}
                                            className="flex items-center gap-1.5 px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-[10px] uppercase tracking-widest font-bold transition-all rounded-sm whitespace-nowrap"
                                        >
                                            {isRouting ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
                                            Route
                                        </button>
                                    </div>
                                )}
                            </section>
                        )}

                        {task.status === 'REVIEW' && (
                            <section className="mb-8 p-4 border border-amber-400/40 bg-amber-400/[0.06] rounded">
                                <div className="flex items-center gap-2 mb-3">
                                    <AlertTriangle size={14} className="text-amber-500" />
                                    <h3 className="text-[10px] uppercase tracking-[0.2em] font-bold text-amber-600 dark:text-amber-400">Awaiting Human Review</h3>
                                </div>
                                <p className="text-xs text-slate-600 dark:text-slate-400 mb-4 leading-relaxed">
                                    This task was submitted for review by the assigned agent. As the human lead, only you can approve or reject it.
                                </p>
                                {showFeedbackInput && !showRejectPrompt && (
                                    <textarea
                                        autoFocus
                                        rows={3}
                                        placeholder="Describe what needs to be revised..."
                                        value={feedback}
                                        onChange={(e) => setFeedback(e.target.value)}
                                        className="w-full mb-3 bg-white dark:bg-white/[0.03] border border-black/10 dark:border-white/10 rounded-sm p-2 text-[11px] text-slate-900 dark:text-slate-200 placeholder:text-slate-400 focus:border-violet-500/50 outline-none resize-none"
                                    />
                                )}
                                {showRejectPrompt && (
                                    <div className="mb-3">
                                        <textarea
                                            autoFocus
                                            rows={6}
                                            value={rejectPrompt}
                                            onChange={(e) => setRejectPrompt(e.target.value)}
                                            className="w-full bg-white dark:bg-white/[0.03] border border-amber-500/20 rounded-sm p-3 text-xs text-slate-900 dark:text-slate-200 focus:border-amber-500/50 outline-none resize-y font-mono font-medium"
                                        />
                                        <p className="text-[10px] text-amber-600 dark:text-amber-500/80 mt-1 uppercase tracking-wider">
                                            Raw payload (agent will receive this exact text).
                                        </p>
                                    </div>
                                )}
                                <div className="flex items-center justify-between mb-3">
                                    <div className="flex items-center gap-2">
                                        {(showFeedbackInput || showRejectPrompt) && (
                                            <>
                                                <input
                                                    type="checkbox"
                                                    id="editRejectPrompt"
                                                    checked={showRejectPrompt}
                                                    onChange={(e) => {
                                                        const wantRaw = e.target.checked;
                                                        setShowRejectPrompt(wantRaw);
                                                        setShowFeedbackInput(!wantRaw);
                                                    }}
                                                    className="w-3 h-3 text-amber-500 focus:ring-amber-500 border-amber-300 rounded"
                                                />
                                                <label htmlFor="editRejectPrompt" className="text-[10px] uppercase tracking-wider font-bold text-amber-600/80 cursor-pointer">Edit Raw Payload</label>
                                            </>
                                        )}
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={handleApprove}
                                        disabled={isSubmitting}
                                        className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-[10px] uppercase tracking-widest font-bold transition-all rounded-sm"
                                    >
                                        {isSubmitting ? <Loader2 size={12} className="animate-spin" /> : <ThumbsUp size={12} />}
                                        Approve
                                    </button>
                                    <button
                                        onClick={handleReject}
                                        disabled={isSubmitting}
                                        className="flex items-center gap-1.5 px-4 py-2 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-[10px] uppercase tracking-widest font-bold transition-all rounded-sm"
                                    >
                                        {isSubmitting ? <Loader2 size={12} className="animate-spin" /> : <ThumbsDown size={12} />}
                                        {(showFeedbackInput || showRejectPrompt) ? 'Send Feedback' : 'Reject'}
                                    </button>
                                </div>
                            </section>
                        )}

                        <section className="mb-8">
                            <h3 className="text-[10px] uppercase tracking-[0.2em] font-bold text-slate-400 dark:text-slate-500 mb-3">
                                Activity Log
                                {taskActivities.length > 0 && (
                                    <span className="ml-2 text-slate-300 dark:text-slate-600 normal-case tracking-normal font-normal">
                                        ({taskActivities.length})
                                    </span>
                                )}
                            </h3>
                            {activitiesLoading ? (
                                <div className="flex items-center gap-2 text-xs text-slate-400 py-2">
                                    <Loader2 size={12} className="animate-spin" /> Loading…
                                </div>
                            ) : taskActivities.length === 0 ? (
                                <EmptyState icon={ScrollText} title="No activity yet" description="Activity from agents will appear here." />
                            ) : (
                                <div className="space-y-2">
                                    {taskActivities.map((a) => (
                                        <div key={a.id} className={`p-3 rounded border text-xs leading-relaxed ${a.message.startsWith('completed:') || a.message.startsWith('done:')
                                                ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800/40'
                                                : a.message.startsWith('error:')
                                                    ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800/40'
                                                    : 'bg-slate-50 dark:bg-white/[0.02] border-black/[0.04] dark:border-white/[0.04]'
                                            }`}>
                                            <div className="flex items-center justify-between mb-1">
                                                <span className="font-semibold text-slate-700 dark:text-slate-300">{a.agentId ?? 'system'}</span>
                                                <span className="text-[10px] text-slate-400">{new Date(a.timestamp).toLocaleString()}</span>
                                            </div>
                                            <p className="text-slate-600 dark:text-slate-300">
                                                <MarkdownContent content={a.message} />
                                            </p>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </section>

                        <section className="mb-8">
                            <div className="flex items-center justify-between mb-3">
                                <h3 className="text-[10px] uppercase tracking-[0.2em] font-bold text-slate-400 dark:text-slate-500">Project Description</h3>
                                <div className="flex items-center gap-px border border-black/[0.06] dark:border-white/[0.06] rounded overflow-hidden">
                                    <button
                                        type="button"
                                        onClick={() => setDescPreview(false)}
                                        className={`px-2 py-0.5 text-[9px] uppercase tracking-wider font-bold transition-colors ${!descPreview
                                                ? 'bg-violet-600 text-white'
                                                : 'text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                                            }`}
                                    >
                                        Edit
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setDescPreview(true)}
                                        className={`px-2 py-0.5 text-[9px] uppercase tracking-wider font-bold transition-colors ${descPreview
                                                ? 'bg-violet-600 text-white'
                                                : 'text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                                            }`}
                                    >
                                        Preview
                                    </button>
                                </div>
                            </div>
                            <textarea
                                rows={5}
                                {...register('description')}
                                placeholder="No description…"
                                className={`w-full bg-transparent border border-black/[0.04] dark:border-white/[0.04] rounded p-2 text-slate-600 dark:text-slate-300 text-sm leading-relaxed resize-none focus:border-violet-500/50 outline-none ${descPreview ? 'hidden' : ''
                                    }`}
                            />
                            {descPreview && (
                                <div className="min-h-[7rem] border border-black/[0.04] dark:border-white/[0.04] rounded p-2">
                                    {watch('description') ? (
                                        <MarkdownContent content={watch('description') ?? ''} />
                                    ) : (
                                        <p className="text-slate-400 dark:text-slate-600 text-sm italic">No description…</p>
                                    )}
                                </div>
                            )}
                        </section>

                        <section className="mb-8">
                            <h3 className="text-[10px] uppercase tracking-[0.2em] font-bold text-slate-400 dark:text-slate-500 mb-3">
                                Deliverables
                                {task.deliverables && task.deliverables.length > 0 && (
                                    <span className="ml-2 text-slate-300 dark:text-slate-600 normal-case tracking-normal font-normal">
                                        ({task.deliverables.filter(d => d.status === 'COMPLETED').length}/{task.deliverables.length})
                                    </span>
                                )}
                            </h3>
                            {!task.deliverables || task.deliverables.length === 0 ? (
                                <EmptyState
                                    icon={Package}
                                    title="No deliverables"
                                    description="No deliverables defined for this task."
                                />
                            ) : (
                                <div className="space-y-2">
                                    {task.deliverables.map((d) => (
                                        <button
                                            key={d.id}
                                            onClick={() => toggleDeliverable(d.id, task.id)}
                                            className="w-full flex items-center gap-3 p-2 bg-slate-50 dark:bg-white/[0.02] border border-black/[0.04] dark:border-white/[0.04] rounded hover:border-violet-500/30 transition-all text-left"
                                        >
                                            <div className="w-4 h-4 flex-shrink-0 text-emerald-600 dark:text-emerald-500">
                                                {d.status === 'COMPLETED'
                                                    ? <CheckCircle2 size={14} />
                                                    : <Circle size={14} className="text-slate-300 dark:text-slate-600" />}
                                            </div>
                                            <span className={`text-xs ${d.status === 'COMPLETED' ? 'line-through text-slate-400 dark:text-slate-600' : 'text-slate-600 dark:text-slate-300'}`}>
                                                {d.title}
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </section>
                    </div>

                    <div className="w-full md:w-56 space-y-6">
                        <div>
                            <h3 className="text-[10px] uppercase tracking-[0.2em] font-bold text-slate-400 dark:text-slate-500 mb-3">Assignee</h3>
                            {agent && assigneeId && (
                                <div className="mb-2 flex items-center gap-3 p-3 bg-slate-50 dark:bg-white/[0.02] border border-black/[0.04] dark:border-white/[0.04] rounded">
                                    <div className="w-8 h-8 bg-slate-100 dark:bg-white/5 rounded flex items-center justify-center">
                                        <StatusDot status={agent.status} />
                                    </div>
                                    <div>
                                        <div className="text-xs font-bold text-slate-900 dark:text-slate-200">{agent.name}</div>
                                        <div className="text-[9px] text-slate-500 uppercase">{agent.role ?? '—'}</div>
                                    </div>
                                </div>
                            )}
                            <Controller
                                name="assignee_id"
                                control={control}
                                render={({ field }) => (
                                    <Select
                                        value={field.value || NONE_VALUE}
                                        onValueChange={field.onChange}
                                        options={agentOptions}
                                        placeholder="— Unassigned —"
                                    />
                                )}
                            />
                        </div>

                        <div>
                            <h3 className="text-[10px] uppercase tracking-[0.2em] font-bold text-slate-400 dark:text-slate-500 mb-3">Priority</h3>
                            <Controller
                                name="priority"
                                control={control}
                                render={({ field }) => (
                                    <Select
                                        value={field.value || NONE_VALUE}
                                        onValueChange={field.onChange}
                                        options={PRIORITY_OPTIONS}
                                        placeholder="— None —"
                                    />
                                )}
                            />
                        </div>
                    </div>
                </div>

                <div className="p-4 border-t border-black/[0.04] dark:border-white/[0.04] bg-slate-50 dark:bg-white/[0.02] flex items-center justify-end gap-3">
                    <button onClick={onClose} className="px-5 py-2 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400 text-[10px] uppercase tracking-widest font-bold hover:bg-black/5 dark:hover:bg-white/5 transition-all">
                        Close
                    </button>
                    {task.status !== 'REVIEW' && (
                        <button
                            onClick={handleSubmit(handleUpdateTask)}
                            disabled={isSubmitting}
                            className="flex items-center gap-1.5 px-5 py-2 bg-violet-600 text-white text-[10px] uppercase tracking-widest font-bold hover:bg-violet-500 disabled:opacity-50 transition-all"
                        >
                            {isSubmitting && <Loader2 size={12} className="animate-spin" />}
                            Update Task
                        </button>
                    )}
                </div>
            </div>

            <ConfirmDialog
                open={showDeleteConfirm}
                title="Delete Task"
                message="Delete this task? This cannot be undone."
                confirmLabel="Delete"
                variant="danger"
                onConfirm={handleDeleteTask}
                onCancel={() => setShowDeleteConfirm(false)}
            />
        </div>
    );
};

