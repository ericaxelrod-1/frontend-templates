import { createEntityManagerProxy, RlsSecurityViolationError } from './entity-manager.proxy';

describe('EntityManager Proxy', () => {
  let mockManager: any;
  let mockCls: any;
  let mockRlsService: any;
  let mockMetrics: any;
  let mockConfig: any;

  beforeEach(() => {
    mockManager = {
      createQueryBuilder: jest.fn().mockReturnValue({}),
      update: jest.fn(),
      delete: jest.fn(),
      transaction: jest.fn(),
      query: jest.fn(),
      connection: {
        getMetadata: jest.fn().mockReturnValue({ tableName: 'users' })
      },
      getRepository: jest.fn().mockReturnValue({ target: 'User', extend: jest.fn() }),
      getTreeRepository: jest.fn().mockReturnValue({ target: 'Category' })
    };

    mockCls = { 
      get: jest.fn((key) => {
        if (key === 'activeGroupIds') return [1];
        if (key === '__rlsBypass') return false;
        return null;
      }) 
    };
    mockRlsService = {
      getRulesForTable: jest.fn().mockReturnValue({ sql: '1=1' })
    };
    mockMetrics = { recordBlock: jest.fn() };
    mockConfig = { exemptTables: [], fallbackBehavior: 'deny' };
  });

  it('should wrap createQueryBuilder', () => {
    const proxy = createEntityManagerProxy(mockManager, mockCls, mockRlsService, mockMetrics, mockConfig);
    proxy.createQueryBuilder();
    expect(mockManager.createQueryBuilder).toHaveBeenCalled();
  });

  it('should force update/delete through query builder', async () => {
    const mockQb = { 
      update: jest.fn().mockReturnThis(), 
      delete: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(), 
      where: jest.fn().mockReturnThis(), 
      andWhere: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue(true),
      expressionMap: { queryType: 'update', mainAlias: { metadata: { tableName: 'users' } } }
    };
    mockManager.createQueryBuilder.mockReturnValue(mockQb);

    const proxy = createEntityManagerProxy(mockManager, mockCls, mockRlsService, mockMetrics, mockConfig);
    await proxy.update('User', { id: 1 }, { name: 'Test' });

    expect(mockQb.update).toHaveBeenCalled();
    expect(mockQb.set).toHaveBeenCalled();
    expect(mockManager.update).not.toHaveBeenCalled();
  });

  it('should allow raw queries if bypassed', async () => {
    mockCls.get.mockImplementation((key: string) => key === '__rlsBypass' ? true : null);
    const proxy = createEntityManagerProxy(mockManager, mockCls, mockRlsService, mockMetrics, mockConfig);
    
    await proxy.query('SELECT 1');
    expect(mockManager.query).toHaveBeenCalled();
  });

  it('should crash on raw queries if not bypassed', async () => {
    const proxy = createEntityManagerProxy(mockManager, mockCls, mockRlsService, mockMetrics, mockConfig);
    
    // Fix: Use rejects.toThrow for async error check
    await expect(proxy.query('SELECT 1')).rejects.toThrow('[RLS] Raw EntityManager queries');
    expect(mockMetrics.recordBlock).toHaveBeenCalledWith('raw_query');
  });

  it('should wrap transaction manager', async () => {
    const proxy = createEntityManagerProxy(mockManager, mockCls, mockRlsService, mockMetrics, mockConfig);
    
    const fakeTxManager = { createQueryBuilder: jest.fn() };
    mockManager.transaction.mockImplementation((cb: Function) => cb(fakeTxManager));

    let receivedManager: any;
    await proxy.transaction(async (m) => {
      receivedManager = m;
    });

    expect(receivedManager).not.toBe(fakeTxManager);
    expect(receivedManager.createQueryBuilder).not.toBe(fakeTxManager.createQueryBuilder);
  });

  it('should block unrecognized methods by default', () => {
    const proxy = createEntityManagerProxy(mockManager, mockCls, mockRlsService, mockMetrics, mockConfig);
    expect(() => (proxy as any).someNewMethod()).toThrow(RlsSecurityViolationError);
  });
});
