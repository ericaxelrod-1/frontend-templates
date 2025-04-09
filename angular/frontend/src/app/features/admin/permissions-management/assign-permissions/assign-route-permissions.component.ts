import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormControl } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AssignPermissionBaseComponent, AssignPermissionBaseItem, Permission } from './assign-permission-base.component';

interface RoutePermission extends AssignPermissionBaseItem {
  path: string;
  lastSynced: Date;
}

@Component({
  selector: 'app-assign-route-permissions',
  templateUrl: '../assign-permissions/assign-permission-base.component.html',
  styleUrls: ['../assign-permissions/assign-permission-base.component.scss']
})
export class AssignRoutePermissionsComponent extends AssignPermissionBaseComponent<RoutePermission> implements OnInit {
  apiEndpointPrefix = 'permissions/routes';
  returnRoute = '/admin/permissions/routes';
  itemTypeName = 'Route';
  pageTitle = 'Assign Route Permissions';
  searchControl = new FormControl('');
  
  constructor(
    protected override fb: FormBuilder,
    protected override http: HttpClient,
    protected override route: ActivatedRoute,
    protected override router: Router,
    protected override snackBar: MatSnackBar
  ) {
    super(fb, http, route, router, snackBar);
  }
  
  override ngOnInit() {
    super.ngOnInit();
    
    // Set up filtering for the permissions list
    this.searchControl.valueChanges.subscribe(value => {
      this.updateFilteredPermissions();
    });
  }

  // Filter permissions based on search text
  get filteredPermissions(): Permission[] {
    return this.filterPermissions(this.availablePermissions, this.searchControl.value || '');
  }
  
  // Update the filtered permissions list
  updateFilteredPermissions() {
    // This triggers the getter which applies the filter
    this.filteredPermissions;
  }
} 