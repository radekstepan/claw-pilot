import { Cron } from 'croner';

const PRESET_CRON_BY_TYPE: Record<string, string> = {
    HOURLY: '0 * * * *',
    DAILY: '0 0 * * *',
    WEEKLY: '0 0 * * 1',
};

export interface RecurringScheduleValidationResult {
    normalizedType: string;
    normalizedValue: string | null;
    expression: string;
}

export function resolveRecurringCronExpression(scheduleType: string, scheduleValue?: string | null): string | null {
    const normalizedType = scheduleType.trim().toUpperCase();
    if (!normalizedType) return null;

    if (normalizedType === 'CUSTOM') {
        const customExpression = scheduleValue?.trim() ?? '';
        return customExpression.length > 0 ? customExpression : null;
    }

    return PRESET_CRON_BY_TYPE[normalizedType] ?? null;
}

export function isValidCronExpression(expression: string): boolean {
    try {
        new Cron(expression);
        return true;
    } catch {
        return false;
    }
}

export function validateRecurringScheduleInput(
    scheduleType: string,
    scheduleValue?: string | null,
): { valid: true; value: RecurringScheduleValidationResult } | { valid: false; error: string } {
    const normalizedType = scheduleType.trim().toUpperCase();
    if (!normalizedType) {
        return { valid: false, error: 'schedule_type is required' };
    }

    const expression = resolveRecurringCronExpression(normalizedType, scheduleValue);
    if (!expression) {
        if (normalizedType === 'CUSTOM') {
            return { valid: false, error: 'schedule_value is required when schedule_type is CUSTOM' };
        }
        return { valid: false, error: `Unsupported schedule_type '${scheduleType}'` };
    }

    if (!isValidCronExpression(expression)) {
        return { valid: false, error: `Invalid cron expression: '${expression}'` };
    }

    return {
        valid: true,
        value: {
            normalizedType,
            normalizedValue: normalizedType === 'CUSTOM' ? expression : null,
            expression,
        },
    };
}
