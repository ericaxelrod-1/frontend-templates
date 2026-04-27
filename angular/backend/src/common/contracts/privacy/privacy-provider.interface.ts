import { Readable } from 'stream';

export interface IPrivacyProvider {
  /**
   * Unique identifier for the provider.
   */
  readonly providerName: string;

  /**
   * Exports user data as a stream to maintain low memory footprint.
   * @param userId The ID of the user whose data is being exported.
   */
  onExport(userId: string): Promise<Readable>;

  /**
   * Deletes or anonymizes user data.
   * @param userId The ID of the user whose data is being deleted.
   */
  onDelete(userId: string): Promise<void>;

  /**
   * Provides a count of records categorized by type for pre-execution preview.
   * @param userId The ID of the user.
   */
  getPreview(userId: string): Promise<Record<string, number>>;
}
