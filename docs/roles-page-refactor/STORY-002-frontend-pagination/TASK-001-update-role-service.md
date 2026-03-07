# TASK-001: Update RoleService for Paginated Fetching

## Objective
Update the `getRoles` method in `RoleService` to attach search, pagination, and sorting HTTP query parameters, typed with `ServerResponse`.

## Current State
`RoleService.getRoles` directly returns an `Observable<Role[]>`.

## Desired State
`getRoles` will return `Observable<ServerResponse<Role>>`, matching the backend schema of `{ items, total, page, pageSize }`.

## Steps
1. Import `ServerResponse` from `../models/server-response.model` and `HttpParams` from `@angular/common/http`.
2. Refactor `getRoles` signature:
   ```typescript
   getRoles(params: {
     page?: number;
     pageSize?: number;
     sortBy?: string;
     sortDirection?: string;
     search?: string;
   } = {}): Observable<ServerResponse<Role>>
   ```
3. Use `HttpParams` to append populated keys from `params` to the `httpParams` instance mapping.
   ```typescript
   let httpParams = new HttpParams();
   if (params.page !== undefined) httpParams = httpParams.append('page', params.page.toString());
   // ...
   ```
4. Perform the `GET` request using `this.apiUrl` with `{ params: httpParams }`.
