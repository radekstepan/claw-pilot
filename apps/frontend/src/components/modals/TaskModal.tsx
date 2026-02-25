import { useState } from 'react';
import { X, CheckCircle2, Circle, ThumbsUp, ThumbsDown, Loader2, AlertTriangle, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { Agent, Task, TaskPriority } from '@claw-pilot/shared-types';
import { Badge } from '../ui/Badge';
import { StatusDot } from '../ui/StatusDot';
import { COLUMN_TITLES } from '../../constants';
import { useMissionStore } from '../../store/useMissionStore';
import { api } from '../../api/client';

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

    // Editable form state — initialized from the task prop
    const [title, setTitle] = useState(task?.title ?? '');
    const [description, setDescription] = useState(task?.description ?? '');
    const [priority, setPriority] = useState<TaskPriority | ''>(task?.priority ?? '');
    const [assigneeId, setAssigneeId] = useState(task?.assignee_id ?? '');

    const { updateTaskLocally, updateTask, deleteTask, toggleDeliverable } = useMissionStore();

    if (!task) return null;
    const agent = agents.find(a => a.id === (assigneeId || task.assignee_id));

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
        if (!showFeedbackInput) {
            setShowFeedbackInput(true);
            return;
        }
        if (!feedback.trim()) {
            toast.error('Please provide feedback before rejecting.');
            return;
        }
        setIsSubmitting(true);
        const snapshot = { ...task };
        updateTaskLocally({ ...task, status: 'IN_PROGRESS' });
        try {
            await api.reviewTask(task.id, 'reject', feedback);
            toast.success('Task rejected. Agent has been notified with your feedback.');
            onClose();
        } catch {
            updateTaskLocally(snapshot);
            toast.error('Failed to reject task. Changes reverted.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleUpdateTask = async () => {
        setIsSubmitting(true);
        try {
            const patch: Partial<Task> = {
                title: title || undefined,
                description: description || undefined,
                priority: (priority as TaskPriority) || undefined,
                assignee_id: assigneeId || undefined,
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
        if (!window.confirm('Delete this task? This cannot be undone.')) return;
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
                            <Badge variant={task.status === 'DONE' ? 'success' : 'violet'}>{COLUMN_TITLES[task.status]}</Badge>
                        </div>
                        <input
                            type="text"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            className="text-xl font-bold text-slate-900 dark:text-white tracking-tight bg-transparent border-none outline-none w-full focus:ring-1 focus:ring-violet-500/50 rounded px-1 -ml-1"
                        />
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                            onClick={handleDeleteTask}
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

                        {task.status === 'REVIEW' && (
                            <section className="mb-8 p-4 border border-amber-400/40 bg-amber-400/[0.06] rounded">
                                <div className="flex items-center gap-2 mb-3">
                                    <AlertTriangle size={14} className="text-amber-500" />
                                    <h3 className="text-[10px] uppercase tracking-[0.2em] font-bold text-amber-600 dark:text-amber-400">Awaiting Human Review</h3>
                                </div>
                                <p className="text-xs text-slate-600 dark:text-slate-400 mb-4 leading-relaxed">
                                    This task was submitted for review by the assigned agent. As the human lead, only you can approve or reject it.
                                </p>
                                {showFeedbackInput && (
                                    <textarea
                                        autoFocus
                                        rows={3}
                                        placeholder="Describe what needs to be revised..."
                                        value={feedback}
                                        onChange={(e) => setFeedback(e.target.value)}
                                        className="w-full mb-3 bg-white dark:bg-white/[0.03] border border-black/10 dark:border-white/10 rounded-sm p-2 text-[11px] text-slate-900 dark:text-slate-200 placeholder:text-slate-400 focus:border-violet-500/50 outline-none resize-none"
                                    />
                                )}
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
                                        {showFeedbackInput ? 'Send Feedback' : 'Reject'}
                                    </button>
                                </div>
                            </section>
                        )}

                        <section className="mb-8">
                            <h3 className="text-[10px] uppercase tracking-[0.2em] font-bold text-slate-400 dark:text-slate-500 mb-3">Project Description</h3>
                            <textarea
                                rows={5}
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder="No description…"
                                className="w-full bg-transparent border border-black/[0.04] dark:border-white/[0.04] rounded p-2 text-slate-600 dark:text-slate-300 text-sm leading-relaxed resize-none focus:border-violet-500/50 outline-none"
                            />
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
                                <p className="text-xs text-slate-400 dark:text-slate-600 italic">No deliverables defined for this task.</p>
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
                            <select
                                value={assigneeId}
                                onChange={(e) => setAssigneeId(e.target.value)}
                                className="w-full bg-white dark:bg-white/[0.03] border border-black/10 dark:border-white/10 rounded px-2 py-1.5 text-[11px] text-slate-900 dark:text-slate-300 outline-none focus:border-violet-500/50"
                            >
                                <option value="">— Unassigned —</option>
                                {agents.map(a => (
                                    <option key={a.id} value={a.id}>{a.name}</option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <h3 className="text-[10px] uppercase tracking-[0.2em] font-bold text-slate-400 dark:text-slate-500 mb-3">Priority</h3>
                            <select
                                value={priority}
                                onChange={(e) => setPriority(e.target.value as TaskPriority | '')}
                                className="w-full bg-white dark:bg-white/[0.03] border border-black/10 dark:border-white/10 rounded px-2 py-1.5 text-[11px] text-slate-900 dark:text-slate-300 outline-none focus:border-violet-500/50"
                            >
                                <option value="">— None —</option>
                                <option value="LOW">LOW</option>
                                <option value="MEDIUM">MEDIUM</option>
                                <option value="HIGH">HIGH</option>
                            </select>
                        </div>
                    </div>
                </div>

                <div className="p-4 border-t border-black/[0.04] dark:border-white/[0.04] bg-slate-50 dark:bg-white/[0.02] flex items-center justify-end gap-3">
                    <button onClick={onClose} className="px-5 py-2 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400 text-[10px] uppercase tracking-widest font-bold hover:bg-black/5 dark:hover:bg-white/5 transition-all">
                        Close
                    </button>
                    {task.status !== 'REVIEW' && (
                        <button
                            onClick={handleUpdateTask}
                            disabled={isSubmitting}
                            className="flex items-center gap-1.5 px-5 py-2 bg-violet-600 text-white text-[10px] uppercase tracking-widest font-bold hover:bg-violet-500 disabled:opacity-50 transition-all"
                        >
                            {isSubmitting && <Loader2 size={12} className="animate-spin" />}
                            Update Task
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

