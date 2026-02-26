import { Clock, User, AlertTriangle, Loader2 } from 'lucide-react';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Task } from '@claw-pilot/shared-types';
import { useMissionStore } from '../../store/useMissionStore';

function formatTimeAgo(iso: string | undefined): string {
    if (!iso) return 'NEW';
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days}d ago`;
    const months = Math.floor(days / 30);
    return `${months}mo ago`;
}

interface TaskCardProps {
    task: Task;
    onClick: () => void;
    isOverlay?: boolean;
    /** True when this card's swimlane changed since the user last opened it. */
    isUnread?: boolean;
}

export const TaskCard = ({ task, onClick, isOverlay, isUnread }: TaskCardProps) => {
    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
        id: task.id,
        data: { task },
        disabled: isOverlay,
    });
    const isUpdating = useMissionStore((s) => s.updatingTaskIds.has(task.id));
    const isLocallyBusy = useMissionStore((s) => !!task.agentId && s.busyAgentIds.has(task.agentId));
    // Also surface "busy" when the session monitor has flipped the agent to WORKING status
    const agentIsWorking = useMissionStore((s) =>
        task.agentId ? s.agents.find(a => a.id === task.agentId)?.status === 'WORKING' : false
    );
    const isAgentBusy = isLocallyBusy || agentIsWorking;

    const style = {
        transform: CSS.Translate.toString(transform),
        opacity: isDragging ? 0.35 : 1,
        zIndex: isDragging ? 50 : 1,
        position: 'relative' as const,
    };

    const isStuck = task.status === 'STUCK';

    return (
        <div ref={setNodeRef} style={style} {...listeners} {...attributes}
            className={`transition-opacity duration-300 ${
                isUpdating ? 'opacity-50 animate-pulse pointer-events-none' : ''
            }`}
        >
            <Card
                onClick={onClick}
                className={`p-3 mb-2 cursor-grab active:cursor-grabbing select-none shadow-sm dark:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${isDragging ? 'ring-2 ring-violet-500' : ''} ${isOverlay ? 'shadow-2xl cursor-grabbing' : ''} ${isStuck ? 'ring-1 ring-rose-500/60 dark:ring-rose-500/40 bg-rose-50/40 dark:bg-rose-900/10' : ''} ${isUnread && !isStuck ? 'border-l-2 border-l-violet-500 dark:border-l-violet-400' : ''}`}
                role="button"
                aria-label={`Task: ${task.title}. Priority: ${task.priority ?? 'LOW'}. Drag to move.`}
                tabIndex={isOverlay ? -1 : 0}
            >
                <div className="flex items-start justify-between mb-2">
                    <span className="text-[9px] font-mono text-slate-400 dark:text-slate-600 group-hover:text-violet-600 dark:group-hover:text-violet-400 transition-colors">
                        {task.id}
                    </span>
                    <div className="flex items-center gap-1.5">
                        {isUnread && (
                            <span
                                className="w-1.5 h-1.5 rounded-full bg-violet-500 flex-shrink-0 animate-pulse"
                                aria-label="Unread — task was updated since you last opened it"
                                title="Updated since last viewed"
                            />
                        )}
                        <Badge variant={task.priority === 'HIGH' ? 'urgent' : 'default'}>
                            {task.priority ?? 'LOW'}
                        </Badge>
                    </div>
                </div>
                {isStuck && (
                    <div className="flex items-center gap-1 mb-2">
                        <AlertTriangle size={10} className="text-rose-500 flex-shrink-0" aria-hidden="true" />
                        <span className="text-[9px] font-bold text-rose-500 uppercase tracking-widest">Stuck / Error</span>
                    </div>
                )}
                <h3 className="text-[11px] font-semibold text-slate-800 dark:text-slate-200 mb-2 leading-snug">
                    {task.title}
                </h3>
                <div className="flex flex-wrap gap-1 mb-3">
                    {task.tags?.map((tag: string) => (
                        <span key={tag} className="text-[8px] text-slate-500 px-1 border border-black/5 dark:border-white/5 rounded-sm">
                            #{tag}
                        </span>
                    ))}
                </div>
                {isAgentBusy && (
                    <div className="flex items-center gap-1.5 mb-2 px-2 py-1 rounded-sm bg-violet-500/8 dark:bg-violet-500/10 border border-violet-500/20">
                        <Loader2 size={9} className="text-violet-500 animate-spin flex-shrink-0" aria-hidden="true" />
                        <span className="text-[9px] font-bold text-violet-600 dark:text-violet-400 uppercase tracking-widest">Agent working…</span>
                    </div>
                )}
                <div className="flex items-center justify-between border-t border-black/[0.04] dark:border-white/[0.04] pt-2 mt-2">
                    <div className="flex items-center gap-1">
                        {isStuck ? (
                            <AlertTriangle size={10} className="text-rose-400" aria-hidden="true" />
                        ) : (
                            <Clock size={10} className="text-slate-400 dark:text-slate-600" aria-hidden="true" />
                        )}
                        <span className={`text-[9px] uppercase font-bold tracking-tighter ${isStuck ? 'text-rose-400' : 'text-slate-400 dark:text-slate-600'}`}>
                            {isStuck ? 'Error' : formatTimeAgo(task.updatedAt ?? task.createdAt)}
                        </span>
                    </div>
                    <div className="w-5 h-5 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-full flex items-center justify-center" aria-hidden="true">
                        <User size={10} className="text-slate-500 dark:text-slate-700" />
                    </div>
                </div>
            </Card>
        </div>
    );
};
