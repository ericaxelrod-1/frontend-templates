import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { environment } from '../../../../environments/environment';

interface HierarchyNode {
  id: number;
  name: string;
  description?: string;
  parentId: number | null;
  children?: HierarchyNode[];
  isExpanded?: boolean;
}

@Component({
  selector: 'app-hierarchy-tree',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatIconModule],
  template: `
    <div class="hierarchy-container">
      <header class="header">
        <div class="header-title">
          <h1>Organization Hierarchy</h1>
          <p class="subtitle">Visualize and manage your {{ viewMode }} structure</p>
        </div>
        <div class="tabs">
          <button mat-button [class.active]="viewMode === 'groups'" (click)="switchView('groups')">
            <mat-icon>groups</mat-icon> Groups
          </button>
          <button mat-button [class.active]="viewMode === 'roles'" (click)="switchView('roles')">
            <mat-icon>verified_user</mat-icon> Roles
          </button>
        </div>
      </header>

      <div class="tree-panel">
        @if (loading) {
          <div class="loading-state">
            <div class="spinner"></div>
            <p>Loading hierarchy...</p>
          </div>
        } @else if (error) {
          <div class="error-state">
            <mat-icon>error_outline</mat-icon>
            <p>{{ error }}</p>
            <button mat-stroked-button (click)="loadData()">Retry</button>
          </div>
        } @else {
          <ul class="tree-root">
            @for (node of treeData; track node.id) {
              <ng-container *ngTemplateOutlet="treeNode; context: { $implicit: node }"></ng-container>
            } @empty {
              <div class="empty-state">
                <mat-icon>account_tree</mat-icon>
                <p>No {{ viewMode }} found in the system hierarchy.</p>
              </div>
            }
          </ul>
        }
      </div>
    </div>

    <ng-template #treeNode let-node>
      <li class="tree-node">
        <div class="node-content" (click)="toggleExpand(node)" [class.expanded]="node.isExpanded">
          <span class="toggle-icon" [class.invisible]="!node.children?.length">
            <mat-icon>{{ node.isExpanded ? 'expand_more' : 'chevron_right' }}</mat-icon>
          </span>
          <span class="node-icon">
            <mat-icon>{{ viewMode === 'groups' ? 'corporate_fare' : 'shield' }}</mat-icon>
          </span>
          <div class="node-details">
            <span class="node-name">{{ node.name }}</span>
            <span class="node-desc" *ngIf="node.description">{{ node.description }}</span>
          </div>
          <div class="node-badges">
            @if (node.children?.length) {
              <span class="badge">{{ node.children?.length }} children</span>
            }
          </div>
        </div>
        
        <ul class="tree-children" *ngIf="node.isExpanded && node.children?.length">
          @for (child of node.children; track child.id) {
            <ng-container *ngTemplateOutlet="treeNode; context: { $implicit: child }"></ng-container>
          }
        </ul>
      </li>
    </ng-template>
  `,
  styles: [`
    .hierarchy-container { padding: var(--fluid-spacing-md); max-width: 1200px; margin: 0 auto; }
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--fluid-spacing-md); border-bottom: 1px solid var(--mat-sys-outline-variant); padding-bottom: 1.5rem; }
    .header-title h1 { margin: 0; font-size: var(--fluid-text-lg); font-weight: 600; color: var(--mat-sys-on-surface); }
    .subtitle { margin: 0.25rem 0 0 0; font-size: var(--fluid-text-sm); color: var(--mat-sys-on-surface-variant); }
    
    .tabs { display: flex; gap: 0.5rem; background: var(--mat-sys-surface-container-low); padding: 4px; border-radius: 8px; }
    .tabs button { color: var(--mat-sys-on-surface-variant); border-radius: 6px; }
    .tabs button.active { background: var(--mat-sys-primary); color: var(--mat-sys-on-primary); }
    
    .tree-panel { background: var(--mat-sys-surface); border-radius: 12px; padding: 1.5rem; border: 1px solid var(--mat-sys-outline-variant); box-shadow: var(--mat-sys-shadow); }
    .tree-root, .tree-children { list-style: none; padding: 0; margin: 0; }
    .tree-children { padding-left: 2rem; border-left: 1px dashed var(--mat-sys-outline-variant); margin-left: 1rem; margin-top: 0.5rem; }
    .tree-node { margin-bottom: 0.5rem; }
    
    .node-content { display: flex; align-items: center; padding: 0.75rem 1rem; background: var(--mat-sys-surface-container-low); border-radius: 8px; cursor: pointer; border: 1px solid transparent; transition: all 0.2s ease; }
    .node-content:hover { background: var(--mat-sys-surface-container-high); border-color: var(--mat-sys-outline); }
    .node-content.expanded { background: var(--mat-sys-surface-container-high); border-bottom-left-radius: 0; border-bottom-right-radius: 0; }
    
    .toggle-icon { width: 24px; color: var(--mat-sys-on-surface-variant); display: flex; align-items: center; }
    .toggle-icon mat-icon { font-size: 1.25rem; width: 1.25rem; height: 1.25rem; }
    .invisible { opacity: 0; pointer-events: none; }
    
    .node-icon { margin-right: 1rem; color: var(--mat-sys-primary); display: flex; align-items: center; }
    .node-icon mat-icon { font-size: 1.5rem; width: 1.5rem; height: 1.5rem; }
    
    .node-details { display: flex; flex-direction: column; flex: 1; }
    .node-name { font-weight: 600; color: var(--mat-sys-on-surface); font-size: var(--fluid-text-sm); }
    .node-desc { font-size: var(--fluid-text-xs); color: var(--mat-sys-on-surface-variant); margin-top: 2px; }
    
    .badge { background: var(--mat-sys-secondary-container); color: var(--mat-sys-on-secondary-container); padding: 2px 10px; border-radius: 9999px; font-size: 10px; font-weight: 700; text-transform: uppercase; }
    
    .loading-state, .error-state, .empty-state { text-align: center; padding: 4rem 2rem; color: var(--mat-sys-on-surface-variant); }
    .empty-state mat-icon, .error-state mat-icon { font-size: 3rem; width: 3rem; height: 3rem; margin-bottom: 1rem; opacity: 0.5; }
    
    .spinner { width: 40px; height: 40px; border: 4px solid var(--mat-sys-surface-variant); border-top: 4px solid var(--mat-sys-primary); border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto 1rem; }
    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
  `]
})
export class HierarchyTreeComponent implements OnInit {
  viewMode: 'groups' | 'roles' = 'groups';
  treeData: HierarchyNode[] = [];
  loading = false;
  error = '';

