// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type I18nKeys,
    type IDocument,
    type IEdge,
    type INode,
    type IShape,
    type IShapeMeshData,
    isPropertyChanged,
    Matrix4,
    MultiShapeMesh,
    ParameterShapeNode,
    type Plane,
    Precision,
    Result,
    serializable,
    serialize,
} from "@chili3d/core";
import { allProfiles, sketchProfiles } from "../features/profileBuilder";
import { type PlaneFaceRef, resolveFacePlane } from "./planeRef";
import { arcAngles, type SketchData, type SketchEntityData, toWorld } from "./sketchModel";

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

    private _showProfileFaces = true;

    /**
     * Whether the mesh includes the closed profile faces so they can be hovered and
     * picked in the viewport (e.g. extrude profile selection). On outside sketch
     * editing; `SketchEditor` turns it off for the session so the faces don't get in
     * the way of editing geometry. Not serialized.
     */
    get showProfileFaces(): boolean {
        return this._showProfileFaces;
    }

    setShowProfileFaces(value: boolean): void {
        if (this._showProfileFaces === value) return;
        this._showProfileFaces = value;
        this._mesh = undefined;
        // The visual rebuilds its meshes on "shape" changes; the shape itself is untouched.
        this.emitPropertyChanged("shape", this._shape);
    }

    protected override createMesh(): IShapeMeshData {
        if (!this._showProfileFaces || !this.shape.isOk) return super.createMesh();
        const profiles = sketchProfiles(this);
        // Outer profiles come with holes applied; inner loops are shown as solid faces
        // so the hole region stays clickable (it selects the inner profile).
        const faces = profiles.isOk ? allProfiles(profiles.value) : [];
        if (faces.length === 0) return super.createMesh();
        const mesh = new MultiShapeMesh();
        mesh.addShape(this.shape.value, Matrix4.identity());
        for (const face of faces) {
            mesh.addShape(face, Matrix4.identity());
        }
        return mesh;
    }

    generateShape(): Result<IShape> {
        this.syncPlaneRefWatch();
        const edges: IEdge[] = [];
        for (const entity of this.data.entities) {
            const edge = this.entityEdge(entity);
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

    private entityEdge(entity: SketchEntityData): Result<IEdge> {
        const p = entity.params;
        switch (entity.type) {
            case "line":
                return shapeFactory.line(toWorld(this.plane, p[0], p[1]), toWorld(this.plane, p[2], p[3]));
            case "circle":
                return shapeFactory.circle(this.plane.normal, toWorld(this.plane, p[0], p[1]), p[2]);
            case "arc":
                return this.arcEdge(p as [number, number, number, number, number, number]);
        }
    }

    /** arc params = [cx, cy, sx, sy, ex, ey]; the end point only fixes the sweep angle. */
    private arcEdge(params: [number, number, number, number, number, number]): Result<IEdge> {
        const [cx, cy, sx, sy] = params;
        if (Math.hypot(sx - cx, sy - cy) < Precision.Distance) {
            return Result.err("Arc radius is too small");
        }
        const [, sweep] = arcAngles(params);
        if (Math.abs(sweep - Math.PI * 2) < Precision.Angle) {
            return Result.err("Arc sweep angle is too small");
        }
        return shapeFactory.arc(
            this.plane.normal,
            toWorld(this.plane, cx, cy),
            toWorld(this.plane, sx, sy),
            (sweep * 180) / Math.PI,
        );
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
