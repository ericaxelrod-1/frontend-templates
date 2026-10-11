import { Injectable, OnDestroy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, Subscription, timer, of } from 'rxjs';
import { switchMap, tap, map, catchError } from 'rxjs/operators';
import { Notification, NotificationPreference } from '../../models/notification.model';
import { AuthService } from './auth.service';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class NotificationCenterService implements OnDestroy {
  private readonly API_URL = `${environment.apiUrl}/notifications`;
  
  private notificationsSubject = new BehaviorSubject<Notification[]>([]);
  notifications$ = this.notificationsSubject.asObservable();
  
  private unreadCountSubject = new BehaviorSubject<number>(0);
  unreadCount$ = this.unreadCountSubject.asObservable();
  
  private pollingSubscription?: Subscription;
  private authSubscription: Subscription;

  constructor(
    private http: HttpClient,
    private authService: AuthService
  ) {
    this.authSubscription = this.authService.currentUser$.subscribe(user => {
      if (user) {
        this.startPolling();
        this.loadInitialState();
      } else {
        this.stopPolling();
        this.notificationsSubject.next([]);
        this.unreadCountSubject.next(0);
      }
    });
  }

  ngOnDestroy() {
    this.authSubscription.unsubscribe();
    this.stopPolling();
  }

  private loadInitialState() {
    this.fetchNotifications().subscribe();
    this.fetchUnreadCount().subscribe();
  }

  private startPolling() {
    this.stopPolling();
    // Poll every 30 seconds for unread count
    this.pollingSubscription = timer(30000, 30000).pipe(
      switchMap(() => this.fetchUnreadCount())
    ).subscribe();
  }

  private stopPolling() {
    if (this.pollingSubscription) {
      this.pollingSubscription.unsubscribe();
      this.pollingSubscription = undefined;
    }
  }

  fetchNotifications(): Observable<Notification[]> {
    return this.http.get<Notification[]>(this.API_URL).pipe(
      tap(notifications => this.notificationsSubject.next(notifications)),
      catchError(err => {
        console.error('Error fetching notifications:', err);
        return of([]);
      })
    );
  }

  fetchUnreadCount(): Observable<number> {
    return this.http.get<number>(`${this.API_URL}/unread-count`).pipe(
      tap(count => {
        if (count !== this.unreadCountSubject.value) {
          const wasHigher = count > this.unreadCountSubject.value;
          this.unreadCountSubject.next(count);
          if (wasHigher) {
            // New notification arrived, refresh the list
            this.fetchNotifications().subscribe();
          }
        }
      }),
      catchError(err => {
        console.error('Error fetching unread count:', err);
        return of(this.unreadCountSubject.value);
      })
    );
  }

  markAsRead(id: number): Observable<Notification> {
    return this.http.patch<Notification>(`${this.API_URL}/${id}/read`, {}).pipe(
      tap(() => {
        const current = this.notificationsSubject.value;
        const updated = current.map(n => n.id === id ? { ...n, isRead: true } : n);
        this.notificationsSubject.next(updated);
        this.unreadCountSubject.next(Math.max(0, this.unreadCountSubject.value - 1));
      })
    );
  }

  markAllAsRead(): Observable<void> {
    return this.http.patch<void>(`${this.API_URL}/read-all`, {}).pipe(
      tap(() => {
        const current = this.notificationsSubject.value;
        const updated = current.map(n => ({ ...n, isRead: true }));
        this.notificationsSubject.next(updated);
        this.unreadCountSubject.next(0);
      })
    );
  }

  deleteNotification(id: number): Observable<void> {
    return this.http.delete<void>(`${this.API_URL}/${id}`).pipe(
      tap(() => {
        const current = this.notificationsSubject.value;
        const toDelete = current.find(n => n.id === id);
        const updated = current.filter(n => n.id !== id);
        this.notificationsSubject.next(updated);
        if (toDelete && !toDelete.isRead) {
          this.unreadCountSubject.next(Math.max(0, this.unreadCountSubject.value - 1));
        }
      })
    );
  }

  getPreferences(): Observable<NotificationPreference> {
    return this.http.get<NotificationPreference>(`${this.API_URL}/preferences`);
  }

  updatePreferences(prefs: Partial<NotificationPreference>): Observable<NotificationPreference> {
    return this.http.patch<NotificationPreference>(`${this.API_URL}/preferences`, prefs);
  }
}