  constructor(private http: HttpClient) {}

  ngOnInit() {
    this.loadData();
  }

  switchView(mode: 'groups' | 'roles') {
    this.viewMode = mode;
    this.loadData();
  }

  loadData() {
    this.loading = true;
    this.error = '';
    const endpoint = this.viewMode === 'groups' ? 'groups' : 'roles';
    
    this.http.get<{ items: any[] }>(`${environment.apiUrl}/${endpoint}`).subscribe({
      next: (response) => {
        const items = Array.isArray(response) ? response : (response.items || []);
        this.treeData = this.buildTree(items);
        this.loading = false;
      },
      error: (err) => {
        this.error = `Failed to load ${this.viewMode} hierarchy. Please check your connection.`;
        this.loading = false;
      }
    });
  }

  buildTree(items: any[]): HierarchyNode[] {
    const nodeMap = new Map<number, HierarchyNode>();
    const roots: HierarchyNode[] = [];

    items.forEach(item => {
      nodeMap.set(item.id, {
        id: item.id,
        name: item.name,
        description: item.description,
        parentId: item.parentId || (item.parent?.id) || null,
        children: [],
        isExpanded: true
      });
    });

    nodeMap.forEach(node => {
      if (node.parentId === null) {
        roots.push(node);
      } else {
        const parent = nodeMap.get(node.parentId);
        if (parent) {
          parent.children!.push(node);
        } else {
          roots.push(node);
        }
      }
    });

    return roots;
  }

  toggleExpand(node: HierarchyNode) {
    if (node.children?.length) {
      node.isExpanded = !node.isExpanded;
    }
  }
}
