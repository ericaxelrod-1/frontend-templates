import { Component, Input, Output, EventEmitter, OnInit, OnDestroy, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { NgDiagramComponent, NgDiagramPaletteItemComponent, NgDiagramPaletteItemPreviewComponent, NgDiagramPortComponent, NgDiagramBaseEdgeComponent, provideNgDiagram, initializeModel, NgDiagramService } from 'ng-diagram';
import { environment } from '../../../environments/environment';

export interface DiagramTableNode {
  id: string;
  tableName: string;
  columns: DiagramColumn[];
  position?: { x: number; y: number };
}

export interface DiagramColumn {
  name: string;
  dataType: string;
  isPrimaryKey?: boolean;
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

  @Output() conditionsChange = new EventEmitter<DiagramJoinCondition[]>();
  @Output() diagramChange = new EventEmitter<DiagramOutput>();

  availableTables: DiagramTableNode[] = [];
  canvasNodes: any[] = [];
  canvasEdges: any[] = [];
  model: any;

  selectedEdgeId: string | null = null;
  selectedEdge: DiagramEdge | null = null;

  sidebarOpen = false;
  sidebarEdge: DiagramEdge | null = null;
  sidebarSourceColumn = '';
  sidebarTargetColumn = '';
  sidebarOperator = '=';

  nodeCounter = 0;
  edgeCounter = 0;

  paletteItems: { label: string; data: DiagramTableNode }[] = [];

  private ngDiagramService: NgDiagramService | null = null;

  constructor(private http: HttpClient) {}

  ngOnInit(): void {
    this.model = initializeModel({
      nodes: [],
      edges: [],
    });

    if (this.initialTables.length > 0) {
      this.canvasNodes = this.initialTables.map(t => ({
        id: t.id,
        position: t.position || { x: 100 + this.nodeCounter * 300, y: 100 },
        data: { tableName: t.tableName, columns: t.columns },
      }));
      this.nodeCounter = this.canvasNodes.length;
      this.syncModel();
    }

    if (this.initialConditions.length > 0) {
      this.canvasEdges = this.initialConditions.map(c => ({
        id: c.id,
        source: c.fromTable,
        target: c.toTable,
        data: {
          sourceColumn: c.fromColumn,
          targetColumn: c.toColumn,
          operator: c.operator || '=',
        },
      }));
      this.edgeCounter = this.canvasEdges.length;
      this.syncModel();
    }

    this.loadAvailableTables();
  }

  ngOnDestroy(): void {}

  loadAvailableTables(): void {
    this.http.get<{ tables: { name: string; columns: DiagramColumn[] }[] }>(`${environment.apiUrl}/schema/tables`)
      .subscribe({
        next: (response) => {
          this.availableTables = response.tables.map(t => ({
            id: t.name,
            tableName: t.name,
            columns: t.columns,
          }));
          this.paletteItems = this.availableTables.map(t => ({
            label: t.tableName,
            data: t,
          }));
        },
        error: () => {
          this.availableTables = [
            { id: 'users', tableName: 'users', columns: [
              { name: 'id', dataType: 'integer', isPrimaryKey: true },
              { name: 'email', dataType: 'string' },
              { name: 'group_id', dataType: 'integer', isForeignKey: true },
              { name: 'created_at', dataType: 'timestamp' },
            ]},
            { id: 'groups', tableName: 'groups', columns: [
              { name: 'id', dataType: 'integer', isPrimaryKey: true },
              { name: 'name', dataType: 'string' },
              { name: 'owner_id', dataType: 'integer', isForeignKey: true },
              { name: 'created_at', dataType: 'timestamp' },
            ]},
            { id: 'orders', tableName: 'orders', columns: [
              { name: 'id', dataType: 'integer', isPrimaryKey: true },
              { name: 'user_id', dataType: 'integer', isForeignKey: true },
              { name: 'total', dataType: 'decimal' },
              { name: 'status', dataType: 'string' },
              { name: 'created_at', dataType: 'timestamp' },
            ]},
            { id: 'products', tableName: 'products', columns: [
              { name: 'id', dataType: 'integer', isPrimaryKey: true },
              { name: 'name', dataType: 'string' },
              { name: 'price', dataType: 'decimal' },
              { name: 'category_id', dataType: 'integer', isForeignKey: true },
            ]},
            { id: 'categories', tableName: 'categories', columns: [
              { name: 'id', dataType: 'integer', isPrimaryKey: true },
              { name: 'name', dataType: 'string' },
              { name: 'parent_id', dataType: 'integer', isForeignKey: true },
            ]},
            { id: 'order_items', tableName: 'order_items', columns: [
              { name: 'id', dataType: 'integer', isPrimaryKey: true },
              { name: 'order_id', dataType: 'integer', isForeignKey: true },
              { name: 'product_id', dataType: 'integer', isForeignKey: true },
              { name: 'quantity', dataType: 'integer' },
              { name: 'price', dataType: 'decimal' },
            ]},
          ];
          this.paletteItems = this.availableTables.map(t => ({
            label: t.tableName,
            data: t,
          }));
        }
      });
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
    const existing = this.canvasEdges.find(e => e.id === edge.id);
    if (existing) {
      const idx = this.canvasEdges.indexOf(existing);
      this.canvasEdges[idx] = updatedEdge;
    } else {
      this.canvasEdges = [...this.canvasEdges, updatedEdge];
    }
    this.syncModel();
    this.openEdgeSidebar(updatedEdge);
  }

  onNodeSelected(event: any): void {
    this.selectedEdgeId = null;
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
    this.canvasNodes = this.canvasNodes.filter(n => n.id !== nodeId);
    this.canvasEdges = this.canvasEdges.filter(e => e.source !== nodeId && e.target !== nodeId);
    this.syncModel();
    this.emitChange();
  }

  syncModel(): void {
    this.model = initializeModel({
      nodes: this.canvasNodes,
      edges: this.canvasEdges,
    });
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

  get outputJson(): string {
    const conditions: DiagramJoinCondition[] = this.canvasEdges.map(e => ({
      id: e.id,
      fromTable: this.getNodeTableName(e.source),
      fromColumn: e.data?.sourceColumn || '',
      toTable: this.getNodeTableName(e.target),
      toColumn: e.data?.targetColumn || '',
      operator: e.data?.operator || '=',
    })).filter(c => c.fromColumn && c.toColumn);

    return JSON.stringify(conditions, null, 2);
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
    this.syncModel();
    this.emitChange();
  }

  closeSidebar(): void {
    this.sidebarOpen = false;
    this.sidebarEdge = null;
    this.selectedEdgeId = null;
  }
}
