# STORY-003: Cleanup Old Sidebar Files and Z-Index Workarounds

## Overview

After STORY-002 is complete and verified, remove:
1. Old unused SCSS files (e.g., `group-selector-sidebar.component.scss` which was unused even before)
2. The z-index workarounds that were added in `docs/bug-sidebar-zindex/` (no longer needed)
3. Any leftover `position: fixed` sidebar CSS that is no longer referenced

## Tasks

| # | Task | Description | Status |
|---|------|-------------|--------|
| 1 | [TASK-001](./TASK-001-remove-unused-scss.md) | Remove orphaned SCSS files that are no longer referenced by any component | Open |
| 2 | [TASK-002](./TASK-002-revert-zindex-workaround.md) | Revert z-index values back to original or remove them entirely (the CDK Overlay approach makes z-index irrelevant for these components) | Open |
| 3 | [TASK-003](./TASK-003-verify-final-build.md) | Final build and manual verification | Open |

## Execution Notes

- This story should only begin after STORY-002 is fully verified
- These are low-risk cleanup tasks
