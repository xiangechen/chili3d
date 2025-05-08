// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { IView, VisualShapeData, VisualState, XYZ } from "chili-core";
import { ISnap, MouseAndDetected, SnapResult } from "../snap";

export abstract class BaseSnap implements ISnap {
    protected _tempMeshIds: Map<IView, number[]> = new Map();
    protected _highlightedShapes: VisualShapeData[] = [];

    constructor(readonly referencePoint?: () => XYZ) {}

    abstract snap(data: MouseAndDetected): SnapResult | undefined;

    removeDynamicObject(): void {
        this.clearTempMeshes();
        this.unhighlight();
    }

    clear(): void {
        this.removeDynamicObject();
    }

    protected clearTempMeshes(): void {
        this._tempMeshIds.forEach((ids, view) => {
            ids.forEach((id) => view.document.visual.context.removeMesh(id));
        });
        this._tempMeshIds.clear();
    }

    protected addTempMesh(view: IView, meshId: number): void {
        let ids = this._tempMeshIds.get(view);
        if (!ids) {
            ids = [];
            this._tempMeshIds.set(view, ids);
        }
        ids.push(meshId);
    }

    protected highlight(shapes: VisualShapeData[]): void {
        shapes.forEach((shape) => {
            const highlighter = shape.owner.node.document.visual.highlighter;
            highlighter.addState(
                shape.owner,
                VisualState.edgeHighlight,
                shape.shape.shapeType,
                ...shape.indexes,
            );
        });
        this._highlightedShapes.push(...shapes);
    }

    protected unhighlight(): void {
        this._highlightedShapes.forEach((shape) => {
            const highlighter = shape.owner.node.document.visual.highlighter;
            highlighter.removeState(
                shape.owner,
                VisualState.edgeHighlight,
                shape.shape.shapeType,
                ...shape.indexes,
            );
        });
        this._highlightedShapes.length = 0;
    }

    protected calculateDistance(point: XYZ): number | undefined {
        return this.referencePoint ? this.referencePoint().distanceTo(point) : undefined;
    }
}
