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
      },
      __rlsCachedRules: {},
      __rlsPendingJoins: []
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

  it('should record pending join on leftJoin and apply RLS at execution', async () => {
    mockRlsService.getRulesForTable.mockResolvedValue({ sql: 'tenant_id = :id', parameters: { id: 1 } });
    
    const proxy = createQueryBuilderProxy(mockQb, mockCls, mockRlsService, mockMetrics, mockConfig);
    
    // leftJoin should just record the pending join and call original
    const result = proxy.leftJoin('orders', 'order', 'order.userId = user.id');
    
    // Returns same proxy for chaining
    expect(result).toBe(proxy);
    
    // Original leftJoin called with original condition (RLS applied later)
    expect(mockQb.leftJoin).toHaveBeenCalledWith('orders', 'order', 'order.userId = user.id');
    
    // Now execute to trigger RLS application
    await proxy.getMany();
    
    // RLS condition should be applied via andWhere
    expect(mockQb.andWhere).toHaveBeenCalled();
    const andWhereCall = mockQb.andWhere.mock.calls[0][0];
    expect(andWhereCall).toContain('tenant_id = :');
  });

  it('should apply default deny on execution if no rules found', async () => {
    mockRlsService.getRulesForTable.mockResolvedValue(null); // No rules
    
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
