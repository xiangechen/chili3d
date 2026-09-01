// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type I18nKeys,
    type IDocument,
    type IEdge,
    type INode,
    type IShape,
    isPropertyChanged,
    ParameterShapeNode,
    type Plane,
    Result,
    serializable,
    serialize,
} from "@chili3d/core";
import { type PlaneFaceRef, resolveFacePlane } from "./planeRef";
import { type SketchData, toWorld } from "./sketchModel";

export interface SketchNodeOptions {
    document: IDocument;
    plane: Plane;
    /** Present when the plane was captured from a solid's face; the sketch follows that face. */
    planeRef?: PlaneFaceRef;
    /** Serialized form produced by the Serializer; takes precedence over `planeRef`. */
    planeRefJson?: string;
    data?: SketchData;
    /** Serialized form produced by the Serializer; takes precedence over `data`. */
    dataJson?: string;
    id?: string;
}

@serializable()
export class SketchNode extends ParameterShapeNode {
    override display(): I18nKeys {
        return "body.sketch";
    }

    @serialize()
    get plane(): Plane {
        return this.getPrivateValue("plane");
    }
    /** Undo/redo assigns through the property (PropertyHistoryRecord), so a setter is required. */
    set plane(value: Plane) {
        this.setPropertyEmitShapeChanged("plane", value);
    }

    /**
     * PlaneFaceRef is a plain JSON object graph; the Serializer only round-trips
     * @serializable classes, so it is stored as a JSON string like dataJson.
     */
    @serialize()
    get planeRefJson(): string | undefined {
        return this.getPrivateValue("planeRefJson");
    }

    get planeRef(): PlaneFaceRef | undefined {
        const json = this.planeRefJson;
        return json === undefined ? undefined : (JSON.parse(json) as PlaneFaceRef);
    }

    /**
     * SketchData is a plain JSON object graph; the Serializer only round-trips
     * @serializable classes, so it is stored as a JSON string.
     */
    @serialize()
    get dataJson(): string {
        return this.getPrivateValue("dataJson");
    }
    /** Undo/redo assigns through the property (PropertyHistoryRecord), so a setter is required. */
    set dataJson(value: string) {
        this.setPropertyEmitShapeChanged("dataJson", value);
    }

    get data(): SketchData {
        return JSON.parse(this.dataJson) as SketchData;
    }

    private _planeRefNode: INode | undefined;

    constructor(options: SketchNodeOptions) {
        super({ document: options.document, id: options.id });
        this.setPrivateValue("plane", options.plane);
        this.setPrivateValue(
            "planeRefJson",
            options.planeRefJson ??
                (options.planeRef === undefined ? undefined : JSON.stringify(options.planeRef)),
        );
        this.setPrivateValue(
            "dataJson",
            options.dataJson ?? JSON.stringify(options.data ?? { entities: [], constraints: [] }),
        );
    }

    setDataEmitShapeChanged(data: SketchData): void {
        this.setPropertyEmitShapeChanged("dataJson", JSON.stringify(data));
    }

    generateShape(): Result<IShape> {
        this.syncPlaneRefWatch();
        const edges: IEdge[] = [];
        for (const entity of this.data.entities) {
            const edge =
                entity.type === "line"
                    ? shapeFactory.line(
                          toWorld(this.plane, entity.params[0], entity.params[1]),
                          toWorld(this.plane, entity.params[2], entity.params[3]),
                      )
                    : shapeFactory.circle(
                          this.plane.normal,
                          toWorld(this.plane, entity.params[0], entity.params[1]),
                          entity.params[2],
                      );
            if (!edge.isOk) return edge;
            edges.push(edge.value);
        }
        // A sketch is a set of possibly disjoint entities; a wire requires connected
        // edges (shapeFactory.wire fails with DisconnectedWire otherwise), so entities
        // are combined into a compound — empty when every entity was deleted, which
        // keeps the visual in sync instead of leaving a stale ghost behind.
        // Use convert.toWire/toFace downstream when a closed profile is needed.
        if (edges.length === 1) {
            return Result.ok(edges[0]);
        }
        return shapeFactory.combine(edges);
    }

    /** Watches the node the plane reference points at; unresolved ids are retried next evaluation. */
    private syncPlaneRefWatch(): void {
        const ref = this.planeRef;
        const node =
            ref === undefined ? undefined : this.document.modelManager.findNode((n) => n.id === ref.nodeId);
        if (node === this._planeRefNode) return;
        if (this._planeRefNode !== undefined && isPropertyChanged(this._planeRefNode)) {
            this._planeRefNode.removePropertyChanged(this.handlePlaneRefNodeChanged);
        }
        this._planeRefNode = node;
        if (node !== undefined && isPropertyChanged(node)) {
            node.onPropertyChanged(this.handlePlaneRefNodeChanged);
        }
    }

    /** Follows the referenced face: a source rebuild moves the sketch plane with it. */
    private readonly handlePlaneRefNodeChanged = (property: string) => {
        if (property !== "shape") return;
        const ref = this.planeRef;
        if (ref === undefined) return;
        // The face can be gone mid-rebuild; keep the last plane then.
        const plane = resolveFacePlane(this.document, ref);
        if (plane === undefined || this.isSamePlane(plane)) return;
        this.plane = plane;
    };

    private isSamePlane(plane: Plane): boolean {
        return plane.origin.isEqualTo(this.plane.origin) && plane.normal.isEqualTo(this.plane.normal);
    }

    override disposeInternal(): void {
        if (this._planeRefNode !== undefined && isPropertyChanged(this._planeRefNode)) {
            this._planeRefNode.removePropertyChanged(this.handlePlaneRefNodeChanged);
        }
        this._planeRefNode = undefined;
        super.disposeInternal();
    }
}
