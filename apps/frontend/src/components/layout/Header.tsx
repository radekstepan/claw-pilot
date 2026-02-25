import { Terminal, Sun, Moon, Bell, Plus, ChevronDown, Menu } from 'lucide-react';

interface HeaderProps {
    stats: { active: number; queued: number; done: number };
    theme: string;
    isSocketConnected: boolean;
    onToggleTheme: () => void;
    onNewTask: () => void;
    onToggleSidebar: () => void;
}

export const Header = ({ stats, theme, isSocketConnected, onToggleTheme, onNewTask, onToggleSidebar }: HeaderProps) => (
    <header className="h-14 border-b border-black/[0.06] dark:border-white/[0.06] bg-[#f8fafc] dark:bg-[#060509] flex items-center justify-between px-4 md:px-6 sticky top-0 z-50">
        <div className="flex items-center gap-3 md:gap-8">
            <button
                className="md:hidden p-1 text-slate-500 hover:text-slate-900 dark:hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 rounded"
                onClick={onToggleSidebar}
                aria-label="Toggle navigation sidebar"
            >
                <Menu size={18} />
            </button>
            <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-violet-600 rounded flex items-center justify-center" aria-hidden="true">
                    <Terminal size={18} className="text-white" />
                </div>
                <div>
                    <h1 className="text-sm font-bold tracking-widest text-slate-900 dark:text-white uppercase">ClawController</h1>
                    <div className="text-[9px] text-slate-500 font-mono tracking-tighter">MISSION_CONTROL // v2.2.0</div>
                </div>
            </div>

            <nav className="hidden md:flex items-center gap-6" aria-label="Key metrics">
                {[
                    { label: 'Active Agents', val: stats.active, color: 'text-emerald-600 dark:text-emerald-400' },
                    { label: 'Tasks Queue', val: stats.queued, color: 'text-violet-600 dark:text-violet-400' },
                    { label: 'Done Today', val: stats.done, color: 'text-slate-500 dark:text-slate-400' }
                ].map(stat => (
                    <div key={stat.label} className="flex flex-col">
                        <span className="text-[9px] uppercase tracking-wider text-slate-500">{stat.label}</span>
                        <span className={`text-xs font-mono font-bold ${stat.color}`} aria-label={`${stat.label}: ${stat.val}`}>{stat.val}</span>
                    </div>
                ))}
            </nav>
        </div>

        <div className="flex items-center gap-2 md:gap-3">
            <button
                onClick={onToggleTheme}
                className="p-2 text-slate-500 hover:text-violet-600 dark:hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 rounded"
                aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            >
                {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>

            <div
                role="status"
                aria-label={isSocketConnected ? 'Gateway connected' : 'Gateway disconnected'}
                className={`hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full border mr-2 md:mr-4 cursor-default transition-colors group ${isSocketConnected
                    ? 'bg-emerald-500/5 border-emerald-500/20 hover:bg-emerald-500/10'
                    : 'bg-red-500/5 border-red-500/20 hover:bg-red-500/10'
                }`}>
                <div className={`w-1.5 h-1.5 rounded-full animate-pulse ${isSocketConnected ? 'bg-emerald-500' : 'bg-red-500'}`} aria-hidden="true" />
                <span className={`text-[10px] uppercase font-bold tracking-wider ${isSocketConnected ? 'text-emerald-600 dark:text-emerald-500' : 'text-red-600 dark:text-red-500'}`}>
                    {isSocketConnected ? 'Gateway Nominal' : 'Disconnected'}
                </span>
                <ChevronDown size={12} className={`${isSocketConnected ? 'text-emerald-500' : 'text-red-500'} opacity-50 group-hover:opacity-100`} aria-hidden="true" />
            </div>

            <button
                className="p-2 text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 rounded"
                aria-label="Notifications"
            >
                <Bell size={18} />
                <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-violet-500 rounded-full border-2 border-white dark:border-[#060509]" aria-hidden="true" />
            </button>
            <button
                onClick={onNewTask}
                className="px-3 md:px-4 py-1.5 bg-violet-600 hover:bg-violet-500 text-white text-[10px] font-bold uppercase tracking-widest transition-all rounded-sm flex items-center gap-2 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2"
                aria-label="Create new task"
            >
                <Plus size={14} aria-hidden="true" /> <span className="hidden sm:inline">New Task</span>
            </button>
        </div>
    </header>
);
