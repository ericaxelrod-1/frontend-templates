# STORY-001: Install and Configure TypeORM SnakeNamingStrategy

## Overview

Install the `typeorm-naming-strategies` npm package and configure both database connection points (`database.config.ts` and `data-source.ts`) to use the `SnakeNamingStrategy`. This enables TypeORM to automatically map camelCase entity properties to snake_case database columns without any explicit `{ name: 'snake_case' }` annotations.

## Why This Must Be Done First

The naming strategy must be in place and verified before any entity refactoring begins. Once the naming strategy is active, TypeORM will automatically generate the correct snake_case column names from camelCase properties. Entities that currently have explicit `name:` parameters will continue to work because the explicit `name:` overrides the naming strategy — meaning this story introduces zero breaking changes by itself.

## Tasks

| # | Task | Status |
|---|------|--------|
| 1 | [TASK-001: Install typeorm-naming-strategies](./TASK-001-install-package.md) | Completed |
| 2 | [TASK-002: Configure database.config.ts](./TASK-002-configure-database-config.md) | Completed |
| 3 | [TASK-003: Configure data-source.ts](./TASK-003-configure-data-source.md) | Completed |
| 4 | [TASK-004: Verify naming strategy is active](./TASK-004-verify-naming-strategy.md) | Completed |
