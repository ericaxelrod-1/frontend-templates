import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

@Injectable({
    providedIn: 'root'
})
export class PageTitleService {
    private titleSubject = new BehaviorSubject<string>('');
    public title$: Observable<string> = this.titleSubject.asObservable();

    /**
     * Update the current page title
     * @param title The new page title display string
     */
    setTitle(title: string): void {
        this.titleSubject.next(title);
    }

    /**
     * Reset the title back to an empty state
     */
    resetTitle(): void {
        this.titleSubject.next('');
    }
}
