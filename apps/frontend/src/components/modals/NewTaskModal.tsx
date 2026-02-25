import { useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, X, Send } from 'lucide-react';
import type { Agent, CreateTaskPayload } from '@claw-pilot/shared-types';
import { Select } from '../ui/Select';

const formSchema = z.object({
    title: z.string().min(1, 'Mission title is required.'),
    description: z.string().optional(),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH']),
    assignee_id: z.string().optional(),
    tags: z.array(z.string()),
});
type FormValues = z.infer<typeof formSchema>;

const PRIORITY_OPTIONS = [
    { value: 'LOW', label: 'LOW' },
    { value: 'MEDIUM', label: 'MEDIUM' },
    { value: 'HIGH', label: 'HIGH' },
];

const NONE_VALUE = '__NONE__';

interface NewTaskModalProps {
    agents: Agent[];
    onClose: () => void;
    onAdd: (payload: CreateTaskPayload) => void;
}

export const NewTaskModal = ({ agents, onClose, onAdd }: NewTaskModalProps) => {
    const [tagInput, setTagInput] = useState('');

    const {
        register,
        handleSubmit,
        control,
        watch,
        setValue,
        formState: { errors, isSubmitting },
    } = useForm<FormValues>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            title: '',
            description: '',
            priority: 'MEDIUM',
            assignee_id: NONE_VALUE,
            tags: [],
        },
    });

    const tags = watch('tags');

    const handleAddTag = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' && tagInput.trim()) {
            e.preventDefault();
            const trimmed = tagInput.trim().toLowerCase();
            if (!tags.includes(trimmed)) {
                setValue('tags', [...tags, trimmed]);
            }
            setTagInput('');
        }
    };

    const removeTag = (tagToRemove: string) => {
        setValue('tags', tags.filter(t => t !== tagToRemove));
    };

    const onSubmit = (data: FormValues) => {
        const assignedId = data.assignee_id && data.assignee_id !== NONE_VALUE ? data.assignee_id : undefined;
        const payload: CreateTaskPayload = {
            title: data.title,
            description: data.description || undefined,
            priority: data.priority,
            assignee_id: assignedId,
            tags: data.tags.length > 0 ? data.tags : undefined,
            status: assignedId ? 'ASSIGNED' : 'TODO',
        };
        onAdd(payload);
        onClose();
    };

    const agentOptions = [
        { value: NONE_VALUE, label: 'DEFERRED (INBOX)' },
        ...agents.filter(a => !!a.id).map(a => ({ value: a.id, label: `${a.name}${a.role ? ` (${a.role})` : ''}` })),
    ];

    return (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-6">
            <div className="absolute inset-0 bg-slate-900/60 dark:bg-black/80" onClick={onClose} />
            <div className="relative w-full max-w-xl bg-white dark:bg-[#0c0a14] border border-black/10 dark:border-white/10 shadow-2xl flex flex-col animate-fadeIn overflow-hidden">
                <div className="h-12 border-b border-black/[0.06] dark:border-white/[0.06] flex items-center px-6 justify-between bg-slate-50 dark:bg-white/[0.01]">
                    <div className="flex items-center gap-2">
                        <Plus size={14} className="text-violet-600 dark:text-violet-500" />
                        <span className="text-[10px] uppercase tracking-[0.2em] font-bold text-slate-900 dark:text-white">Initialize New Mission</span>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-900 dark:hover:text-white"><X size={18} /></button>
                </div>

                <form onSubmit={handleSubmit(onSubmit)} className="p-8 space-y-6 overflow-y-auto custom-scrollbar">
                    {/* Title */}
                    <div className="space-y-2">
                        <label className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 tracking-wider">Mission Title</label>
                        <input
                            autoFocus
                            type="text"
                            {...register('title')}
                            placeholder="e.g. Refactor Data Stream Gateway"
                            className="w-full bg-slate-100 dark:bg-black/20 border border-black/10 dark:border-white/10 rounded px-3 py-2 text-xs text-slate-900 dark:text-slate-300 outline-none focus:border-violet-500/50 transition-colors aria-[invalid=true]:border-rose-500/50"
                            aria-invalid={errors.title ? 'true' : 'false'}
                        />
                        {errors.title && (
                            <p className="text-rose-400 text-[10px]" role="alert">{errors.title.message}</p>
                        )}
                    </div>

                    {/* Description */}
                    <div className="space-y-2">
                        <label className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 tracking-wider">Mission Briefing</label>
                        <textarea
                            {...register('description')}
                            placeholder="Detail the parameters and expected outcomes..."
                            className="w-full h-24 bg-slate-100 dark:bg-black/20 border border-black/10 dark:border-white/10 rounded px-3 py-2 text-xs text-slate-900 dark:text-slate-300 outline-none focus:border-violet-500/50 transition-colors"
                        />
                    </div>

                    {/* Priority + Assignee */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 tracking-wider">Priority</label>
                            <Controller
                                name="priority"
                                control={control}
                                render={({ field }) => (
                                    <Select
                                        value={field.value}
                                        onValueChange={field.onChange}
                                        options={PRIORITY_OPTIONS}
                                        placeholder="— Priority —"
                                        className="bg-slate-100 dark:bg-black/20"
                                    />
                                )}
                            />
                            {errors.priority && (
                                <p className="text-rose-400 text-[10px]" role="alert">{errors.priority.message}</p>
                            )}
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 tracking-wider">Assign Agent</label>
                            <Controller
                                name="assignee_id"
                                control={control}
                                render={({ field }) => (
                                    <Select
                                        value={field.value || NONE_VALUE}
                                        onValueChange={field.onChange}
                                        options={agentOptions}
                                        placeholder="DEFERRED (INBOX)"
                                        className="bg-slate-100 dark:bg-black/20"
                                    />
                                )}
                            />
                        </div>
                    </div>

                    {/* Tags */}
                    <div className="space-y-2">
                        <label className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 tracking-wider">Tags</label>
                        <div className="flex flex-wrap gap-2 mb-2">
                            {tags.map(t => (
                                <span key={t} className="flex items-center gap-1 text-[9px] uppercase font-bold bg-violet-500/10 text-violet-600 dark:text-violet-400 border border-violet-500/20 px-2 py-0.5 rounded-sm">
                                    {t}
                                    <button type="button" onClick={() => removeTag(t)} className="hover:text-red-500">
                                        <X size={10} />
                                    </button>
                                </span>
                            ))}
                        </div>
                        <input
                            type="text"
                            value={tagInput}
                            onChange={e => setTagInput(e.target.value)}
                            onKeyDown={handleAddTag}
                            placeholder="Type tag and press enter..."
                            className="w-full bg-slate-100 dark:bg-black/20 border border-black/10 dark:border-white/10 rounded px-3 py-2 text-xs text-slate-900 dark:text-slate-300 outline-none"
                        />
                    </div>
                </form>

                <div className="p-4 border-t border-black/[0.06] dark:border-white/[0.06] bg-slate-50 dark:bg-black/20 flex items-center justify-end gap-3">
                    <button type="button" onClick={onClose} className="px-5 py-2 text-[10px] uppercase font-bold text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors">Cancel</button>
                    <button
                        onClick={handleSubmit(onSubmit)}
                        disabled={isSubmitting}
                        className="px-6 py-2 bg-violet-600 text-white text-[10px] font-bold uppercase tracking-widest hover:bg-violet-500 flex items-center gap-2 disabled:opacity-50 transition-all"
                    >
                        <Send size={12} /> Launch Mission
                    </button>
                </div>
            </div>
        </div>
    );
};
