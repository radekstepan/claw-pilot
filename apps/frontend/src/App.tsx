import { useState, useMemo, useEffect, useCallback } from "react";
import { Toaster, toast } from "sonner";
import { Header } from "./components/layout/Header";
import { Sidebar } from "./components/layout/Sidebar";
import { KanbanColumn } from "./components/kanban/KanbanColumn";
import { TaskModal } from "./components/modals/TaskModal";
import { SettingsModal } from "./components/modals/SettingsModal";
import { NewTaskModal } from "./components/modals/NewTaskModal";
import { RecurringView } from "./components/RecurringView";
import { Task } from "@claw-pilot/shared-types";
import type { CreateTaskPayload } from "@claw-pilot/shared-types";
import { COLUMN_IDS, COLUMN_TITLES } from "./constants";
import { useMissionStore } from "./store/useMissionStore";
import { useSocketListener } from "./hooks/useSocketListener";
import { AppNotification } from "./store/useMissionStore";

export default function App() {
  useSocketListener();

  // Persist theme to localStorage
  const [theme, setTheme] = useState<string>(
    () => localStorage.getItem("theme") ?? "dark",
  );

  // Persist accent color to localStorage
  const [accentColor, setAccentColor] = useState<string>(
    () => localStorage.getItem("accentColor") ?? "violet",
  );

  // ── Read/Unread tracking ─────────────────────────────────────────────────
  // A "read key" is `${taskId}:${status}`. A card is unread if its current key
  // isn't in the set (e.g. it was never opened, or it moved to a new swimlane).
  const [readSet, setReadSet] = useState<Set<string>>(new Set());
  const [readSetInitialised, setReadSetInitialised] = useState(false);
  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      localStorage.setItem("theme", next);
      return next;
    });
  }, []);

  const handleAccentChange = useCallback((color: string) => {
    localStorage.setItem("accentColor", color);
    setAccentColor(color);
  }, []);

  // Keep the <html> element's .dark class in sync with theme state.
  // The blocking <script> in index.html applies it before React mounts;
  // this effect keeps it accurate after user toggles.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    // Replace any existing accent-* class with the current one
    [
      "violet",
      "blue",
      "indigo",
      "sky",
      "cyan",
      "teal",
      "emerald",
      "rose",
      "pink",
      "amber",
      "orange",
    ].forEach((c) => root.classList.remove(`accent-${c}`));
    root.classList.add(`accent-${accentColor}`);
  }, [theme, accentColor]);

  // Zustand Store
  const {
    tasks,
    agents,
    fetchInitialData,
    fetchRecurring,
    isSocketConnected,
    gatewayOnline,
    gatewayPairingRequired,
    gatewayDeviceId,
    isLoading,
    dismissNotification,
  } = useMissionStore();

  // Local UI State
  const [filterText, setFilterText] = useState("");
  const [activeView, setActiveView] = useState<"kanban" | "recurring">(
    "kanban",
  );
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isNewTaskOpen, setIsNewTaskOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  useEffect(() => {
    fetchInitialData();
    fetchRecurring();
  }, [fetchInitialData, fetchRecurring]);

  // Mark all tasks as "read" once the initial load completes.
  // From that point on, a task becomes unread when its status changes (swimlane move).
  useEffect(() => {
    if (!readSetInitialised && !isLoading && tasks.length > 0) {
      setReadSet(new Set(tasks.map((t) => `${t.id}:${t.status}`)));
      setReadSetInitialised(true);
    }
  }, [isLoading, tasks, readSetInitialised]);

  const todayStr = new Date().toDateString();
  const stats = useMemo(
    () => ({
      queued: tasks.filter(
        (t) =>
          t.status === "BACKLOG" ||
          t.status === "TODO" ||
          t.status === "ASSIGNED",
      ).length,
      done: tasks.filter(
        (t) =>
          t.status === "DONE" &&
          new Date(t.updatedAt ?? t.createdAt ?? 0).toDateString() === todayStr,
      ).length,
    }),
    [tasks, todayStr],
  );

  const filteredTasks = useMemo(() => {
    let base = tasks;
    if (filterText.trim()) {
      const q = filterText.toLowerCase();
      base = base.filter(
        (t) =>
          (t.title ?? "").toLowerCase().includes(q) ||
          (t.description ?? "").toLowerCase().includes(q),
      );
    }
    // Sort newest-updated first within each swimlane
    return base
      .slice()
      .sort(
        (a, b) =>
          new Date(b.updatedAt ?? b.createdAt ?? 0).getTime() -
          new Date(a.updatedAt ?? a.createdAt ?? 0).getTime(),
      );
  }, [tasks, filterText]);

  const addTask = async (
    payload: CreateTaskPayload,
    options?: { skipRoute?: boolean },
  ) => {
    try {
      await useMissionStore.getState().createTask(payload, options);
    } catch {
      // toast already shown in the store
    }
  };

  const handleTaskClick = (task: Task) => {
    setActiveTaskId(task.id);
    // Mark this task's current swimlane position as "read"
    setReadSet((prev) => new Set([...prev, `${task.id}:${task.status}`]));
    // Dismiss any notifications associated with this task
    const notifications = useMissionStore.getState().notifications;
    notifications
      .filter((n) => n.taskId === task.id)
      .forEach((n) => dismissNotification(n.id));
  };

  const handleNotificationClick = (notification: AppNotification) => {
    if (!notification.taskId) {
      return;
    }

    const task = tasks.find((t) => t.id === notification.taskId);

    if (task) {
      handleTaskClick(task);
    } else {
      toast.error("Task not found", {
        description: "The task linked to this notification no longer exists.",
      });
    }

    dismissNotification(notification.id);
  };

  return (
    <div
      className={`flex flex-col h-screen font-sans selection:bg-violet-500/30 overflow-hidden ${theme === "dark" ? "bg-[var(--bg-dark-base)] text-slate-400" : "bg-white text-slate-600"}`}
    >
      <Toaster
        theme={theme as "dark" | "light"}
        position="bottom-right"
        richColors
        closeButton
      />
      <Header
        stats={stats}
        theme={theme}
        isSocketConnected={isSocketConnected}
        gatewayOnline={gatewayOnline}
        gatewayPairingRequired={gatewayPairingRequired}
        gatewayDeviceId={gatewayDeviceId}
        onToggleTheme={toggleTheme}
        onNewTask={() => setIsNewTaskOpen(true)}
        onToggleSidebar={() => setIsSidebarOpen((o) => !o)}
        filterText={filterText}
        onFilterChange={setFilterText}
        onNotificationClick={handleNotificationClick}
      />

      <main className="flex-1 flex overflow-hidden relative">
        {/* Mobile sidebar backdrop */}
        {isSidebarOpen && (
          <div
            className="fixed inset-0 z-30 bg-black/40 md:hidden"
            onClick={() => setIsSidebarOpen(false)}
            aria-hidden="true"
          />
        )}

        <Sidebar
          onOpenSettings={() => setIsSettingsOpen(true)}
          isMobileOpen={isSidebarOpen}
          onMobileClose={() => setIsSidebarOpen(false)}
          activeView={activeView}
          onChangeView={setActiveView}
        />

        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          {activeView === "kanban" && (
            <>
              <div className="flex-1 flex overflow-x-auto overflow-y-hidden custom-scrollbar bg-transparent">
                {COLUMN_IDS.map((colId) => (
                  <KanbanColumn
                    key={colId}
                    id={colId}
                    title={COLUMN_TITLES[colId]}
                    tasks={filteredTasks.filter((t) => t.status === colId)}
                    onTaskClick={handleTaskClick}
                    isLoading={isLoading}
                    readSet={readSet}
                  />
                ))}
              </div>
            </>
          )}

          {activeView === "recurring" && <RecurringView />}
        </div>
      </main>

      {activeTaskId && (
        <TaskModal
          taskId={activeTaskId}
          onClose={() => setActiveTaskId(null)}
          agents={agents}
        />
      )}
      {isSettingsOpen && (
        <SettingsModal
          agents={agents}
          onClose={() => setIsSettingsOpen(false)}
          theme={theme}
          onToggleTheme={toggleTheme}
          accentColor={accentColor}
          onChangeAccent={handleAccentChange}
        />
      )}
      {isNewTaskOpen && (
        <NewTaskModal
          agents={agents}
          onClose={() => setIsNewTaskOpen(false)}
          onAdd={addTask}
        />
      )}

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .custom-scrollbar::-webkit-scrollbar { width: 4px; height: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: var(--accent-scroll-sm); border-radius: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: var(--accent-scroll-hover); }
        
        @keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        .animate-slideUp { animation: slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
        .animate-fadeIn { animation: fadeIn 0.2s ease-out forwards; }
      `,
        }}
      />
    </div>
  );
}
