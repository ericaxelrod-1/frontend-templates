# TASK-001: Create SidePanelRef and SIDE_PANEL_DATA Injection Token

| Field | Value |
|-------|-------|
| **Task ID** | STORY-001 / TASK-001 |
| **Status** | Open |
| **Story** | STORY-001: Create SidePanelService Infrastructure |
| **Description** | Create the `SidePanelRef` class (handle for close/result communication) and the `SIDE_PANEL_DATA` injection token (for passing data into panel components) |
| **Estimated Effort** | 15 minutes |
| **Dependencies** | None |

---

## Context

`SidePanelRef` follows the same pattern as `MatDialogRef` and `MatBottomSheetRef`. It is returned when a panel is opened and allows the opener to:
- Close the panel programmatically
- Subscribe to when the panel closes
- Receive a result value when the panel closes

`SIDE_PANEL_DATA` follows the same pattern as `MAT_DIALOG_DATA` and `MAT_BOTTOM_SHEET_DATA`. Panel components inject it to receive data passed by the opener.

---

## Instructions

### File to Create

**File**: `angular/frontend/src/app/shared/components/side-panel/side-panel-ref.ts`  
**Full Path**: `/home/eaxelrod/GitHub/frontend-templates/angular/frontend/src/app/shared/components/side-panel/side-panel-ref.ts`

### Complete File Contents

```typescript
import { OverlayRef } from '@angular/cdk/overlay';
import { InjectionToken } from '@angular/core';
import { Subject, Observable } from 'rxjs';

/**
 * Injection token for passing data into side panel components.
 * Usage: @Inject(SIDE_PANEL_DATA) public data: MyDataType
 *
 * This follows the same pattern as MAT_DIALOG_DATA and MAT_BOTTOM_SHEET_DATA.
 */
export const SIDE_PANEL_DATA = new InjectionToken<any>('SidePanelData');

/**
 * Reference to an opened side panel.
 * Provides methods to close the panel and observe its lifecycle.
 *
 * This follows the same pattern as MatDialogRef and MatBottomSheetRef.
 *
 * @example
 * // Opening a panel
 * const panelRef = sidePanelService.open(MyComponent, { data: { id: 123 } });
 *
 * // Closing from outside
 * panelRef.close('result value');
 *
 * // Subscribing to close
 * panelRef.afterClosed().subscribe(result => {
 *   console.log('Panel closed with:', result);
 * });
 */
export class SidePanelRef<T = any, R = any> {
  private readonly _afterClosed = new Subject<R | undefined>();

  constructor(private overlayRef: OverlayRef) {}

  /**
   * Closes the side panel, optionally passing a result value.
   * @param result - Optional result to pass back to the opener
   */
  close(result?: R): void {
    this.overlayRef.dispose();
    this._afterClosed.next(result);
    this._afterClosed.complete();
  }

  /**
   * Observable that emits when the panel is closed.
   * Emits the result value if one was passed to close().
   */
  afterClosed(): Observable<R | undefined> {
    return this._afterClosed.asObservable();
  }
}
```

---

## Acceptance Criteria

- [ ] File exists at `shared/components/side-panel/side-panel-ref.ts`
- [ ] `SIDE_PANEL_DATA` is exported as an `InjectionToken`
- [ ] `SidePanelRef` class is exported with `close()` and `afterClosed()` methods
- [ ] `SidePanelRef` accepts an `OverlayRef` in its constructor
- [ ] No compilation errors
