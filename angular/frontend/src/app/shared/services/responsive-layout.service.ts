import { Injectable } from "@angular/core";
import { BreakpointObserver } from "@angular/cdk/layout";
import { BehaviorSubject, Observable } from "rxjs";
import { map } from "rxjs/operators";

export type ResponsiveBreakpoint = "mobile" | "tablet" | "desktop" | "largeDesktop";

@Injectable({
  providedIn: "root"
})
export class ResponsiveLayoutService {
  private breakpointSubject = new BehaviorSubject<ResponsiveBreakpoint>("desktop");
  public breakpoint$ = this.breakpointSubject.asObservable();
  
  // Unified breakpoint system matching login-monitoring component
  private readonly breakpoints = {
    mobile: "(max-width: 575.98px)",
    tablet: "(min-width: 576px) and (max-width: 1023.98px)",
    desktop: "(min-width: 1024px) and (max-width: 1279.98px)",
    largeDesktop: "(min-width: 1280px)"
  };
  
  constructor(private breakpointObserver: BreakpointObserver) {
    this.initializeBreakpointMonitoring();
  }
  
  private initializeBreakpointMonitoring(): void {
    this.breakpointObserver.observe([
      this.breakpoints.mobile,
      this.breakpoints.tablet,
      this.breakpoints.desktop,
      this.breakpoints.largeDesktop
    ]).subscribe(result => {
      if (this.breakpointObserver.isMatched(this.breakpoints.mobile)) {
        this.breakpointSubject.next("mobile");
      } else if (this.breakpointObserver.isMatched(this.breakpoints.tablet)) {
        this.breakpointSubject.next("tablet");
      } else if (this.breakpointObserver.isMatched(this.breakpoints.desktop)) {
        this.breakpointSubject.next("desktop");
      } else {
        this.breakpointSubject.next("largeDesktop");
      }
    });
  }
  
  getResponsiveClass(): Observable<string> {
    return this.breakpoint$.pipe(
      map(breakpoint => `${breakpoint}-spacing`)
    );
  }
  
  getGridColumns(type: "stats" | "pattern" | "test"): Observable<string> {
    return this.breakpoint$.pipe(
      map(breakpoint => {
        const columnMap = {
          stats: {
            mobile: "1fr",
            tablet: "repeat(2, 1fr)",
            desktop: "repeat(auto-fit, minmax(200px, 1fr))",
            largeDesktop: "repeat(auto-fit, minmax(200px, 1fr))"
          },
          pattern: {
            mobile: "1fr",
            tablet: "repeat(2, 1fr)",
            desktop: "repeat(auto-fit, minmax(280px, 1fr))",
            largeDesktop: "repeat(auto-fit, minmax(320px, 1fr))"
          },
          test: {
            mobile: "1fr",
            tablet: "repeat(2, 1fr)",
            desktop: "repeat(3, 1fr)",
            largeDesktop: "repeat(4, 1fr)"
          }
        };
        return columnMap[type][breakpoint];
      })
    );
  }
  
  getCurrentBreakpoint(): ResponsiveBreakpoint {
    return this.breakpointSubject.value;
  }
  
  isMobile(): Observable<boolean> {
    return this.breakpoint$.pipe(map(bp => bp === "mobile"));
  }
  
  isTablet(): Observable<boolean> {
    return this.breakpoint$.pipe(map(bp => bp === "tablet"));
  }
  
  isDesktop(): Observable<boolean> {
    return this.breakpoint$.pipe(map(bp => bp === "desktop"));
  }
  
  isLargeDesktop(): Observable<boolean> {
    return this.breakpoint$.pipe(map(bp => bp === "largeDesktop"));
  }
}
