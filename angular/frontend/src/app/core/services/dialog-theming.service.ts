import { Injectable, Inject } from '@angular/core';
import { OverlayContainer } from '@angular/cdk/overlay';
import { DOCUMENT } from '@angular/common';

/**
 * Service for managing dialog theming in Angular Material applications.
 * 
 * This service addresses the issue where dialogs inherit the global theme
 * instead of component-specific theme overrides. Dialogs are rendered in
 * the CDK overlay container which is outside the component DOM tree.
 * 
 * Usage:
 * 1. Inject this service in your component
 * 2. Call applyLightTheme() before opening a dialog
 * 3. Call removeLightTheme() after the dialog closes
 * 
 * @example
 * ```typescript
 * constructor(private dialogTheming: DialogThemingService) {}
 * 
 * openDialog() {
 *   this.dialogTheming.applyLightTheme();
 *   const dialogRef = this.dialog.open(MyDialogComponent);
 *   dialogRef.afterClosed().subscribe(() => {
 *     this.dialogTheming.removeLightTheme();
 *   });
 * }
 * ```
 */
@Injectable({
  providedIn: 'root'
})
export class DialogThemingService {
  private readonly LIGHT_THEME_CLASS = 'light-theme-dialogs';
  private readonly LIGHT_CONTENT_CLASS = 'light-dialog-content';
  private appliedClasses = new Set<string>();

  constructor(
    private overlayContainer: OverlayContainer,
    @Inject(DOCUMENT) private document: Document
  ) {}

  /**
   * Applies light theme to dialogs by adding theme classes to the overlay container.
   * This ensures dialogs use light theme even when the global theme is dark.
   * 
   * The method applies classes to multiple elements to ensure comprehensive coverage:
   * 1. CDK overlay container (where dialogs are rendered)
   * 2. Document body (for global CSS variable inheritance)
   * 3. Document root element (for CSS custom property cascade)
   */
  applyLightTheme(): void {
    try {
      // Apply to overlay container (primary target for dialogs)
      const overlayElement = this.overlayContainer.getContainerElement();
      if (overlayElement) {
        overlayElement.classList.add(this.LIGHT_THEME_CLASS);
        overlayElement.classList.add(this.LIGHT_CONTENT_CLASS);
        this.appliedClasses.add(`overlay-${this.LIGHT_THEME_CLASS}`);
        this.appliedClasses.add(`overlay-${this.LIGHT_CONTENT_CLASS}`);
      }

      // Apply to document body for CSS variable inheritance
      if (this.document.body) {
        this.document.body.classList.add(this.LIGHT_THEME_CLASS);
        this.appliedClasses.add(`body-${this.LIGHT_THEME_CLASS}`);
      }

      // Apply to document root for CSS custom property cascade
      if (this.document.documentElement) {
        this.document.documentElement.classList.add(this.LIGHT_THEME_CLASS);
        this.appliedClasses.add(`root-${this.LIGHT_THEME_CLASS}`);
      }

      console.log('[DialogThemingService] Light theme applied to dialog overlay container');
    } catch (error) {
      console.error('[DialogThemingService] Error applying light theme:', error);
    }
  }

  /**
   * Removes light theme classes from all elements where they were applied.
   * This should be called after the dialog closes to restore the original theme.
   * 
   * The method safely removes classes and handles cases where elements
   * might have been removed from the DOM.
   */
  removeLightTheme(): void {
    try {
      // Remove from overlay container
      const overlayElement = this.overlayContainer.getContainerElement();
      if (overlayElement) {
        overlayElement.classList.remove(this.LIGHT_THEME_CLASS);
        overlayElement.classList.remove(this.LIGHT_CONTENT_CLASS);
      }

      // Remove from document body
      if (this.document.body) {
        this.document.body.classList.remove(this.LIGHT_THEME_CLASS);
      }

      // Remove from document root
      if (this.document.documentElement) {
        this.document.documentElement.classList.remove(this.LIGHT_THEME_CLASS);
      }

      // Clear tracking
      this.appliedClasses.clear();

      console.log('[DialogThemingService] Light theme removed from dialog overlay container');
    } catch (error) {
      console.error('[DialogThemingService] Error removing light theme:', error);
    }
  }

  /**
   * Checks if light theme is currently applied to any elements.
   * Useful for debugging and ensuring proper cleanup.
   * 
   * @returns True if light theme classes are currently applied
   */
  isLightThemeApplied(): boolean {
    return this.appliedClasses.size > 0;
  }

  /**
   * Forces cleanup of all theme classes.
   * Use this as a safety measure if normal cleanup fails.
   */
  forceCleanup(): void {
    try {
      this.removeLightTheme();
      
      // Additional cleanup for any orphaned classes
      const allElements = [
        this.overlayContainer.getContainerElement(),
        this.document.body,
        this.document.documentElement
      ].filter(Boolean);

      allElements.forEach(element => {
        if (element) {
          element.classList.remove(this.LIGHT_THEME_CLASS);
          element.classList.remove(this.LIGHT_CONTENT_CLASS);
        }
      });

      this.appliedClasses.clear();
      console.log('[DialogThemingService] Force cleanup completed');
    } catch (error) {
      console.error('[DialogThemingService] Error during force cleanup:', error);
    }
  }

  /**
   * Gets debug information about the current state of the service.
   * Useful for troubleshooting theming issues.
   * 
   * @returns Object containing debug information
   */
  getDebugInfo(): any {
    const overlayElement = this.overlayContainer.getContainerElement();
    
    return {
      appliedClasses: Array.from(this.appliedClasses),
      isLightThemeApplied: this.isLightThemeApplied(),
      overlayContainerClasses: overlayElement ? Array.from(overlayElement.classList) : [],
      bodyClasses: this.document.body ? Array.from(this.document.body.classList) : [],
      rootClasses: this.document.documentElement ? Array.from(this.document.documentElement.classList) : []
    };
  }
} 