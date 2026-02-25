export const SkeletonCard = () => (
    <div className="p-3 mb-2 rounded border border-black/[0.04] dark:border-white/[0.04] bg-white dark:bg-white/[0.02] animate-pulse">
        <div className="flex items-start justify-between mb-2">
            <div className="h-2 w-16 bg-slate-200 dark:bg-white/10 rounded" />
            <div className="h-4 w-10 bg-slate-200 dark:bg-white/10 rounded-sm" />
        </div>
        <div className="h-3 w-full bg-slate-200 dark:bg-white/10 rounded mb-1" />
        <div className="h-3 w-3/4 bg-slate-200 dark:bg-white/10 rounded mb-3" />
        <div className="flex items-center justify-between border-t border-black/[0.04] dark:border-white/[0.04] pt-2 mt-2">
            <div className="h-2 w-8 bg-slate-200 dark:bg-white/10 rounded" />
            <div className="w-5 h-5 bg-slate-200 dark:bg-white/10 rounded-full" />
        </div>
    </div>
);

export const SkeletonAgentItem = () => (
    <div className="flex items-center gap-3 p-2.5 animate-pulse">
        <div className="w-2 h-2 rounded-full bg-slate-200 dark:bg-white/10 flex-shrink-0" />
        <div className="flex-1 space-y-1">
            <div className="h-2.5 w-3/4 bg-slate-200 dark:bg-white/10 rounded" />
            <div className="h-2 w-1/2 bg-slate-200 dark:bg-white/10 rounded" />
        </div>
    </div>
);
