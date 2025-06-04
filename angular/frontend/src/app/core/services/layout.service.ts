import { Injectable, Inject } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { DOCUMENT } from '@angular/common';

export type ResponsiveState = 'fixed'; // Simplified to only fixed state

export interface LayoutConfig {
  sidebarWidth: number;
  sidebarMode: 'side'; // Fixed to side mode only
  sidebarOpened: boolean;
  responsiveState: ResponsiveState;
  isMobile: boolean; // Kept for backward compatibility but always false
}

@Injectable({
  providedIn: 'root'
})
export class LayoutService {
  private readonly defaultConfig: LayoutConfig = {
    sidebarWidth: 280,
    sidebarMode: 'side',
    sidebarOpened: true,
    responsiveState: 'fixed',
    isMobile: false
  };

  private readonly layoutConfig$ = new BehaviorSubject<LayoutConfig>(this.defaultConfig);

  constructor(@Inject(DOCUMENT) private document: Document) {
    this.initializeCssCustomProperties();
  }

  get config$(): Observable<LayoutConfig> {
    return this.layoutConfig$.asObservable();
  }

  get currentConfig(): LayoutConfig {
    return this.layoutConfig$.value;
  }

  updateConfig(config: Partial<LayoutConfig>): void {
    const newConfig = {
      ...this.currentConfig,
      ...config
    };
    this.layoutConfig$.next(newConfig);
    this.updateCssCustomProperties(newConfig);
  }

  /**
   * Set fixed, non-responsive sidebar configuration
   * This ensures consistent behavior across all screen sizes
   */
  setFixedSidebarConfiguration(): void {
    this.updateConfig({
      sidebarWidth: 280,
      sidebarMode: 'side',
      sidebarOpened: true,
      responsiveState: 'fixed',
      isMobile: false
    });
  }

  setSidebarWidth(width: number): void {
    // Allow width changes but maintain fixed mode
    this.updateConfig({ sidebarWidth: width });
  }

  toggleSidebar(): void {
    // Manual toggle for user preference - this is the only way sidebar state changes
    this.updateConfig({ 
      sidebarOpened: !this.currentConfig.sidebarOpened 
    });
  }

  /** @deprecated No longer supported - sidebar is always fixed */
  setSidebarMode(mode: 'side' | 'over' | 'push'): void {
    // Maintain fixed side mode regardless of input
    this.updateConfig({ sidebarMode: 'side' });
  }

  /** @deprecated No longer supported - sidebar is not responsive */
  setResponsiveState(state: string): void {
    // Do nothing - sidebar maintains fixed configuration
    console.warn('setResponsiveState is deprecated - sidebar is now fixed at all screen sizes');
  }

  /** @deprecated No longer supported - sidebar is not responsive */
  setMobileState(isMobile: boolean): void {
    // Do nothing - sidebar maintains fixed configuration
    console.warn('setMobileState is deprecated - sidebar is now fixed at all screen sizes');
  }

  private initializeCssCustomProperties(): void {
    this.updateCssCustomProperties(this.defaultConfig);
  }

  private updateCssCustomProperties(config: LayoutConfig): void {
    const root = this.document.documentElement;
    
    // Clean up old responsive classes
    root.classList.remove(
      'sidebar-mode-side', 'sidebar-mode-over', 'sidebar-mode-push',
      'mobile-layout', 'tablet-layout', 'desktop-layout'
    );
    
    // Set fixed sidebar mode class only
    root.classList.add('sidebar-mode-side');
    
    // Set fixed layout class
    root.classList.add('fixed-layout');
  }
} 