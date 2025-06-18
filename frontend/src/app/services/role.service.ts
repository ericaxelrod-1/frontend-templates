import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface Permission {
  id: number;
  name: string;
  description: string;
  resourceName: string;
  actionName: string;
}

export interface Role {
  id?: number;
  name: string;
  description: string;
  permissions: Permission[];
  createdAt?: Date;
  updatedAt?: Date;
  userCount?: number;
} 