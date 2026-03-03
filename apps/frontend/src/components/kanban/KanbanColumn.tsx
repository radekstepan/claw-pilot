import { useRef } from "react";
import { AlertTriangle } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { TaskCard } from "./TaskCard";
import { Task } from "@claw-pilot/shared-types";
import { SkeletonCard } from "../ui/SkeletonCard";

interface KanbanColumnProps {
  id: string;
  title: string;
  tasks: Task[];
  onTaskClick: (task: Task) => void;
  isLoading?: boolean;
  /** Set of "taskId:status" read keys — cards not in this set are highlighted as unread. */
  readSet?: Set<string>;
}

export const KanbanColumn = ({
  id,
  title,
  tasks,
  onTaskClick,
  isLoading,
  readSet,
}: KanbanColumnProps) => {
  const isStuckColumn = id === "STUCK";

  // ─── Virtualization ───────────────────────────────────────────────────────
  // Renders only visible TaskCards, keeping DOM lightweight for large boards.
  // Kick in automatically regardless of task count — the overhead is trivial
  // and prevents any future DOM lag as task lists grow beyond 200+ items.
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: tasks.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 98, // approximate TaskCard height with mb-2 gap
    overscan: 5, // buffer extra items above/below viewport
  });

  return (
    <section
      aria-label={`${title} column, ${tasks.length} task${tasks.length !== 1 ? "s" : ""}`}
      className="flex-1 min-w-[180px] flex flex-col h-full border-r border-black/[0.04] dark:border-white/[0.04] last:border-r-0"
    >
      <div className="p-3 flex items-center justify-between border-b border-black/[0.04] dark:border-white/[0.04] bg-[#f8fafc]/80 dark:bg-white/[0.01]">
        <div className="flex items-center gap-2">
          {isStuckColumn && (
            <AlertTriangle
              size={10}
              className="text-rose-400 animate-pulse"
              aria-label="Tasks in error state"
            />
          )}
          <h2
            className={`text-[10px] uppercase tracking-[0.2em] font-bold ${isStuckColumn ? "text-rose-500 dark:text-rose-400" : "text-slate-500"}`}
          >
            {title}
          </h2>
          <span
            className="text-[10px] font-mono text-slate-400 dark:text-slate-600 bg-black/5 dark:bg-white/5 px-1.5 rounded-sm"
            aria-hidden="true"
          >
            {tasks.length}
          </span>
        </div>
      </div>
      <div
        ref={scrollContainerRef}
        className="flex-1 p-3 overflow-y-auto custom-scrollbar bg-transparent"
        role="list"
        aria-label={`${title} tasks`}
      >
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)
        ) : tasks.length === 0 ? (
          <div
            aria-hidden="true"
            className="pointer-events-none flex items-center justify-center pt-6"
          >
            <span className="text-[9px] text-slate-200 dark:text-slate-800 select-none">
              —
            </span>
          </div>
        ) : (
          // Virtual list: total-height spacer with absolutely-positioned items
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              position: "relative",
            }}
          >
            {virtualizer.getVirtualItems().map((virtualItem) => {
              const task = tasks[virtualItem.index];
              return (
                <div
                  key={virtualItem.key}
                  data-index={virtualItem.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                  role="listitem"
                >
                  <TaskCard
                    task={task}
                    onClick={() => onTaskClick(task)}
                    isUnread={
                      readSet
                        ? !readSet.has(`${task.id}:${task.status}`)
                        : false
                    }
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
};
