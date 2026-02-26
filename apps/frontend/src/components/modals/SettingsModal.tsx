import { useState, useEffect } from 'react';
import { X, Bot, Cpu, Activity, Server, Settings as SettingsIcon, Trash2, Zap, Globe, RefreshCw, Plus, Save, Loader2, Sun, Moon, Palette } from 'lucide-react';
import type { Agent, AppConfig } from '@claw-pilot/shared-types';
import type { Model, GatewayStatus } from '../../api/client';
import { Badge } from '../ui/Badge';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { AgentFormModal } from './AgentFormModal';
import { api } from '../../api/client';
import { useMissionStore } from '../../store/useMissionStore';

interface SettingsModalProps {
    agents: Agent[];
    onClose: () => void;
    theme: string;
    onToggleTheme: () => void;
    accentColor: string;
    onChangeAccent: (color: string) => void;
}

export const SettingsModal = ({ agents, onClose, theme, onToggleTheme, accentColor, onChangeAccent }: SettingsModalProps) => {
    const [activeTab, setActiveTab] = useState('agents');

    // Agent form modal — declared before the Escape useEffect so the variable is in scope
    const [agentFormOpen, setAgentFormOpen] = useState(false);

    useEffect(() => {
        // When the inner AgentFormModal is open, it owns the Escape key — suppress this handler
        // so pressing Escape closes only the inner modal and not both at once.
        if (agentFormOpen) return;
        const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [onClose, agentFormOpen]);
    const [agentFormMode, setAgentFormMode] = useState<'create' | 'edit'>('create');
    const [agentForEdit, setAgentForEdit] = useState<Agent | null>(null);
    const [defaultWorkspace, setDefaultWorkspace] = useState('');

    // Delete confirmation state
    const [confirmDeleteAgent, setConfirmDeleteAgent] = useState<Agent | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);

    const [models, setModels] = useState<Model[]>([]);
    const [gatewayLogs, setGatewayLogs] = useState<string>('Loading gateway status...\n');

    const { refreshAgents } = useMissionStore();

    // Config state for System tab
    const [config, setConfig] = useState<AppConfig>({ gatewayUrl: '', apiPort: 54321, autoRestart: false, defaultWorkspace: '' });
    const [isSavingConfig, setIsSavingConfig] = useState(false);

    // Sync config once data is loaded
    useEffect(() => {
        api.getConfig().then(cfg => {
            setConfig(cfg);
            if (cfg.defaultWorkspace) setDefaultWorkspace(cfg.defaultWorkspace);
        }).catch(console.error);
    }, []);

    useEffect(() => {
        if (activeTab === 'models' || activeTab === 'agents') {
            api.getModels().then(setModels).catch(console.error);
        }
        if (activeTab === 'system') {
            api.getConfig().then(setConfig).catch(console.error);
            api.getGatewayStatus().then((data: GatewayStatus) => {
                if (data.status === 'ONLINE') {
                    setGatewayLogs('[System] Gateway connected and healthy.\n');
                } else if (data.status === 'PAIRING_REQUIRED') {
                    setGatewayLogs(`[System] Device pairing required.\nDevice ID: ${data.deviceId ?? 'unknown'}\n\n${data.instructions ?? ''}\n`);
                } else {
                    setGatewayLogs(`[System] Gateway status: ${data.status}${data.error ? '\nError: ' + data.error : ''}\n`);
                }
            }).catch((err: unknown) => {
                const message = err instanceof Error ? err.message : 'Unknown error';
                setGatewayLogs(`Failed to fetch gateway status: ${message}\n`);
            });
        }
    }, [activeTab]);

    const renderAgentsTab = () => (
        <div className="space-y-4 animate-fadeIn">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-[10px] uppercase tracking-widest font-bold text-slate-400 dark:text-slate-500">Active Squad</h3>
                <button
                    onClick={() => {
                        setAgentForEdit(null);
                        setAgentFormMode('create');
                        setAgentFormOpen(true);
                    }}
                    className="flex items-center gap-2 text-[9px] uppercase font-bold text-[var(--accent-600)] dark:text-[var(--accent-400)] hover:text-[var(--accent-500)] transition-colors"
                >
                    <Plus size={14} /> Add Agent
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {agents.map(agent => (
                    <div key={agent.id} className="p-3 bg-slate-50 dark:bg-white/[0.02] border border-black/[0.05] dark:border-white/[0.05] rounded group hover:border-violet-500/30 transition-all">
                        <div className="flex items-start justify-between mb-3">
                            <div className="flex items-center gap-2">
                                <div className={`w-2 h-2 rounded-full ${agent.status === 'WORKING' ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                                <span className="text-[11px] font-bold text-slate-900 dark:text-slate-200">{agent.name}</span>
                            </div>
                            <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                    title="Edit agent"
                                    className="text-slate-400 hover:text-slate-900 dark:hover:text-white"
                                    onClick={() => {
                                        setAgentForEdit(agent);
                                        setAgentFormMode('edit');
                                        setAgentFormOpen(true);
                                    }}
                                ><SettingsIcon size={12} /></button>
                                <button
                                    title="Delete agent"
                                    className="text-slate-400 hover:text-red-500"
                                    onClick={() => setConfirmDeleteAgent(agent)}
                                ><Trash2 size={12} /></button>
                            </div>
                        </div>
                        <div className="flex items-center gap-4 text-[9px] font-mono text-slate-500">
                            <div className="flex items-center gap-1"><Cpu size={10} /> {agent.model ?? '—'}</div>
                        </div>
                    </div>
                ))}
            </div>

            <ConfirmDialog
                open={confirmDeleteAgent !== null}
                title={`Delete ${confirmDeleteAgent?.name ?? 'agent'}?`}
                message="This will remove the agent from the OpenClaw gateway and delete its workspace files. This cannot be undone."
                confirmLabel={isDeleting ? 'Deleting…' : 'Delete Agent'}
                variant="danger"
                onConfirm={async () => {
                    if (!confirmDeleteAgent || isDeleting) return;
                    setIsDeleting(true);
                    try {
                        await api.deleteAgent(confirmDeleteAgent.id);
                        setConfirmDeleteAgent(null);
                        refreshAgents().catch(console.error);
                    } catch (err) {
                        console.error('Failed to delete agent:', err);
                    } finally {
                        setIsDeleting(false);
                    }
                }}
                onCancel={() => setConfirmDeleteAgent(null)}
            />

            {agentFormOpen && (
                <AgentFormModal
                    mode={agentFormMode}
                    agent={agentForEdit ?? undefined}
                    models={models}
                    defaultWorkspace={defaultWorkspace}
                    onClose={() => setAgentFormOpen(false)}
                />
            )}
        </div>
    );

    const renderModelsTab = () => (
        <div className="space-y-6 animate-fadeIn">
            <div className="flex items-center justify-between">
                <h3 className="text-[10px] uppercase tracking-widest font-bold text-slate-400 dark:text-slate-500">LLM Provider Status</h3>
                <button onClick={() => api.getModels().then(setModels).catch()} className="text-[9px] uppercase font-bold text-[var(--accent-600)] dark:text-[var(--accent-400)] flex items-center gap-1"><RefreshCw size={10} /> Rescan</button>
            </div>
            <div className="space-y-2">
                {models.map((model) => (
                    <div key={model.id} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-white/[0.02] border border-black/5 dark:border-white/5 rounded">
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-white dark:bg-white/5 rounded flex items-center justify-center border border-black/5 dark:border-white/5 shadow-sm">
                                <Zap size={14} className="text-amber-500" />
                            </div>
                            <div>
                                <div className="text-[11px] font-bold text-slate-900 dark:text-slate-200">{model.name}</div>
                                <div className="text-[9px] text-slate-500 uppercase">{model.provider}</div>
                            </div>
                        </div>
                        <Badge variant="success">Nominal</Badge>
                    </div>
                ))}
            </div>
        </div>
    );

    const renderAppearanceTab = () => {
        const accentSwatches = [
            { id: 'violet',  label: 'Violet',  bg: 'bg-violet-500',  ring: 'ring-violet-500' },
            { id: 'blue',    label: 'Blue',    bg: 'bg-blue-500',    ring: 'ring-blue-500' },
            { id: 'emerald', label: 'Emerald', bg: 'bg-emerald-500', ring: 'ring-emerald-500' },
            { id: 'rose',    label: 'Rose',    bg: 'bg-rose-500',    ring: 'ring-rose-500' },
            { id: 'amber',   label: 'Amber',   bg: 'bg-amber-500',   ring: 'ring-amber-500' },
        ];
        return (
            <div className="space-y-6 animate-fadeIn">
                <h3 className="text-[10px] uppercase tracking-widest font-bold text-slate-400 dark:text-slate-500">Appearance</h3>
                <div className="space-y-3">
                    <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-white/[0.02] border border-black/5 dark:border-white/5 rounded">
                        <div>
                            <p className="text-[11px] font-bold text-slate-700 dark:text-slate-300">Theme</p>
                            <p className="text-[9px] text-slate-400 mt-0.5">Switch between light and dark interface</p>
                        </div>
                        <div className="flex items-center gap-1 bg-black/5 dark:bg-white/5 rounded p-0.5">
                            <button
                                onClick={() => { if (theme !== 'light') onToggleTheme(); }}
                                className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-wider transition-all ${theme === 'light' ? 'bg-white dark:bg-white/10 text-slate-900 dark:text-white shadow-sm' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'}`}
                                aria-pressed={theme === 'light'}
                                aria-label="Light mode"
                            >
                                <Sun size={11} aria-hidden="true" /> Light
                            </button>
                            <button
                                onClick={() => { if (theme !== 'dark') onToggleTheme(); }}
                                className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-wider transition-all ${theme === 'dark' ? 'bg-white dark:bg-white/10 text-slate-900 dark:text-white shadow-sm' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'}`}
                                aria-pressed={theme === 'dark'}
                                aria-label="Dark mode"
                            >
                                <Moon size={11} aria-hidden="true" /> Dark
                            </button>
                        </div>
                    </div>

                    <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-white/[0.02] border border-black/5 dark:border-white/5 rounded">
                        <div>
                            <p className="text-[11px] font-bold text-slate-700 dark:text-slate-300">Highlight Color</p>
                            <p className="text-[9px] text-slate-400 mt-0.5">Used for buttons, active states and focus rings throughout the UI</p>
                        </div>
                        <div className="flex items-center gap-3">
                            {accentSwatches.map(swatch => (
                                <button
                                    key={swatch.id}
                                    onClick={() => onChangeAccent(swatch.id)}
                                    aria-label={`${swatch.label} accent color`}
                                    aria-pressed={accentColor === swatch.id}
                                    title={swatch.label}
                                    className={`w-6 h-6 rounded-full ${swatch.bg} transition-all focus-visible:outline-none ${accentColor === swatch.id ? `ring-2 ring-offset-2 ring-offset-white dark:ring-offset-[#0c0a14] ${swatch.ring} scale-110` : 'opacity-50 hover:opacity-100 hover:scale-105'}`}
                                />
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    const renderSystemTab = () => (
        <div className="space-y-6 animate-fadeIn">
            <div className="grid grid-cols-3 gap-4">
                {[
                    { label: 'Uptime', val: '99.8%', color: 'text-emerald-600 dark:text-emerald-400' },
                    { label: 'Avg Latency', val: '1.2s', color: 'text-amber-600 dark:text-amber-400' },
                    { label: 'Memory', val: '412mb', color: 'text-slate-500 dark:text-slate-400' }
                ].map(m => (
                    <div key={m.label} className="p-3 bg-slate-50 dark:bg-white/[0.02] border border-black/5 dark:border-white/5 rounded text-center">
                        <div className="text-[8px] uppercase text-slate-400 dark:text-slate-500 mb-1">{m.label}</div>
                        <div className={`text-sm font-mono font-bold ${m.color}`}>{m.val}</div>
                    </div>
                ))}
            </div>

            <div className="p-4 border accent-active-bg rounded space-y-4">
                <div className="flex items-center gap-2 mb-2">
                    <Globe size={14} className="text-[var(--accent-600)] dark:text-[var(--accent-500)]" />
                    <h3 className="text-[10px] uppercase font-bold text-slate-900 dark:text-white tracking-widest">Gateway Configuration</h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1">
                        <label className="text-[8px] uppercase font-bold text-slate-400 dark:text-slate-500">Gateway URL</label>
                        <input
                            type="text"
                            value={config.gatewayUrl}
                            onChange={(e) => setConfig(c => ({ ...c, gatewayUrl: e.target.value }))}
                            className="w-full bg-white dark:bg-black/20 border border-black/10 dark:border-white/10 rounded px-2 py-1.5 text-[10px] font-mono text-slate-900 dark:text-slate-300 outline-none focus:border-violet-500/50"
                        />
                    </div>
                    <div className="space-y-1">
                        <label className="text-[8px] uppercase font-bold text-slate-400 dark:text-slate-500">API Port</label>
                        <input
                            type="number"
                            value={config.apiPort}
                            onChange={(e) => setConfig(c => ({ ...c, apiPort: parseInt(e.target.value, 10) || c.apiPort }))}
                            className="w-full bg-white dark:bg-black/20 border border-black/10 dark:border-white/10 rounded px-2 py-1.5 text-[10px] font-mono text-slate-900 dark:text-slate-300 outline-none focus:border-violet-500/50"
                        />
                    </div>
                    <div className="space-y-1 col-span-full">
                        <label className="text-[8px] uppercase font-bold text-slate-400 dark:text-slate-500">Base Workspace Path</label>
                        <input
                            type="text"
                            value={config.defaultWorkspace}
                            onChange={(e) => {
                                const val = e.target.value;
                                setConfig(c => ({ ...c, defaultWorkspace: val }));
                                setDefaultWorkspace(val);
                            }}
                            placeholder="~/openclaw-agents"
                            className="w-full bg-white dark:bg-black/20 border border-black/10 dark:border-white/10 rounded px-2 py-1.5 text-[10px] font-mono text-slate-900 dark:text-slate-300 outline-none focus:border-violet-500/50"
                        />
                        <p className="text-[8px] text-slate-500 italic">Used as the parent directory for new agents.</p>
                    </div>
                    <div className="flex items-center gap-2 col-span-full">
                        <input
                            type="checkbox"
                            id="auto-restart"
                            className="accent-violet-600"
                            checked={config.autoRestart}
                            onChange={(e) => setConfig(c => ({ ...c, autoRestart: e.target.checked }))}
                        />
                        <label htmlFor="auto-restart" className="text-[10px] text-slate-600 dark:text-slate-400">Auto-restart OpenClaw gateway on CLI crash</label>
                    </div>
                </div>
                <button
                    onClick={async () => {
                        setIsSavingConfig(true);
                        try {
                            const saved = await api.saveConfig(config);
                            setConfig(saved);
                        } catch {
                            // error shown inline
                        } finally {
                            setIsSavingConfig(false);
                        }
                    }}
                    disabled={isSavingConfig}
                    className="flex items-center gap-2 px-4 py-2 bg-[var(--accent-600)] hover:bg-[var(--accent-500)] text-white text-[10px] uppercase tracking-widest font-bold disabled:opacity-50 transition-all"
                >
                    {isSavingConfig ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                    Save Changes
                </button>
            </div>

            <div className="space-y-2">
                <label className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 tracking-wider">Gateway Watchdog</label>
                <div className="p-3 bg-slate-900 dark:bg-black/20 rounded border border-black/5 dark:border-white/5 font-mono text-[9px] text-slate-400 h-24 overflow-y-auto whitespace-pre-wrap">
                    {gatewayLogs}
                </div>
            </div>
        </div>
    );

    return (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-6">
            <div className="absolute inset-0 bg-slate-900/40 dark:bg-black/60" onClick={onClose} />
            <div className="relative w-full max-w-3xl bg-white dark:bg-[#0c0a14] border border-black/10 dark:border-white/10 shadow-2xl flex flex-col h-[600px] animate-fadeIn overflow-hidden rounded">
                <div className="h-12 border-b border-black/[0.06] dark:border-white/[0.06] flex items-center px-6 justify-between bg-slate-50 dark:bg-white/[0.01]">
                    <div className="flex items-center gap-6 h-full">
                        <div className="flex items-center gap-2 mr-4">
                            <SettingsIcon size={14} className="text-[var(--accent-600)] dark:text-[var(--accent-500)]" />
                            <span className="text-[10px] uppercase tracking-[0.2em] font-bold text-slate-900 dark:text-white">System Settings</span>
                        </div>
                        {[
                            { id: 'agents', label: 'Squad Management', icon: Bot },
                            { id: 'models', label: 'Model Fallback', icon: Cpu },
                            { id: 'system', label: 'Gateway Health', icon: Activity },
                            { id: 'appearance', label: 'Appearance', icon: Palette },
                        ].map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                style={activeTab === tab.id ? { borderBottomColor: 'var(--accent-500)' } : undefined}
                        className={`flex items-center gap-2 px-1 h-full border-b-2 transition-all text-[10px] uppercase tracking-wider font-bold ${activeTab === tab.id
                                    ? 'border-[var(--accent-500)] text-slate-900 dark:text-white'
                                    : 'border-transparent text-slate-400 dark:text-slate-500 hover:text-slate-900 dark:hover:text-slate-300'
                                    }`}
                            >
                                <tab.icon size={12} /> {tab.label}
                            </button>
                        ))}
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-900 dark:hover:text-white"><X size={18} /></button>
                </div>

                <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
                    {activeTab === 'agents' && renderAgentsTab()}
                    {activeTab === 'models' && renderModelsTab()}
                    {activeTab === 'system' && renderSystemTab()}
                    {activeTab === 'appearance' && renderAppearanceTab()}
                </div>

                <div className="p-4 border-t border-black/[0.06] dark:border-white/[0.06] bg-slate-50 dark:bg-black/20 flex items-center justify-between text-[9px] font-mono text-slate-400 dark:text-slate-600">
                    <span>ClawController Revision: {__GIT_COMMIT__}</span>
                    <div className="flex items-center gap-4">
                        <span className="flex items-center gap-1"><Server size={10} /> LOCAL_INSTANCE</span>
                        <span>Environment: PRODUCTION_STABLE</span>
                    </div>
                </div>
            </div>
        </div>
    );
};
