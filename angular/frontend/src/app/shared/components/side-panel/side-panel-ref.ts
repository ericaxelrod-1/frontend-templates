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

    constructor(private overlayRef: OverlayRef) { }

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
