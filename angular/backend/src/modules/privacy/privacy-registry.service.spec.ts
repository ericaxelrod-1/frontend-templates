import { Test, TestingModule } from '@nestjs/testing';
import { DiscoveryService, Reflector } from '@nestjs/core';
import { PrivacyRegistryService } from './privacy-registry.service';
import { PRIVACY_PROVIDER_METADATA_KEY } from '../../common/decorators/privacy-provider.decorator';
import { IPrivacyProvider } from '../../common/contracts/privacy/privacy-provider.interface';
import { Readable } from 'stream';

describe('PrivacyRegistryService', () => {
  let service: PrivacyRegistryService;
  let discoveryService: DiscoveryService;
  let reflector: Reflector;

  const mockProvider: IPrivacyProvider = {
    providerName: 'test-provider',
    onExport: jest.fn().mockResolvedValue(new Readable()),
    onDelete: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PrivacyRegistryService,
        {
          provide: DiscoveryService,
          useValue: {
            getProviders: jest.fn().mockReturnValue([
              {
                instance: mockProvider,
              },
            ]),
          },
        },
        {
          provide: Reflector,
          useValue: {
            get: jest.fn().mockReturnValue(true),
          },
        },
      ],
    }).compile();

    service = module.get<PrivacyRegistryService>(PrivacyRegistryService);
    discoveryService = module.get<DiscoveryService>(DiscoveryService);
    reflector = module.get<Reflector>(Reflector);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should discover and register providers on init', () => {
    // Manually trigger init because we mocked the discovery
    service.onModuleInit();
    const providers = service.getProviders();
    expect(providers).toHaveLength(1);
    expect(providers[0].providerName).toBe('test-provider');
  });

  it('should not register provider without providerName', () => {
    const invalidProvider = {
      onExport: jest.fn(),
      onDelete: jest.fn(),
      constructor: { name: 'InvalidProvider' },
    };
    (discoveryService.getProviders as jest.Mock).mockReturnValue([
      { instance: invalidProvider },
    ]);
    (reflector.get as jest.Mock).mockReturnValue(true);

    service.onModuleInit();
    expect(service.getProviders()).toHaveLength(0);
  });

  it('should get provider by name', () => {
    service.onModuleInit();
    const provider = service.getProvider('test-provider');
    expect(provider).toBeDefined();
    expect(provider?.providerName).toBe('test-provider');
  });
});
