# TASK-001: Create PageTitleService 

## Description
Create a global service that manages the page title state using RxJS paradigms.

## Implementation Steps
1. Create a `page-title.service.ts` file in `src/app/core/services/`.
2. Annotate the class with `@Injectable({ providedIn: 'root' })`.
3. Create a private `BehaviorSubject<string>` initialized to an empty string `''`.
4. Expose the value as a public `title$` observable using `asObservable()`.
5. Implement a `setTitle(title: string)` method that pushes new titles into the `BehaviorSubject` via `.next()`.
6. Make sure to export the class as `PageTitleService`.

## Acceptance Criteria
- `PageTitleService` is globally provided.
- Has a `setTitle` method taking a string.
- Exposes a `title$` observable string stream.
