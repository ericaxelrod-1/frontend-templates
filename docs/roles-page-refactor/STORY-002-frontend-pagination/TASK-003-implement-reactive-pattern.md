# TASK-003: Implement Reactive Loading Pattern in RolesComponent

## Objective
Transition the `RolesComponent` logic to the industry-standard RxJS pattern defined in `.cursor/rules/150-angular-server-side-sorting.mdc`.

## Current State
`RolesComponent.loadRoles` populates a direct list representation on `ngOnInit`.

## Desired State
`RolesComponent` coordinates streams (`sort`, `paginator`, `searchControl`) and merges them into a reactive initialization using `switchMap`, bypassing static initial loading functions.

## Steps
1. Modify imports to include `ViewChild`, `AfterViewInit`, `FormControl`, and RxJS operators (`merge`, `switchMap`, `debounceTime`, `startWith`, `catchError`, `of`, `tap`).
2. Implement class properties: `@ViewChild(MatSort) sort!: MatSort`, `@ViewChild(MatPaginator) paginator!: MatPaginator`, `dataSource: Role[] = []`, `totalCount = 0`, `pageSize = 10`, `searchControl = new FormControl('')`.
3. Add a wrapper tracking method:
   ```typescript
   private reactivePatternInitialized = false;
   private shouldInitializeReactivePattern = false;
   ```
4. Define `initializeReactivePattern()` mirroring `GroupsComponent`.
   - Prevent `NG0100` errors by queuing default sorts within a `setTimeout`.
   - Setup combination merging:
     ```typescript
     merge(
        this.sort.sortChange.pipe(tap(() => this.paginator.pageIndex = 0)),
        this.paginator.page,
        this.searchControl.valueChanges.pipe(
           debounceTime(300),
           tap(() => this.paginator.pageIndex = 0)
        )
     )
     ```
   - Invoke `switchMap` requesting `getRoles`.
5. Replace occurrences of manual `.push()` lists logic within CRUD handlers (`onRoleSaved`, `deleteRole`) with `this.loadRoles()` forcing dummy UI paginated event re-emits (`this.paginator.page.emit()`).
