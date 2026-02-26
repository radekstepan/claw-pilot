import { useState, useEffect } from 'react';
import { X, Bot, Cpu, Activity, Server, Settings as SettingsIcon, Shield, Trash2, Zap, Globe, RefreshCw, Wand2, ChevronRight, Plus, Save, Loader2 } from 'lucide-react';
import type { Agent, AppConfig } from '@claw-pilot/shared-types';
import type { Model, GatewayStatus, GeneratedAgentConfig } from '../../api/client';
import { Badge } from '../ui/Badge';
import { api } from '../../api/client';

interface SettingsModalProps {
    agents: Agent[];
    onClose: () => void;
    theme: string;
}

const AVAILABLE_MODELS: Model[] = [
    { id: 'claude-3-5-sonnet', name: 'Claude 3.5 Sonnet', provider: 'Anthropic' },
    { id: 'gpt-4o', name: 'GPT-4o', provider: 'OpenAI' },
    { id: 'gpt-4o-mini', name: 'GPT-4o mini', provider: 'OpenAI' },
    { id: 'o1-preview', name: 'o1-preview', provider: 'OpenAI' },
    { id: 'llama-3-8b', name: 'Llama 3 8b', provider: 'Groq' },
];

export const SettingsModal = ({ agents, onClose }: SettingsModalProps) => {
    const [activeTab, setActiveTab] = useState('agents');
    const [wizardStep, setWizardStep] = useState(0);
    const [prompt, setPrompt] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);
    const [generatedConfig, setGeneratedConfig] = useState<GeneratedAgentConfig | null>(null);

    const [models, setModels] = useState<Model[]>(AVAILABLE_MODELS);
    const [gatewayLogs, setGatewayLogs] = useState<string>('Loading gateway status...\n');

    // Config state for System tab
    const [config, setConfig] = useState<AppConfig>({ gatewayUrl: '', apiPort: 54321, autoRestart: false });
    const [isSavingConfig, setIsSavingConfig] = useState(false);

    useEffect(() => {
        if (activeTab === 'models') {
            api.getModels().then(setModels).catch(console.error);
        } else if (activeTab === 'system') {
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

    const renderAgentsTab = () => {
        if (wizardStep === 1) {
            return (
                <div className="space-y-6 animate-fadeIn">
                    <div className="flex items-center gap-2 mb-4">
                        <button onClick={() => setWizardStep(0)} className="p-1 hover:text-slate-900 dark:hover:text-white"><ChevronRight size={16} className="rotate-180" /></button>
                        <h3 className="text-xs font-bold uppercase tracking-widest text-slate-900 dark:text-white">Create New Agent</h3>
                    </div>
                    <div className="space-y-4">
                        <label className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 tracking-wider">Mission Prompt</label>
                        <textarea
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            placeholder="e.g. I need a python expert who specializes in data visualization..."
                            className="w-full h-32 bg-slate-100 dark:bg-black/20 border border-black/10 dark:border-white/10 rounded p-3 text-xs text-slate-900 dark:text-slate-300 outline-none focus:border-violet-500/50 flex-shrink-0 whitespace-pre-wrap resize-y"
                        />
                        <button
                            onClick={async () => {
                                if (!prompt.trim()) return;
                                setIsGenerating(true);
                                try {
                                    const config = await api.generateAgent(prompt);
                                    setGeneratedConfig(config);
                                    setWizardStep(2);
                                } catch (error) {
                                    console.error('Failed to generate agent:', error);
                                } finally {
                                    setIsGenerating(false);
                                }
                            }}
                            disabled={isGenerating || !prompt.trim()}
                            className="w-full py-3 bg-violet-600 text-white text-[10px] font-bold uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isGenerating ? <RefreshCw size={14} className="animate-spin" /> : <Wand2 size={14} />}
                            {isGenerating ? 'Generating...' : 'Generate Configuration'}
                        </button>
                    </div>
                </div>
            );
        }

        if (wizardStep === 2) {
            return (
                <div className="space-y-6 animate-fadeIn">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <button onClick={() => setWizardStep(1)} className="p-1 hover:text-slate-900 dark:hover:text-white"><ChevronRight size={16} className="rotate-180" /></button>
                            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-900 dark:text-white">Review Configuration</h3>
                        </div>
                        <Badge variant="success">AI Generated</Badge>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-4">
                            <div>
                                <label className="text-[8px] uppercase font-bold text-slate-400 dark:text-slate-500 block mb-1">Configuration (JSON)</label>
                                <div className="h-48 bg-slate-50 dark:bg-black/40 rounded border border-black/5 dark:border-white/5 p-3 font-mono text-[9px] text-emerald-600 dark:text-emerald-400/80 overflow-y-auto whitespace-pre">
                                    {generatedConfig ? JSON.stringify(generatedConfig, null, 2) : 'No config generated'}
                                </div>
                            </div>
                        </div>
                        <div className="space-y-4">
                            <div>
                                <label className="text-[8px] uppercase font-bold text-slate-400 dark:text-slate-500 block mb-1">CAPABILITIES</label>
                                <div className="h-48 bg-slate-50 dark:bg-black/40 rounded border border-black/5 dark:border-white/5 p-3 font-mono text-[9px] text-cyan-600 dark:text-cyan-400/80 overflow-y-auto">
                                    {generatedConfig?.capabilities?.map((cap: string, i: number) => (
                                        <div key={i}>- {cap}</div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                    <button
                        onClick={() => setWizardStep(0)}
                        className="w-full py-3 bg-emerald-600 text-white text-[10px] font-bold uppercase tracking-widest hover:bg-emerald-500"
                    >
                        Deploy Agent
                    </button>
                </div>
            );
        }

        return (
            <div className="space-y-4 animate-fadeIn">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-[10px] uppercase tracking-widest font-bold text-slate-400 dark:text-slate-500">Active Squad</h3>
                    <button
                        onClick={() => setWizardStep(1)}
                        className="flex items-center gap-2 text-[9px] uppercase font-bold text-violet-600 dark:text-violet-400 hover:text-violet-500 dark:hover:text-violet-300 transition-colors"
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
                                    <button className="text-slate-400 hover:text-slate-900 dark:hover:text-white"><SettingsIcon size={12} /></button>
                                    <button className="text-slate-400 hover:text-red-500"><Trash2 size={12} /></button>
                                </div>
                            </div>
                            <div className="flex items-center gap-4 text-[9px] font-mono text-slate-500">
                                <div className="flex items-center gap-1"><Cpu size={10} /> {agent.model}</div>
                                <div className="flex items-center gap-1"><Shield size={10} /> {agent.fallback}</div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        );
    };

    const renderModelsTab = () => (
        <div className="space-y-6 animate-fadeIn">
            <div className="flex items-center justify-between">
                <h3 className="text-[10px] uppercase tracking-widest font-bold text-slate-400 dark:text-slate-500">LLM Provider Status</h3>
                <button onClick={() => api.getModels().then(setModels).catch()} className="text-[9px] uppercase font-bold text-violet-600 dark:text-violet-400 flex items-center gap-1"><RefreshCw size={10} /> Rescan</button>
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

            <div className="p-4 border border-violet-500/20 bg-violet-500/[0.02] rounded space-y-4">
                <div className="flex items-center gap-2 mb-2">
                    <Globe size={14} className="text-violet-600 dark:text-violet-500" />
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
                    className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white text-[10px] uppercase tracking-widest font-bold hover:bg-violet-500 disabled:opacity-50 transition-all"
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
            <div className="relative w-full max-w-3xl bg-white dark:bg-[#0c0a14] border border-black/10 dark:border-white/10 shadow-2xl flex flex-col h-[600px] animate-fadeIn overflow-hidden">
                <div className="h-12 border-b border-black/[0.06] dark:border-white/[0.06] flex items-center px-6 justify-between bg-slate-50 dark:bg-white/[0.01]">
                    <div className="flex items-center gap-6 h-full">
                        <div className="flex items-center gap-2 mr-4">
                            <SettingsIcon size={14} className="text-violet-600 dark:text-violet-500" />
                            <span className="text-[10px] uppercase tracking-[0.2em] font-bold text-slate-900 dark:text-white">System Settings</span>
                        </div>
                        {[
                            { id: 'agents', label: 'Squad Management', icon: Bot },
                            { id: 'models', label: 'Model Fallback', icon: Cpu },
                            { id: 'system', label: 'Gateway Health', icon: Activity }
                        ].map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => { setActiveTab(tab.id); setWizardStep(0); }}
                                className={`flex items-center gap-2 px-1 h-full border-b-2 transition-all text-[10px] uppercase tracking-wider font-bold ${activeTab === tab.id
                                    ? 'border-violet-600 dark:border-violet-500 text-slate-900 dark:text-white'
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
                </div>

                <div className="p-4 border-t border-black/[0.06] dark:border-white/[0.06] bg-slate-50 dark:bg-black/20 flex items-center justify-between text-[9px] font-mono text-slate-400 dark:text-slate-600">
                    <span>ClawController Revision: b82c91a</span>
                    <div className="flex items-center gap-4">
                        <span className="flex items-center gap-1"><Server size={10} /> LOCAL_INSTANCE</span>
                        <span>Environment: PRODUCTION_STABLE</span>
                    </div>
                </div>
            </div>
        </div>
    );
};
