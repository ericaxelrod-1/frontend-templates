# TASK-002: Update HeaderComponent

## Description
Integrate the `PageTitleService` into the main application layout header to visually output the dynamic title.

## Implementation Steps
1. **TypeScript Update**: In `src/app/layouts/header/header.component.ts`, inject the `PageTitleService` into the constructor.
2. In the `HeaderComponent` class variables, declare a `pageTitle$: Observable<string>` variable.
3. In the constructor, assign `this.pageTitle$ = this.pageTitleService.title$;`.
4. **HTML Update**: Open `src/app/layouts/header/header.component.html`.
5. Locate the `<div class="logo-container">` block.
6. Adjacent to the `<h1 class="app-name">`, introduce a container utilizing the `async` pipe. For example: `<ng-container *ngIf="pageTitle$ | async as pageTitle">`.
7. Render a separator such as `<span class="title-separator">|</span>`.
8. Output the dynamic title: `<span class="page-title">{{ pageTitle }}</span>`.
9. **SCSS Update**: Modify `src/app/layouts/header/header.component.scss` to style `.title-separator` and `.page-title`. Give them appropriate margins, font-weights, and colors to match the header visually but remain distinct.

## Acceptance Criteria
- Header component subscribes to `PageTitleService`.
- If a title is emitted, it renders seamlessly next to the app logo.
- Layout remains fully responsive without breaking inline block alignments.
