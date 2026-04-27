import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { DiscoveryService, Reflector } from '@nestjs/core';
import { IPrivacyProvider } from '../../common/contracts/privacy/privacy-provider.interface';
import { PRIVACY_PROVIDER_METADATA_KEY } from '../../common/decorators/privacy-provider.decorator';

@Injectable()
export class PrivacyRegistryService implements OnModuleInit {
  private readonly logger = new Logger(PrivacyRegistryService.name);
  private readonly providers = new Map<string, IPrivacyProvider>();

  constructor(
    private readonly discoveryService: DiscoveryService,
    private readonly reflector: Reflector,
  ) {}

  onModuleInit() {
    this.discoverProviders();
  }

  private discoverProviders() {
    const providers = this.discoveryService.getProviders();

    providers.forEach((wrapper) => {
      const { instance } = wrapper;
      if (!instance || typeof instance !== 'object') {
        return;
      }

      const isPrivacyProvider = this.reflector.get<boolean>(
        PRIVACY_PROVIDER_METADATA_KEY,
        instance.constructor,
      );

      if (isPrivacyProvider) {
        this.registerProvider(instance as IPrivacyProvider);
      }
    });
  }

  private registerProvider(provider: IPrivacyProvider) {
    if (!provider.providerName) {
      this.logger.warn(
        `Provider ${provider.constructor.name} missing providerName. Skipping.`,
      );
      return;
    }

    if (this.providers.has(provider.providerName)) {
      this.logger.warn(
        `Duplicate provider name: ${provider.providerName}. Skipping.`,
      );
      return;
    }

    // Verify contract compliance (simple check for methods)
    if (
      typeof provider.onExport !== 'function' ||
      typeof provider.onDelete !== 'function' ||
      typeof provider.getPreview !== 'function'
    ) {
      this.logger.error(
        `Provider ${provider.providerName} does not implement IPrivacyProvider correctly (missing onExport, onDelete, or getPreview).`,
      );
      return;
    }

    this.providers.set(provider.providerName, provider);
    this.logger.log(`Registered privacy provider: ${provider.providerName}`);
  }

  getProviders(): IPrivacyProvider[] {
    return Array.from(this.providers.values());
  }

  getProvider(name: string): IPrivacyProvider | undefined {
    return this.providers.get(name);
  }
}
