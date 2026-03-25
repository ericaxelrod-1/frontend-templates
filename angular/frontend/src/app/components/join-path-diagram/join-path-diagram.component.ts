import { Component, Input, Output, EventEmitter, OnInit, OnDestroy, Injector, runInInjectionContext } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpParams } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { NgDiagramComponent, NgDiagramPaletteItemComponent, NgDiagramPaletteItemPreviewComponent, NgDiagramPortComponent, NgDiagramBaseEdgeComponent, provideNgDiagram, initializeModel } from 'ng-diagram';
import { environment } from '../../../environments/environment';
import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';

export interface DiagramTableNode {
  id: string;
  data: {
    tableName: string;
    columns: DiagramColumn[];
  };
  position?: { x: number; y: number };
}

export interface DiagramColumn {
  name: string;
  type: string;
  isPrimary?: boolean;
  isForeignKey?: boolean;
}

export interface DiagramEdge {
  id: string;
  source: string;
  target: string;
  sourceColumn: string;
  targetColumn: string;
  operator: string;
}

export interface DiagramJoinCondition {
  id: string;
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  operator: string;
}

export interface DiagramOutput {
  tables: DiagramTableNode[];
  edges: DiagramEdge[];
  conditions: DiagramJoinCondition[];
}

@Component({
  selector: 'app-join-path-diagram',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatInputModule,
    MatFormFieldModule,
    NgDiagramComponent,
    NgDiagramPaletteItemComponent,
    NgDiagramPaletteItemPreviewComponent,
    NgDiagramPortComponent,
    NgDiagramBaseEdgeComponent,
  ],
  providers: [provideNgDiagram()],
  templateUrl: './join-path-diagram.component.html',
  styleUrls: ['./join-path-diagram.component.scss']
})
export class JoinPathDiagramComponent implements OnInit, OnDestroy {
  @Input() targetTable = '';
  @Input() initialTables: DiagramTableNode[] = [];
  @Input() initialConditions: DiagramJoinCondition[] = [];
  
  @Input() set availableTablesFromParent(tables: any[]) {
    if (tables && tables.length > 0) {
      this.availableTables = tables.map(t => ({
        id: t.name,
        data: {
          tableName: t.name,
          columns: t.columns,
        },
      }));
      this.totalTables = tables.length;
      this.updatePaletteItems();
    }
  }

  @Output() conditionsChange = new EventEmitter<DiagramJoinCondition[]>();
  @Output() diagramChange = new EventEmitter<DiagramOutput>();
  @Output() targetTableChange = new EventEmitter<string>();

  availableTables: DiagramTableNode[] = [];
  
  model = initializeModel({
    nodes: [],
    edges: [],
  });

  selectedEdgeId: string | null = null;
  sidebarOpen = false;
  sidebarEdge: any | null = null;
  sidebarSourceColumn = '';
  sidebarTargetColumn = '';
  sidebarOperator = '=';

  edgeCounter = 0;

  paletteItems: any[] = [];
  searchTerm = '';
  searchSubject = new Subject<string>();
  currentPage = 1;
  pageSize = 20;
  totalTables = 0;
  loadingPalette = false;
  availableCanvasColumns: { tableName: string; columnName: string }[] = [];

  constructor(private http: HttpClient, private injector: Injector) {
    this.searchSubject.pipe(
      debounceTime(300),
      distinctUntilChanged()
    ).subscribe(() => {
      this.currentPage = 1;
      this.availableTables = [];
      this.loadAvailableTables();
    });
  }

  ngOnInit(): void {
    // Map initial conditions to edges - but we need node IDs first
    // Since initialTables has indices as IDs (node_0, node_1), we can use those
    const initialEdges = this.initialConditions.map((c, i) => ({
      id: c.id || `edge_${i}`,
      source: `node_${this.getNodeIndex(c.fromTable)}`,
      target: `node_${this.getNodeIndex(c.toTable)}`,
      data: {
        sourceColumn: c.fromColumn,
        targetColumn: c.toColumn,
        operator: c.operator || '=',
      },
    }));

    this.edgeCounter = initialEdges.length;

    // Initialize model with initial data
    this.model = runInInjectionContext(this.injector, () => initializeModel({
      nodes: this.initialTables as any,
      edges: initialEdges as any,
    }));

    if (this.availableTables.length === 0) {
      this.loadAvailableTables();
    }
  }

