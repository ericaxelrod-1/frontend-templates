import { createQueryBuilderProxy } from './query-builder.proxy';

describe('QueryBuilder Proxy', () => {
  let mockQb: any;
  let mockCls: any;
  let mockRlsService: any;
  let mockMetrics: any;
  let mockConfig: any;

  beforeEach(() => {
    mockQb = {
      leftJoin: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
      setParameters: jest.fn().mockReturnThis(),
      getParameters: jest.fn().mockReturnValue({ existing: 1 }),
      connection: {
        getMetadata: jest.fn((entity) => ({ tableName: typeof entity === 'string' ? entity : 'users' }))
      },
      expressionMap: {
        queryType: 'select',
        mainAlias: { metadata: { tableName: 'users' } },
        aliases: []
      }
    };

    mockCls = { 
      get: jest.fn((key) => {
        if (key === 'activeGroupIds') return [1];
        if (key === '__rlsBypass') return false;
        return null;
      }) 
    };
    mockRlsService = {
      getRulesForTable: jest.fn()
    };
    mockMetrics = { recordBlock: jest.fn(), recordBypass: jest.fn() };
    mockConfig = { exemptTables: [], fallbackBehavior: 'deny' };
  });

  it('should intercept leftJoin and apply rules with namespaced parameters', () => {
    mockRlsService.getRulesForTable.mockReturnValue({ sql: 'tenant_id = :id', parameters: { id: 1 } });
    
    const proxy = createQueryBuilderProxy(mockQb, mockCls, mockRlsService, mockMetrics, mockConfig);
    proxy.leftJoin('orders', 'order', 'order.userId = user.id');

    // We expect the call to include the original condition AND the RLS condition
    // We expect the parameters to contain the namespaced RLS parameter
    // We DO NOT expect it to contain 'existing: 1' because that is already on the QB state
    expect(mockQb.leftJoin).toHaveBeenCalledWith(
      'orders', 
      'order', 
      expect.stringMatching(/\(order\.userId = user\.id\) AND \(tenant_id = :rls_id_[a-z0-9]+\)/), 
      expect.objectContaining({})
    );
    
    // Verify the parameter object contains the dynamic key
    const callArgs = mockQb.leftJoin.mock.calls[0];
    const params = callArgs[3];
    const dynamicKey = Object.keys(params).find(k => k.startsWith('rls_id_'));
    expect(dynamicKey).toBeDefined();
    expect(params[dynamicKey!]).toBe(1);
  });

  it('should apply default deny on execution if no rules found', async () => {
    mockRlsService.getRulesForTable.mockReturnValue(null); // No rules
    
    const proxy = createQueryBuilderProxy(mockQb, mockCls, mockRlsService, mockMetrics, mockConfig);
    await proxy.getMany();

    // Fix: target.andWhere('1=0') is called with one argument
    expect(mockQb.andWhere).toHaveBeenCalledWith('1=0');
    expect(mockMetrics.recordBlock).toHaveBeenCalledWith('users');
  });

  it('should not apply rules to exempt tables on execution', async () => {
    mockConfig.exemptTables = ['users'];
    
    const proxy = createQueryBuilderProxy(mockQb, mockCls, mockRlsService, mockMetrics, mockConfig);
    await proxy.getMany();

    expect(mockQb.andWhere).not.toHaveBeenCalled();
  });

  it('should bypass completely if __rlsBypass is true', async () => {
    mockCls.get.mockImplementation((key: string) => {
      if (key === '__rlsBypass') return true;
      return null;
    });
    
    const proxy = createQueryBuilderProxy(mockQb, mockCls, mockRlsService, mockMetrics, mockConfig);
    await proxy.getMany();

    expect(mockQb.andWhere).not.toHaveBeenCalled();
    expect(mockMetrics.recordBypass).toHaveBeenCalled();
  });
});
