export const StatusDot = ({ status }: { status: string }) => {
    const colors: Record<string, string> = {
        working: 'bg-emerald-500 animate-pulse',
        idle: 'bg-amber-500',
        standby: 'bg-slate-500',
        offline: 'bg-red-500/50 grayscale'
    };
    return <div className={`w-1.5 h-1.5 rounded-full ${colors[status] || colors.offline}`} />;
};
