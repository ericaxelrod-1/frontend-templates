import { SetMetadata } from '@nestjs/common';

export const PRIVACY_PROVIDER_METADATA_KEY = 'PRIVACY_PROVIDER_METADATA_KEY';

/**
 * Decorator to mark a service as a Privacy Provider.
 * These providers are auto-discovered by the PrivacyRegistryService.
 */
export const PrivacyProvider = () => SetMetadata(PRIVACY_PROVIDER_METADATA_KEY, true);
