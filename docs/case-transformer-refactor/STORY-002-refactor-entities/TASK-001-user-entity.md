# TASK-001: Refactor user.entity.ts

| Field | Value |
|-------|-------|
| **Task ID** | STORY-002 / TASK-001 |
| **Status** | Completed |
| **Story** | STORY-002: Refactor All Entity Files |
| **Description** | Remove explicit `name:` parameters from column decorators and remove backward-compatibility getter/setter pairs from the User entity |
| **Estimated Effort** | 15 minutes |
| **Dependencies** | STORY-001 must be fully completed and verified |

---

## File to Edit

**File**: `angular/backend/src/modules/users/entities/user.entity.ts`  
**Full Path**: `/home/eaxelrod/GitHub/frontend-templates/angular/backend/src/modules/users/entities/user.entity.ts`  
**Total Lines**: 193

---

## Edits

### Edit 1: Line 36 — Remove `name:` from firstName column

**Before (line 36):**
```typescript
  @Column({ name: 'first_name', nullable: true })
```

**After:**
```typescript
  @Column({ nullable: true })
```

---

### Edit 2: Line 39 — Remove `name:` from lastName column

**Before (line 39):**
```typescript
  @Column({ name: 'last_name', nullable: true })
```

**After:**
```typescript
  @Column({ nullable: true })
```

---

### Edit 3: Line 42 — Remove `name:` from isActive column

**Before (line 42):**
```typescript
  @Column({ name: 'is_active', default: false })
```

**After:**
```typescript
  @Column({ default: false })
```

---

### Edit 4: Line 45 — Remove `name:` from isEmailVerified column

**Before (line 45):**
```typescript
  @Column({ name: 'is_email_verified', default: false })
```

**After:**
```typescript
  @Column({ default: false })
```

---

### Edit 5: Lines 48-62 — Remove emailVerified getter/setter

**Delete the entire block from line 48 to line 62 (inclusive):**

```typescript
  /**
   * Getter for backward compatibility with services expecting emailVerified
   * Returns the isEmailVerified value
   */
  get emailVerified(): boolean {
    return this.isEmailVerified;
  }

  /**
   * Setter for backward compatibility with services setting emailVerified
   * Sets the isEmailVerified field
   */
  set emailVerified(value: boolean) {
    this.isEmailVerified = value;
  }
```

---

### Edit 6: Line 64 — Remove `name:` from lastLoginAt column

**Before (line 64):**
```typescript
  @Column({ name: 'last_login_at', nullable: true })
```

**After:**
```typescript
  @Column({ nullable: true })
```

---

### Edit 7: Lines 66-81 — Remove lastLogin getter/setter

**Delete the entire block from line 66 to line 81 (inclusive):**

```typescript
  /**
   * Getter for backward compatibility with services expecting lastLogin
   * Returns the lastLoginAt value
   */
  get lastLogin(): Date {
    return this.lastLoginAt;
  }

  /**
   * Setter for backward compatibility with services setting lastLogin
   * Sets the lastLoginAt field
   */
  set lastLogin(value: Date) {
    this.lastLoginAt = value;
  }
```

---

### Edit 8: Line 83 — Remove `name:` from requiresPasswordChange column

**Before (line 83):**
```typescript
  @Column({ name: 'requires_password_change', default: false })
```

**After:**
```typescript
  @Column({ default: false })
```

---

### Edit 9: Line 89 — Remove `name:` from emailVerifiedAt column

**Before (line 89):**
```typescript
  @Column({ name: 'email_verified_at', nullable: true })
```

**After:**
```typescript
  @Column({ nullable: true })
```

---

### Edit 10: Line 92 — Remove `name:` from registrationVerificationSentAt column

**Before (line 92):**
```typescript
  @Column({ name: 'registration_verification_sent_at', nullable: true })
```

**After:**
```typescript
  @Column({ nullable: true })
```

---

### Edit 11: Lines 94-109 — Remove registrationVerificationSent getter/setter

**Delete the entire block from line 94 to line 109 (inclusive).**

---

### Edit 12: Line 111 — Remove `name:` from userVerifiedAt column

**Before (line 111):**
```typescript
  @Column({ name: 'user_verified_at', nullable: true })
```

**After:**
```typescript
  @Column({ nullable: true })
```

---

### Edit 13: Lines 113-128 — Remove userVerified getter/setter

**Delete the entire block from line 113 to line 128 (inclusive).**

---

### Edit 14: Line 130 — Remove `name:` from isDeleted column

**Before (line 130):**
```typescript
  @Column({ name: 'is_deleted', default: false })
```

**After:**
```typescript
  @Column({ default: false })
```

---

### Edit 15: Line 133 — Remove `name:` from deletedAt column

**Before (line 133):**
```typescript
  @Column({ name: 'deleted_at', nullable: true })
```

**After:**
```typescript
  @Column({ nullable: true })
```

---

### Edit 16: Line 136 — Remove `name:` from isBlocked column

**Before (line 136):**
```typescript
  @Column({ name: 'is_blocked', default: false })
```

**After:**
```typescript
  @Column({ default: false })
```

---

### Edit 17: Line 139 — Remove `name:` from blockedAt column

**Before (line 139):**
```typescript
  @Column({ name: 'blocked_at', nullable: true })
```

**After:**
```typescript
  @Column({ nullable: true })
```

---

### Edit 18: Line 142 — Remove `name:` from blockedUntil column

**Before (line 142):**
```typescript
  @Column({ name: 'blocked_until', nullable: true })
```

**After:**
```typescript
  @Column({ nullable: true })
```

---

### Edit 19: Line 145 — Remove `name:` from blockedReason column

**Before (line 145):**
```typescript
  @Column({ name: 'blocked_reason', type: 'text', nullable: true })
```

**After:**
```typescript
  @Column({ type: 'text', nullable: true })
```

---

### Edit 20: Lines 187-188 — Remove `name:` from createdAt/updatedAt

**Before (line 187):**
```typescript
  @CreateDateColumn({ name: 'created_at' })
```
**After:**
```typescript
  @CreateDateColumn()
```

**Before (line 190):**
```typescript
  @UpdateDateColumn({ name: 'updated_at' })
```
**After:**
```typescript
  @UpdateDateColumn()
```

---

### DO NOT CHANGE

- Lines 148-160: `@JoinTable({ name: 'user_roles', ... })` — Keep all `name:` params in `@JoinTable` and `@JoinColumn`
- Lines 162-174: `@JoinTable({ name: 'user_groups', ... })` — Keep all `name:` params
- Lines 179-185: `@JoinTable({ name: 'user_permissions', ... })` — Keep all `name:` params
- Line 21: `@Entity('users')` — Keep the table name

---

## Acceptance Criteria

- [ ] All `{ name: 'snake_case' }` removed from `@Column`, `@CreateDateColumn`, `@UpdateDateColumn` decorators
- [ ] All 4 backward-compatibility getter/setter pairs removed (emailVerified, lastLogin, registrationVerificationSent, userVerified)
- [ ] All `@JoinTable` and `@JoinColumn` decorators unchanged
- [ ] `@Entity('users')` table name unchanged
- [ ] All TypeScript property names unchanged (still camelCase)
- [ ] File compiles without errors
