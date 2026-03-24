import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
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
  imports: [CommonModule],
  template: `
    <div class="hierarchy-container">
      <header class="header">
        <h1>Organization Hierarchy</h1>
        <div class="tabs">
          <button [class.active]="viewMode === 'groups'" (click)="switchView('groups')">Groups</button>
          <button [class.active]="viewMode === 'roles'" (click)="switchView('roles')">Roles</button>
        </div>
      </header>

      <div class="tree-panel">
        @if (loading) {
          <div class="loading">Loading hierarchy...</div>
        } @else if (error) {
          <div class="error">{{ error }}</div>
        } @else {
          <ul class="tree-root">
            @for (node of treeData; track node.id) {
              <ng-container *ngTemplateOutlet="treeNode; context: { $implicit: node }"></ng-container>
            }
          </ul>
        }
      </div>
    </div>

    <ng-template #treeNode let-node>
      <li class="tree-node">
        <div class="node-content" (click)="toggleExpand(node)">
          <span class="toggle-icon" [class.invisible]="!node.children?.length">
            {{ node.isExpanded ? '▼' : '▶' }}
          </span>
          <span class="node-icon">{{ viewMode === 'groups' ? '🏢' : '🛡️' }}</span>
          <div class="node-details">
            <span class="node-name">{{ node.name }}</span>
            <span class="node-desc" *ngIf="node.description">{{ node.description }}</span>
          </div>
          <div class="node-badges">
            <span class="badge" *ngIf="node.children?.length">{{ node.children?.length }} children</span>
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
    .hierarchy-container { padding: 1.5rem; max-width: 1000px; margin: 0 auto; }
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem; border-bottom: 1px solid #e2e8f0; padding-bottom: 1rem; }
    .header h1 { margin: 0; font-size: 1.5rem; color: #1e293b; }
    .tabs { display: flex; gap: 0.5rem; }
    .tabs button { padding: 0.5rem 1.5rem; border: none; background: #f1f5f9; color: #64748b; border-radius: 0.375rem; cursor: pointer; font-weight: 500; }
    .tabs button.active { background: #3b82f6; color: white; }
    .tree-panel { background: white; border-radius: 0.5rem; padding: 1.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .tree-root, .tree-children { list-style: none; padding: 0; margin: 0; }
    .tree-children { padding-left: 1.5rem; border-left: 1px solid #e2e8f0; margin-left: 0.75rem; margin-top: 0.5rem; }
    .tree-node { margin-bottom: 0.5rem; }
    .node-content { display: flex; align-items: center; padding: 0.75rem; background: #f8fafc; border-radius: 0.375rem; cursor: pointer; border: 1px solid transparent; transition: all 0.2s; }
    .node-content:hover { background: #f1f5f9; border-color: #cbd5e1; }
    .toggle-icon { width: 1.5rem; text-align: center; color: #64748b; font-size: 0.75rem; }
    .invisible { visibility: hidden; }
    .node-icon { margin-right: 0.75rem; font-size: 1.25rem; }
    .node-details { display: flex; flex-direction: column; flex: 1; }
    .node-name { font-weight: 600; color: #334155; }
    .node-desc { font-size: 0.75rem; color: #64748b; margin-top: 0.125rem; }
    .badge { background: #e2e8f0; color: #475569; padding: 0.125rem 0.5rem; border-radius: 9999px; font-size: 0.7rem; font-weight: 500; }
    .loading, .error { text-align: center; padding: 2rem; color: #64748b; }
    .error { color: #ef4444; }
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
    
    // We assume the API returns a flat list with parentId
    this.http.get<{ items: any[] }>(`${environment.apiUrl}/${endpoint}`).subscribe({
      next: (response) => {
        const items = Array.isArray(response) ? response : (response.items || []);
        this.treeData = this.buildTree(items);
        this.loading = false;
      },
      error: (err) => {
        this.error = `Failed to load ${this.viewMode} hierarchy`;
        this.loading = false;
      }
    });
  }

  buildTree(items: any[]): HierarchyNode[] {
    const nodeMap = new Map<number, HierarchyNode>();
    const roots: HierarchyNode[] = [];

    // First pass: create node objects
    items.forEach(item => {
      nodeMap.set(item.id, {
        id: item.id,
        name: item.name,
        description: item.description,
        parentId: item.parentId || (item.parent?.id) || null,
        children: [],
        isExpanded: true // default expanded
      });
    });

    // Second pass: build tree
    nodeMap.forEach(node => {
      if (node.parentId === null) {
        roots.push(node);
      } else {
        const parent = nodeMap.get(node.parentId);
        if (parent) {
          parent.children!.push(node);
        } else {
          // Orphan node (parent not in list), treat as root
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
