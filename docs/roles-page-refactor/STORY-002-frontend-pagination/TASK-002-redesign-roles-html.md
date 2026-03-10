# TASK-002: Redesign Roles HTML Template

## Objective
Update the `RolesComponent` inline template to inject the `mat-paginator` and `matSort` controls, along with an intuitive search field.

## Current State
The template uses a `mat-table` bound to `<table *ngIf="!loading" mat-table [dataSource]="roles">`.

## Desired State
The `mat-table` always renders natively without an `*ngIf` wrapper, thereby resolving lifecycle initializations (`undefined ViewChild`). A search bar will permit backend ILike substring matches. A `mat-paginator` controls slicing natively.

## Steps
1. Insert the search input form control into `.actions-bar`:
   ```html
   <mat-form-field appearance="outline" class="search-field">
     <mat-label>Search roles</mat-label>
     <mat-icon matPrefix>search</mat-icon>
     <input matInput [formControl]="searchControl" placeholder="Search by name or description">
   </mat-form-field>
   ```
2. Restructure the table wrapper layout to prevent `*ngIf="!loading"` from destroying the `mat-table` view instance.
3. Apply `matSort`, `matSortActive="name"`, and `matSortDirection="asc"` directives to the root table and headers with `mat-sort-header`.
4. Define a placeholder fallthrough row:
   ```html
   <tr class="mat-row" *matNoDataRow>
      <td class="mat-cell" colspan="5" *ngIf="!loading">
         No roles found matching the filter "{{searchControl.value}}"
      </td>
   </tr>
   ```
5. Prepend `<mat-paginator [length]="totalCount" [pageSize]="pageSize" [pageSizeOptions]="[5, 10, 25, 100]">` natively beneath the `mat-table`.
