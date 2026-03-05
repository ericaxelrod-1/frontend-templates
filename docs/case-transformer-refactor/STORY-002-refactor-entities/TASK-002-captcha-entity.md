# TASK-002: Refactor captcha.entity.ts

| Field | Value |
|-------|-------|
| **Task ID** | STORY-002 / TASK-002 |
| **Status** | Completed |
| **Story** | STORY-002: Refactor All Entity Files |
| **Description** | Remove explicit `name:` parameters from column decorators and remove backward-compatibility getter/setter pair |
| **Estimated Effort** | 10 minutes |
| **Dependencies** | STORY-001 must be fully completed and verified |

---

## File to Edit

**File**: `angular/backend/src/modules/auth/entities/captcha.entity.ts`  
**Full Path**: `/home/eaxelrod/GitHub/frontend-templates/angular/backend/src/modules/auth/entities/captcha.entity.ts`  
**Total Lines**: 60

---

## Edits

### Edit 1: Line 26 — Remove `name:` from isUsed column

**Before:**
```typescript
  @Column({ name: 'is_used', type: 'boolean', default: false })
```
**After:**
```typescript
  @Column({ type: 'boolean', default: false })
```

### Edit 2: Lines 28-43 — Remove `used` getter/setter

**Delete the entire block from line 28 to line 43 (inclusive):**
```typescript
  /**
   * Getter for backward compatibility with services expecting used
   * Returns the isUsed value
   */
  get used(): boolean {
    return this.isUsed;
  }

  /**
   * Setter for backward compatibility with services setting used
   * Sets the isUsed field
   */
  set used(value: boolean) {
    this.isUsed = value;
  }
```

### Edit 3: Line 45 — Remove `name:` from expiresAt column

**Before:**
```typescript
  @Column({ name: 'expires_at', type: 'datetime' })
```
**After:**
```typescript
  @Column({ type: 'datetime' })
```

### Edit 4: Line 48 — Remove `name:` from ipAddress column

**Before:**
```typescript
  @Column({ name: 'ip_address', type: 'text', nullable: true })
```
**After:**
```typescript
  @Column({ type: 'text', nullable: true })
```

### Edit 5: Lines 54-55 — Remove `name:` from createdAt

**Before:**
```typescript
  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
```
**After:**
```typescript
  @CreateDateColumn({ type: 'datetime' })
```

### Edit 6: Lines 57-58 — Remove `name:` from updatedAt

**Before:**
```typescript
  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
```
**After:**
```typescript
  @UpdateDateColumn({ type: 'datetime' })
```

---

## DO NOT CHANGE

- Line 9: `@Entity('captcha')` — Keep the table name

## Acceptance Criteria

- [ ] All `{ name: 'snake_case' }` removed from `@Column`, `@CreateDateColumn`, `@UpdateDateColumn`
- [ ] The `used` getter/setter pair removed
- [ ] `@Entity('captcha')` unchanged
- [ ] File compiles without errors
