// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type AsyncController,
    type IDocument,
    type IFace,
    type IView,
    isReferenceGeometryNode,
    type Plane,
    type Ray,
    ShapeSelectionHandler,
    ShapeTypes,
    type VisualShapeData,
    VisualStates,
    type XYZ,
} from "@chili3d/core";
import { isBodyTrackingNode } from "../../features/bodyTracking";
import type { NeutralPlaneRef } from "../../features/feature";
import { reportSilentIdLoss } from "../../features/idDiagnostics";
import { isPlaneNode } from "../../plane/planeNodeContract";
import {
    captureFaceRef,
    DATUM_PLANE_NAMES,
    type DatumPlaneName,
    datumDisplayPlane,
    datumPlaneOf,
    planeOfFace,
} from "../planeRef";
import {
    DATUM_COLORS,
    DATUM_GAP,
    DATUM_HIGHLIGHT_COLORS,
    DATUM_HOVER_OPACITY,
    DATUM_OPACITY,
    DATUM_SIZE,
    datumQuad,
    quadAt,
} from "./planePreview";

/**
 * Sketch planes returned on a datum pick, oriented Z-up (see `sketchPlaneOfFace`).
 * Index-parallel with DATUM_DISPLAY_PLANES: one quad is shown per entry.
 */
const DATUM_PLANES: ReadonlyArray<{ name: DatumPlaneName; plane: Plane }> = DATUM_PLANE_NAMES.map((name) => ({
    name,
    plane: datumPlaneOf(name),
}));

/** Display frames for the datum quads, in name order — see `datumDisplayPlane`. */
const DATUM_DISPLAY_PLANES = DATUM_PLANE_NAMES.map(datumDisplayPlane);

export type PlanePickResult =
    /**
     * `point` is where the pointer met the face's plane — the point the user clicked,
     * which the offset preview centres on.
     */
    | { kind: "face"; data: VisualShapeData; point: XYZ }
    /** `point` is where the ray met the datum's quad; the offset preview centres on it. */
    | { kind: "datum"; plane: Plane; name: DatumPlaneName; point?: XYZ }
    /** A user-created datum plane, named by node so editing it moves every reference. */
    | { kind: "planeNode"; plane: Plane; nodeId: string; point?: XYZ };

const PLANE_NODE_COLOR = 0x6c9ce0;
const PLANE_NODE_HIGHLIGHT_COLOR = 0x9ac4ff;

interface PlaneNodeQuad {
    readonly meshId: number;
    readonly nodeId: string;
    /** The plane a reference stores: the node's authoritative frame, not the display frame. */
    readonly plane: Plane;
    /** Where the node's visible square is drawn; the picker's quad and hit test match it. */
    readonly displayPlane: Plane;
    readonly center: XYZ;
    readonly width: number;
    readonly height: number;
}

/** What a plane pick captured: the stored reference, plus the plane it resolved to. */
export interface PickedNeutralPlane {
    readonly ref: NeutralPlaneRef;
    /** The plane in WORLD coordinates — what has to be mapped into the body before the kernel sees it. */
    readonly plane: Plane;
    /** A point of the plane near what was picked; where a datum plane draws its square. */
    readonly anchor: XYZ;
}

/**
 * The picked plane as a feature stores it and as the kernel consumes it. A datum needs nothing
 * more than its name — the three never move — while a face is captured in world coordinates as
 * `PlaneFaceRef`, with the owner's tracked face id when it has one so a rebuild re-matches it
 * exactly instead of geometrically.
 */
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
                // Not fatal: the ref keeps its geometric fingerprint and re-matches on that. The
                // report is what turns a silently weaker reference into a visible one.
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

/**
 * Where the ray meets the picked face's plane. A planar face lies in that plane, so this
 * is the point the pointer was over. Undefined only for a ray parallel to the plane — a
 * grazing hit, since this picker is single-mode and so never sweeps a rect.
 */
function facePlanePoint(data: VisualShapeData, view: IView, event: PointerEvent): XYZ | undefined {
    const world = data.shape.transformedMul(data.transform) as IFace;
    try {
        return planeOfFace(world).intersectRay(view.rayAt(event.offsetX, event.offsetY));
    } finally {
        world.dispose();
    }
}

/**
 * Picks the sketch base plane directly in the viewport: a planar face of a
 * solid takes precedence, otherwise one of the three translucent datum quads
 * shown while the handler is active.
 */
export class PlanePickHandler extends ShapeSelectionHandler {
    result: PlanePickResult | undefined;

    private readonly _datumMeshIds: number[] = [];
    private _hoveredDatum = -1;
    private readonly _planeNodeQuads: PlaneNodeQuad[] = [];
    private _hoveredPlaneNode = -1;

