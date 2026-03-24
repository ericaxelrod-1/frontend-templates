import { ScopeCompilerService } from './scope-compiler.service';

describe('ScopeCompilerService', () => {
  let service: ScopeCompilerService;

  beforeEach(() => {
    service = new ScopeCompilerService();
  });

  describe('compileFromTree', () => {
    it('should compile single condition with equality', () => {
      const group = {
        logicalOperator: 'AND',
        conditions: [{ columnName: 'group_id', operator: '=', value: '1' }],
        childGroups: [],
      };
      const result = service.compileFromTree(group);
      expect(result.sql).toContain('group_id = :p_0');
      expect(result.parameters).toEqual({ p_0: '1' });
    });

    it('should compile AND group with multiple conditions', () => {
      const group = {
        logicalOperator: 'AND',
        conditions: [
          { columnName: 'tenant_id', operator: '=', value: '123' },
          { columnName: 'active', operator: '=', value: 'true' },
        ],
        childGroups: [],
      };
      const result = service.compileFromTree(group);
      expect(result.sql).toContain('tenant_id = :p_0 AND active = :p_1');
      expect(result.parameters).toEqual({ p_0: '123', p_1: 'true' });
    });

    it('should compile OR group with multiple conditions', () => {
      const group = {
        logicalOperator: 'OR',
        conditions: [
          { columnName: 'role', operator: '=', value: 'admin' },
          { columnName: 'role', operator: '=', value: 'superuser' },
        ],
        childGroups: [],
      };
      const result = service.compileFromTree(group);
      expect(result.sql).toContain('role = :p_0 OR role = :p_1');
      expect(result.parameters).toEqual({ p_0: 'admin', p_1: 'superuser' });
    });

    it('should compile nested OR inside AND group', () => {
      const group = {
        logicalOperator: 'AND',
        conditions: [{ columnName: 'tenant_id', operator: '=', value: '100' }],
        childGroups: [
          {
            logicalOperator: 'OR',
            conditions: [
              { columnName: 'department', operator: '=', value: 'engineering' },
              { columnName: 'department', operator: '=', value: 'devops' },
            ],
            childGroups: [],
          },
        ],
      };
      const result = service.compileFromTree(group);
      expect(result.sql).toContain(
        'tenant_id = :p_0 AND (department = :p_g1_0 OR department = :p_g1_1)',
      );
      expect(result.parameters).toEqual({
        p_0: '100',
        p_g1_0: 'engineering',
        p_g1_1: 'devops',
      });
    });

    it('should compile IS NULL operator without parameter', () => {
      const group = {
        logicalOperator: 'AND',
        conditions: [
          { columnName: 'deleted_at', operator: 'IS NULL', value: null },
        ],
        childGroups: [],
      };
      const result = service.compileFromTree(group);
      expect(result.sql).toContain('deleted_at IS NULL');
      expect(result.parameters).toEqual({});
    });

    it('should compile IS NOT NULL operator without parameter', () => {
      const group = {
        logicalOperator: 'AND',
        conditions: [
          { columnName: 'archived_at', operator: 'IS NOT NULL', value: null },
        ],
        childGroups: [],
      };
      const result = service.compileFromTree(group);
      expect(result.sql).toContain('archived_at IS NOT NULL');
      expect(result.parameters).toEqual({});
    });

    it('should compile IN operator with comma-separated values into multiple parameters', () => {
      const group = {
        logicalOperator: 'AND',
        conditions: [
          {
            columnName: 'status',
            operator: 'IN',
            value: 'active,pending,review',
          },
        ],
        childGroups: [],
      };
      const result = service.compileFromTree(group);
      expect(result.sql).toContain('status IN (:p_0_0, :p_0_1, :p_0_2)');
      expect(result.parameters).toEqual({
        p_0_0: 'active',
        p_0_1: 'pending',
        p_0_2: 'review',
      });
    });

    it('should compile IN operator with single value', () => {
      const group = {
        logicalOperator: 'AND',
        conditions: [{ columnName: 'type', operator: 'IN', value: 'admin' }],
        childGroups: [],
      };
      const result = service.compileFromTree(group);
      expect(result.sql).toContain('type IN (:p_0_0)');
      expect(result.parameters).toEqual({ p_0_0: 'admin' });
    });

    it('should compile IN operator with empty value gracefully', () => {
      const group = {
        logicalOperator: 'AND',
        conditions: [{ columnName: 'type', operator: 'IN', value: '' }],
        childGroups: [],
      };
      const result = service.compileFromTree(group);
      expect(result.sql).not.toContain('IN');
      expect(result.parameters).toEqual({});
    });

    it('should handle different comparison operators', () => {
      const group = {
        logicalOperator: 'AND',
        conditions: [
          { columnName: 'age', operator: '>', value: '18' },
          { columnName: 'score', operator: '<=', value: '100' },
        ],
        childGroups: [],
      };
      const result = service.compileFromTree(group);
      expect(result.sql).toContain('age > :p_0 AND score <= :p_1');
      expect(result.parameters).toEqual({ p_0: '18', p_1: '100' });
    });

    it('should compile deeply nested groups', () => {
      const group = {
        logicalOperator: 'AND',
        conditions: [{ columnName: 'root', operator: '=', value: 'true' }],
        childGroups: [
          {
            logicalOperator: 'OR',
            conditions: [{ columnName: 'level1', operator: '=', value: 'a' }],
            childGroups: [
              {
                logicalOperator: 'AND',
                conditions: [
                  { columnName: 'level2a', operator: '=', value: 'b' },
                  { columnName: 'level2b', operator: '=', value: 'c' },
                ],
                childGroups: [],
              },
            ],
          },
        ],
      };
      const result = service.compileFromTree(group);
      expect(result.sql).toContain(
        'root = :p_0 AND (level1 = :p_g1_0 OR (level2a = :p_g1_g1_0 AND level2b = :p_g1_g1_1))',
      );
    });

    it('should compile empty group with no conditions', () => {
      const group = {
        logicalOperator: 'AND',
        conditions: [],
        childGroups: [],
      };
      const result = service.compileFromTree(group);
      expect(result.sql).toEqual('');
      expect(result.parameters).toEqual({});
    });

    it('should use custom parameter prefix', () => {
      const group = {
        logicalOperator: 'AND',
        conditions: [{ columnName: 'id', operator: '=', value: '42' }],
        childGroups: [],
      };
      const result = service.compileFromTree(group, 'custom');
      expect(result.sql).toContain('id = :custom_0');
      expect(result.parameters).toEqual({ custom_0: '42' });
    });

    it('should compile complex real-world example with multiple condition types', () => {
      const group = {
        logicalOperator: 'AND',
        conditions: [
          { columnName: 'tenant_id', operator: '=', value: 'tenant_123' },
          { columnName: 'deleted_at', operator: 'IS NULL', value: null },
          { columnName: 'role', operator: 'IN', value: 'admin,manager,viewer' },
        ],
        childGroups: [
          {
            logicalOperator: 'OR',
            conditions: [
              { columnName: 'department', operator: '=', value: 'sales' },
              { columnName: 'department', operator: '=', value: 'marketing' },
            ],
            childGroups: [],
          },
        ],
      };
      const result = service.compileFromTree(group);
      expect(result.sql).toContain(
        'tenant_id = :p_0 AND deleted_at IS NULL AND role IN (:p_2_0, :p_2_1, :p_2_2) AND (department = :p_g3_0 OR department = :p_g3_1)',
      );
      expect(result.parameters).toEqual({
        p_0: 'tenant_123',
        p_2_0: 'admin',
        p_2_1: 'manager',
        p_2_2: 'viewer',
        p_g3_0: 'sales',
        p_g3_1: 'marketing',
      });
    });
  });

  describe('compileGroup', () => {
    it('should compile group with RlsConditionGroup structure', () => {
      const group = {
        conditions: [{ columnName: 'test', operator: '=', value: 'value' }],
        childGroups: [],
        logicalOperator: 'AND',
      };
      const result = service.compileGroup(group as any);
      expect(result.sql).toContain('test = :p_0');
      expect(result.parameters).toEqual({ p_0: 'value' });
    });

    it('should handle IS NULL in compileGroup', () => {
      const group = {
        conditions: [
          { columnName: 'nullable', operator: 'IS NULL', value: null },
        ],
        childGroups: [],
        logicalOperator: 'AND',
      };
      const result = service.compileGroup(group as any);
      expect(result.sql).toContain('nullable IS NULL');
      expect(result.parameters).toEqual({});
    });

    it('should handle IN operator in compileGroup', () => {
      const group = {
        conditions: [{ columnName: 'items', operator: 'IN', value: 'a,b,c' }],
        childGroups: [],
        logicalOperator: 'AND',
      };
      const result = service.compileGroup(group as any);
      expect(result.sql).toContain('items IN (:p_0_0, :p_0_1, :p_0_2)');
      expect(result.parameters).toEqual({ p_0_0: 'a', p_0_1: 'b', p_0_2: 'c' });
    });
  });
});
