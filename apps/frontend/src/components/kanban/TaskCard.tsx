import { Clock, User } from 'lucide-react';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Task } from '@claw-pilot/shared-types';

interface TaskCardProps {
    task: Task;
    onClick: () => void;
}

export const TaskCard = ({ task, onClick }: TaskCardProps) => {
    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
        id: task.id,
        data: { task },
    });

    const style = {
        transform: CSS.Translate.toString(transform),
        opacity: isDragging ? 0.5 : 1,
        zIndex: isDragging ? 50 : 1,
        position: 'relative' as const,
    };

    return (
        <div ref={setNodeRef} style={style} {...listeners} {...attributes}>
            <Card
                onClick={onClick}
                className={`p-3 mb-2 cursor-grab active:cursor-grabbing select-none shadow-sm dark:shadow-none ${isDragging ? 'ring-2 ring-violet-500' : ''}`}
            >
                <div className="flex items-start justify-between mb-2">
                    <span className="text-[9px] font-mono text-slate-400 dark:text-slate-600 group-hover:text-violet-600 dark:group-hover:text-violet-400 transition-colors">
                        {task.id}
                    </span>
                    <Badge variant={task.priority === 'HIGH' ? 'urgent' : 'default'}>
                        {task.priority || 'NORMAL'}
                    </Badge>
                </div>
                <h3 className="text-[11px] font-semibold text-slate-800 dark:text-slate-200 mb-2 leading-snug">
                    {task.title}
                </h3>
                <div className="flex flex-wrap gap-1 mb-3">
                    {(task as any).tags?.map((tag: string) => (
                        <span key={tag} className="text-[8px] text-slate-500 px-1 border border-black/5 dark:border-white/5 rounded-sm">
                            #{tag}
                        </span>
                    ))}
                </div>
                <div className="flex items-center justify-between border-t border-black/[0.04] dark:border-white/[0.04] pt-2 mt-2">
                    <div className="flex items-center gap-1">
                        <Clock size={10} className="text-slate-400 dark:text-slate-600" />
                        <span className="text-[9px] text-slate-400 dark:text-slate-600 uppercase font-bold tracking-tighter">NEW</span>
                    </div>
                    <div className="w-5 h-5 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-full flex items-center justify-center">
                        <User size={10} className="text-slate-500 dark:text-slate-700" />
                    </div>
                </div>
            </Card>
        </div>
    );
};
