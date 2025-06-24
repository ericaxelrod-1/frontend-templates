import { Directive, OnInit, ElementRef, Renderer2, AfterViewInit, Optional, Self } from '@angular/core';
import { MatSelect } from '@angular/material/select';
import { OverlayRef } from '@angular/cdk/overlay';

/**
 * MatSelectFixDirective - Fixes z-index and positioning issues with Angular Material select overlays
 * 
 * This directive addresses the same CDK overlay click blocking issue as BUG-054 but for mat-select elements.
 * The issue occurs when mat-select overlays block mouse clicks while keyboard navigation still works.
 * 
 * This directive:
 * 1. Ensures proper z-index management for select overlays
 * 2. Fixes pointer-events issues that block option clicks
 * 3. Provides DOM reordering to ensure select panels appear on top
 * 
 * Usage: Add [matSelectFix] to any mat-select element experiencing click blocking
 * 
 * Reference: Based on solutions from Angular Material GitHub issues #9320 and BUG-054 resolution
 */
@Directive({
  selector: '[matSelectFix]',
  standalone: true
})
export class MatSelectFixDirective implements OnInit, AfterViewInit {
  
  constructor(
    private elementRef: ElementRef,
    private renderer: Renderer2,
    @Optional() @Self() private matSelect: MatSelect
  ) {}

  ngOnInit(): void {
    if (!this.matSelect) {
      console.warn('MatSelectFixDirective: No MatSelect found. Make sure to apply this directive to a mat-select element.');
      return;
    }

    // Subscribe to the select's opened event to fix positioning when panel opens
    this.matSelect.openedChange.subscribe((isOpen: boolean) => {
      if (isOpen) {
        // Use setTimeout to ensure the overlay is fully rendered
        setTimeout(() => {
          this.fixSelectPositioning();
        }, 0);
      }
    });
  }

  ngAfterViewInit(): void {
    // Additional setup if needed
  }

  /**
   * Fix select panel positioning by reordering DOM elements and ensuring proper pointer events
   * Based on the principle that elements later in DOM appear on top
   */
  private fixSelectPositioning(): void {
    // Get the overlay pane
    const overlayPane = this.getOverlayPane();
    if (!overlayPane) {
      console.error('MatSelectFixDirective: Could not find overlay pane');
      return;
    }

    // Get the overlay container
    const overlayContainer = overlayPane.parentElement;
    if (!overlayContainer) {
      console.error('MatSelectFixDirective: Could not find overlay container');
      return;
    }

    // Move the overlay pane to the end of the container
    // This ensures it appears on top of other overlays
    overlayContainer.appendChild(overlayPane);

    // Ensure pointer events are enabled on the overlay pane
    this.renderer.setStyle(overlayPane, 'pointer-events', 'auto');

    // Also ensure pointer events are enabled on the select panel itself
    const selectPanel = overlayPane.querySelector('.mat-select-panel');
    if (selectPanel) {
      this.renderer.setStyle(selectPanel, 'pointer-events', 'auto');
    }

    // Ensure all mat-options have proper pointer events
    const options = overlayPane.querySelectorAll('.mat-option');
    options.forEach(option => {
      this.renderer.setStyle(option, 'pointer-events', 'auto');
    });

    // Set a high z-index to ensure it appears on top
    this.renderer.setStyle(overlayPane, 'z-index', '9999');

    // Log for debugging
    console.debug('MatSelectFixDirective: Select positioning fixed', {
      overlayPane,
      selectPanel,
      optionsCount: options.length,
      zIndex: window.getComputedStyle(overlayPane).zIndex,
      pointerEvents: window.getComputedStyle(overlayPane).pointerEvents
    });
  }

  /**
   * Get the overlay pane element for the select
   */
  private getOverlayPane(): HTMLElement | null {
    // Access the private _overlayRef property from MatSelect
    const overlayRef = (this.matSelect as any)._overlayRef as OverlayRef;
    if (!overlayRef) {
      return null;
    }

    return overlayRef.overlayElement;
  }
} 