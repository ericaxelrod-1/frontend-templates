# TASK-002: Create SidePanelService

| Field | Value |
|-------|-------|
| **Task ID** | STORY-001 / TASK-002 |
| **Status** | Open |
| **Story** | STORY-001: Create SidePanelService Infrastructure |
| **Description** | Create the `SidePanelService` that uses CDK Overlay to open right-side panel overlays |
| **Estimated Effort** | 20 minutes |
| **Dependencies** | TASK-001 must be completed first |

---

## Context

`SidePanelService` is the main entry point. Parent components call `sidePanelService.open(ComponentType, config)` to open a sidebar. The service:
1. Creates a CDK Overlay positioned at the right edge of the viewport
2. Attaches the component to the overlay using a `ComponentPortal`
3. Creates a `SidePanelRef` for close/result communication
4. Injects `SIDE_PANEL_DATA` and `SidePanelRef` into the component
5. Adds a backdrop that closes the panel when clicked
6. Handles Escape key to close

This follows the same pattern that `MatDialog.open()` and `MatBottomSheet.open()` use.

---

## Instructions

### File to Create

**File**: `angular/frontend/src/app/shared/components/side-panel/side-panel.service.ts`  
**Full Path**: `/home/eaxelrod/GitHub/frontend-templates/angular/frontend/src/app/shared/components/side-panel/side-panel.service.ts`

### Complete File Contents

```typescript
import { Injectable, Injector, ComponentType } from '@angular/core';
import { Overlay, OverlayConfig, OverlayRef } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { SidePanelRef, SIDE_PANEL_DATA } from './side-panel-ref';

/**
 * Configuration options for opening a side panel.
 */
export interface SidePanelConfig<D = any> {
  /** Data to pass to the panel component via SIDE_PANEL_DATA injection token. */
  data?: D;

  /** Width of the panel. Defaults to '400px'. */
  width?: string;

  /** Whether clicking the backdrop closes the panel. Defaults to true. */
  hasBackdrop?: boolean;

  /** CSS class(es) to apply to the backdrop. */
  backdropClass?: string | string[];

  /** CSS class(es) to apply to the overlay panel. */
  panelClass?: string | string[];
}

/**
 * Service for opening right-side panel overlays using Angular CDK Overlay.
 *
 * This follows the same pattern as MatDialog and MatBottomSheet.
 * Content is rendered into a CDK overlay container appended to <body>,
 * completely outside any stacking context (mat-sidenav-content, etc.).
 *
 * @example
 * constructor(private sidePanelService: SidePanelService) {}
 *
 * openGroupSelector(): void {
 *   const ref = this.sidePanelService.open(GroupSelectorPanelComponent, {
 *     data: { selectedGroupIds: this.selectedGroupIds },
 *     width: '400px'
 *   });
 *
 *   ref.afterClosed().subscribe(result => {
 *     if (result) {
 *       this.selectedGroupIds = result;
 *     }
 *   });
 * }
 */
@Injectable({ providedIn: 'root' })
export class SidePanelService {
  constructor(
    private overlay: Overlay,
    private injector: Injector
  ) {}

  /**
   * Opens a component as a right-side panel overlay.
   *
   * @param component - The component class to render inside the panel
   * @param config - Configuration options (data, width, backdrop, etc.)
   * @returns SidePanelRef for closing the panel and receiving results
   */
  open<T, D = any, R = any>(
    component: ComponentType<T>,
    config: SidePanelConfig<D> = {}
  ): SidePanelRef<T, R> {
    // Create the overlay with right-edge positioning
    const overlayRef = this.createOverlay(config);

    // Create the SidePanelRef (handle for close/result communication)
    const sidePanelRef = new SidePanelRef<T, R>(overlayRef);

    // Create a custom injector that provides SidePanelRef and SIDE_PANEL_DATA
    const panelInjector = Injector.create({
      parent: this.injector,
      providers: [
        { provide: SidePanelRef, useValue: sidePanelRef },
        { provide: SIDE_PANEL_DATA, useValue: config.data || null }
      ]
    });

    // Attach the component to the overlay
    const portal = new ComponentPortal(component, null, panelInjector);
    overlayRef.attach(portal);

    // Close on backdrop click
    if (config.hasBackdrop !== false) {
      overlayRef.backdropClick().subscribe(() => {
        sidePanelRef.close();
      });
    }

    // Close on Escape key
    overlayRef.keydownEvents().subscribe(event => {
      if (event.key === 'Escape') {
        sidePanelRef.close();
      }
    });

    return sidePanelRef;
  }

  /**
   * Creates a CDK OverlayRef configured for a right-edge panel.
   */
  private createOverlay<D>(config: SidePanelConfig<D>): OverlayRef {
    const overlayConfig = new OverlayConfig({
      // Position at the right edge, full height
      positionStrategy: this.overlay
        .position()
        .global()
        .right('0')
        .top('0'),

      // Full viewport height, configurable width
      width: config.width || '400px',
      height: '100vh',

      // Backdrop configuration
      hasBackdrop: config.hasBackdrop !== false,
      backdropClass: config.backdropClass || 'side-panel-backdrop',

      // Panel styling
      panelClass: config.panelClass || 'side-panel-overlay',

      // Scroll strategy: block page scrolling while panel is open
      scrollStrategy: this.overlay.scrollStrategies.block()
    });

    return this.overlay.create(overlayConfig);
  }
}
```

---

## Acceptance Criteria

- [ ] File exists at `shared/components/side-panel/side-panel.service.ts`
- [ ] `SidePanelService` is exported as an `@Injectable({ providedIn: 'root' })` service
- [ ] `SidePanelConfig` interface is exported
- [ ] `open()` method creates an overlay, attaches the component, and returns a `SidePanelRef`
- [ ] Backdrop click closes the panel
- [ ] Escape key closes the panel
- [ ] Data is injectable via `SIDE_PANEL_DATA`
- [ ] `SidePanelRef` is injectable into the panel component
- [ ] No compilation errors
