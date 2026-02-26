import { Loader2 } from 'lucide-react';

interface StatusDotProps {
    /** Gateway-reported status — WORKING | IDLE | OFFLINE (case-insensitive). */
    status: string;
    /** When true, overrides the colour dot with a spinning Loader icon indicating
     * that claw-pilot currently has an in-flight request to this agent. */
    busy?: boolean;
}

export const StatusDot = ({ status, busy = false }: StatusDotProps) => {
    if (busy) {
        return <Loader2 size={10} className="text-violet-500 animate-spin flex-shrink-0" aria-label="Agent thinking" />;
    }

    const colors: Record<string, string> = {
        working: 'bg-emerald-500 animate-pulse',
        idle: 'bg-amber-500',
        offline: 'bg-red-500/50 grayscale',
    };
    const key = status.toLowerCase();
    return <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${colors[key] ?? colors.offline}`} aria-label={`Agent ${key}`} />;
};
