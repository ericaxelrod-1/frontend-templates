#!/bin/bash
# Script to audit hardcoded access controls in the Angular codebase
# This script identifies files with hardcoded role names, role checks, and other access control issues

BACKEND_DIR="backend"
FRONTEND_DIR="frontend"
REPORT_FILE="access-control-audit-report.md"

echo "# Access Control Audit Report" > $REPORT_FILE
echo "Generated on $(date)" >> $REPORT_FILE
echo "" >> $REPORT_FILE

echo "## 1. Backend Hardcoded Role Definitions" >> $REPORT_FILE
echo "" >> $REPORT_FILE

echo "### 1.1 Role Enums and Type Definitions" >> $REPORT_FILE
echo "" >> $REPORT_FILE
echo '```' >> $REPORT_FILE
grep -r --include="*.ts" -n "enum\|type.*Role\|interface.*Role" $BACKEND_DIR/ >> $REPORT_FILE
echo '```' >> $REPORT_FILE
echo "" >> $REPORT_FILE

echo "### 1.2 Hardcoded Role Names" >> $REPORT_FILE
echo "" >> $REPORT_FILE
echo '```' >> $REPORT_FILE
grep -r --include="*.ts" -n "'ADMIN\|'USER'\|'SUPERADMIN'\|'PROJECT_MANAGER'\|'SUPERUSER'" $BACKEND_DIR/ >> $REPORT_FILE
echo '```' >> $REPORT_FILE
echo "" >> $REPORT_FILE

echo "### 1.3 Role-Based Guards and Decorators" >> $REPORT_FILE
echo "" >> $REPORT_FILE
echo '```' >> $REPORT_FILE
grep -r --include="*.ts" -n "@Roles\|@HasRole\|@RequireRoles" $BACKEND_DIR/ >> $REPORT_FILE
echo '```' >> $REPORT_FILE
echo "" >> $REPORT_FILE

echo "### 1.4 Seed Data and Migrations with Hardcoded Roles" >> $REPORT_FILE
echo "" >> $REPORT_FILE
echo '```' >> $REPORT_FILE
grep -r --include="*.ts" -n "createRole\|insertRole\|role:" $BACKEND_DIR/ >> $REPORT_FILE
echo '```' >> $REPORT_FILE
echo "" >> $REPORT_FILE

echo "### 1.5 Critical File: role.entity.ts" >> $REPORT_FILE
echo "" >> $REPORT_FILE
echo "**Location:** $BACKEND_DIR/src/modules/users/entities/role.entity.ts" >> $REPORT_FILE
echo "" >> $REPORT_FILE
echo '```typescript' >> $REPORT_FILE
cat $BACKEND_DIR/src/modules/users/entities/role.entity.ts | head -20 >> $REPORT_FILE
echo '```' >> $REPORT_FILE
echo "" >> $REPORT_FILE

echo "## 2. Frontend Hardcoded Access Controls" >> $REPORT_FILE
echo "" >> $REPORT_FILE

echo "### 2.1 Route Definitions with Hardcoded Roles" >> $REPORT_FILE
echo "" >> $REPORT_FILE
echo '```' >> $REPORT_FILE
grep -r --include="*.ts" -n "roles:\|data: { roles" $FRONTEND_DIR/ >> $REPORT_FILE
echo '```' >> $REPORT_FILE
echo "" >> $REPORT_FILE

echo "### 2.2 Template Role Checks" >> $REPORT_FILE
echo "" >> $REPORT_FILE
echo '```' >> $REPORT_FILE
grep -r --include="*.html" -n "*ngIf=\".*role\|*ngIf=\".*hasRole\|*ngIf=\".*isAdmin" $FRONTEND_DIR/ >> $REPORT_FILE
echo '```' >> $REPORT_FILE
echo "" >> $REPORT_FILE

echo "### 2.3 Component Role Checks" >> $REPORT_FILE
echo "" >> $REPORT_FILE
echo '```' >> $REPORT_FILE
grep -r --include="*.ts" -n "user.role\|hasRole\|roles.includes\|isAdmin\|isSuperAdmin" $FRONTEND_DIR/ | grep -v "import" >> $REPORT_FILE
echo '```' >> $REPORT_FILE
echo "" >> $REPORT_FILE

