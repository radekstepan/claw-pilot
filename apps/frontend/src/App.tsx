import { useState, useMemo } from 'react';
import { Hash, ChevronRight, Search, Layout } from 'lucide-react';
import { Header } from './components/layout/Header';
import { Sidebar } from './components/layout/Sidebar';
import { KanbanColumn } from './components/kanban/KanbanColumn';
import { LiveFeed } from './components/widgets/LiveFeed';
import { ChatWidget } from './components/widgets/ChatWidget';
import { TaskModal } from './components/modals/TaskModal';
import { SettingsModal } from './components/modals/SettingsModal';
import { NewTaskModal } from './components/modals/NewTaskModal';
import { Task, Agent } from './types';
import { INITIAL_TASKS, INITIAL_AGENTS, COLUMN_IDS, COLUMN_TITLES } from './constants';

export default function App() {
    const [theme, setTheme] = useState('dark');
    const [tasks, setTasks] = useState<Task[]>(INITIAL_TASKS);
    const [agents] = useState<Agent[]>(INITIAL_AGENTS);
    const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
    const [activeTask, setActiveTask] = useState<Task | null>(null);
    const [isFeedCollapsed, setIsFeedCollapsed] = useState(false);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [isNewTaskOpen, setIsNewTaskOpen] = useState(false);

    const stats = useMemo(() => ({
        active: agents.filter(a => a.status === 'working').length,
        queued: tasks.filter(t => t.status === 'INBOX' || t.status === 'ASSIGNED').length,
        done: tasks.filter(t => t.status === 'DONE').length,
    }), [tasks, agents]);

    const filteredTasks = useMemo(() => {
        if (!selectedAgentId) return tasks;
        return tasks.filter(t => t.assignee === selectedAgentId);
    }, [tasks, selectedAgentId]);

    const addTask = (newTask: Task) => {
        setTasks((prev) => [newTask, ...prev]);
    };

    return (
        <div className={`flex flex-col h-screen font-sans selection:bg-violet-500/30 overflow-hidden ${theme === 'dark' ? 'dark bg-[#08070b] text-slate-400' : 'bg-white text-slate-600'}`}>
            <Header
                stats={stats}
                theme={theme}
                onToggleTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                onNewTask={() => setIsNewTaskOpen(true)}
            />

            <main className="flex-1 flex overflow-hidden">
                <Sidebar
                    agents={agents}
                    selectedAgentId={selectedAgentId}
                    onSelectAgent={setSelectedAgentId}
                    onOpenSettings={() => setIsSettingsOpen(true)}
                />

                <div className="flex-1 flex flex-col overflow-hidden">
                    <div className="h-10 px-6 border-b border-black/[0.04] dark:border-white/[0.04] bg-[#fcfdfe] dark:bg-white/[0.01] flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Hash size={12} className="text-slate-400 dark:text-slate-600" />
                            <span className="text-[10px] uppercase tracking-widest font-bold text-slate-400 dark:text-slate-500">Active Board</span>
                            <ChevronRight size={12} className="text-slate-300 dark:text-slate-700" />
                            <span className="text-[10px] uppercase tracking-widest font-bold text-violet-600 dark:text-violet-400">
                                {selectedAgentId ? `Filter: ${agents.find(a => a.id === selectedAgentId)?.name}` : 'All Missions'}
                            </span>
                        </div>

                        <div className="flex items-center gap-4">
                            <div className="relative">
                                <Search size={12} className="absolute left-2 top-1.5 text-slate-300 dark:text-slate-700" />
                                <input
                                    type="text"
                                    placeholder="Filter..."
                                    className="bg-transparent border-none text-[10px] py-1 pl-7 outline-none w-24 focus:w-40 transition-all placeholder:text-slate-300 dark:placeholder:text-slate-800"
                                />
                            </div>
                            <button
                                onClick={() => setIsFeedCollapsed(!isFeedCollapsed)}
                                className="p-1 hover:text-slate-900 dark:hover:text-white transition-colors"
                            >
                                <Layout size={14} />
                            </button>
                        </div>
                    </div>

                    <div className="flex-1 flex overflow-x-auto overflow-y-hidden custom-scrollbar bg-transparent">
                        {COLUMN_IDS.map(colId => (
                            <KanbanColumn
                                key={colId}
                                id={colId}
                                title={COLUMN_TITLES[colId]}
                                tasks={filteredTasks.filter(t => t.status === colId)}
                                onTaskClick={setActiveTask}
                            />
                        ))}
                    </div>
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
