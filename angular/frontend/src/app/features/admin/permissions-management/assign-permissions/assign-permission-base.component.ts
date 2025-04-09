import { OnInit, Directive, ViewChild } from '@angular/core';
import { FormBuilder, FormGroup, FormArray, FormControl } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatSelectionList } from '@angular/material/list';
import { environment } from '../../../../../environments/environment';
import { EMPTY, Observable, catchError, finalize, of, tap } from 'rxjs';

export interface Permission {
  id: string;
  name: string;
  description: string;
  resourceName: string;
  actionName: string;
}

export interface AssignPermissionBaseItem {
  id: string;
  name: string;
  description: string;
  requiredPermissions: string[];
  overridePermissions: boolean;
}

@Directive()
export abstract class AssignPermissionBaseComponent<T extends AssignPermissionBaseItem> implements OnInit {
  // The item (component, route, or endpoint) being edited
  item: T | null = null;
  // The list of all available permissions
  availablePermissions: Permission[] = [];
  // The loading state
  loading = false;
  // The form group
  form: FormGroup;
  // The ID from the route
  itemId: string | null = null;
  // The api endpoint prefix
  abstract apiEndpointPrefix: string;
  // The route to return to
  abstract returnRoute: string;
  // The item type name (for display)
  abstract itemTypeName: string;

  @ViewChild('permissionList') permissionList!: MatSelectionList;

  constructor(
    protected fb: FormBuilder,
    protected http: HttpClient,
    protected route: ActivatedRoute,
    protected router: Router,
    protected snackBar: MatSnackBar
  ) {
    this.form = this.fb.group({
      id: [''],
      name: [''],
      description: [''],
      requiredPermissions: this.fb.array([]),
      overridePermissions: [false]
    });
  }

  ngOnInit() {
    this.itemId = this.route.snapshot.paramMap.get('id');
    if (!this.itemId) {
      this.snackBar.open(`No ${this.itemTypeName} ID provided`, 'Close', { duration: 3000 });
      this.router.navigate([this.returnRoute]);
      return;
    }

    this.loadItem();
    this.loadPermissions();
  }

  loadItem() {
    this.loading = true;
    this.http.get<T>(`${environment.apiUrl}/${this.apiEndpointPrefix}/${this.itemId}`)
      .pipe(
        tap(item => {
          this.item = item;
          this.form.patchValue({
            id: item.id,
            name: item.name,
            description: item.description,
            overridePermissions: item.overridePermissions
          });
          
          // Clear the form array
          const permissionsArray = this.form.get('requiredPermissions') as FormArray;
          while (permissionsArray.length) {
            permissionsArray.removeAt(0);
          }
          
          // Add the required permissions
          item.requiredPermissions?.forEach(permission => {
            permissionsArray.push(new FormControl(permission));
          });
        }),
        catchError(error => {
          console.error(`Error loading ${this.itemTypeName}:`, error);
          this.snackBar.open(`Failed to load ${this.itemTypeName}`, 'Close', { duration: 3000 });
          return EMPTY;
        }),
        finalize(() => {
          this.loading = false;
        })
      )
      .subscribe();
  }

  loadPermissions() {
    this.loading = true;
    this.http.get<Permission[]>(`${environment.apiUrl}/permissions`)
      .pipe(
        tap(permissions => {
          this.availablePermissions = permissions;
        }),
        catchError(error => {
          console.error('Error loading permissions:', error);
          this.snackBar.open('Failed to load permissions', 'Close', { duration: 3000 });
          return EMPTY;
        }),
        finalize(() => {
          this.loading = false;
        })
      )
      .subscribe();
  }

  get requiredPermissions(): FormArray {
    return this.form.get('requiredPermissions') as FormArray;
  }

  togglePermission(permission: Permission) {
    const permissionsArray = this.form.get('requiredPermissions') as FormArray;
    const permissionId = permission.resourceName + ':' + permission.actionName;
    
    const index = permissionsArray.value.findIndex((p: string) => p === permissionId);
    if (index !== -1) {
      // Remove the permission
      permissionsArray.removeAt(index);
    } else {
      // Add the permission
      permissionsArray.push(new FormControl(permissionId));
    }
  }

  isPermissionSelected(permission: Permission): boolean {
    const permissionsArray = this.form.get('requiredPermissions') as FormArray;
    const permissionId = permission.resourceName + ':' + permission.actionName;
    
    return permissionsArray.value.includes(permissionId);
  }

  savePermissions() {
    if (this.form.invalid) {
      this.snackBar.open('Please correct the form errors before saving', 'Close', { duration: 3000 });
      return;
    }
    
    this.loading = true;
    const formValue = this.form.value;
    
    this.http.patch<T>(
      `${environment.apiUrl}/${this.apiEndpointPrefix}/${this.itemId}`,
      {
        requiredPermissions: formValue.requiredPermissions,
        overridePermissions: formValue.overridePermissions
      }
    ).pipe(
      tap(updatedItem => {
        this.snackBar.open(`${this.itemTypeName} permissions updated successfully`, 'Close', { duration: 3000 });
        this.router.navigate([this.returnRoute]);
      }),
      catchError(error => {
        console.error(`Error updating ${this.itemTypeName} permissions:`, error);
        this.snackBar.open(`Failed to update ${this.itemTypeName} permissions`, 'Close', { duration: 3000 });
        return of(null);
      }),
      finalize(() => {
        this.loading = false;
      })
    ).subscribe();
  }

  cancel() {
    this.router.navigate([this.returnRoute]);
  }

  // Filter permissions based on search text
  filterPermissions(permissions: Permission[], searchText: string): Permission[] {
    if (!searchText) {
      return permissions;
    }
    
    const lowerCaseSearch = searchText.toLowerCase();
    return permissions.filter(permission => 
      permission.name.toLowerCase().includes(lowerCaseSearch) ||
      permission.description.toLowerCase().includes(lowerCaseSearch) ||
      permission.resourceName.toLowerCase().includes(lowerCaseSearch) ||
      permission.actionName.toLowerCase().includes(lowerCaseSearch)
    );
  }
} 