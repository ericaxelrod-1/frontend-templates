# STORY-001: Create SidePanelService Infrastructure

## Overview

Create a reusable `SidePanelService` that wraps Angular CDK Overlay to open right-side panel overlays. This follows the same pattern that `MatDialog` and `MatBottomSheet` use internally. The service provides:

- **SidePanelService**: Opens a component as a right-side overlay panel
- **SidePanelRef**: Handle returned to the caller for closing and receiving results
- **SIDE_PANEL_DATA**: Injection token for passing data into panel components

## Why This Must Be Done First

All sidebar component refactoring (STORY-002) depends on this infrastructure. Once this is built and tested, each sidebar component can be converted independently.

## Tasks

| # | Task | Description | Status |
|---|------|-------------|--------|
| 1 | [TASK-001](./TASK-001-create-side-panel-ref.md) | Create the `SidePanelRef` class and `SIDE_PANEL_DATA` injection token | Open |
| 2 | [TASK-002](./TASK-002-create-side-panel-service.md) | Create the `SidePanelService` using CDK Overlay | Open |
| 3 | [TASK-003](./TASK-003-create-side-panel-animations.md) | Create the slide-in/slide-out animation trigger | Open |
| 4 | [TASK-004](./TASK-004-create-side-panel-container.md) | Create the `SidePanelContainerComponent` wrapper | Open |
| 5 | [TASK-005](./TASK-005-create-side-panel-module.md) | Export everything from an index barrel file | Open |
| 6 | [TASK-006](./TASK-006-verify-build.md) | Verify the Angular project builds without errors | Open |
