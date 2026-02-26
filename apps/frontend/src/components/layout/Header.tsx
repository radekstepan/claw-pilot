import { Terminal, Sun, Moon, Plus, Menu, WifiOff, Link2, Copy } from 'lucide-react';
import { Agent } from '@claw-pilot/shared-types';
import { NotificationsPanel } from '../ui/NotificationsPanel';

interface HeaderProps {
    stats: { active: number; queued: number; done: number };
    theme: string;
    isSocketConnected: boolean;
    /** null = status not yet known (first monitor tick pending) */
    gatewayOnline: boolean | null;
    /** True when the device identity has been sent to the gateway but pairing is not yet approved. */
    gatewayPairingRequired: boolean;
    /** Stable device ID to show in pairing instructions. */
    gatewayDeviceId: string | null;
    /** Agents currently in WORKING status — used for the active agents indicator. */
    activeAgents: Agent[];
    onToggleTheme: () => void;
    onNewTask: () => void;
    onToggleSidebar: () => void;
}

type PillState = 'disconnected' | 'pairing' | 'offline' | 'nominal';

function getPillState(isSocketConnected: boolean, gatewayPairingRequired: boolean, gatewayOnline: boolean | null): PillState {
    if (!isSocketConnected) return 'disconnected';
    if (gatewayPairingRequired) return 'pairing';
    if (gatewayOnline === false) return 'offline';
    return 'nominal';
}

const PILL_STYLES: Record<PillState, { container: string; dot: string; text: string; label: string }> = {
    disconnected: {
        container: 'bg-red-500/5 border-red-500/20',
        dot: 'bg-red-500',
        text: 'text-red-600 dark:text-red-500',
        label: 'Disconnected',
    },
    pairing: {
        container: 'bg-yellow-500/5 border-yellow-500/20',
        dot: 'bg-yellow-400',
        text: 'text-yellow-600 dark:text-yellow-400',
        label: 'Pair Device',
    },
    offline: {
        container: 'bg-amber-500/5 border-amber-500/20',
        dot: 'bg-amber-500',
        text: 'text-amber-600 dark:text-amber-400',
        label: 'Gateway Offline',
    },
    nominal: {
        container: 'bg-emerald-500/5 border-emerald-500/20',
        dot: 'bg-emerald-500',
        text: 'text-emerald-600 dark:text-emerald-500',
        label: 'Nominal',
    },
};

