import React, { useState } from 'react';
import { Plus, X, Send } from 'lucide-react';
import { Agent, Task } from '../../types';

interface NewTaskModalProps {
    agents: Agent[];
    onClose: () => void;
    onAdd: (task: Task) => void;
}

export const NewTaskModal = ({ agents, onClose, onAdd }: NewTaskModalProps) => {
    const [task, setTask] = useState({
        title: '',
        description: '',
        priority: 'NORMAL',
        assignee: '',
        tags: [] as string[]
    });
    const [tagInput, setTagInput] = useState('');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!task.title) return;
        onAdd({
            ...task,
            id: `TASK-${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`,
            status: task.assignee ? 'ASSIGNED' : 'INBOX',
            tags: task.tags.length > 0 ? task.tags : ['untagged']
        });
        onClose();
    };

    const handleAddTag = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' && tagInput.trim()) {
            e.preventDefault();
            setTask(prev => ({ ...prev, tags: Array.from(new Set([...prev.tags, tagInput.trim().toLowerCase()])) }));
            setTagInput('');
        }
    };

    const removeTag = (tagToRemove: string) => {
        setTask(prev => ({ ...prev, tags: prev.tags.filter(t => t !== tagToRemove) }));
    };

    return (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-6">
            <div className="absolute inset-0 bg-slate-900/60 dark:bg-black/80" onClick={onClose} />
            <div className="relative w-full max-w-xl bg-white dark:bg-[#0c0a14] border border-black/10 dark:border-white/10 shadow-2xl flex flex-col animate-fadeIn overflow-hidden">
                <div className="h-12 border-b border-black/[0.06] dark:border-white/[0.06] flex items-center px-6 justify-between bg-slate-50 dark:bg-white/[0.01]">
                    <div className="flex items-center gap-2">
                        <Plus size={14} className="text-violet-600 dark:text-violet-500" />
                        <span className="text-[10px] uppercase tracking-[0.2em] font-bold text-slate-900 dark:text-white">Initialize New Mission</span>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-900 dark:hover:text-white"><X size={18} /></button>
                </div>

                <form onSubmit={handleSubmit} className="p-8 space-y-6 overflow-y-auto custom-scrollbar">
                    <div className="space-y-2">
                        <label className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 tracking-wider">Mission Title</label>
                        <input
                            autoFocus
                            required
                            type="text"
                            value={task.title}
                            onChange={e => setTask({ ...task, title: e.target.value })}
                            placeholder="e.g. Refactor Data Stream Gateway"
                            className="w-full bg-slate-100 dark:bg-black/20 border border-black/10 dark:border-white/10 rounded px-3 py-2 text-xs text-slate-900 dark:text-slate-300 outline-none focus:border-violet-500/50 transition-colors"
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 tracking-wider">Mission Briefing</label>
                        <textarea
                            value={task.description}
                            onChange={e => setTask({ ...task, description: e.target.value })}
                            placeholder="Detail the parameters and expected outcomes..."
                            className="w-full h-24 bg-slate-100 dark:bg-black/20 border border-black/10 dark:border-white/10 rounded px-3 py-2 text-xs text-slate-900 dark:text-slate-300 outline-none focus:border-violet-500/50 transition-colors"
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 tracking-wider">Priority</label>
                            <select
                                value={task.priority}
                                onChange={e => setTask({ ...task, priority: e.target.value })}
                                className="w-full bg-slate-100 dark:bg-black/20 border border-black/10 dark:border-white/10 rounded px-2 py-2 text-xs text-slate-900 dark:text-slate-300 outline-none"
                            >
                                <option value="NORMAL">NORMAL</option>
                                <option value="URGENT">URGENT</option>
                            </select>
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 tracking-wider">Assign Agent</label>
                            <select
                                value={task.assignee}
                                onChange={e => setTask({ ...task, assignee: e.target.value })}
                                className="w-full bg-slate-100 dark:bg-black/20 border border-black/10 dark:border-white/10 rounded px-2 py-2 text-xs text-slate-900 dark:text-slate-300 outline-none"
                            >
                                <option value="">DEFERRED (INBOX)</option>
                                {agents.map(a => <option key={a.id} value={a.id}>{a.name} ({a.role})</option>)}
                            </select>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 tracking-wider">Tags</label>
                        <div className="flex flex-wrap gap-2 mb-2">
                            {task.tags.map(t => (
                                <span key={t} className="flex items-center gap-1 text-[9px] uppercase font-bold bg-violet-500/10 text-violet-600 dark:text-violet-400 border border-violet-500/20 px-2 py-0.5 rounded-sm">
                                    {t} <button type="button" onClick={() => removeTag(t)} className="hover:text-red-500"><X size={10} /></button>
                                </span>
                            ))}
                        </div>
                        <input
                            type="text"
                            value={tagInput}
                            onChange={e => setTagInput(e.target.value)}
                            onKeyDown={handleAddTag}
                            placeholder="Type tag and press enter..."
                            className="w-full bg-slate-100 dark:bg-black/20 border border-black/10 dark:border-white/10 rounded px-3 py-2 text-xs text-slate-900 dark:text-slate-300 outline-none"
                        />
                    </div>
                </form>

                <div className="p-4 border-t border-black/[0.06] dark:border-white/[0.06] bg-slate-50 dark:bg-black/20 flex items-center justify-end gap-3">
                    <button type="button" onClick={onClose} className="px-5 py-2 text-[10px] uppercase font-bold text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors">Cancel</button>
                    <button onClick={handleSubmit} className="px-6 py-2 bg-violet-600 text-white text-[10px] font-bold uppercase tracking-widest hover:bg-violet-500 flex items-center gap-2">
                        <Send size={12} /> Launch Mission
                    </button>
                </div>
            </div>
        </div>
    );
};
