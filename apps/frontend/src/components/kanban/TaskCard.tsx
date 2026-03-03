import { useState, useEffect } from "react";
import { Clock, AlertTriangle, Loader2 } from "lucide-react";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Card } from "../ui/Card";
import { Badge } from "../ui/Badge";
import { Task } from "@claw-pilot/shared-types";
import { useMissionStore } from "../../store/useMissionStore";
import { generateAvatarUrl } from "../../utils/avatar";

function formatTimeAgo(iso: string | undefined, now: number): string {
  if (!iso) return "NEW";
  const diff = now - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  return `${months}mo`;
}

interface TaskCardProps {
  task: Task;
  onClick: () => void;
  isOverlay?: boolean;
  /** True when this card's swimlane changed since the user last opened it. */
  isUnread?: boolean;
}

export const TaskCard = ({
  task,
  onClick,
  isOverlay,
  isUnread,
}: TaskCardProps) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: task.id,
      data: { task },
      disabled: isOverlay,
    });
  const isUpdating = useMissionStore((s) => s.updatingTaskIds.has(task.id));
  const isAgentBusy = isUpdating;
  const agents = useMissionStore((s) => s.agents);
  const agent = task.agentId
    ? agents.find((a) => a.id === task.agentId)
    : undefined;
  const assignee = task.assignee_id
    ? agents.find((a) => a.id === task.assignee_id)
    : undefined;

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.35 : 1,
    zIndex: isDragging ? 50 : 1,
    position: "relative" as const,
  };

  const isStuck = task.status === "STUCK";

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`transition-opacity duration-300 ${
        isUpdating ? "opacity-50 animate-pulse pointer-events-none" : ""
      }`}
    >
      <Card
        onClick={onClick}
        className={`p-3 mb-2 cursor-grab active:cursor-grabbing select-none shadow-sm dark:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-500)] ${isDragging ? "ring-2 ring-[var(--accent-500)]" : ""} ${isOverlay ? "shadow-2xl cursor-grabbing" : ""} ${isStuck ? "ring-1 ring-rose-500/60 dark:ring-rose-500/40 bg-rose-50/40 dark:bg-rose-900/10" : ""} ${isUnread && !isStuck ? "border-l-2 border-l-[var(--accent-500)]" : ""}`}
        role="button"
        aria-label={`Task: ${task.title}. Priority: ${task.priority ?? "LOW"}. Drag to move.`}
        tabIndex={isOverlay ? -1 : 0}
      >
        <div className="flex items-start justify-between mb-2">
          <span className="text-[9px] font-mono text-slate-400 dark:text-slate-600 group-hover:text-[var(--accent-600)] dark:group-hover:text-[var(--accent-400)] transition-colors">
            {task.id.slice(0, 8)}
          </span>
          {(task.priority === "HIGH" || task.priority === "LOW") && (
            <Badge variant={task.priority === "HIGH" ? "urgent" : "default"}>
              {task.priority}
            </Badge>
          )}
        </div>
        {isStuck && (
          <div className="flex items-center gap-1 mb-2">
            <AlertTriangle
              size={10}
              className="text-rose-500 flex-shrink-0"
              aria-hidden="true"
            />
            <span className="text-[9px] font-bold text-rose-500 uppercase tracking-widest">
              Error
            </span>
          </div>
        )}
        <h3 className="text-[11px] font-semibold text-slate-800 dark:text-slate-200 mb-2 leading-snug">
          {task.title}
        </h3>
        <div className="flex flex-wrap gap-1 mb-3">
          {task.tags?.map((tag: string) => (
            <span
              key={tag}
              className="text-[8px] text-slate-500 px-1 border border-black/5 dark:border-white/5 rounded-sm"
            >
              #{tag}
            </span>
          ))}
        </div>
        {isAgentBusy && (
          <div className="flex items-center gap-1.5 mb-2 px-2 py-1 rounded-sm bg-[var(--accent-scroll-sm)] dark:bg-[var(--accent-scroll-sm)] border border-[var(--accent-scroll-hover)]">
            <Loader2
              size={9}
              className="text-[var(--accent-500)] animate-spin flex-shrink-0"
              aria-hidden="true"
            />
            <span className="text-[9px] font-bold text-[var(--accent-600)] dark:text-[var(--accent-400)] uppercase tracking-widest">
              Agent working…
            </span>
          </div>
        )}
        <div className="flex items-center justify-between border-t border-black/[0.04] dark:border-white/[0.04] pt-2 mt-2">
          <div className="flex items-center gap-1">
            {isStuck ? (
              <AlertTriangle
                size={10}
                className="text-rose-400"
                aria-hidden="true"
              />
            ) : (
              <Clock
                size={10}
                className="text-slate-400 dark:text-slate-600"
                aria-hidden="true"
              />
            )}
            <span
              className={`text-[9px] uppercase font-bold tracking-tighter ${isStuck ? "text-rose-400" : "text-slate-400 dark:text-slate-600"}`}
            >
              {formatTimeAgo(task.updatedAt ?? task.createdAt, now)}
            </span>
          </div>
          <div className="flex items-center gap-0.5">
            {assignee && (
              <img
                src={generateAvatarUrl(assignee.name, { size: 80 })}
                alt={assignee.name}
                className="w-2.5 h-2.5 rounded-full ring-1 ring-slate-200 dark:ring-slate-700"
                title={`Assignee: ${assignee.name}`}
              />
            )}
            {agent && agent.id !== assignee?.id && (
              <img
                src={generateAvatarUrl(agent.name, { size: 80 })}
                alt={agent.name}
                className="w-2.5 h-2.5 rounded-full"
                title={`Agent: ${agent.name}`}
              />
            )}
          </div>
        </div>
      </Card>
    </div>
  );
};
