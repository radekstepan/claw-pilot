import * as RadixSelect from '@radix-ui/react-select';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';

export interface SelectOption {
    value: string;
    label: string;
}

interface SelectProps {
    value: string;
    onValueChange: (value: string) => void;
    options: SelectOption[];
    placeholder?: string;
    disabled?: boolean;
    className?: string;
}

/**
 * Accessible custom Select — replaces all native <select> elements.
 *
 * Keyboard support (via Radix UI):
 *   Arrow Up/Down  — navigate options
 *   Enter/Space    — select highlighted option
 *   Escape         — close without selecting
 *   Tab            — close and move focus
 *
 * ARIA: role="listbox" + role="option" + aria-activedescendant are handled
 * internally by @radix-ui/react-select.
 *
 * Auto-positioning: `position="popper"` flips the dropdown upward when it
 * would otherwise be clipped by the viewport or a modal boundary.
 */
export const Select = ({
    value,
    onValueChange,
    options,
    placeholder = '— Select —',
    disabled,
    className,
}: SelectProps) => {
    return (
        <RadixSelect.Root value={value} onValueChange={onValueChange} disabled={disabled}>
            <RadixSelect.Trigger
                className={[
                    'w-full flex items-center justify-between',
                    'bg-white dark:bg-white/[0.03]',
                    'border border-black/10 dark:border-white/10 rounded',
                    'px-2 py-1.5',
                    'text-[11px] text-slate-900 dark:text-slate-300',
                    'outline-none focus:border-violet-500/50',
                    'transition-colors',
                    'disabled:opacity-50 disabled:cursor-not-allowed',
                    'data-[placeholder]:text-slate-500 dark:data-[placeholder]:text-slate-500',
                    className,
                ]
                    .filter(Boolean)
                    .join(' ')}
                aria-label={placeholder}
            >
                <RadixSelect.Value placeholder={placeholder} />
                <RadixSelect.Icon asChild>
                    <ChevronDown size={12} className="text-slate-400 flex-shrink-0" />
                </RadixSelect.Icon>
            </RadixSelect.Trigger>

            <RadixSelect.Portal>
                <RadixSelect.Content
                    position="popper"
                    sideOffset={0}
                    className={[
                        'z-[300] overflow-hidden',
                        'bg-white border border-slate-200 shadow-xl dark:bg-[#0c0a14] dark:border-white/10',
                        'w-[var(--radix-select-trigger-width)]',
                        'max-h-60',
                        'animate-fadeIn',
                    ].join(' ')}
                >
                    <RadixSelect.ScrollUpButton className="flex items-center justify-center py-1 text-slate-500 cursor-default">
                        <ChevronUp size={12} />
                    </RadixSelect.ScrollUpButton>

                    <RadixSelect.Viewport>
                        {options.filter(opt => !!opt.value).map((opt) => (
                            <RadixSelect.Item
                                key={opt.value}
                                value={opt.value}
                                className={[
                                    'relative flex items-center gap-2',
                                    'px-2 py-1.5 pr-7',
                                    'text-[11px] text-slate-700 dark:text-slate-300',
                                    'cursor-pointer select-none outline-none',
                                    'hover:bg-slate-100 dark:hover:bg-white/5',
                                    'focus:bg-violet-100 focus:text-violet-700 dark:focus:bg-violet-600/20 dark:focus:text-white',
                                    'data-[state=checked]:text-violet-600 dark:data-[state=checked]:text-violet-300',
                                    'data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed',
                                ].join(' ')}
                            >
                                <RadixSelect.ItemText>{opt.label}</RadixSelect.ItemText>
                                <RadixSelect.ItemIndicator className="absolute right-2">
                                    <Check size={11} className="text-violet-400" />
                                </RadixSelect.ItemIndicator>
                            </RadixSelect.Item>
                        ))}
                    </RadixSelect.Viewport>

                    <RadixSelect.ScrollDownButton className="flex items-center justify-center py-1 text-slate-500 cursor-default">
                        <ChevronDown size={12} />
                    </RadixSelect.ScrollDownButton>
                </RadixSelect.Content>
            </RadixSelect.Portal>
        </RadixSelect.Root>
    );
};
