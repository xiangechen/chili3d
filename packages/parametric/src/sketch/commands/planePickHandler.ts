// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type AsyncController,
    PlanePickHandler as BasePlanePickHandler,
    DATUM_HOVER_OPACITY,
    DATUM_OPACITY,
    type DatumPickResult,
    type DatumPlaneSpec,
    type FacePickResult,
    type IDocument,
    type IFace,
    type IView,
    type Plane,
    quadAt,
    type Ray,
    type VisualShapeData,
    type XYZ,
} from "@chili3d/core";
import { isBodyTrackingNode } from "../../features/bodyTracking";
import type { NeutralPlaneRef } from "../../features/feature";
import { reportSilentIdLoss } from "../../features/idDiagnostics";
import { isPlaneNode } from "../../plane/planeNodeContract";
import { captureFaceRef, type DatumPlaneName, datumPlaneOf, planeOfFace } from "../planeRef";

export type PlanePickResult =
    | (FacePickResult & { point: XYZ })
    | (DatumPickResult & { name: DatumPlaneName })
    | { kind: "planeNode"; plane: Plane; nodeId: string; point?: XYZ };

const PLANE_NODE_COLOR = 0x6c9ce0;
const PLANE_NODE_HIGHLIGHT_COLOR = 0x9ac4ff;

interface PlaneNodeQuad {
    readonly meshId: number;
    readonly nodeId: string;
    readonly plane: Plane;
    readonly displayPlane: Plane;
    readonly center: XYZ;
    readonly width: number;
    readonly height: number;
}

export interface PickedNeutralPlane {
    readonly ref: NeutralPlaneRef;
    readonly plane: Plane;
    readonly anchor: XYZ;
}

export function captureNeutralPlane(
    document: IDocument,
    result: PlanePickResult,
): PickedNeutralPlane | undefined {
    if (result.kind === "datum") {
        const plane = datumPlaneOf(result.name);
        return {
            ref: { kind: "datum", name: result.name },
            plane,
            anchor: result.point ?? plane.origin,
        };
    }
    if (result.kind === "planeNode") {
        return {
            ref: { kind: "planeNode", nodeId: result.nodeId },
            plane: result.plane,
            anchor: result.point ?? result.plane.origin,
        };
    }
    const owner = document.visual.context.getNode(result.data.owner);
    if (owner === undefined) return undefined;
    const worldFace = result.data.shape.transformedMul(result.data.transform) as IFace;
    try {
        const ref = captureFaceRef(owner.id, worldFace);
        if (isBodyTrackingNode(owner)) {
            const faceId = owner.faceIdAt(result.data.indexes[0]);
            if (faceId === undefined) {
                reportSilentIdLoss(owner, "face", "a picked plane face has no tracked id");
            } else {
                ref.faceId = faceId;
            }
        }
        return { ref: { kind: "face", ref }, plane: planeOfFace(worldFace), anchor: result.point };
    } finally {
        worldFace.dispose();
    }
}

function facePlanePoint(data: VisualShapeData, view: IView, event: PointerEvent): XYZ | undefined {
    const world = data.shape.transformedMul(data.transform) as IFace;
    try {
        if (!world.surface().isPlanar()) return data.point;
        return planeOfFace(world).intersectRay(view.rayAt(event.offsetX, event.offsetY));
    } finally {
        world.dispose();
    }
}

export class PlanePickHandler extends BasePlanePickHandler<PlanePickResult> {
    private readonly _planeNodeQuads: PlaneNodeQuad[] = [];
    private _hoveredPlaneNode = -1;

    constructor(document: IDocument, controller: AsyncController, allowCurved = false) {
        super(document, controller, { allowCurved, excludeReferenceGeometry: true });
        const context = document.visual.context;
        const planeNodes = document.modelManager
            .findNodes((candidate) => isPlaneNode(candidate) && candidate.visible && candidate.parentVisible)
            .filter(isPlaneNode);
        for (const node of planeNodes) {
            const plane = node.worldPlane();
            const display = node.displayQuad();
            if (plane === undefined || display === undefined) continue;
            const id = context.displayMesh(
                [quadAt(display.plane, display.center, display.width, display.height)],
                { meshOpacity: DATUM_OPACITY, onTop: true },
            );
            context.setMeshColor(id, PLANE_NODE_COLOR);
            this._planeNodeQuads.push({
                meshId: id,
                nodeId: node.id,
                plane,
                displayPlane: display.plane,
                center: display.center,
                width: display.width,
                height: display.height,
            });
        }
    }

    protected createDatumResult(datum: DatumPlaneSpec, ray: Ray): PlanePickResult {
        return {
            kind: "datum",
            plane: datum.plane,
            name: datum.name,
            point: datum.plane.intersectRay(ray),
        };
    }

    protected createFaceResult(
        face: VisualShapeData,
        view: IView,
        event: PointerEvent,
    ): PlanePickResult | undefined {
        const point = facePlanePoint(face, view, event);
        return point === undefined ? undefined : { kind: "face", data: face, point };
    }

    protected override setHighlight(view: IView, event: PointerEvent): void {
        const ray = view.rayAt(event.offsetX, event.offsetY);
        const hoveredDatum = this.detectDatum(ray);
        const hoveredPlaneNode = hoveredDatum >= 0 ? -1 : this.detectPlaneNode(ray);
        if (hoveredDatum >= 0 || hoveredPlaneNode >= 0) this.cleanHighlights();
        else super.setHighlight(view, event);
        this.setHoveredDatum(view, hoveredDatum);
        this.setHoveredPlaneNode(view, hoveredPlaneNode);
    }

    override pointerOut(view: IView, event: PointerEvent): void {
        super.pointerOut(view, event);
        this.setHoveredPlaneNode(view, -1);
    }

    private detectPlaneNode(ray: Ray): number {
        return this._planeNodeQuads.findIndex((quad) => {
            const hit = quad.displayPlane.intersectRay(ray);
            if (hit === undefined) return false;
            const offset = hit.sub(quad.center);
            return (
                Math.abs(offset.dot(quad.displayPlane.xvec)) <= quad.width / 2 &&
                Math.abs(offset.dot(quad.displayPlane.yvec)) <= quad.height / 2
            );
        });
    }

    private setHoveredPlaneNode(view: IView, index: number): void {
        if (index === this._hoveredPlaneNode) return;
        this._hoveredPlaneNode = index;
        const context = this.document.visual.context;
        this._planeNodeQuads.forEach((quad, i) => {
            const hovered = i === index;
            context.setMeshColor(quad.meshId, hovered ? PLANE_NODE_HIGHLIGHT_COLOR : PLANE_NODE_COLOR);
            context.setMeshOpacity(quad.meshId, hovered ? DATUM_HOVER_OPACITY : DATUM_OPACITY);
        });
        view.update();
    }

    protected override select(view: IView, event: PointerEvent): number {
        if (this._hoveredPlaneNode >= 0) {
            const ray = view.rayAt(event.offsetX, event.offsetY);
            const quad = this._planeNodeQuads[this._hoveredPlaneNode];
            this.result = {
                kind: "planeNode",
                plane: quad.plane,
                nodeId: quad.nodeId,
                point: quad.displayPlane.intersectRay(ray),
            };
            return 1;
        }
        return super.select(view, event);
    }

    protected override disposeInternal(): void {
        super.disposeInternal();
        const context = this.document.visual.context;
        this._planeNodeQuads.forEach((quad) => {
            context.removeMesh(quad.meshId);
        });
        this._planeNodeQuads.length = 0;
    }
}
