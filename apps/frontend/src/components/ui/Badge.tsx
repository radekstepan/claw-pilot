import React from 'react';

interface BadgeProps {
    children: React.ReactNode;
    variant?: "default" | "urgent" | "success" | "violet";
}

export const Badge = ({ children, variant = "default" }: BadgeProps) => {
    const variants = {
        default: "bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-white/10",
        urgent: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
        success: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
        violet: "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20",
    };
    return (
        <span className={`text-[8px] uppercase tracking-[0.15em] font-bold px-1.5 py-0.5 border rounded-sm ${variants[variant]}`}>
            {children}
        </span>
    );
};
