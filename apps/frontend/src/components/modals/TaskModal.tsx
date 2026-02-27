import { useState, useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  X,
  CheckCircle2,
  Circle,
  ThumbsUp,
  ThumbsDown,
  Loader2,
  AlertTriangle,
  Trash2,
  Package,
  Zap,
  ScrollText,
  GripVertical,
  ChevronDown,
  ChevronUp,
  Copy,
} from "lucide-react";
import { toast } from "sonner";
import type {
  Agent,
  Task,
  ActivityLog,
  Deliverable,
} from "@claw-pilot/shared-types";
import { DndContext, DragEndEvent, closestCenter } from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  arrayMove,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Badge } from "../ui/Badge";
import { COLUMN_TITLES } from "../../constants";
import { useMissionStore } from "../../store/useMissionStore";
import { api } from "../../api/client";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Select } from "../ui/Select";
import { EmptyState } from "../ui/EmptyState";
import { MarkdownContent } from "../ui/MarkdownContent";

const updateFormSchema = z.object({
  title: z.string().min(1, "Title cannot be empty."),
  description: z.string().optional(),
  priority: z.string().optional(),
  assignee_id: z.string().optional(),
});
type UpdateFormValues = z.infer<typeof updateFormSchema>;

const NONE_VALUE = "__NONE__";

const PRIORITY_OPTIONS = [
  { value: NONE_VALUE, label: "— None —" },
  { value: "LOW", label: "LOW" },
  { value: "MEDIUM", label: "MEDIUM" },
  { value: "HIGH", label: "HIGH" },
];

