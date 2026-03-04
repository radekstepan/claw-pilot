import { useState, useEffect, useRef } from 'react';
import { X, Bot, Save, Loader2, Rocket } from 'lucide-react';
import type { Agent } from '@claw-pilot/shared-types';
import type { Model } from '../../api/client';
import { Select } from '../ui/Select';
import type { SelectOption } from '../ui/Select';
import { api } from '../../api/client';
import { useMissionStore } from '../../store/useMissionStore';

interface AgentFormModalProps {
    /** 'create' = new agent form; 'edit' = update existing agent metadata. */
    mode: 'create' | 'edit';
    /** Required when mode is 'edit'. Pre-fills the form fields. */
    agent?: Agent;
    /** Available LLM models to populate the model selector. */
    models: Model[];
    /** Default workspace path pre-filled for create mode. */
    defaultWorkspace?: string;
    onClose: () => void;
}

export const AgentFormModal = ({
    mode,
    agent,
    models,
    defaultWorkspace = '',
    onClose,
}: AgentFormModalProps) => {
    const { refreshAgents } = useMissionStore();

    const [name, setName] = useState(mode === 'edit' ? (agent?.name ?? '') : '');
    const [model, setModel] = useState(mode === 'edit' ? (agent?.model ?? '') : '');
    const [workspace, setWorkspace] = useState(mode === 'edit' ? (agent?.workspace ?? '') : defaultWorkspace);
    const [isWorkspaceModified, setIsWorkspaceModified] = useState(false);
    const [capabilities, setCapabilities] = useState(mode === 'edit' && agent?.capabilities ? agent.capabilities.join(', ') : '');
    const [soul, setSoul] = useState('');
    const [tools, setTools] = useState('');

    const [isLoadingFiles, setIsLoadingFiles] = useState(mode === 'edit');
    const [isBusy, setIsBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const nameRef = useRef<HTMLInputElement>(null);

    // Automate workspace path based on agent name (create mode only)
    useEffect(() => {
        if (mode === 'create' && !isWorkspaceModified && name.trim()) {
            const base = defaultWorkspace.endsWith('/') ? defaultWorkspace : defaultWorkspace + '/';
            // Suggest path: <base>/<name>
            setWorkspace(`${base}${name.trim().toLowerCase().replace(/\s+/g, '-')}`);
        }
    }, [name, defaultWorkspace, mode, isWorkspaceModified]);

    // Fetch existing files if editing
    useEffect(() => {
        if (mode === 'edit' && agent) {
            setIsLoadingFiles(true);
            api.getAgentFiles(agent.id)
                .then((files) => {
                    setSoul(files.soul);
                    setTools(files.tools);
                })
                .catch((err) => {
                    console.error('Failed to load agent files:', err);
                })
                .finally(() => {
                    setIsLoadingFiles(false);
                });
        }
    }, [mode, agent]);

    // Close on Escape
    useEffect(() => {
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handleKey);
        return () => document.removeEventListener('keydown', handleKey);
    }, [onClose]);

    // Auto-focus the name field on open
    useEffect(() => {
        nameRef.current?.focus();
    }, []);

    const modelOptions: SelectOption[] = models.map((m) => ({
        value: m.id,
        label: m.name + (m.provider ? ` (${m.provider})` : ''),
    }));

    const canSubmit = name.trim().length > 0 && (mode === 'create' ? workspace.trim().length > 0 : true);

    const handleSubmit = async () => {
        if (!canSubmit || isBusy) return;
        setIsBusy(true);
        setError(null);

        const capsArray = capabilities.split(',').map(s => s.trim()).filter(Boolean);

        try {
            if (mode === 'create') {
                // Returns 202 — close immediately; socket event will call refreshAgents().
                await api.deployAgent({
                    name: name.trim(),
                    model: model || undefined,
                    workspace: workspace.trim(),
                    capabilities: capsArray,
                    soul: soul.trim() || undefined,
                    tools: tools.trim() || undefined,
                });
                onClose();
            } else {
                // Synchronous PATCH — wait for the updated agent then refresh.
                if (!agent) throw new Error('No agent provided for edit mode.');
                await api.updateAgent(agent.id, {
                    ...(name.trim() !== agent.name ? { name: name.trim() } : {}),
                    ...(model && model !== agent.model ? { model } : {}),
                    capabilities: capsArray,
                    soul: soul.trim(),
                    tools: tools.trim(),
                });
                await refreshAgents();
                onClose();
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'An unexpected error occurred.');
            setIsBusy(false);
        }
    };

    const title = mode === 'create' ? 'Deploy New Agent' : `Edit — ${agent?.name ?? 'Agent'}`;
    const submitLabel = mode === 'create' ? 'Deploy Agent' : 'Save Changes';
    const SubmitIcon = mode === 'create' ? Rocket : Save;

    return (
        /* Backdrop */
        <div
            className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 backdrop-blur-sm"
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div className="w-full max-w-2xl bg-white dark:bg-[var(--bg-dark-surface)] border border-black/10 dark:border-white/10 rounded shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-black/[0.06] dark:border-white/[0.06]">
                    <div className="flex items-center gap-2">
                        <Bot size={16} className="text-[var(--accent-500)]" />
                        <h2 className="text-xs font-bold uppercase tracking-widest text-slate-900 dark:text-white">
                            {title}
                        </h2>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
                        aria-label="Close"
                    >
                        <X size={16} />
                    </button>
                </div>

                {/* Body - Scrollable */}
                <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6 custom-scrollbar">
                    {/* Metadata Section */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Name / ID */}
                        <div className="space-y-1">
                            <label className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 tracking-wider block">
                                Agent Name / ID
                            </label>
                            <input
                                ref={nameRef}
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="e.g. data-viz-expert"
                                className="w-full bg-slate-50 focus:bg-white dark:bg-black/20 dark:focus:bg-black/40 border border-black/10 dark:border-white/10 rounded px-3 py-2 text-xs font-mono text-slate-900 dark:text-slate-300 outline-none focus:border-[var(--accent-500)]/50 transition-colors"
                            />
                        </div>

                        {/* Model */}
                        <div className="space-y-1">
                            <label className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 tracking-wider block">
                                LLM Model
                            </label>
                            <Select
                                value={model}
                                onValueChange={setModel}
                                options={modelOptions}
                                placeholder={models.length === 0 ? 'Loading models…' : '— Choose model —'}
                                disabled={models.length === 0}
                            />
                        </div>

                        {/* Workspace */}
                        {mode === 'create' ? (
                            <div className="space-y-1 col-span-full">
                                <label className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 tracking-wider block">
                                    Workspace Path
                                </label>
                                <input
                                    type="text"
                                    value={workspace}
                                    onChange={(e) => {
                                        setWorkspace(e.target.value);
                                        setIsWorkspaceModified(true);
                                    }}
                                    placeholder="~/openclaw-agents/my-agent"
                                    className="w-full bg-slate-50 focus:bg-white dark:bg-black/20 dark:focus:bg-black/40 border border-black/10 dark:border-white/10 rounded px-3 py-2 text-xs font-mono text-slate-900 dark:text-slate-300 outline-none focus:border-[var(--accent-500)]/50 transition-colors"
                                />
                                <p className="text-[9px] text-slate-400 dark:text-slate-500">
                                    Recommended: a unique directory for this agent.
                                </p>
                            </div>
                        ) : workspace ? (
                            <div className="space-y-1 col-span-full">
                                <label className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 tracking-wider block">
                                    Workspace Path
                                </label>
                                <p className="w-full bg-slate-100 dark:bg-black/20 border border-black/10 dark:border-white/10 rounded px-3 py-2 text-xs font-mono text-slate-500 dark:text-slate-400 select-all">
                                    {workspace}
                                </p>
                            </div>
                        ) : null}
                    </div>

                    {/* Capabilities */}
                    <div className="space-y-1">
                        <label className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 tracking-wider block">
                            Capabilities (Config)
                        </label>
                        <input
                            type="text"
                            value={capabilities}
                            onChange={(e) => setCapabilities(e.target.value)}
                            placeholder="python, scraping, visualization"
                            className="w-full bg-slate-50 focus:bg-white dark:bg-black/20 dark:focus:bg-black/40 border border-black/10 dark:border-white/10 rounded px-3 py-1.5 text-[10px] font-mono text-slate-900 dark:text-slate-300 outline-none focus:border-[var(--accent-500)]/50"
                        />
                        <p className="text-[9px] text-slate-400 dark:text-slate-500">
                            Comma-separated list of tags for the gateway configuration.
                        </p>
                    </div>

                    {/* Behavioral Section — in edit mode only rendered when files have content */}
                    {(mode === 'create' || soul || tools) && (
                        <div className="space-y-4 pt-2 border-t border-black/[0.06] dark:border-white/[0.06]">
                            {(mode === 'create' || soul) && (
                                <div className="space-y-1">
                                    <label className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 tracking-wider block">
                                        Role &amp; Instructions (SOUL.md)
                                    </label>
                                    <textarea
                                        value={soul}
                                        onChange={(e) => setSoul(e.target.value)}
                                        placeholder="# System Prompt&#10;You are an expert..."
                                        className="w-full h-40 bg-slate-50 focus:bg-white dark:bg-black/20 dark:focus:bg-black/40 border border-black/10 dark:border-white/10 rounded p-3 text-[10px] font-mono text-slate-900 dark:text-slate-300 outline-none focus:border-[var(--accent-500)]/50 resize-y"
                                    />
                                </div>
                            )}
                            {(mode === 'create' || tools) && (
                                <div className="space-y-1">
                                    <label className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 tracking-wider block">
                                        Tool Definitions (TOOLS.md)
                                    </label>
                                    <textarea
                                        value={tools}
                                        onChange={(e) => setTools(e.target.value)}
                                        placeholder="- name: my_tool&#10;  description: ..."
                                        className="w-full h-28 bg-slate-50 focus:bg-white dark:bg-black/20 dark:focus:bg-black/40 border border-black/10 dark:border-white/10 rounded p-3 text-[10px] font-mono text-slate-900 dark:text-slate-300 outline-none focus:border-[var(--accent-500)]/50 resize-y"
                                    />
                                </div>
                            )}
                        </div>
                    )}

                    {/* Inline error */}
                    {error && (
                        <p className="text-[10px] text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-500/20 rounded px-3 py-2">
                            {error}
                        </p>
                    )}
                </div>

                {/* Footer */}
                <div className="px-5 py-4 border-t border-black/[0.06] dark:border-white/[0.06] flex justify-end gap-2 bg-slate-50 dark:bg-white/[0.02]">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={!canSubmit || isBusy || isLoadingFiles}
                        className="flex items-center gap-2 px-5 py-2 bg-[var(--accent-600)] hover:bg-[var(--accent-500)] disabled:opacity-50 disabled:cursor-not-allowed text-white text-[10px] font-bold uppercase tracking-widest rounded transition-colors"
                    >
                        {isBusy
                            ? <Loader2 size={12} className="animate-spin" />
                            : <SubmitIcon size={12} />
                        }
                        {isBusy ? (mode === 'create' ? 'Deploying…' : 'Saving…') : submitLabel}
                    </button>
                </div>
            </div>
        </div>
    );
};
