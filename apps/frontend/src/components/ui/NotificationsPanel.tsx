import { useRef, useState, useEffect, useCallback } from 'react';
import { Bell, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useMissionStore, AppNotification } from '../../store/useMissionStore';
import { EmptyState } from './EmptyState';

function formatRelativeTime(isoTimestamp: string): string {
    const diff = Date.now() - new Date(isoTimestamp).getTime();
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
}

function NotificationRow({ n }: { n: AppNotification }) {
    const isError = n.type === 'error';
    return (
        <div
            className={`flex items-start gap-3 px-4 py-3 border-b border-black/[0.04] dark:border-white/[0.04] last:border-b-0 ${!n.read ? 'bg-violet-500/[0.04]' : ''}`}
        >
            <div className="mt-0.5 flex-shrink-0" aria-hidden="true">
                {isError
                    ? <AlertCircle size={14} className="text-red-500" />
                    : <CheckCircle2 size={14} className="text-violet-500" />}
            </div>
            <div className="min-w-0 flex-1">
                <p className="text-[11px] text-slate-700 dark:text-slate-300 leading-snug break-words">{n.message}</p>
                <p className="text-[9px] text-slate-400 dark:text-slate-600 mt-0.5 font-mono">{formatRelativeTime(n.timestamp)}</p>
            </div>
            {!n.read && (
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-violet-500 flex-shrink-0" aria-hidden="true" />
            )}
        </div>
    );
}

export function NotificationsPanel() {
    const [isOpen, setIsOpen] = useState(false);
    const panelRef = useRef<HTMLDivElement>(null);

    const notifications = useMissionStore(s => s.notifications);
    const markAllNotificationsRead = useMissionStore(s => s.markAllNotificationsRead);

    const unreadCount = notifications.filter(n => !n.read).length;

    const close = useCallback(() => setIsOpen(false), []);

    // Close on outside click
    useEffect(() => {
        if (!isOpen) return;
        const handler = (e: MouseEvent) => {
            if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
                close();
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [isOpen, close]);

    // Close on Escape
    useEffect(() => {
        if (!isOpen) return;
        const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [isOpen, close]);

    const handleToggle = () => {
        setIsOpen(o => !o);
    };

    const handleMarkAllRead = () => {
        markAllNotificationsRead();
    };

    return (
        <div ref={panelRef} className="relative">
            <button
                onClick={handleToggle}
                className="p-2 text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 rounded"
                aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
                aria-expanded={isOpen}
                aria-haspopup="dialog"
            >
                <Bell size={18} />
                {unreadCount > 0 && (
                    <span
                        className="absolute top-1.5 right-1.5 min-w-[14px] h-[14px] bg-violet-500 rounded-full border-2 border-white dark:border-[#060509] flex items-center justify-center"
                        aria-hidden="true"
                    >
                        <span className="text-[8px] text-white font-bold leading-none px-0.5">
                            {unreadCount > 9 ? '9+' : unreadCount}
                        </span>
                    </span>
                )}
            </button>

            {isOpen && (
                <div
                    role="dialog"
                    aria-label="Notifications"
                    className="absolute right-0 top-full mt-2 w-80 bg-white dark:bg-[#0e0c14] border border-black/10 dark:border-white/10 rounded-md shadow-2xl z-50 flex flex-col overflow-hidden"
                >
                    {/* Header */}
                    <div className="flex items-center justify-between px-4 py-2.5 border-b border-black/[0.06] dark:border-white/[0.06]">
                        <span className="text-[10px] uppercase tracking-widest font-bold text-slate-500">Notifications</span>
                        {unreadCount > 0 && (
                            <button
                                onClick={handleMarkAllRead}
                                className="text-[9px] text-violet-500 hover:text-violet-400 transition-colors focus-visible:outline-none underline underline-offset-2"
                            >
                                Mark all read
                            </button>
                        )}
                    </div>

                    {/* Body */}
                    <div className="max-h-80 overflow-y-auto custom-scrollbar">
                        {notifications.length === 0 ? (
                            <div className="py-6">
                                <EmptyState
                                    icon={Bell}
                                    title="No notifications"
                                    description="Agent errors and review requests will appear here."
                                />
                            </div>
                        ) : (
                            notifications.map(n => <NotificationRow key={n.id} n={n} />)
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
