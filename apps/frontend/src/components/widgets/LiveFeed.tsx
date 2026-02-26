import { Activity } from 'lucide-react';
import { useMissionStore } from '../../store/useMissionStore';
import type { Agent } from '@claw-pilot/shared-types';

interface LiveFeedProps {
    collapsed: boolean;
    agents: Agent[];
}

export const LiveFeed = ({ collapsed, agents }: LiveFeedProps) => {
    const activities = useMissionStore((state) => state.activities);
    const activitiesCursor = useMissionStore((state) => state.activitiesCursor);
    const loadMoreActivities = useMissionStore((state) => state.loadMoreActivities);

    return (
        <div className={`${collapsed ? 'w-12' : 'w-72'} border-l border-black/[0.06] dark:border-white/[0.06] bg-[#f8fafc] dark:bg-[#060509] flex flex-col transition-all duration-300`}>
            {!collapsed ? (
                <>
                    <div className="p-4 border-b border-black/[0.04] dark:border-white/[0.04] flex items-center justify-between">
                        <h2 className="text-[9px] uppercase tracking-[0.2em] font-bold text-slate-400 dark:text-slate-500">Live Activity</h2>
                        <span className="w-1.5 h-1.5 bg-violet-500 rounded-full animate-pulse"></span>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
                        {activities.map(item => (
                            <div key={item.id} className="relative pl-4 border-l border-black/5 dark:border-white/5 group">
                                <div className="absolute top-1 -left-[3px] w-1.5 h-1.5 rounded-full bg-slate-300 dark:bg-slate-700 group-hover:bg-violet-500 transition-colors" />
                                <div className="text-[10px] text-slate-600 dark:text-slate-300 mb-0.5 leading-relaxed">
                                    <span className="font-bold text-violet-600 dark:text-violet-400 mr-1">
                                        {!item.agentId ? 'SYSTEM' : agents.find(a => a.id === item.agentId)?.name || item.agentId}
                                    </span>
                                    {item.message}
                                </div>
                                <div className="text-[8px] font-mono text-slate-400 dark:text-slate-600 uppercase">
                                    {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </div>
                            </div>
                        ))}
                        {activitiesCursor !== null && (
                            <button
                                onClick={loadMoreActivities}
                                className="w-full text-[9px] uppercase tracking-[0.15em] font-bold text-slate-400 dark:text-slate-600 hover:text-violet-500 dark:hover:text-violet-400 py-2 transition-colors"
                            >
                                Load more
                            </button>
                        )}
                    </div>
                </>
            ) : (
                <div className="flex flex-col items-center py-4 gap-6">
                    <Activity size={16} className="text-slate-400 dark:text-slate-500" />
                    <div className="h-[1px] w-4 bg-black/5 dark:bg-white/5" />
                    <div className="[writing-mode:vertical-lr] text-[9px] uppercase tracking-[0.3em] font-bold text-slate-400 dark:text-slate-700 rotate-180">Activity Feed</div>
                </div>
            )}
        </div>
    );
};