  private getNodeIndex(tableName: string): number {
    return this.initialTables.findIndex(t => t.data?.tableName === tableName);
  }

  ngOnDestroy(): void {
    this.searchSubject.complete();
  }

  onSearchChange(term: string): void {
    this.searchSubject.next(term);
  }

  loadMore(): void {
    if (this.availableTables.length < this.totalTables) {
      this.currentPage++;
      this.loadAvailableTables();
    }
  }

  onPaletteScroll(event: Event): void {
    const target = event.target as HTMLElement;
    const threshold = 50;
    if (target.scrollHeight - target.scrollTop <= target.clientHeight + threshold) {
      this.loadMore();
    }
  }

  loadAvailableTables(): void {
    this.loadingPalette = true;
    let params = new HttpParams()
      .set('page', this.currentPage.toString())
      .set('limit', this.pageSize.toString());
    
    if (this.searchTerm) {
      params = params.set('search', this.searchTerm);
    }

    this.http.get<{ items: any[], total: number }>(`${environment.apiUrl}/schema/tables`, { params })
      .subscribe({
        next: (response) => {
          const newTables = response.items.map(t => ({
            id: t.name,
            data: {
              tableName: t.name,
              columns: t.columns,
            },
          }));
          
          this.availableTables = this.currentPage === 1 
            ? newTables 
            : [...this.availableTables, ...newTables];
            
          this.totalTables = response.total;
          this.updatePaletteItems();
          this.loadingPalette = false;
        },
        error: () => {
          this.loadingPalette = false;
        }
      });
  }

  updatePaletteItems(): void {
    this.paletteItems = this.availableTables.map(t => ({
      id: t.id,
      label: t.data.tableName,
      data: { label: t.data.tableName, tableName: t.data.tableName, columns: t.data.columns } as any,
    }));
  }

  get edges(): any[] {
    return this.model.getEdges() as any[];
  }

  getNodeIdByTableName(tableName: string): string {
    // Query live model for node
    const nodes = this.model.getNodes() as any[];
    const node = nodes.find(n => n.data?.tableName === tableName);
    return node?.id || tableName;
  }

  onPaletteItemDropped(event: any): void {
    // Library natively adds the node to canvas - event contains the new node
    const { node } = event;
    
    // Query current state from model
    const currentNodes = this.model.getNodes() as any[];
    const currentEdges = this.model.getEdges() as any[];

    // Auto-connect to previous node if exists
    if (currentNodes.length > 1) {
      const prevNode = currentNodes[currentNodes.length - 2];
      const edgeId = `edge_${++this.edgeCounter}`;
      const newEdge = {
        id: edgeId,
        source: prevNode.id,
        target: node.id,
        data: {
          sourceColumn: '',
          targetColumn: '',
          operator: '=',
        },
      };
      this.model.updateEdges([...currentEdges, newEdge]);
    }

    this.emitChange();
  }

  onEdgeDrawn(event: any): void {
    const edge = event.edge;
    if (!edge.data) {
      edge.data = { sourceColumn: '', targetColumn: '', operator: '=' };
    }
    // Library handles adding the edge - just open sidebar
    this.openEdgeSidebar(edge);
  }

  onEdgeSelected(edge: any): void {
    this.selectedEdgeId = edge.id;
    this.openEdgeSidebar(edge);
  }

  onSelectionChanged(event: any): void {
    const selected = event.selection || [];
    if (selected.length > 0) {
      const selectedId = selected[0].id;
      // Query live model for the selected edge
      const edge = (this.model.getEdges() as any[]).find(e => e.id === selectedId);
      if (edge) {
        this.onEdgeSelected(edge);
      }
    }
  }

  openEdgeSidebar(edge: any): void {
    this.sidebarEdge = edge;
    this.sidebarSourceColumn = edge.data?.sourceColumn || '';
    this.sidebarTargetColumn = edge.data?.targetColumn || '';
    this.sidebarOperator = edge.data?.operator || '=';
    this.sidebarOpen = true;
  }

  updateEdgeCondition(): void {
    if (!this.sidebarEdge) return;
    // Query live model and update edge
    const currentEdges = this.model.getEdges();
    const updatedEdges = currentEdges.map((e: any) => {
      if (e.id === this.sidebarEdge.id) {
        return {
          ...e,
          data: {
            sourceColumn: this.sidebarSourceColumn,
            targetColumn: this.sidebarTargetColumn,
            operator: this.sidebarOperator,
          },
        };
      }
      return e;
    });
    this.model.updateEdges(updatedEdges);
    this.emitChange();
  }

