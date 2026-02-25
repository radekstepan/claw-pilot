import { Settings } from 'lucide-react';
import { StatusDot } from '../ui/StatusDot';
import { Agent } from '../../types';

interface SidebarProps {
    agents: Agent[];
    selectedAgentId: string | null;
    onSelectAgent: (id: string | null) => void;
    onOpenSettings: () => void;
}

export const Sidebar = ({ agents, selectedAgentId, onSelectAgent, onOpenSettings }: SidebarProps) => (
    <aside className="w-64 border-r border-black/[0.06] dark:border-white/[0.06] bg-[#f8fafc] dark:bg-[#060509] flex flex-col overflow-hidden">
        <div className="p-4 border-b border-black/[0.04] dark:border-white/[0.04]">
            <h2 className="text-[9px] uppercase tracking-[0.2em] font-bold text-slate-400 dark:text-slate-500 mb-4">Agent Roster</h2>
            <div className="space-y-1">
                {agents.map(agent => (
                    <button
                        key={agent.id}
                        onClick={() => onSelectAgent(agent.id === selectedAgentId ? null : agent.id)}
                        className={`w-full flex items-center gap-3 p-2.5 rounded-sm transition-all group ${selectedAgentId === agent.id
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
                ))}
            </div>
        </div>

        <div className="mt-auto p-4 border-t border-black/[0.04] dark:border-white/[0.04]">
            <button
                onClick={onOpenSettings}
                className="w-full flex items-center justify-between text-[10px] uppercase tracking-wider font-bold text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors"
            >
                <span>Manage Squad</span>
                <Settings size={14} />
            </button>
        </div>
    </aside>
);
