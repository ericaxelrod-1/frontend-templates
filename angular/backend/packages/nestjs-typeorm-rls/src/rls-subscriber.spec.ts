import { RlsInsertSubscriber, RlsSecurityViolationError } from './rls-subscriber';
import { InsertEvent } from 'typeorm';

describe('RlsInsertSubscriber', () => {
  let subscriber: RlsInsertSubscriber;

  const createMockCls = (overrides: Record<string, any>) => ({
    get: jest.fn((key?: string) => overrides[key]),
  });

  beforeEach(() => {
    subscriber = new RlsInsertSubscriber();
  });

  describe('Tenant Spoofing Prevention', () => {
    it('should throw error when entity has groupId user does not belong to', () => {
      const mockCls = createMockCls({
        '__rlsBypass': false,
        'activeGroupIds': [1, 2, 3],
        'primaryGroupId': 1,
      });
      subscriber.setCls(mockCls as any);

      const mockEvent: InsertEvent<any> = {
        entity: { groupId: 999 },
      } as any;

      expect(() => subscriber.beforeInsert(mockEvent)).toThrow(RlsSecurityViolationError);
      expect(() => subscriber.beforeInsert(mockEvent)).toThrow(/Tenant spoofing detected/);
    });

    it('should throw error when entity has customer_id user does not own', () => {
      const mockCls = createMockCls({
        '__rlsBypass': false,
        'activeGroupIds': [1, 2, 3],
        'primaryGroupId': 1,
      });
      subscriber.setCls(mockCls as any);

      const mockEvent: InsertEvent<any> = {
        entity: { customer_id: 999 },
      } as any;

      expect(() => subscriber.beforeInsert(mockEvent)).toThrow(RlsSecurityViolationError);
      expect(() => subscriber.beforeInsert(mockEvent)).toThrow(/Tenant spoofing detected on customer_id/);
    });

    it('should throw error when entity has tenantId user does not own', () => {
      const mockCls = createMockCls({
        '__rlsBypass': false,
        'activeGroupIds': [1, 2, 3],
        'primaryGroupId': 1,
      });
      subscriber.setCls(mockCls as any);

      const mockEvent: InsertEvent<any> = {
        entity: { tenantId: 999 },
      } as any;

      expect(() => subscriber.beforeInsert(mockEvent)).toThrow(RlsSecurityViolationError);
      expect(() => subscriber.beforeInsert(mockEvent)).toThrow(/Tenant spoofing detected on tenantId/);
    });

    it('should throw error when entity has organizationId user does not own', () => {
      const mockCls = createMockCls({
        '__rlsBypass': false,
        'activeGroupIds': [1, 2, 3],
        'primaryGroupId': 1,
      });
      subscriber.setCls(mockCls as any);

      const mockEvent: InsertEvent<any> = {
        entity: { organizationId: 999 },
      } as any;

      expect(() => subscriber.beforeInsert(mockEvent)).toThrow(RlsSecurityViolationError);
      expect(() => subscriber.beforeInsert(mockEvent)).toThrow(/Tenant spoofing detected on organizationId/);
    });
  });

  describe('Valid Group Assignment', () => {
    it('should assign groupId from primaryGroupId when not provided', () => {
      const mockCls = createMockCls({
        '__rlsBypass': false,
        'activeGroupIds': [1, 2, 3],
        'primaryGroupId': 2,
      });
      subscriber.setCls(mockCls as any);

      const entity = { name: 'test' };
      const mockEvent: InsertEvent<any> = { entity } as any;

      subscriber.beforeInsert(mockEvent);

      expect(entity.groupId).toBe(2);
    });

    it('should use primaryGroupId over activeGroupIds[0]', () => {
      const mockCls = createMockCls({
        '__rlsBypass': false,
        'activeGroupIds': [1, 2, 3],
        'primaryGroupId': 3,
      });
      subscriber.setCls(mockCls as any);

      const entity = { name: 'test' };
      const mockEvent: InsertEvent<any> = { entity } as any;

      subscriber.beforeInsert(mockEvent);

      expect(entity.groupId).toBe(3);
    });

    it('should allow groupId that user belongs to and use primaryGroupId', () => {
      const mockCls = createMockCls({
        '__rlsBypass': false,
        'activeGroupIds': [1, 2, 3],
        'primaryGroupId': 2,
      });
      subscriber.setCls(mockCls as any);

      const entity = { name: 'test', groupId: 1 };
      const mockEvent: InsertEvent<any> = { entity } as any;

      subscriber.beforeInsert(mockEvent);

      expect(entity.groupId).toBe(2);
    });
  });

  describe('Force Overwrite of Tenant Columns', () => {
    it('should force-overwrite groupId with active context', () => {
      const mockCls = createMockCls({
        '__rlsBypass': false,
        'activeGroupIds': [1, 2, 3],
        'primaryGroupId': 1,
      });
      subscriber.setCls(mockCls as any);

      const entity = { groupId: 2 };
      const mockEvent: InsertEvent<any> = { entity } as any;

      subscriber.beforeInsert(mockEvent);

      expect(entity.groupId).toBe(1);
    });

    it('should force-overwrite customer_id with active context', () => {
      const mockCls = createMockCls({
        '__rlsBypass': false,
        'activeGroupIds': [1, 2, 3],
        'primaryGroupId': 1,
      });
      subscriber.setCls(mockCls as any);

      const entity = { customer_id: 2 };
      const mockEvent: InsertEvent<any> = { entity } as any;

      subscriber.beforeInsert(mockEvent);

      expect(entity.customer_id).toBe(1);
    });

    it('should force-overwrite tenantId with active context', () => {
      const mockCls = createMockCls({
        '__rlsBypass': false,
        'activeGroupIds': [1, 2, 3],
        'primaryGroupId': 1,
      });
      subscriber.setCls(mockCls as any);

      const entity = { tenantId: 2 };
      const mockEvent: InsertEvent<any> = { entity } as any;

      subscriber.beforeInsert(mockEvent);

      expect(entity.tenantId).toBe(1);
    });

    it('should force-overwrite organizationId with active context', () => {
      const mockCls = createMockCls({
        '__rlsBypass': false,
        'activeGroupIds': [1, 2, 3],
        'primaryGroupId': 1,
      });
      subscriber.setCls(mockCls as any);

      const entity = { organizationId: 2 };
      const mockEvent: InsertEvent<any> = { entity } as any;

      subscriber.beforeInsert(mockEvent);

      expect(entity.organizationId).toBe(1);
    });
  });

  describe('Bypass Mode', () => {
    it('should not perform any checks when __rlsBypass is true', () => {
      const mockCls = createMockCls({
        '__rlsBypass': true,
      });
      subscriber.setCls(mockCls as any);

      const entity = { groupId: 999 };
      const mockEvent: InsertEvent<any> = { entity } as any;

      expect(() => subscriber.beforeInsert(mockEvent)).not.toThrow();
      expect(entity.groupId).toBe(999);
    });
  });

  describe('Missing Active Context', () => {
    it('should throw error for RLS-scoped entity without active context', () => {
      const mockCls = createMockCls({
        '__rlsBypass': false,
        'activeGroupIds': [],
        'primaryGroupId': null,
      });
      subscriber.setCls(mockCls as any);

      const entity = { groupId: 1 };
      const mockEvent: InsertEvent<any> = { entity } as any;

      expect(() => subscriber.beforeInsert(mockEvent)).toThrow(RlsSecurityViolationError);
      expect(() => subscriber.beforeInsert(mockEvent)).toThrow(/without active group context/);
    });

    it('should allow non-RLS-scoped entities without active context', () => {
      const mockCls = createMockCls({
        '__rlsBypass': false,
        'activeGroupIds': [],
        'primaryGroupId': null,
      });
      subscriber.setCls(mockCls as any);

      const entity = { name: 'test' };
      const mockEvent: InsertEvent<any> = { entity } as any;

      expect(() => subscriber.beforeInsert(mockEvent)).not.toThrow();
    });
  });

  describe('Error Type', () => {
    it('should throw RlsSecurityViolationError specifically', () => {
      const mockCls = createMockCls({
        '__rlsBypass': false,
        'activeGroupIds': [],
        'primaryGroupId': null,
      });
      subscriber.setCls(mockCls as any);

      const entity = { groupId: 1 };
      const mockEvent: InsertEvent<any> = { entity } as any;

      expect(() => subscriber.beforeInsert(mockEvent)).toThrow(RlsSecurityViolationError);
    });

    it('should have correct error name', () => {
      const error = new RlsSecurityViolationError('test');
      expect(error.name).toBe('RlsSecurityViolationError');
    });
  });
});
