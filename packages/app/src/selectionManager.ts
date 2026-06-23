// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type IDisposable,
    type IDocument,
    type INode,
    type ISelection,
    ShapeTypes,
    Signal,
    VisualNode,
    type VisualShapeData,
    type VisualState,
    VisualStates,
} from "@chili3d/core";

export class SelectionManager implements ISelection, IDisposable {
    readonly onNodeChanged = new Signal<(selected: INode[]) => void>();
    readonly onShapeChanged = new Signal<(selected: VisualShapeData[]) => void>();

    private readonly selectedSet = new Set<INode>();
    private selectedShapeSet = [] as [VisualShapeData, VisualState][];

    constructor(readonly document: IDocument) {}

    setSelectedNodes(nodes: INode[], toggle: boolean): number {
        if (toggle) {
            const selected = nodes.filter((m) => this.selectedSet.has(m));
            const unSelected = nodes.filter((m) => !this.selectedSet.has(m));
            this.removeSelectedNodes(selected, false);
            this.addSelectedNode(unSelected, true);
        } else {
            this.removeSelectedNodes(this.selectedSet, false);
            this.addSelectedNode(nodes, true);
        }
        this.document.visual.update();
        return this.selectedSet.size;
    }

    getSelectedNodes(): INode[] {
        return Array.from(this.selectedSet);
    }

    getSelectedVisualNodes(): VisualNode[] {
        return Array.from(this.selectedSet.values().filter((x): x is VisualNode => x instanceof VisualNode));
    }

    getSelectedNodeLength(): number {
        return this.selectedSet.size;
    }

    setSelectedShapes(shapes: VisualShapeData[], selectedState: VisualState, toggle: boolean): number {
        if (toggle) {
            const shapeIds = shapes.map((x) => x.shape.id);
            const toRemove = this.selectedShapeSet.filter((x) => shapeIds.includes(x[0].shape.id));
            const removedShape = toRemove.map((x) => x[0].shape.id);
            const toAdd = shapes.filter((x) => !removedShape.includes(x.shape.id));
            this.removeSelectedShapes(toRemove, false);
            this.addSelectedShapes(toAdd, selectedState, true);
        } else {
            this.removeSelectedShapes(this.selectedShapeSet, false);
            this.addSelectedShapes(shapes, selectedState, true);
        }
        this.document.visual.update();
        return this.selectedShapeSet.length;
    }

    getSelectedShapes(): VisualShapeData[] {
        return Array.from(this.selectedShapeSet).map((x) => x[0]);
    }

    clearSelection(): void {
        this.removeSelectedNodes(this.selectedSet, this.selectedSet.size > 0);
        this.removeSelectedShapes(this.selectedShapeSet, this.selectedShapeSet.length > 0);
        this.selectedShapeSet.length = 0;
        this.selectedSet.clear();
        this.document.visual.update();
    }

    private addSelectedShapes(shapes: VisualShapeData[], selectedState: VisualState, publish: boolean) {
        for (const shape of shapes) {
            this.document.visual.highlighter.addState(
                shape.owner,
                selectedState,
                shape.shape.shapeType,
                ...shape.indexes,
            );
            this.selectedShapeSet.push([shape, selectedState]);
        }
        if (publish) this.onShapeChanged.emit(this.selectedShapeSet.map((x) => x[0]));
    }

    private removeSelectedShapes(selected: Array<[VisualShapeData, VisualState]>, publish: boolean): void {
        for (const [s, state] of selected) {
            this.document.visual.highlighter.removeState(s.owner, state, s.shape.shapeType, ...s.indexes);
        }
        this.selectedShapeSet = this.selectedShapeSet.filter((x) => !selected.includes(x));
        if (publish) this.onShapeChanged.emit(this.selectedShapeSet.map((x) => x[0]));
    }

    private addSelectedNode(nodes: INode[], publish: boolean): void {
        for (const node of nodes) {
            if (node instanceof VisualNode) {
                const visual = this.document.visual.context.getVisual(node);
                if (visual) {
                    this.document.visual.highlighter.addState(
                        visual,
                        VisualStates.edgeSelected,
                        ShapeTypes.shape,
                    );
                }
            }
            this.selectedSet.add(node);
        }
        if (publish) this.onNodeChanged.emit(Array.from(this.selectedSet));
    }

    private removeSelectedNodes(nodes: INode[] | Set<INode>, publish: boolean): void {
        for (const node of nodes) {
            if (node instanceof VisualNode) {
                const visual = this.document.visual.context.getVisual(node);
                if (visual) {
                    this.document.visual.highlighter.removeState(
                        visual,
                        VisualStates.edgeSelected,
                        ShapeTypes.shape,
                    );
                }
            }
            this.selectedSet.delete(node);
        }
        if (publish) this.onNodeChanged.emit(Array.from(this.selectedSet));
    }

    dispose(): void {
        this.clearSelection();
        this.onNodeChanged.dispose();
        this.onShapeChanged.dispose();
    }
}
