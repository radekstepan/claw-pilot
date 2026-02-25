import { Settings, CalendarClock, LayoutDashboard } from 'lucide-react';
import { StatusDot } from '../ui/StatusDot';
import { SkeletonAgentItem } from '../ui/SkeletonCard';
import { Agent } from '../../types';

interface SidebarProps {
    agents: Agent[];
    isLoading: boolean;
    selectedAgentId: string | null;
    onSelectAgent: (id: string | null) => void;
    onOpenSettings: () => void;
    isMobileOpen: boolean;
    onMobileClose: () => void;
    activeView: 'kanban' | 'recurring';
    onChangeView: (view: 'kanban' | 'recurring') => void;
}

export const Sidebar = ({ agents, isLoading, selectedAgentId, onSelectAgent, onOpenSettings, isMobileOpen, onMobileClose, activeView, onChangeView }: SidebarProps) => (
    <aside
        className={`
            fixed md:relative inset-y-0 left-0 z-40
            w-64 border-r border-black/[0.06] dark:border-white/[0.06]
            bg-[#f8fafc] dark:bg-[#060509] flex flex-col overflow-hidden
            transform transition-transform duration-300 ease-in-out
            ${isMobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
        `}
        aria-label="Agent roster navigation"
    >
        {/* View switcher */}
        <div className="p-4 border-b border-black/[0.04] dark:border-white/[0.04]">
            <h2 className="text-[9px] uppercase tracking-[0.2em] font-bold text-slate-400 dark:text-slate-500 mb-3">Navigation</h2>
            <nav className="space-y-1" aria-label="Views">
                <button
                    onClick={() => { onChangeView('kanban'); onMobileClose(); }}
                    aria-pressed={activeView === 'kanban'}
                    className={`w-full flex items-center gap-2.5 p-2.5 rounded-sm transition-all text-[11px] font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
                        activeView === 'kanban'
                            ? 'bg-violet-500/10 dark:bg-violet-500/10 border border-violet-500/20 text-violet-700 dark:text-violet-300'
                            : 'hover:bg-black/[0.02] dark:hover:bg-white/[0.03] border border-transparent text-slate-600 dark:text-slate-400'
                    }`}
                >
                    <LayoutDashboard size={13} />
                    Mission Board
                </button>
                <button
                    onClick={() => { onChangeView('recurring'); onMobileClose(); }}
                    aria-pressed={activeView === 'recurring'}
                    className={`w-full flex items-center gap-2.5 p-2.5 rounded-sm transition-all text-[11px] font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
                        activeView === 'recurring'
                            ? 'bg-violet-500/10 dark:bg-violet-500/10 border border-violet-500/20 text-violet-700 dark:text-violet-300'
                            : 'hover:bg-black/[0.02] dark:hover:bg-white/[0.03] border border-transparent text-slate-600 dark:text-slate-400'
                    }`}
                >
                    <CalendarClock size={13} />
                    Scheduled Missions
                </button>
            </nav>
        </div>

        <div className="p-4 border-b border-black/[0.04] dark:border-white/[0.04]">
            <h2 className="text-[9px] uppercase tracking-[0.2em] font-bold text-slate-400 dark:text-slate-500 mb-4">Agent Roster</h2>
            <nav className="space-y-1" aria-label="Agents">
                {isLoading ? (
                    Array.from({ length: 4 }).map((_, i) => <SkeletonAgentItem key={i} />)
                ) : (
                    agents.map(agent => (
                        <button
                            key={agent.id}
                            onClick={() => {
                                onSelectAgent(agent.id === selectedAgentId ? null : agent.id);
                                onMobileClose();
                            }}
                            aria-pressed={selectedAgentId === agent.id}
                            aria-label={`Filter by ${agent.name} (${agent.status})`}
                            className={`w-full flex items-center gap-3 p-2.5 rounded-sm transition-all group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${selectedAgentId === agent.id
                                ? 'bg-violet-500/10 dark:bg-violet-500/10 border border-violet-500/20'
                                : 'hover:bg-black/[0.02] dark:hover:bg-white/[0.03] border border-transparent'
                                }`}
                        >
                            <div className="flex-shrink-0">
                                <StatusDot status={agent.status} />
                            </div>
                            <div className="text-left overflow-hidden">
                                <div className="text-[11px] font-bold text-slate-900 dark:text-slate-200 truncate">{agent.name}</div>
                                <div className="text-[9px] text-slate-500 uppercase tracking-tighter truncate">{agent.role}</div>
                            </div>
                        </button>
                    ))
                )}
            </nav>
        </div>

        <div className="mt-auto p-4 border-t border-black/[0.04] dark:border-white/[0.04]">
            <button
                onClick={onOpenSettings}
                className="w-full flex items-center justify-between text-[10px] uppercase tracking-wider font-bold text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 rounded"
                aria-label="Open settings"
            >
                <span>Manage Squad</span>
                <Settings size={14} aria-hidden="true" />
            </button>
        </div>
    </aside>
);
