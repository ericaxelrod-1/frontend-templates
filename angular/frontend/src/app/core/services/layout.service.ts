import { Injectable, Inject } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { DOCUMENT } from '@angular/common';

export interface LayoutConfig {
  sidebarWidth: number;
  sidebarMode: 'side' | 'over' | 'push';
  sidebarOpened: boolean;
  isMobile: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class LayoutService {
  private readonly defaultConfig: LayoutConfig = {
    sidebarWidth: 280,
    sidebarMode: 'side',
    sidebarOpened: true,
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

  setSidebarWidth(width: number): void {
    this.updateConfig({ sidebarWidth: width });
  }

  setSidebarMode(mode: 'side' | 'over' | 'push'): void {
    this.updateConfig({ sidebarMode: mode });
  }

  toggleSidebar(): void {
    this.updateConfig({ 
      sidebarOpened: !this.currentConfig.sidebarOpened 
    });
  }

  setMobileState(isMobile: boolean): void {
    this.updateConfig({ 
      isMobile,
      sidebarMode: isMobile ? 'over' : 'side',
      sidebarOpened: true,
      sidebarWidth: 280
    });
  }

  private initializeCssCustomProperties(): void {
    this.updateCssCustomProperties(this.defaultConfig);
  }

  private updateCssCustomProperties(config: LayoutConfig): void {
    const root = this.document.documentElement;
    
    // Set sidebar mode class for positioning behavior only
    root.classList.remove('sidebar-mode-side', 'sidebar-mode-over', 'sidebar-mode-push');
    root.classList.add(`sidebar-mode-${config.sidebarMode}`);
    
    // Set mobile state class for mode styling only
    if (config.isMobile) {
      root.classList.add('mobile-layout');
    } else {
      root.classList.remove('mobile-layout');
    }
  }
} 