# BUG: Sidebar Overlays Not Clickable (Z-Index Stacking Context)

> [!NOTE]
> This fix has been superseded by [bug-sidebar-overlay-refactor](../bug-sidebar-overlay-refactor/). The z-index approach only partially addressed the issue. The root cause was that `position: fixed` CSS inside `mat-sidenav-content` creates a stacking context trap. The proper fix uses Angular CDK Overlay to render sidebars outside the stacking context entirely.

## Problem

Sidebar overlays across the app (group selector, role selector, group creation, role creation, member actions, user selector) are unclickable. Buttons like "Apply Selection", "Create Group", and "Create Role" do not respond to clicks.

## Root Cause

The layout header (`.layout-header` in `custom-layout.component.scss`) has `z-index: 1000`. The `mat-sidenav-content` container and `.layout-main` (`overflow: hidden`) create a CSS stacking context that traps `position: fixed` sidebar elements rendered inside the content area. Sidebar components with `z-index: 1000` or `z-index: 1100` are painted behind or at the same level as the layout header, making their interactive elements unreachable.

## Fix

Standardize all sidebar overlay z-index values to **1200** (panel) / **1199** (backdrop), ensuring they render above the layout header.

## Affected Components

| # | Component | Current z-index (panel/backdrop) |
|---|-----------|----------------------------------|
| 1 | group-selector-sidebar (inline styles) | 1001 / 1000 |
| 2 | role-selector-sidebar (inline styles) | 1001 / 1000 |
| 3 | role-creation-sidebar (inline styles) | 1100 / 1099 |
| 4 | group-creation-sidebar (inline styles) | 1100 / 1099 |
| 5 | member-actions-sidebar (inline styles) | 1100 / 1099 |
| 6 | generic-selector-sidebar (SCSS file) | 1100 / 1099 |
| 7 | group-selector-sidebar (SCSS file — unused but should match) | 1100 / 1099 |
| 8 | user-sidebar (SCSS file — layout-level) | 1100 / 1099 |

## Stories

| # | Story | Description | Status |
|---|-------|-------------|--------|
| 1 | [STORY-001](./STORY-001-fix-sidebar-zindex/) | Update z-index values on all 8 affected sidebar components and verify | Completed |

## Execution Order

This is a single-story bug fix. All tasks within STORY-001 can be executed in any order, but TASK-009 (verification) must be done last.
