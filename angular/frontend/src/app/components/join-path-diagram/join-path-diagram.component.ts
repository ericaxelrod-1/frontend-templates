import { Component, Input, Output, EventEmitter, OnInit, OnDestroy } from '@angular/core';
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
  tableName: string;
  columns: DiagramColumn[];
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
        tableName: t.name,
        columns: t.columns,
      }));
      this.totalTables = tables.length;
      this.updatePaletteItems();
    }
  }

  @Output() conditionsChange = new EventEmitter<DiagramJoinCondition[]>();
  @Output() diagramChange = new EventEmitter<DiagramOutput>();
  @Output() targetTableChange = new EventEmitter<string>();

  availableTables: DiagramTableNode[] = [];
  canvasNodes: any[] = [];
  canvasEdges: any[] = [];
  
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

  nodeCounter = 0;
  edgeCounter = 0;

  paletteItems: any[] = [];
  searchTerm = '';
  searchSubject = new Subject<string>();
  currentPage = 1;
  pageSize = 20;
  totalTables = 0;
  loadingPalette = false;

  constructor(private http: HttpClient) {
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
    if (this.initialTables.length > 0) {
      this.canvasNodes = [...this.initialTables];
      this.nodeCounter = this.canvasNodes.length;
      this.syncModel();
    }

    if (this.initialConditions.length > 0) {
      this.canvasEdges = this.initialConditions.map(c => ({
        id: c.id,
        source: this.getNodeIdByTableName(c.fromTable),
        target: this.getNodeIdByTableName(c.toTable),
        data: {
          sourceColumn: c.fromColumn,
          targetColumn: c.toColumn,
          operator: c.operator || '=',
        },
      }));
      this.edgeCounter = this.canvasEdges.length;
      this.syncModel();
    }

    if (this.availableTables.length === 0) {
      this.loadAvailableTables();
    }
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
            tableName: t.name,
            columns: t.columns,
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
      label: t.tableName,
      data: { label: t.tableName, tableName: t.tableName, columns: t.columns } as any,
    }));
  }

  getNodeIdByTableName(tableName: string): string {
    const node = this.canvasNodes.find(n => n.data?.tableName === tableName);
    return node?.id || tableName;
  }

  onPaletteItemDropped(event: any): void {
    const { item, position } = event;
    const nodeId = `node_${++this.nodeCounter}`;
    const node = {
      id: nodeId,
      position: { x: position.x - 150, y: position.y - 40 },
      data: {
        tableName: item.data.tableName,
        columns: item.data.columns,
      },
    };
    this.canvasNodes = [...this.canvasNodes, node];
    this.syncModel();
    this.emitChange();
  }

  onEdgeDrawn(event: any): void {
    const edge = event.edge;
    if (!edge.data) {
      edge.data = { sourceColumn: '', targetColumn: '', operator: '=' };
    }
    const edgeId = `edge_${++this.edgeCounter}`;
    const updatedEdge = { ...edge, id: edgeId };
    this.canvasEdges = [...this.canvasEdges, updatedEdge];
    this.syncModel();
    this.openEdgeSidebar(updatedEdge);
  }

  onEdgeSelected(edge: any): void {
    this.selectedEdgeId = edge.id;
    this.openEdgeSidebar(edge);
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
    const idx = this.canvasEdges.findIndex(e => e.id === this.sidebarEdge!.id);
    if (idx === -1) return;
    this.canvasEdges[idx] = {
      ...this.canvasEdges[idx],
      data: {
        sourceColumn: this.sidebarSourceColumn,
        targetColumn: this.sidebarTargetColumn,
        operator: this.sidebarOperator,
      },
    };
    this.syncModel();
    this.emitChange();
  }

  deleteSelectedEdge(): void {
    if (!this.selectedEdgeId) return;
    this.canvasEdges = this.canvasEdges.filter(e => e.id !== this.selectedEdgeId);
    this.sidebarOpen = false;
    this.sidebarEdge = null;
    this.selectedEdgeId = null;
    this.syncModel();
    this.emitChange();
  }

  deleteNode(nodeId: string): void {
    const node = this.canvasNodes.find(n => n.id === nodeId);
    if (node?.data?.tableName === this.targetTable) {
      this.setTargetTable('');
    }
    this.canvasNodes = this.canvasNodes.filter(n => n.id !== nodeId);
    this.canvasEdges = this.canvasEdges.filter(e => e.source !== nodeId && e.target !== nodeId);
    this.syncModel();
    this.emitChange();
  }

  setTargetTable(tableName: string): void {
    this.targetTable = tableName;
    this.targetTableChange.emit(tableName);
  }

  syncModel(): void {
    this.model = initializeModel({
      nodes: this.canvasNodes,
      edges: this.canvasEdges,
    });
  }

  calculateEdgePath(edge: any): string {
    if (!edge.source || !edge.target) return '';
    const sourceNode = this.canvasNodes.find(n => n.id === edge.source);
    const targetNode = this.canvasNodes.find(n => n.id === edge.target);
    if (!sourceNode || !targetNode) return '';
    return `M ${sourceNode.position.x} ${sourceNode.position.y} L ${targetNode.position.x} ${targetNode.position.y}`;
  }

  emitChange(): void {
    const conditions: DiagramJoinCondition[] = this.canvasEdges.map(e => ({
      id: e.id,
      fromTable: this.getNodeTableName(e.source),
      fromColumn: e.data?.sourceColumn || '',
      toTable: this.getNodeTableName(e.target),
      toColumn: e.data?.targetColumn || '',
      operator: e.data?.operator || '=',
    })).filter(c => c.fromColumn && c.toColumn);

    const output: DiagramOutput = {
      tables: this.canvasNodes.map(n => ({
        id: n.id,
        tableName: n.data.tableName,
        columns: n.data.columns,
        position: n.position,
      })),
      edges: this.canvasEdges.map(e => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceColumn: e.data?.sourceColumn || '',
        targetColumn: e.data?.targetColumn || '',
        operator: e.data?.operator || '=',
      })),
      conditions,
    };

    this.conditionsChange.emit(conditions);
    this.diagramChange.emit(output);
  }

  getNodeTableName(nodeId: string): string {
    const node = this.canvasNodes.find(n => n.id === nodeId);
    return node?.data?.tableName || nodeId;
  }

  getNodeColumns(nodeId: string): DiagramColumn[] {
    const node = this.canvasNodes.find(n => n.id === nodeId);
    return node?.data?.columns || [];
  }

  getEdgeSourceColumns(edge: any): DiagramColumn[] {
    return this.getNodeColumns(edge.source);
  }

  getEdgeTargetColumns(edge: any): DiagramColumn[] {
    return this.getNodeColumns(edge.target);
  }

  clearDiagram(): void {
    this.canvasNodes = [];
    this.canvasEdges = [];
    this.nodeCounter = 0;
    this.edgeCounter = 0;
    this.sidebarOpen = false;
    this.sidebarEdge = null;
    this.selectedEdgeId = null;
    this.setTargetTable('');
    this.syncModel();
    this.emitChange();
  }

  closeSidebar(): void {
    this.sidebarOpen = false;
    this.sidebarEdge = null;
    this.selectedEdgeId = null;
  }
}
