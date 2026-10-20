/**
 * The response from `POST /api/privacy/erase`.
 *
 * Matches `EraseResponseDto` from `backend/src/privacy/dto/erase-response.dto.ts`.
 */
export interface EraseResponse {
  readonly userId: string;
  readonly alreadyErased: boolean;
  readonly tombstoneAddress: string;
  readonly anonymizedAt: string | null;
  readonly pepperKid: string;
}

/**
 * An entry in the privacy purge queue, representing scheduled retention lifecycle events.
 */
export interface PrivacyPurgeQueueItem {
  readonly id: string;
  readonly status: string;
  readonly scheduled_for: string;
  readonly completed_at: string | null;
}
