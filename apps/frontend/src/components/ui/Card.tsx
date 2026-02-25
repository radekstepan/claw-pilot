import React from 'react';

interface CardProps {
    children: React.ReactNode;
    className?: string;
    onClick?: () => void;
}

export const Card = ({ children, className = "", onClick }: CardProps) => (
    <div
        onClick={onClick}
        className={`border border-black/[0.08] dark:border-white/[0.04] bg-white/70 dark:bg-white/[0.02] hover:border-violet-500/30 dark:hover:border-white/[0.1] transition-all duration-200 group relative ${className}`}
    >
        {children}
    </div>
);
