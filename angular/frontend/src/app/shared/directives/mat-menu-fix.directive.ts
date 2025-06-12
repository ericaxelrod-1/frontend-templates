import { Directive, OnInit, ElementRef, Renderer2, AfterViewInit, Optional, Self } from '@angular/core';
import { MatMenuTrigger } from '@angular/material/menu';
import { OverlayRef } from '@angular/cdk/overlay';

/**
 * MatMenuFixDirective - Fixes z-index and positioning issues with Angular Material menus
 * 
 * This directive addresses BUG-054 by:
 * 1. Ensuring proper z-index management for menu overlays
 * 2. Fixing pointer-events issues that block menu clicks
 * 3. Providing DOM reordering to ensure menus appear on top
 * 
 * Reference: Based on solutions from dev.to article on managing multiple dialogs
 * and Angular Material GitHub issues #9320
 */
@Directive({
  selector: '[matMenuFix]',
  standalone: true
})
export class MatMenuFixDirective implements OnInit, AfterViewInit {
  
  constructor(
    private elementRef: ElementRef,
    private renderer: Renderer2,
    @Optional() @Self() private matMenuTrigger: MatMenuTrigger
  ) {}
  
  ngOnInit(): void {
    if (!this.matMenuTrigger) {
      console.error('MatMenuFixDirective: Must be applied to an element with matMenuTriggerFor');
      return;
    }
  }
  
  ngAfterViewInit(): void {
    if (!this.matMenuTrigger) {
      return;
    }
    
    // Subscribe to menu opened event
    this.matMenuTrigger.menuOpened.subscribe(() => {
      this.fixMenuPositioning();
    });
  }
  
  /**
   * Fix menu positioning by reordering DOM elements
   * Based on the principle that elements later in DOM appear on top
   */
  private fixMenuPositioning(): void {
    // Get the overlay pane
    const overlayPane = this.getOverlayPane();
    if (!overlayPane) {
      console.error('MatMenuFixDirective: Could not find overlay pane');
      return;
    }
    
    // Get the overlay container
    const overlayContainer = overlayPane.parentElement;
    if (!overlayContainer) {
      console.error('MatMenuFixDirective: Could not find overlay container');
      return;
    }
    
    // Move the overlay pane to the end of the container
    // This ensures it appears on top of other overlays
    overlayContainer.appendChild(overlayPane);
    
    // Ensure pointer events are enabled
    this.renderer.setStyle(overlayPane, 'pointer-events', 'auto');
    
    // Log for debugging
    console.debug('MatMenuFixDirective: Menu positioning fixed', {
      overlayPane,
      zIndex: window.getComputedStyle(overlayPane).zIndex,
      pointerEvents: window.getComputedStyle(overlayPane).pointerEvents
    });
  }
  
  /**
   * Get the overlay pane element for the menu
   */
  private getOverlayPane(): HTMLElement | null {
    // Access the private _overlayRef property
    const overlayRef = (this.matMenuTrigger as any)._overlayRef as OverlayRef;
    if (!overlayRef) {
      return null;
    }
    
    return overlayRef.overlayElement;
  }
} 