export const Header = ({ stats, theme, isSocketConnected, gatewayOnline, gatewayPairingRequired, gatewayDeviceId, activeAgents, onToggleTheme, onNewTask, onToggleSidebar }: HeaderProps) => {
    const pillState = getPillState(isSocketConnected, gatewayPairingRequired, gatewayOnline);
    const pill = PILL_STYLES[pillState];

    const copyDeviceId = () => {
        if (gatewayDeviceId) void navigator.clipboard.writeText(gatewayDeviceId);
    };

    return (
    <>
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
                    <h1 className="text-sm font-bold tracking-widest text-slate-900 dark:text-white uppercase">ClawPilot</h1>
                    <div className="text-[9px] text-slate-500 font-mono tracking-tighter">MISSION_CONTROL // {__GIT_COMMIT__}</div>
                </div>
            </div>

            <nav className="hidden md:flex items-center gap-6" aria-label="Key metrics">
                {/* ── Active Agents — glowing indicator with hover tooltip ── */}
                <div className="flex flex-col relative group/agents">
                    <span className="text-[9px] uppercase tracking-wider text-slate-500">Active Agents</span>
                    <div className="flex items-center gap-1.5">
                        {stats.active > 0 ? (
                            <>
                                {/* Layered glow: outer ring animates at a different timing for a breathing effect */}
                                <span className="relative flex items-center justify-center" aria-hidden="true">
                                    <span className="absolute w-3.5 h-3.5 rounded-full bg-emerald-500/20 animate-ping" style={{ animationDuration: '1.8s' }} />
                                    <span className="relative w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_6px_2px_rgba(16,185,129,0.5)]" />
                                </span>
                                <span className="text-xs font-mono font-bold text-emerald-600 dark:text-emerald-400" aria-label={`Active Agents: ${stats.active}`}>{stats.active}</span>
                            </>
                        ) : (
                            <span className="text-xs font-mono font-bold text-slate-500 dark:text-slate-400" aria-label="Active Agents: 0">0</span>
                        )}
                    </div>
                    {/* Hover tooltip listing working agents */}
                    {stats.active > 0 && (
                        <div className="absolute top-full left-0 mt-2 z-50 hidden group-hover/agents:block pointer-events-none">
                            <div className="bg-white dark:bg-[#0e0c14] border border-black/10 dark:border-white/10 rounded shadow-xl p-2 min-w-[160px]">
                                <p className="text-[9px] uppercase tracking-widest text-slate-400 mb-1.5 font-bold">Working now</p>
                                {activeAgents.map(a => (
                                    <div key={a.id} className="flex items-center gap-1.5 py-0.5">
                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
                                        <span className="text-[10px] text-slate-700 dark:text-slate-300 font-medium truncate">{a.name}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {[
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
                aria-label={
                    pillState === 'disconnected' ? 'Backend disconnected'
                    : pillState === 'pairing' ? 'Device pairing required'
                    : pillState === 'offline' ? 'OpenClaw gateway offline'
                    : 'All systems nominal'
                }
                className={`hidden sm:flex items-center gap-2 px-2.5 py-1 rounded-sm border mr-2 md:mr-4 ${pill.container}`}>
                <div className={`w-1.5 h-1.5 rounded-full ${pill.dot}`} aria-hidden="true" />
                <span className={`text-[10px] uppercase font-bold tracking-wider ${pill.text}`}>
                    {pill.label}
                </span>
            </div>

            <NotificationsPanel />
            <button
                onClick={onNewTask}
                className="px-3 md:px-4 py-1.5 bg-violet-600 hover:bg-violet-500 text-white text-[10px] font-bold uppercase tracking-widest transition-all rounded-sm flex items-center gap-2 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2"
                aria-label="Create new task"
            >
                <Plus size={14} aria-hidden="true" /> <span className="hidden sm:inline">New Task</span>
            </button>
        </div>
    </header>

    {/* ── Pairing required banner ── */}
    {isSocketConnected && gatewayPairingRequired && (
        <div
            role="alert"
            aria-live="polite"
            className="sticky top-14 z-40 px-4 py-3 bg-yellow-500/10 border-b border-yellow-500/20 text-yellow-800 dark:text-yellow-300 text-[11px]"
        >
            <div className="flex items-start gap-2 max-w-4xl">
                <Link2 size={14} className="shrink-0 mt-0.5" aria-hidden="true" />
                <div className="space-y-1 min-w-0">
                    <p className="font-semibold">Device pairing required — OpenClaw gateway is waiting for your approval</p>
                    <p className="text-yellow-700 dark:text-yellow-400">
                        SSH into the gateway machine and run these two commands. Pending requests expire in ~5 minutes.
                    </p>
                    <pre className="mt-1.5 bg-black/10 dark:bg-white/5 rounded px-3 py-2 font-mono text-[10px] text-yellow-900 dark:text-yellow-200 whitespace-pre-wrap break-all">
{`openclaw devices list\nopenclaw devices approve --latest`}
                    </pre>
                    {gatewayDeviceId && (
                        <div className="flex items-center gap-2 mt-1">
                            <span className="text-yellow-600 dark:text-yellow-500">Your device ID:</span>
                            <code className="font-mono text-[10px] bg-black/10 dark:bg-white/5 px-1.5 py-0.5 rounded break-all">{gatewayDeviceId}</code>
                            <button
                                onClick={copyDeviceId}
                                className="p-0.5 hover:text-yellow-900 dark:hover:text-yellow-100 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-yellow-400 rounded"
                                aria-label="Copy device ID"
                                title="Copy device ID"
                            >
                                <Copy size={11} />
                            </button>
                        </div>
                    )}
                    <p className="text-yellow-600 dark:text-yellow-500 text-[10px] mt-1">
                        After approval, reconnect or wait for the next health check (~10s). You will only need to do this once.
                    </p>
                </div>
            </div>
        </div>
    )}

    {/* ── Gateway offline banner ── */}
    {isSocketConnected && gatewayOnline === false && !gatewayPairingRequired && (
        <div
            role="alert"
            aria-live="polite"
            className="sticky top-14 z-40 flex items-center gap-2 px-4 py-2 bg-amber-500/10 border-b border-amber-500/20 text-amber-700 dark:text-amber-400 text-[11px] font-medium"
        >
            <WifiOff size={13} aria-hidden="true" className="shrink-0" />
            <span><strong>OpenClaw gateway unreachable</strong> — AI features (agent routing, chat, models) are offline. Non-AI features continue to work normally.</span>
        </div>
    )}
    </>
    );
};