    constructor(document: IDocument, controller: AsyncController) {
        super(
            document,
            ShapeTypes.face,
            false,
            controller,
            { allow: (shape) => (shape as IFace).surface().isPlanar() },
            // A datum plane's own display rectangle is derived geometry: clicking it must
            // pick the PLANE (the quad below), never capture its rectangle as a face ref.
            { allow: (node) => !isReferenceGeometryNode(node) },
        );
        this.highlightState = VisualStates.faceHighlight;
        const context = document.visual.context;
        DATUM_DISPLAY_PLANES.forEach((plane, i) => {
            // On top: the quads are the only way to reach a datum plane, so a body in
            // front of one must not put it out of reach. Picking follows the drawing
            // (see `setHighlight`), so what is shown is also what is hit.
            const id = context.displayMesh([datumQuad(plane)], {
                meshOpacity: DATUM_OPACITY,
                onTop: true,
            });
            context.setMeshColor(id, DATUM_COLORS[DATUM_PLANES[i].name]);
            this._datumMeshIds.push(id);
        });
        // User-created planes get the same treatment: a quad on top is reachable even when
        // the plane's own (possibly half-transparent) face is behind a solid.
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

    protected override setHighlight(view: IView, event: PointerEvent): void {
        const ray = view.rayAt(event.offsetX, event.offsetY);
        const hoveredDatum = this.detectDatum(ray);
        const hoveredPlaneNode = hoveredDatum >= 0 ? -1 : this.detectPlaneNode(ray);
        if (hoveredDatum >= 0 || hoveredPlaneNode >= 0) {
            // Drawing and picking stay in step: a quad under the pointer wins over the
            // face behind it, so the face highlight has to come down.
            this.cleanHighlights();
        } else {
            super.setHighlight(view, event);
        }
        this.setHoveredDatum(view, hoveredDatum);
        this.setHoveredPlaneNode(view, hoveredPlaneNode);
    }

    override pointerOut(view: IView, event: PointerEvent): void {
        super.pointerOut(view, event);
        this.setHoveredDatum(view, -1);
        this.setHoveredPlaneNode(view, -1);
    }

    private detectDatum(ray: Ray): number {
        return DATUM_DISPLAY_PLANES.findIndex((plane) => {
            const hit = plane.intersectRay(ray);
            if (hit === undefined) return false;
            const vec = hit.sub(plane.origin);
            const inRange = (v: number) => v >= DATUM_GAP && v <= DATUM_GAP + DATUM_SIZE;
            return inRange(vec.dot(plane.xvec)) && inRange(vec.dot(plane.yvec));
        });
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

    private setHoveredDatum(view: IView, index: number): void {
        if (index === this._hoveredDatum) return;
        this._hoveredDatum = index;
        const context = this.document.visual.context;
        // Two cues at once: the quad comes up to solid and brightens. The opacity is
        // what carries the change — at 0.25 the hue alone barely moves the pixel.
        this._datumMeshIds.forEach((id, i) => {
            const hovered = i === index;
            const name = DATUM_PLANES[i].name;
            context.setMeshColor(id, (hovered ? DATUM_HIGHLIGHT_COLORS : DATUM_COLORS)[name]);
            context.setMeshOpacity(id, hovered ? DATUM_HOVER_OPACITY : DATUM_OPACITY);
        });
        view.update();
    }

    protected override select(view: IView, event: PointerEvent): number {
        // A hovered datum wins: the quads draw on top, so the pointer over one is
        // aiming at it, not at the face the ray would otherwise hit first.
        const ray = view.rayAt(event.offsetX, event.offsetY);
        if (this._hoveredDatum >= 0) {
            const datum = DATUM_PLANES[this._hoveredDatum];
            this.result = {
                kind: "datum",
                plane: datum.plane,
                name: datum.name,
                point: datum.plane.intersectRay(ray),
            };
            return 1;
        }
        if (this._hoveredPlaneNode >= 0) {
            const quad = this._planeNodeQuads[this._hoveredPlaneNode];
            this.result = {
                kind: "planeNode",
                plane: quad.plane,
                nodeId: quad.nodeId,
                point: quad.displayPlane.intersectRay(ray),
            };
            return 1;
        }
        const face = this._highlights?.[0];
        const point = face === undefined ? undefined : facePlanePoint(face, view, event);
        if (face === undefined || point === undefined) return 0;
        this.result = { kind: "face", data: face, point };
        return 1;
    }

    protected override highlightNext(_view: IView): void {
        // no cycling: at most one face is highlighted
    }

    protected override disposeInternal(): void {
        super.disposeInternal();
        const context = this.document.visual.context;
        this._datumMeshIds.forEach((id) => {
            context.removeMesh(id);
        });
        this._datumMeshIds.length = 0;
        this._planeNodeQuads.forEach((quad) => {
            context.removeMesh(quad.meshId);
        });
        this._planeNodeQuads.length = 0;
    }
}
