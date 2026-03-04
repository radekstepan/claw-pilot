import React from 'react';

interface CardProps {
    children: React.ReactNode;
    className?: string;
    onClick?: () => void;
    role?: string;
    tabIndex?: number;
    'aria-label'?: string;
}

export const Card = ({ children, className = "", onClick, role, tabIndex, 'aria-label': ariaLabel }: CardProps) => (
    <div
        onClick={onClick}
        onKeyDown={(e) => {
            if (onClick && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                onClick();
            }
        }}
        role={role}
        tabIndex={tabIndex}
        aria-label={ariaLabel}
        className={`border border-black/[0.08] dark:border-white/[0.12] bg-white/70 dark:bg-white/[0.02] hover:border-[var(--accent-500)]/30 dark:hover:border-white/[0.2] transition-all duration-200 group relative ${className}`}
    >
        {children}
    </div>
);
