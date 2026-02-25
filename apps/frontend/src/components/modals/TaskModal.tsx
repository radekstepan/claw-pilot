import { X, CheckCircle2 } from 'lucide-react';
import { Agent, Task } from '../../types';
import { Badge } from '../ui/Badge';
import { StatusDot } from '../ui/StatusDot';
import { COLUMN_TITLES } from '../../constants';

interface TaskModalProps {
    task: Task | null;
    onClose: () => void;
    agents: Agent[];
}

export const TaskModal = ({ task, onClose, agents }: TaskModalProps) => {
    if (!task) return null;
    const agent = agents.find(a => a.id === task.assignee);

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <div className="absolute inset-0 bg-slate-900/50 dark:bg-black/80" onClick={onClose} />
            <div className="relative w-full max-w-2xl bg-white dark:bg-[#0c0a14] border border-black/10 dark:border-white/10 shadow-2xl flex flex-col max-h-[90vh] animate-fadeIn">

                <div className="p-6 border-b border-black/[0.04] dark:border-white/[0.04] flex items-start justify-between">
                    <div>
                        <div className="flex items-center gap-2 mb-2">
                            <span className="text-[10px] font-mono text-violet-600 dark:text-violet-400">{task.id}</span>
                            <div className="h-1 w-1 rounded-full bg-slate-200 dark:bg-slate-700" />
                            <Badge variant={task.status === 'DONE' ? 'success' : 'violet'}>{COLUMN_TITLES[task.status]}</Badge>
                        </div>
                        <h2 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">{task.title}</h2>
                    </div>
                    <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors">
                        <X size={20} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 flex flex-col md:flex-row gap-8">
                    <div className="flex-1">
                        <section className="mb-8">
                            <h3 className="text-[10px] uppercase tracking-[0.2em] font-bold text-slate-400 dark:text-slate-500 mb-3">Project Description</h3>
                            <p className="text-slate-600 dark:text-slate-300 text-sm leading-relaxed whitespace-pre-wrap">
                                {task.description}
                                {"\n\n"}
                                This mission involves automated agent orchestration through the OpenClaw gateway.
                            </p>
                        </section>

                        <section className="mb-8">
                            <h3 className="text-[10px] uppercase tracking-[0.2em] font-bold text-slate-400 dark:text-slate-500 mb-3">Deliverables</h3>
                            <div className="space-y-2">
                                {['Verified source code', 'Performance report'].map((item, i) => (
                                    <div key={i} className="flex items-center gap-3 p-2 bg-slate-50 dark:bg-white/[0.02] border border-black/[0.04] dark:border-white/[0.04] rounded">
                                        <div className="w-4 h-4 rounded border border-slate-300 dark:border-white/20 flex items-center justify-center text-emerald-600 dark:text-emerald-500">
                                            {i === 0 && <CheckCircle2 size={12} />}
                                        </div>
                                        <span className="text-xs text-slate-500">{item}</span>
                                    </div>
                                ))}
                            </div>
                        </section>
                    </div>

                    <div className="w-full md:w-56 space-y-6">
                        <div>
                            <h3 className="text-[10px] uppercase tracking-[0.2em] font-bold text-slate-400 dark:text-slate-500 mb-3">Assignee</h3>
                            {agent ? (
                                <div className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-white/[0.02] border border-black/[0.04] dark:border-white/[0.04] rounded">
                                    <div className="w-8 h-8 bg-slate-100 dark:bg-white/5 rounded flex items-center justify-center">
                                        <StatusDot status={agent.status} />
                                    </div>
                                    <div>
                                        <div className="text-xs font-bold text-slate-900 dark:text-slate-200">{agent.name}</div>
                                        <div className="text-[9px] text-slate-500 uppercase">{agent.role}</div>
                                    </div>
                                </div>
                            ) : (
                                <button className="w-full p-3 border border-dashed border-slate-300 dark:border-white/10 rounded text-[10px] uppercase font-bold text-slate-400 hover:text-violet-600 dark:hover:text-violet-400 transition-all">
                                    Assign Agent
                                </button>
                            )}
                        </div>
                        <div>
                            <h3 className="text-[10px] uppercase tracking-[0.2em] font-bold text-slate-400 dark:text-slate-500 mb-3">Priority</h3>
                            <Badge variant={task.priority === 'URGENT' ? 'urgent' : 'default'}>{task.priority}</Badge>
                        </div>
                    </div>
                </div>

                <div className="p-4 border-t border-black/[0.04] dark:border-white/[0.04] bg-slate-50 dark:bg-white/[0.02] flex items-center justify-end gap-3">
                    <button onClick={onClose} className="px-5 py-2 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400 text-[10px] uppercase tracking-widest font-bold hover:bg-black/5 dark:hover:bg-white/5 transition-all">
                        Close
                    </button>
                    <button className="px-5 py-2 bg-violet-600 text-white text-[10px] uppercase tracking-widest font-bold hover:bg-violet-500 transition-all">
                        Update Task
                    </button>
                </div>
            </div>
        </div>
    );
};
