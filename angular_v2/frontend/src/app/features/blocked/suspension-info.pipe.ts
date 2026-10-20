import { Pipe, type PipeTransform } from '@angular/core';

export interface SuspensionState {
  readonly isTemporary: boolean;
  readonly isActive: boolean;
  readonly label: string;
  readonly cssClass: string;
}

/**
 * Pure pipe to evaluate whether a disable timestamp represents a permanent disable,
 * an active temporary suspension, or an expired suspension.
 *
 * ## THE TEMPORARY VS PERMANENT DISTINCTION
 *
 * Per 0023 and `backend/src/auth/auth.service.ts`:
 * - `disabled_at IS NOT NULL AND disabled_until IS NULL`: permanent disable.
 * - `disabled_at IS NOT NULL AND disabled_until > now()`: temporary suspension currently active.
 * - `disabled_at IS NOT NULL AND disabled_until <= now()`: temporary suspension that is over.
 */
@Pipe({
  name: 'suspensionInfo',
  standalone: true,
})
export class SuspensionInfoPipe implements PipeTransform {
  transform(disabledUntil: string | null | undefined): SuspensionState {
    if (disabledUntil === null || disabledUntil === undefined) {
      return {
        isTemporary: false,
        isActive: true,
        label: 'Permanent disable (no expiry)',
        cssClass: 'suspension-badge--permanent',
      };
    }

    const untilDate = new Date(disabledUntil);
    const isActive = untilDate.getTime() > Date.now();

    if (isActive) {
      return {
        isTemporary: true,
        isActive: true,
        label: 'Temporary suspension (active)',
        cssClass: 'suspension-badge--active',
      };
    }

    return {
      isTemporary: true,
      isActive: false,
      label: 'Temporary suspension (expired)',
      cssClass: 'suspension-badge--expired',
    };
  }
}
