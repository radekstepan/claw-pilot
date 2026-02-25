import { Plus, Activity, Lock } from 'lucide-react';
import { useDroppable } from '@dnd-kit/core';
import { TaskCard } from './TaskCard';
import { Task } from '@claw-pilot/shared-types';
import { SkeletonCard } from '../ui/SkeletonCard';

interface KanbanColumnProps {
    id: string;
    title: string;
    tasks: Task[];
    onTaskClick: (task: Task) => void;
    isLoading?: boolean;
}

export const KanbanColumn = ({ id, title, tasks, onTaskClick, isLoading }: KanbanColumnProps) => {
    const isDoneColumn = id === 'DONE';
    const { isOver, setNodeRef } = useDroppable({
        id: id,
        disabled: isDoneColumn,
    });

    return (
        <section
            ref={setNodeRef}
            aria-label={`${title} column, ${tasks.length} task${tasks.length !== 1 ? 's' : ''}`}
            className={`flex-1 min-w-[280px] flex flex-col h-full border-r border-black/[0.04] dark:border-white/[0.04] last:border-r-0 transition-colors ${isOver ? 'bg-violet-500/5 dark:bg-violet-400/5' : ''} ${isDoneColumn ? 'opacity-80' : ''}`}
        >
            <div className="p-3 flex items-center justify-between border-b border-black/[0.04] dark:border-white/[0.04] bg-[#f8fafc]/80 dark:bg-white/[0.01]">
                <div className="flex items-center gap-2">
                    <h2 className="text-[10px] uppercase tracking-[0.2em] font-bold text-slate-500">{title}</h2>
                    <span className="text-[10px] font-mono text-slate-400 dark:text-slate-600 bg-black/5 dark:bg-white/5 px-1.5 rounded-sm" aria-hidden="true">{tasks.length}</span>
                    {isDoneColumn && (
                        <Lock size={10} className="text-slate-400 dark:text-slate-600" aria-label="Locked: only a human lead can place tasks here" />
                    )}
                </div>
                {!isDoneColumn && (
                    <Plus
                        size={14}
                        className="text-slate-400 dark:text-slate-700 hover:text-slate-900 dark:hover:text-slate-400 cursor-pointer transition-colors"
                        aria-hidden="true"
                    />
                )}
            </div>
            <div className="flex-1 p-3 overflow-y-auto custom-scrollbar bg-transparent" role="list" aria-label={`${title} tasks`}>
                {isLoading ? (
                    Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)
                ) : (
                    <>
                        {tasks.map(task => (
                            <div key={task.id} role="listitem">
                                <TaskCard task={task} onClick={() => onTaskClick(task)} />
                            </div>
                        ))}
                        {tasks.length === 0 && (
                            <div className="h-full flex flex-col items-center justify-center opacity-40 dark:opacity-20 border border-dashed border-slate-200 dark:border-white/10 rounded p-8 pointer-events-none" aria-hidden="true">
                                <Activity size={24} className="mb-2 text-slate-300 dark:text-white" />
                                <span className="text-[10px] uppercase tracking-widest font-bold text-slate-400 dark:text-white">Empty Node</span>
                            </div>
                        )}
                    </>
                )}
            </div>
        </section>
    );
};
