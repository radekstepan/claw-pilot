import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle } from 'lucide-react';

interface ConfirmDialogProps {
    open: boolean;
    title: string;
    message: string;
    confirmLabel?: string;
    variant?: 'danger' | 'default';
    onConfirm: () => void;
    onCancel: () => void;
}

/**
 * Accessible confirmation dialog — replaces window.confirm().
 * - Traps focus within the dialog while open.
 * - Dismisses on Escape key.
 * - Restores focus to the trigger element on close.
 * - Rendered via createPortal to avoid z-index/clipping issues.
 */
export const ConfirmDialog = ({
    open,
    title,
    message,
    confirmLabel = 'Confirm',
    variant = 'default',
    onConfirm,
    onCancel,
}: ConfirmDialogProps) => {
    const dialogRef = useRef<HTMLDivElement>(null);
    const previouslyFocusedRef = useRef<HTMLElement | null>(null);

    // Save the currently focused element before opening, restore on close
    useEffect(() => {
        if (open) {
            previouslyFocusedRef.current = document.activeElement as HTMLElement;
            // Focus first focusable element on next tick
            requestAnimationFrame(() => {
                const el = dialogRef.current?.querySelector<HTMLElement>(
                    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
                );
                el?.focus();
            });
        } else {
            previouslyFocusedRef.current?.focus();
        }
    }, [open]);

    // Escape key dismissal
    useEffect(() => {
        if (!open) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                onCancel();
            }
        };
        document.addEventListener('keydown', handleKeyDown, true);
        return () => document.removeEventListener('keydown', handleKeyDown, true);
    }, [open, onCancel]);

    // Focus trap
    const handleKeyDownTrap = (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (e.key !== 'Tab') return;
        const focusableEls = Array.from(
            dialogRef.current?.querySelectorAll<HTMLElement>(
                'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
            ) ?? []
        );
        if (focusableEls.length === 0) return;
        const first = focusableEls[0];
        const last = focusableEls[focusableEls.length - 1];
        if (e.shiftKey) {
            if (document.activeElement === first) {
                e.preventDefault();
                last.focus();
            }
        } else {
            if (document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        }
    };

    if (!open) return null;

    const confirmBtnClass =
        variant === 'danger'
            ? 'px-5 py-2 bg-rose-600 hover:bg-rose-500 text-white text-[10px] uppercase tracking-widest font-bold transition-all'
            : 'px-5 py-2 bg-violet-600 hover:bg-violet-500 text-white text-[10px] uppercase tracking-widest font-bold transition-all';

    return createPortal(
        <div
            className="fixed inset-0 z-[200] flex items-center justify-center p-6"
            role="presentation"
        >
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/80"
                onClick={onCancel}
                aria-hidden="true"
            />

            {/* Dialog */}
            <div
                ref={dialogRef}
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="confirm-dialog-title"
                aria-describedby="confirm-dialog-desc"
                onKeyDown={handleKeyDownTrap}
                className="relative w-full max-w-sm bg-[#0c0a14] border border-white/10 shadow-2xl animate-fadeIn"
            >
                {/* Header */}
                <div className="p-5 border-b border-white/[0.06] flex items-center gap-3">
                    <AlertTriangle
                        size={16}
                        className={variant === 'danger' ? 'text-rose-400' : 'text-violet-400'}
                        aria-hidden="true"
                    />
                    <h2
                        id="confirm-dialog-title"
                        className="text-[11px] uppercase tracking-[0.2em] font-bold text-white"
                    >
                        {title}
                    </h2>
                </div>

                {/* Body */}
                <div className="p-5">
                    <p
                        id="confirm-dialog-desc"
                        className="text-xs text-slate-400 leading-relaxed"
                    >
                        {message}
                    </p>
                </div>

                {/* Footer */}
                <div className="px-5 pb-5 flex items-center justify-end gap-3">
                    <button
                        onClick={onCancel}
                        className="px-5 py-2 border border-white/10 text-slate-400 text-[10px] uppercase tracking-widest font-bold hover:bg-white/5 transition-all"
                    >
                        Cancel
                    </button>
                    <button onClick={onConfirm} className={confirmBtnClass}>
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
};