/** Detect "rich" agent responses that deserve a collapsible view. */
function isRichMessage(msg: string): boolean {
  return (
    msg.length > 500 ||
    msg.includes("```") ||
    (msg.match(/^#{1,3} /m) ?? []).length >= 2
  );
}

/** Plain-text preview: strip code fences and trim. */
function plainPreview(msg: string, maxLen = 160): string {
  return msg
    .replace(/```[\s\S]*?```/g, "[code block]")
    .replace(/\n+/g, " ")
    .slice(0, maxLen);
}

interface ActivityEntryProps {
  activity: ActivityLog;
}

function ActivityEntry({ activity: a }: ActivityEntryProps) {
  const [expanded, setExpanded] = useState(false);
  const rich = isRichMessage(a.message);

  const colorClass =
    a.message.startsWith("completed:") || a.message.startsWith("done:")
      ? "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800/40"
      : a.message.startsWith("error:")
        ? "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800/40"
        : "bg-slate-50 dark:bg-white/[0.02] border-black/[0.04] dark:border-white/[0.04]";

  return (
    <div className={`p-3 rounded border text-xs leading-relaxed ${colorClass}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="font-semibold text-slate-700 dark:text-slate-300">
          {a.agentId ?? "system"}
        </span>
        <span className="text-[10px] text-slate-400">
          {new Date(a.timestamp).toLocaleString()}
        </span>
      </div>
      {rich && !expanded ? (
        <div>
          <p className="text-[10px] text-slate-500 dark:text-slate-400 italic mb-2 leading-relaxed line-clamp-2">
            {plainPreview(a.message)}…
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setExpanded(true)}
              className="inline-flex items-center gap-1 text-[9px] uppercase tracking-widest font-bold text-[var(--accent-500)] hover:text-[var(--accent-600)] transition-colors"
            >
              <ChevronDown size={10} />
              View full response
            </button>
            <button
              onClick={() =>
                navigator.clipboard.writeText(a.message).catch(() => {})
              }
              className="inline-flex items-center gap-1 text-[9px] uppercase tracking-widest font-bold text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
            >
              <Copy size={9} />
              Copy
            </button>
          </div>
        </div>
      ) : rich ? (
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[9px] uppercase tracking-widest font-bold text-[var(--accent-500)] opacity-70">
              Agent Response
            </span>
            <div className="flex items-center gap-3">
              <button
                onClick={() =>
                  navigator.clipboard.writeText(a.message).catch(() => {})
                }
                className="inline-flex items-center gap-1 text-[9px] uppercase tracking-widest font-bold text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
              >
                <Copy size={9} />
                Copy
              </button>
              <button
                onClick={() => setExpanded(false)}
                className="inline-flex items-center gap-1 text-[9px] uppercase tracking-widest font-bold text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
              >
                <ChevronUp size={10} />
                Collapse
              </button>
            </div>
          </div>
          <div className="border border-black/[0.06] dark:border-white/[0.06] rounded p-3 bg-white/60 dark:bg-black/20 overflow-auto max-h-[400px] w-full">
            <MarkdownContent content={a.message} />
          </div>
        </div>
      ) : (
        <p className="text-slate-600 dark:text-slate-300">
          <MarkdownContent content={a.message} />
        </p>
      )}
    </div>
  );
}

interface SortableDeliverableItemProps {
  deliverable: Deliverable;
  taskId: string;
  onToggle: (deliverableId: string, taskId: string) => void;
}

function SortableDeliverableItem({
  deliverable: d,
  taskId,
  onToggle,
}: SortableDeliverableItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: d.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 bg-slate-50 dark:bg-white/[0.02] border border-black/[0.04] dark:border-white/[0.04] rounded hover:border-[var(--accent-scroll-hover)] transition-all"
    >
      {/* Drag handle */}
      <button
        type="button"
        className="pl-2 py-2 text-slate-300 dark:text-slate-700 hover:text-slate-500 dark:hover:text-slate-400 cursor-grab active:cursor-grabbing focus-visible:outline-none flex-shrink-0 touch-none"
        aria-label="Drag to reorder"
        {...attributes}
        {...listeners}
      >
        <GripVertical size={12} />
      </button>
      {/* Toggle button */}
      <button
        type="button"
        onClick={() => onToggle(d.id, taskId)}
        className="flex-1 flex items-center gap-3 py-2 pr-2 text-left focus-visible:outline-none"
      >
        <div className="w-4 h-4 flex-shrink-0 text-emerald-600 dark:text-emerald-500">
          {d.status === "COMPLETED" ? (
            <CheckCircle2 size={14} />
          ) : (
            <Circle size={14} className="text-slate-300 dark:text-slate-600" />
          )}
        </div>
        <span
          className={`text-xs ${d.status === "COMPLETED" ? "line-through text-slate-400 dark:text-slate-600" : "text-slate-600 dark:text-slate-300"}`}
        >
          {d.title}
        </span>
      </button>
    </div>
  );
}

interface TaskModalProps {
  task: Task | null;
  onClose: () => void;
  agents: Agent[];
}

export const TaskModal = ({ task, onClose, agents }: TaskModalProps) => {
  const [feedback, setFeedback] = useState("");
  const [showFeedbackInput, setShowFeedbackInput] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isRouting, setIsRouting] = useState(false);
  const [routeAgentId, setRouteAgentId] = useState<string>(
    task?.agentId ?? task?.assignee_id ?? "",
  );
  const [taskActivities, setTaskActivities] = useState<ActivityLog[]>([]);
  const [activitiesLoading, setActivitiesLoading] = useState(false);
  const [descPreview, setDescPreview] = useState(false);
  const [showRetryPrompt, setShowRetryPrompt] = useState(false);
  const [retryPrompt, setRetryPrompt] = useState(() =>
    task ? `${task.title}\n\n${task.description || ""}`.trim() : "",
  );
  const [showRejectPrompt, setShowRejectPrompt] = useState(false);
  const [rejectPrompt, setRejectPrompt] = useState(() =>
    task
      ? `A human reviewer rejected your previous attempt with this feedback:\n\nPlease redo the task taking this feedback into account.\n\nOriginal task:\n${task.title}\n${task.description || ""}`
      : "",
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
      title: task?.title ?? "",
      description: task?.description ?? "",
      priority: task?.priority || NONE_VALUE,
      assignee_id: task?.assignee_id || NONE_VALUE,
    },
  });

  const {
    updateTaskLocally,
    updateTask,
    deleteTask,
    toggleDeliverable,
    reorderDeliverables,
    routeTask,
  } = useMissionStore();

  useEffect(() => {
    if (!task) return;
    setActivitiesLoading(true);
    api
      .getTaskActivities(task.id)
      .then(setTaskActivities)
      .catch(() => setTaskActivities([]))
      .finally(() => setActivitiesLoading(false));
  }, [task?.id]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  if (!task) return null;

  const agentOptions = [
    { value: NONE_VALUE, label: "— Unassigned —" },
    ...agents
      .filter((a) => !!a.id)
      .map((a) => ({ value: a.id, label: a.name })),
  ];

  const handleRouteToAgent = async () => {
    if (!routeAgentId) {
      return;
    }
    setIsRouting(true);
    try {
      await routeTask(
        task!.id,
        routeAgentId,
        showRetryPrompt ? retryPrompt : undefined,
      );
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
    updateTaskLocally({ ...task, status: "DONE" });
    try {
      await api.reviewTask(task.id, "approve");
      toast.success("Task approved and moved to DONE.");
      onClose();
    } catch {
      updateTaskLocally(snapshot);
      toast.error("Failed to approve task. Changes reverted.");
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
      toast.error("Please provide feedback before rejecting.");
      return;
    }
    if (showRejectPrompt && !rejectPrompt.trim()) {
      toast.error("Please provide a prompt before rejecting.");
      return;
    }
    setIsSubmitting(true);
    const snapshot = { ...task };
    updateTaskLocally({ ...task, status: "IN_PROGRESS" });
    try {
      await api.reviewTask(
        task.id,
        "reject",
        showRejectPrompt ? undefined : feedback,
        showRejectPrompt ? rejectPrompt : undefined,
      );
      toast.success(
        "Task rejected. Agent has been notified with your feedback.",
      );
      onClose();
    } catch {
      updateTaskLocally(snapshot);
      toast.error("Failed to reject task. Changes reverted.");
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
        priority:
          data.priority === NONE_VALUE
            ? undefined
            : (data.priority as Task["priority"]),
        assignee_id:
          data.assignee_id === NONE_VALUE ? undefined : data.assignee_id,
      };
      await updateTask(task.id, patch);
      toast.success("Task updated.");
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
      <div
        className="absolute inset-0 bg-slate-900/50 dark:bg-black/80"
        onClick={onClose}
      />
      <div className="relative w-full max-w-2xl bg-white dark:bg-[#0c0a14] border border-black/10 dark:border-white/10 shadow-2xl flex flex-col max-h-[90vh] animate-fadeIn">
        <div className="p-6 border-b border-black/[0.04] dark:border-white/[0.04] flex items-start justify-between">
          <div className="flex-1 min-w-0 pr-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] font-mono text-[var(--accent-600)] dark:text-[var(--accent-400)]">
                {task.id}
              </span>
              <div className="h-1 w-1 rounded-full bg-slate-200 dark:bg-slate-700" />
              <Badge
                variant={
                  task.status === "DONE"
                    ? "success"
                    : task.status === "STUCK"
                      ? "danger"
                      : "violet"
                }
              >
                {COLUMN_TITLES[task.status]}
              </Badge>
            </div>
            <input
              type="text"
              {...register("title")}
              className="text-xl font-bold text-slate-900 dark:text-white tracking-tight bg-transparent border-none outline-none w-full focus:ring-1 focus:ring-[var(--accent-scroll-low)] rounded px-1 -ml-1 aria-[invalid=true]:ring-1 aria-[invalid=true]:ring-rose-500/50"
              aria-invalid={errors.title ? "true" : "false"}
            />
            {errors.title && (
              <p className="text-rose-400 text-[10px] mt-1" role="alert">
                {errors.title.message}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={() => setShowDeleteConfirm(true)}
              disabled={isDeleting}
              title="Delete task"
              className="p-2 text-slate-400 hover:text-rose-500 transition-colors disabled:opacity-50"
            >
              {isDeleting ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Trash2 size={16} />
              )}
            </button>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar">
          <div className="p-6 pb-4 border-b border-black/[0.04] dark:border-white/[0.04]">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <h3 className="text-[10px] uppercase tracking-[0.2em] font-bold text-slate-400 dark:text-slate-500 mb-3">
                  Assignee
                </h3>
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
                <h3 className="text-[10px] uppercase tracking-[0.2em] font-bold text-slate-400 dark:text-slate-500 mb-3">
                  Priority
                </h3>
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

          <div className="p-6 pt-4">
            <div className="flex-1 min-w-0">
              {task.status === "STUCK" && (
                <section className="mb-8 p-4 border border-rose-500/30 bg-rose-500/[0.04] rounded">
                  <div className="flex items-center gap-2 mb-3">
                    <AlertTriangle size={14} className="text-rose-500" />
                    <h3 className="text-[10px] uppercase tracking-[0.2em] font-bold text-rose-600 dark:text-rose-400">
                      Agent Error — Task Stuck
                    </h3>
                  </div>
                  {(() => {
                    const lastError = taskActivities.find((a) =>
                      a.message.startsWith("error:"),
                    );
                    return lastError ? (
                      <p className="text-xs text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800/40 rounded p-2 mb-4 leading-relaxed font-mono">
                        {lastError.message}
                      </p>
                    ) : (
                      <p className="text-xs text-slate-600 dark:text-slate-400 mb-4 leading-relaxed">
                        The agent encountered an error and could not complete
                        this task.
                      </p>
                    );
                  })()}
                  <p className="text-xs text-slate-600 dark:text-slate-400 mb-4 leading-relaxed">
                    Re-route this task to retry with the same or a different
                    agent.
                  </p>
                  {agents.length === 0 ? (
                    <EmptyState
                      icon={AlertTriangle}
                      title="No agents available"
                      description="No agents are connected. Check the gateway."
                    />
                  ) : (
                    <div className="flex flex-col gap-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            id="editRetryPrompt"
                            checked={showRetryPrompt}
                            onChange={(e) =>
                              setShowRetryPrompt(e.target.checked)
                            }
                            className="w-3 h-3 text-rose-600 focus:ring-rose-500 border-rose-300 rounded"
                          />
                          <label
                            htmlFor="editRetryPrompt"
                            className="text-[10px] uppercase tracking-wider font-bold text-rose-600/80 cursor-pointer"
                          >
                            Edit Prompt
                          </label>
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
                            value={routeAgentId || "__NONE__"}
                            onValueChange={(v) =>
                              setRouteAgentId(v === "__NONE__" ? "" : v)
                            }
                            options={[
                              { value: "__NONE__", label: "— Pick an agent —" },
                              ...agents
                                .filter((a) => !!a.id)
                                .map((a) => ({ value: a.id, label: a.name })),
                            ]}
                            placeholder="— Pick an agent —"
                          />
                        </div>
                        <button
                          onClick={handleRouteToAgent}
                          disabled={isRouting || !routeAgentId}
                          className="flex items-center gap-1.5 px-4 py-2 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-[10px] uppercase tracking-widest font-bold transition-all rounded-sm whitespace-nowrap"
                        >
                          {isRouting ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <Zap size={12} />
                          )}
                          Retry
                        </button>
                      </div>
                    </div>
                  )}
                </section>
              )}

              {task.status !== "IN_PROGRESS" &&
                task.status !== "REVIEW" &&
                task.status !== "DONE" &&
                task.status !== "STUCK" && (
                  <section className="mb-8 p-4 border border-[var(--accent-scroll-hover)] bg-[var(--accent-scroll-sm)] rounded">
                    <div className="flex items-center gap-2 mb-3">
                      <Zap size={14} className="text-[var(--accent-500)]" />
                      <h3 className="text-[10px] uppercase tracking-[0.2em] font-bold text-[var(--accent-600)] dark:text-[var(--accent-400)]">
                        Dispatch to Agent
                      </h3>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400 mb-4 leading-relaxed">
                      Route this task to an AI agent. The agent will receive the
                      title and description as its prompt and begin working
                      immediately.
                    </p>
                    {agents.length === 0 ? (
                      <EmptyState
                        icon={Zap}
                        title="No agents available"
                        description="No agents are connected. Check the gateway."
                      />
                    ) : (
                      <div className="flex items-center gap-2">
                        <div className="flex-1">
                          <Select
                            value={routeAgentId || "__NONE__"}
                            onValueChange={(v) =>
                              setRouteAgentId(v === "__NONE__" ? "" : v)
                            }
                            options={[
                              { value: "__NONE__", label: "— Pick an agent —" },
                              ...agents
                                .filter((a) => !!a.id)
                                .map((a) => ({ value: a.id, label: a.name })),
                            ]}
                            placeholder="— Pick an agent —"
                          />
                        </div>
                        <button
                          onClick={handleRouteToAgent}
                          disabled={isRouting || !routeAgentId}
                          className="flex items-center gap-1.5 px-4 py-2 bg-[var(--accent-600)] hover:bg-[var(--accent-500)] disabled:opacity-50 text-white text-[10px] uppercase tracking-widest font-bold transition-all rounded-sm whitespace-nowrap"
                        >
                          {isRouting ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <Zap size={12} />
                          )}
                          Route
                        </button>
                      </div>
                    )}
                  </section>
                )}

              {task.status === "REVIEW" && (
                <section className="mb-8 p-4 border border-amber-400/40 bg-amber-400/[0.06] rounded">
                  <div className="flex items-center gap-2 mb-3">
                    <AlertTriangle size={14} className="text-amber-500" />
                    <h3 className="text-[10px] uppercase tracking-[0.2em] font-bold text-amber-600 dark:text-amber-400">
                      Awaiting Human Review
                    </h3>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mb-4 leading-relaxed">
                    This task was submitted for review by the assigned agent. As
                    the human lead, only you can approve or reject it.
                  </p>
                  {showFeedbackInput && !showRejectPrompt && (
                    <textarea
                      autoFocus
                      rows={3}
                      placeholder="Describe what needs to be revised..."
                      value={feedback}
                      onChange={(e) => setFeedback(e.target.value)}
                      className="w-full mb-3 bg-white dark:bg-white/[0.03] border border-black/10 dark:border-white/10 rounded-sm p-2 text-[11px] text-slate-900 dark:text-slate-200 placeholder:text-slate-400 focus:border-[var(--accent-500)] outline-none resize-none"
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
                          <label
                            htmlFor="editRejectPrompt"
                            className="text-[10px] uppercase tracking-wider font-bold text-amber-600/80 cursor-pointer"
                          >
                            Edit Raw Payload
                          </label>
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
                      {isSubmitting ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <ThumbsUp size={12} />
                      )}
                      Approve
                    </button>
                    <button
                      onClick={handleReject}
                      disabled={isSubmitting}
                      className="flex items-center gap-1.5 px-4 py-2 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-[10px] uppercase tracking-widest font-bold transition-all rounded-sm"
                    >
                      {isSubmitting ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <ThumbsDown size={12} />
                      )}
                      {showFeedbackInput || showRejectPrompt
                        ? "Send Feedback"
                        : "Reject"}
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
                  <EmptyState
                    icon={ScrollText}
                    title="No activity yet"
                    description="Activity from agents will appear here."
                  />
                ) : (
                  <div className="space-y-2">
                    {taskActivities.map((a) => (
                      <ActivityEntry key={a.id} activity={a} />
                    ))}
                  </div>
                )}
              </section>

              <section className="mb-8">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-[10px] uppercase tracking-[0.2em] font-bold text-slate-400 dark:text-slate-500">
                    Project Description
                  </h3>
                  {task.status !== "DONE" && (
                    <div className="flex items-center gap-px border border-black/[0.06] dark:border-white/[0.06] rounded overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setDescPreview(false)}
                        className={`px-2 py-0.5 text-[9px] uppercase tracking-wider font-bold transition-colors ${
                          !descPreview
                            ? "bg-[var(--accent-600)] text-white"
                            : "text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                        }`}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => setDescPreview(true)}
                        className={`px-2 py-0.5 text-[9px] uppercase tracking-wider font-bold transition-colors ${
                          descPreview
                            ? "bg-[var(--accent-600)] text-white"
                            : "text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                        }`}
                      >
                        Preview
                      </button>
                    </div>
                  )}
                </div>
                {task.status === "DONE" ? (
                  <div className="min-h-[7rem] border border-black/[0.04] dark:border-white/[0.04] rounded p-2">
                    {task.description ? (
                      <MarkdownContent content={task.description} />
                    ) : (
                      <p className="text-slate-400 dark:text-slate-600 text-sm italic">
                        No description…
                      </p>
                    )}
                  </div>
                ) : (
                  <>
                    <textarea
                      rows={5}
                      {...register("description")}
                      placeholder="No description…"
                      className={`w-full bg-transparent border border-black/[0.04] dark:border-white/[0.04] rounded p-2 text-slate-600 dark:text-slate-300 text-sm leading-relaxed resize-none focus:border-[var(--accent-500)] outline-none ${
                        descPreview ? "hidden" : ""
                      }`}
                    />
                    {descPreview && (
                      <div className="min-h-[7rem] border border-black/[0.04] dark:border-white/[0.04] rounded p-2">
                        {watch("description") ? (
                          <MarkdownContent
                            content={watch("description") ?? ""}
                          />
                        ) : (
                          <p className="text-slate-400 dark:text-slate-600 text-sm italic">
                            No description…
                          </p>
                        )}
                      </div>
                    )}
                  </>
                )}
              </section>

              <section className="mb-8">
                <h3 className="text-[10px] uppercase tracking-[0.2em] font-bold text-slate-400 dark:text-slate-500 mb-3">
                  Deliverables
                  {task.deliverables && task.deliverables.length > 0 && (
                    <span className="ml-2 text-slate-300 dark:text-slate-600 normal-case tracking-normal font-normal">
                      (
                      {
                        task.deliverables.filter(
                          (d) => d.status === "COMPLETED",
                        ).length
                      }
                      /{task.deliverables.length})
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
                  <DndContext
                    collisionDetection={closestCenter}
                    onDragEnd={(event: DragEndEvent) => {
                      const { active, over } = event;
                      if (!over || active.id === over.id || !task.deliverables)
                        return;
                      const oldIndex = task.deliverables.findIndex(
                        (d) => d.id === active.id,
                      );
                      const newIndex = task.deliverables.findIndex(
                        (d) => d.id === over.id,
                      );
                      if (oldIndex === -1 || newIndex === -1) return;
                      const reordered = arrayMove(
                        task.deliverables,
                        oldIndex,
                        newIndex,
                      );
                      reorderDeliverables(
                        task.id,
                        reordered.map((d) => d.id),
                      );
                    }}
                  >
                    <SortableContext
                      items={task.deliverables.map((d) => d.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      <div className="space-y-2">
                        {task.deliverables.map((d) => (
                          <SortableDeliverableItem
                            key={d.id}
                            deliverable={d}
                            taskId={task.id}
                            onToggle={toggleDeliverable}
                          />
                        ))}
                      </div>
                    </SortableContext>
                  </DndContext>
                )}
              </section>
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-black/[0.04] dark:border-white/[0.04] bg-slate-50 dark:bg-white/[0.02] flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="px-5 py-2 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400 text-[10px] uppercase tracking-widest font-bold hover:bg-black/5 dark:hover:bg-white/5 transition-all"
          >
            Close
          </button>
          {task.status !== "REVIEW" && (
            <button
              onClick={handleSubmit(handleUpdateTask)}
              disabled={isSubmitting}
              className="flex items-center gap-1.5 px-5 py-2 bg-[var(--accent-600)] text-white text-[10px] uppercase tracking-widest font-bold hover:bg-[var(--accent-500)] disabled:opacity-50 transition-all"
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