  deleteSelectedEdge(): void {
    if (!this.selectedEdgeId) return;
    // Filter live model directly
    const updatedEdges = this.model.getEdges().filter((e: any) => e.id !== this.selectedEdgeId);
    this.model.updateEdges(updatedEdges);
    this.sidebarOpen = false;
    this.sidebarEdge = null;
    this.selectedEdgeId = null;
    this.emitChange();
  }

  deleteNode(nodeId: string): void {
    const nodes = this.model.getNodes() as any[];
    const node = nodes.find(n => n.id === nodeId);
    if (node?.data?.tableName === this.targetTable) {
      this.setTargetTable('');
    }
    // Filter both nodes and edges in live model
    const updatedNodes = nodes.filter(n => n.id !== nodeId);
    const updatedEdges = (this.model.getEdges() as any[]).filter(e => e.source !== nodeId && e.target !== nodeId);
    this.model.updateNodes(updatedNodes);
    this.model.updateEdges(updatedEdges);
    this.emitChange();
  }

  setTargetTable(tableName: string): void {
    this.targetTable = tableName;
    this.targetTableChange.emit(tableName);
  }

  calculateEdgePath(edge: any): string {
    if (!edge.source || !edge.target) return '';
    const nodes = this.model.getNodes() as any[];
    const sourceNode = nodes.find(n => n.id === edge.source);
    const targetNode = nodes.find(n => n.id === edge.target);
    if (!sourceNode || !targetNode) return '';
    return `M ${sourceNode.position.x} ${sourceNode.position.y} L ${targetNode.position.x} ${targetNode.position.y}`;
  }

  emitChange(): void {
    const edges = this.model.getEdges();
    const nodes = this.model.getNodes();

    const conditions: DiagramJoinCondition[] = edges.map((e: any) => ({
      id: e.id,
      fromTable: this.getNodeTableName(e.source),
      fromColumn: e.data?.sourceColumn || '',
      toTable: this.getNodeTableName(e.target),
      toColumn: e.data?.targetColumn || '',
      operator: e.data?.operator || '=',
    })).filter(c => c.fromColumn && c.toColumn);

    const output: DiagramOutput = {
      tables: nodes.map((n: any) => ({
        id: n.id,
        data: {
          tableName: n.data.tableName,
          columns: n.data.columns,
        },
        position: n.position,
      })),
      edges: edges.map((e: any) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceColumn: e.data?.sourceColumn || '',
        targetColumn: e.data?.targetColumn || '',
        operator: e.data?.operator || '=',
      })),
      conditions,
    };

    // Build flat list of all columns from all nodes on canvas for theta joins
    this.availableCanvasColumns = nodes.flatMap((n: any) => 
      (n.data?.columns || []).map((col: any) => ({
        tableName: n.data.tableName,
        columnName: col.name
      }))
    );

    this.conditionsChange.emit(conditions);
    this.diagramChange.emit(output);
  }

  getNodeTableName(nodeId: string): string {
    const nodes = this.model.getNodes() as any[];
    const node = nodes.find(n => n.id === nodeId);
    return node?.data?.tableName || nodeId;
  }

  getNodeColumns(nodeId: string): DiagramColumn[] {
    const nodes = this.model.getNodes() as any[];
    const node = nodes.find(n => n.id === nodeId);
    return node?.data?.columns || [];
  }

  getEdgeSourceColumns(edge: any): DiagramColumn[] {
    return this.getNodeColumns(edge.source);
  }

  getEdgeTargetColumns(edge: any): DiagramColumn[] {
    return this.getNodeColumns(edge.target);
  }

  clearDiagram(): void {
    // Clear model directly
    this.model.updateNodes([]);
    this.model.updateEdges([]);
    this.edgeCounter = 0;
    this.sidebarOpen = false;
    this.sidebarEdge = null;
    this.selectedEdgeId = null;
    this.setTargetTable('');
    this.emitChange();
  }

  closeSidebar(): void {
    this.sidebarOpen = false;
    this.sidebarEdge = null;
    this.selectedEdgeId = null;
  }
}