echo "### 2.4 Critical File: role.guard.ts" >> $REPORT_FILE
echo "" >> $REPORT_FILE
echo "**Location:** $FRONTEND_DIR/src/app/core/guards/role.guard.ts" >> $REPORT_FILE
echo "" >> $REPORT_FILE
echo '```typescript' >> $REPORT_FILE
cat $FRONTEND_DIR/src/app/core/guards/role.guard.ts >> $REPORT_FILE
echo '```' >> $REPORT_FILE
echo "" >> $REPORT_FILE

echo "### 2.5 Critical File: auth.service.ts (hasRole method)" >> $REPORT_FILE
echo "" >> $REPORT_FILE
echo "**Location:** $FRONTEND_DIR/src/app/core/services/auth.service.ts" >> $REPORT_FILE
echo "" >> $REPORT_FILE
echo '```typescript' >> $REPORT_FILE
grep -A 30 "hasRole" $FRONTEND_DIR/src/app/core/services/auth.service.ts >> $REPORT_FILE
echo '```' >> $REPORT_FILE
echo "" >> $REPORT_FILE

echo "## 3. Summary of Findings" >> $REPORT_FILE
echo "" >> $REPORT_FILE

# Count total hardcoded instances
BACKEND_COUNT=$(grep -r --include="*.ts" -n "'ADMIN\|'USER'\|'SUPERADMIN'\|'PROJECT_MANAGER'\|'SUPERUSER'" $BACKEND_DIR/ | wc -l)
FRONTEND_TS_COUNT=$(grep -r --include="*.ts" -n "'ADMIN\|'USER'\|'SUPERADMIN'\|'PROJECT_MANAGER'\|'SUPERUSER'" $FRONTEND_DIR/ | wc -l)
FRONTEND_HTML_COUNT=$(grep -r --include="*.html" -n "*ngIf=\".*role\|*ngIf=\".*hasRole\|*ngIf=\".*isAdmin" $FRONTEND_DIR/ | wc -l)
ROUTE_COUNT=$(grep -r --include="*.ts" -n "roles:\|data: { roles" $FRONTEND_DIR/ | wc -l)

TOTAL_COUNT=$((BACKEND_COUNT + FRONTEND_TS_COUNT + FRONTEND_HTML_COUNT))

echo "| Category | Count |" >> $REPORT_FILE
echo "|----------|-------|" >> $REPORT_FILE
echo "| Backend Hardcoded Roles | $BACKEND_COUNT |" >> $REPORT_FILE
echo "| Frontend TypeScript Hardcoded Roles | $FRONTEND_TS_COUNT |" >> $REPORT_FILE
echo "| Frontend Template Role Checks | $FRONTEND_HTML_COUNT |" >> $REPORT_FILE
echo "| Route Definitions with Roles | $ROUTE_COUNT |" >> $REPORT_FILE
echo "| **Total Hardcoded Instances** | **$TOTAL_COUNT** |" >> $REPORT_FILE
echo "" >> $REPORT_FILE

echo "## 4. Critical Files Requiring Migration" >> $REPORT_FILE
echo "" >> $REPORT_FILE

echo "1. $BACKEND_DIR/src/modules/users/entities/role.entity.ts" >> $REPORT_FILE
echo "2. $FRONTEND_DIR/src/app/core/guards/role.guard.ts" >> $REPORT_FILE
echo "3. $FRONTEND_DIR/src/app/core/services/auth.service.ts" >> $REPORT_FILE
echo "4. $FRONTEND_DIR/src/app/app.routes.ts" >> $REPORT_FILE
echo "5. $FRONTEND_DIR/src/app/modules/admin/admin.module.ts" >> $REPORT_FILE
echo "" >> $REPORT_FILE

echo "## 5. Next Steps" >> $REPORT_FILE
echo "" >> $REPORT_FILE
echo "1. Create database schema changes for hierarchical roles and groups" >> $REPORT_FILE
echo "2. Implement permission entities and services" >> $REPORT_FILE
echo "3. Update role.entity.ts to use database-driven approach" >> $REPORT_FILE
echo "4. Create permission-based guards to replace role-based guards" >> $REPORT_FILE
echo "5. Develop frontend permission services and directives" >> $REPORT_FILE
echo "6. Migrate all hardcoded instances to use the new permission system" >> $REPORT_FILE
echo "" >> $REPORT_FILE

echo "Report generated: $REPORT_FILE"
echo "Found $TOTAL_COUNT total hardcoded access control instances" 