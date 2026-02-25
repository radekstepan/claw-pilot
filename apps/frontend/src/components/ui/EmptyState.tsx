import type { LucideIcon } from 'lucide-react';

interface EmptyStateProps {
    icon: LucideIcon;
    title: string;
    description?: string;
    action?: {
        label: string;
        onClick: () => void;
    };
}

/**
 * Standardised empty-state component used across Claw-Pilot views.
 *
 * Visual pattern:
 *   muted icon (32px) → bold label → optional description → optional CTA button
 */
export const EmptyState = ({ icon: Icon, title, description, action }: EmptyStateProps) => {
    return (
        <div className="flex flex-col items-center justify-center py-24 text-center">
            <Icon
                size={32}
                className="text-slate-300 dark:text-slate-700 mb-4"
                aria-hidden="true"
            />
            <p className="text-sm font-bold text-slate-400 dark:text-slate-600 mb-1">{title}</p>
            {description && (
                <p className="text-xs text-slate-400 dark:text-slate-700 max-w-xs">{description}</p>
            )}
            {action && (
                <button
                    onClick={action.onClick}
                    className="mt-5 px-5 py-2 border border-white/10 text-slate-400 text-[10px] uppercase tracking-widest font-bold hover:bg-white/5 transition-all"
                >
                    {action.label}
                </button>
            )}
        </div>
    );
};
