import { useState, useMemo, useEffect, useCallback } from 'react';
import { Hash, ChevronRight, Search, Layout, Menu, X } from 'lucide-react';
import { DndContext, DragEndEvent, DragStartEvent, DragOverlay, pointerWithin, useSensor, useSensors, MouseSensor, TouchSensor } from '@dnd-kit/core';
import { Toaster } from 'sonner';
import { Header } from './components/layout/Header';
import { Sidebar } from './components/layout/Sidebar';
import { KanbanColumn } from './components/kanban/KanbanColumn';
import { LiveFeed } from './components/widgets/LiveFeed';
import { ChatWidget } from './components/widgets/ChatWidget';
import { TaskModal } from './components/modals/TaskModal';
import { SettingsModal } from './components/modals/SettingsModal';
import { NewTaskModal } from './components/modals/NewTaskModal';
import { RecurringView } from './components/RecurringView';
import { TaskCard } from './components/kanban/TaskCard';
import { Task } from '@claw-pilot/shared-types';
import type { CreateTaskPayload, TaskStatus } from '@claw-pilot/shared-types';
import { COLUMN_IDS, COLUMN_TITLES } from './constants';
import { useMissionStore } from './store/useMissionStore';
import { useSocketListener } from './hooks/useSocketListener';

export default function App() {
    useSocketListener();

    // Persist theme to localStorage
    const [theme, setTheme] = useState<string>(() => localStorage.getItem('theme') ?? 'dark');

    // ── Read/Unread tracking ─────────────────────────────────────────────────
    // A "read key" is `${taskId}:${status}`. A card is unread if its current key
    // isn't in the set (e.g. it was never opened, or it moved to a new swimlane).
    const [readSet, setReadSet] = useState<Set<string>>(new Set());
    const [readSetInitialised, setReadSetInitialised] = useState(false);
    const toggleTheme = useCallback(() => {
        setTheme(prev => {
            const next = prev === 'dark' ? 'light' : 'dark';
            localStorage.setItem('theme', next);
            return next;
        });
    }, []);

    // Keep the <html> element's .dark class in sync with theme state.
    // The blocking <script> in index.html applies it before React mounts;
    // this effect keeps it accurate after user toggles.
    useEffect(() => {
        document.documentElement.classList.toggle('dark', theme === 'dark');
    }, [theme]);

    // Zustand Store
    const { tasks, agents, fetchInitialData, fetchRecurring, updateTaskStatus, isSocketConnected, gatewayOnline, gatewayPairingRequired, gatewayDeviceId, isLoading } = useMissionStore();

    // Local UI State
    const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
    const [filterText, setFilterText] = useState('');
    const [activeView, setActiveView] = useState<'kanban' | 'recurring'>('kanban');
    const [activeTask, setActiveTask] = useState<Task | null>(null);
    const [activeDragTask, setActiveDragTask] = useState<Task | null>(null);
    const [isFeedCollapsed, setIsFeedCollapsed] = useState(false);
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
            setReadSet(new Set(tasks.map(t => `${t.id}:${t.status}`)));
            setReadSetInitialised(true);
        }
    }, [isLoading, tasks, readSetInitialised]);

    const activeAgents = useMemo(() => agents.filter(a => a.status === 'WORKING'), [agents]);

    const stats = useMemo(() => ({
        active: activeAgents.length,
        queued: tasks.filter(t => t.status === 'BACKLOG' || t.status === 'TODO' || t.status === 'ASSIGNED').length,
        done: tasks.filter(t => t.status === 'DONE').length,
    }), [tasks, activeAgents]);

    const filteredTasks = useMemo(() => {
        let base = selectedAgentId ? tasks.filter((t) => t.assignee_id === selectedAgentId) : tasks;
        if (filterText.trim()) {
            const q = filterText.toLowerCase();
            base = base.filter(t =>
                (t.title ?? '').toLowerCase().includes(q) ||
                (t.description ?? '').toLowerCase().includes(q)
            );
        }
        // Sort newest-updated first within each swimlane
        return base.slice().sort((a, b) =>
            new Date(b.updatedAt ?? b.createdAt ?? 0).getTime() -
            new Date(a.updatedAt ?? a.createdAt ?? 0).getTime()
        );
    }, [tasks, selectedAgentId, filterText]);

    const addTask = async (payload: CreateTaskPayload) => {
        try {
            await useMissionStore.getState().createTask(payload);
        } catch {
            // toast already shown in the store
        }
    };

    const handleTaskClick = (task: Task) => {
        setActiveTask(task);
        // Mark this task's current swimlane position as "read"
        setReadSet(prev => new Set([...prev, `${task.id}:${task.status}`]));
    };

    const mouseSensor = useSensor(MouseSensor, { activationConstraint: { distance: 5 } });
    const touchSensor = useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } });
    const sensors = useSensors(mouseSensor, touchSensor);

    const handleDragStart = (event: DragStartEvent) => {
        const draggedTask = tasks.find(t => t.id === event.active.id);
        setActiveDragTask(draggedTask ?? null);
    };

    const handleDragEnd = (event: DragEndEvent) => {
        setActiveDragTask(null);
        const { active, over } = event;
        if (!over) return;

        const taskId = active.id as string;
        const newStatus = over.id as TaskStatus;

        // UI-level guard: block direct drag to DONE (backend enforces 403, but give instant feedback)
        if (newStatus === 'DONE') return;

        const task = tasks.find(t => t.id === taskId);
        if (task && task.status !== newStatus) {
            updateTaskStatus(taskId, newStatus);
        }
    };

    return (
        <div className={`flex flex-col h-screen font-sans selection:bg-violet-500/30 overflow-hidden ${theme === 'dark' ? 'bg-[#08070b] text-slate-400' : 'bg-white text-slate-600'}`}>
            <Toaster
                theme={theme as 'dark' | 'light'}
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
                activeAgents={activeAgents}
                onToggleTheme={toggleTheme}
                onNewTask={() => setIsNewTaskOpen(true)}
                onToggleSidebar={() => setIsSidebarOpen(o => !o)}
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
                    agents={agents}
                    isLoading={isLoading}
                    selectedAgentId={selectedAgentId}
                    onSelectAgent={setSelectedAgentId}
                    onOpenSettings={() => setIsSettingsOpen(true)}
                    isMobileOpen={isSidebarOpen}
                    onMobileClose={() => setIsSidebarOpen(false)}
                    activeView={activeView}
                    onChangeView={setActiveView}
                />

                <div className="flex-1 flex flex-col overflow-hidden min-w-0">
                    {activeView === 'kanban' && (
                        <>
                    <div className="h-10 px-4 md:px-6 border-b border-black/[0.04] dark:border-white/[0.04] bg-[#fcfdfe] dark:bg-white/[0.01] flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <button
                                className="md:hidden p-1 text-slate-500 hover:text-slate-900 dark:hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 rounded"
                                onClick={() => setIsSidebarOpen(o => !o)}
                                aria-label="Toggle sidebar"
                            >
                                <Menu size={14} />
                            </button>
                            <Hash size={12} className="text-slate-400 dark:text-slate-600" />
                            <span className="text-[10px] uppercase tracking-widest font-bold text-slate-400 dark:text-slate-500">Active Board</span>
                            <ChevronRight size={12} className="text-slate-300 dark:text-slate-700" />
                            <span className="text-[10px] uppercase tracking-widest font-bold text-violet-600 dark:text-violet-400 hidden sm:inline">
                                {selectedAgentId ? `Filter: ${agents.find(a => a.id === selectedAgentId)?.name}` : 'All Missions'}
                            </span>
                        </div>

                        <div className="flex items-center gap-4">
                            <div className="relative hidden sm:block">
                                <Search size={12} className="absolute left-2 top-1.5 text-slate-300 dark:text-slate-700" />
                                <input
                                    type="text"
                                    placeholder="Filter..."
                                    aria-label="Filter tasks"
                                    value={filterText}
                                    onChange={e => setFilterText(e.target.value)}
                                    className="bg-transparent border-none text-[10px] py-1 pl-7 pr-5 outline-none w-24 focus:w-40 transition-all placeholder:text-slate-300 dark:placeholder:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 rounded"
                                />
                                {filterText && (
                                    <button
                                        onClick={() => setFilterText('')}
                                        className="absolute right-1 top-1 text-slate-300 dark:text-slate-600 hover:text-slate-600 dark:hover:text-slate-300 focus-visible:outline-none"
                                        aria-label="Clear filter"
                                    >
                                        <X size={10} />
                                    </button>
                                )}
                            </div>
                            <button
                                onClick={() => setIsFeedCollapsed(!isFeedCollapsed)}
                                className="p-1 hover:text-slate-900 dark:hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 rounded"
                                aria-label={isFeedCollapsed ? 'Expand live feed' : 'Collapse live feed'}
                            >
                                <Layout size={14} />
                            </button>
                        </div>
                    </div>

                    <div className="flex-1 flex overflow-x-auto overflow-y-hidden custom-scrollbar bg-transparent">
                        <DndContext
                            sensors={sensors}
                            onDragStart={handleDragStart}
                            onDragEnd={handleDragEnd}
                            collisionDetection={pointerWithin}
                        >
                            {COLUMN_IDS.map(colId => (
                                <KanbanColumn
                                    key={colId}
                                    id={colId}
                                    title={COLUMN_TITLES[colId]}
                                    tasks={filteredTasks.filter(t => t.status === colId)}
                                    onTaskClick={handleTaskClick}
                                    isLoading={isLoading}
                                    isDragging={activeDragTask !== null}
                                    readSet={readSet}
                                />
                            ))}
                            <DragOverlay dropAnimation={null}>
                                {activeDragTask ? (
                                    <div className="rotate-1 opacity-95 pointer-events-none">
                                        <TaskCard task={activeDragTask} onClick={() => {}} isOverlay />
                                    </div>
                                ) : null}
                            </DragOverlay>
                        </DndContext>
                    </div>
                        </>
                    )}

                    {activeView === 'recurring' && <RecurringView />}
                </div>

                <LiveFeed collapsed={isFeedCollapsed} agents={agents} />
            </main>

            <ChatWidget />
            {activeTask && <TaskModal task={activeTask} onClose={() => setActiveTask(null)} agents={agents} />}
            {isSettingsOpen && <SettingsModal agents={agents} onClose={() => setIsSettingsOpen(false)} theme={theme} />}
            {isNewTaskOpen && <NewTaskModal agents={agents} onClose={() => setIsNewTaskOpen(false)} onAdd={addTask} />}

            <style dangerouslySetInnerHTML={{
                __html: `
        .custom-scrollbar::-webkit-scrollbar { width: 4px; height: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(139, 92, 246, 0.1); border-radius: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(139, 92, 246, 0.3); }
        
        @keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        .animate-slideUp { animation: slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
        .animate-fadeIn { animation: fadeIn 0.2s ease-out forwards; }
      `}} />
        </div>
    );
}
