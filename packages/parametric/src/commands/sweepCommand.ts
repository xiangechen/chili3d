// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    BoundingBox,
    Combobox,
    command,
    type I18nKeys,
    Id,
    type IEdge,
    type IFace,
    type IShape,
    type IStep,
    Matrix4,
    MultistepCommand,
    property,
    SelectShapeStep,
    type ShapeNode,
    ShapeTypes,
    Transaction,
    type VisualShapeData,
    VisualStates,
} from "@chili3d/core";
import { isBodyTrackingNode } from "../features/bodyTracking";
import { captureEdgeRef, type EdgeRef } from "../features/edgeRef";
import type { BooleanOperation, SweepFeatureData } from "../features/feature";
import { reportSilentIdLoss } from "../features/idDiagnostics";
import { sketchProfiles } from "../features/profileBuilder";
import { captureProfileRef } from "../features/profileRef";
import { ParametricBodyNode } from "../parametricBodyNode";
import { SketchNode } from "../sketch/sketchNode";
import { SelectSketchProfilesStep } from "./extrudeCommand";

const OPERATION_NEW: I18nKeys = "option.command.operation.new";

/** Maps the command's operation dropdown values to boolean operations; new has none. */
const SWEEP_OPERATIONS: Record<string, BooleanOperation> = {
    "option.command.operation.join": "fuse",
    "option.command.operation.cut": "cut",
    "option.command.operation.intersect": "common",
};

/**
 * Creates a sweep feature: pick sketch profiles or planar faces of a parametric body
 * (step 1), then the path edges (step 2, multiple — they must connect into one wire).
 * The committed body replays the feature through `shapeFactory.sweep`; both the
 * profiles (body faces as world-coordinate fingerprints with their tracked ids — the
 * extrude command's `source` contract) and the path (fingerprinted edge references,
 * node-local) are live references, so editing either source moves the sweep.
 *
 * Join/cut/intersect appends the feature to the auto-detected intersecting body
 * (Fusion-style, see the extrude command); "new" creates a standalone body.
 */
@command({ key: "feature.sweep", icon: "icon-sweep" })
export class SweepFeatureCommand extends MultistepCommand {
    @property("option.command.operation", {
        combobox: Combobox.from([
            OPERATION_NEW,
            "option.command.operation.join",
            "option.command.operation.cut",
            "option.command.operation.intersect",
        ] satisfies I18nKeys[]),
    })
    get operation(): I18nKeys {
        return this.getPrivateValue("operation", OPERATION_NEW);
    }
    set operation(value: I18nKeys) {
        this.setProperty("operation", value);
    }

    @property("option.command.isRoundCorner")
    get isRoundCorner(): boolean {
        return this.getPrivateValue("isRoundCorner", false);
    }
    set isRoundCorner(value: boolean) {
        this.setProperty("isRoundCorner", value);
    }

    private get sourceNode(): SketchNode | ParametricBodyNode {
        return this.stepDatas[0].nodes![0] as unknown as SketchNode | ParametricBodyNode;
    }

    protected override getSteps(): IStep[] {
        return [
            new SelectSketchProfilesStep(),
            new SelectShapeStep(ShapeTypes.edge, "prompt.select.path", {
                multiple: true,
                keepSelection: false,
                highlightState: VisualStates.edgeHighlight,
                selectedState: VisualStates.edgeSelected,
            }),
        ];
    }

    protected override executeMainTask(): void {
        const node = this.sourceNode;
        const feature = this.buildFeature();
        const operation = SWEEP_OPERATIONS[this.operation];
        const target = operation === undefined ? undefined : this.findIntersectingBody();
        Transaction.execute(this.document, "execute feature.sweep", () => {
            if (operation !== undefined && target !== undefined) {
                target.setFeaturesEmitShapeChanged([...target.features, { ...feature, operation }]);
            } else {
                this.document.modelManager.addNode(
                    new ParametricBodyNode({ document: this.document, features: [feature] }),
                );
            }
            // A sketch is consumed by the feature; hide it. Same transaction, so undo
            // restores the visibility together with the body. A source body and the
            // path source stay visible — editing them re-matches and moves the sweep.
            if (node instanceof SketchNode) node.visible = false;
            this.document.visual.update();
        });
    }

    private buildFeature(): SweepFeatureData {
        const node = this.sourceNode;
        const base = {
            id: Id.generate(),
            type: "sweep" as const,
            isRoundCorner: this.isRoundCorner,
            path: this.pathRef(),
        };
        if (node instanceof SketchNode) {
            // Picked profile faces are fingerprinted (undefined sweeps the whole sketch).
            const faces = this.stepDatas[0].shapes.map((x) => x.shape as unknown as IFace);
            return {
                ...base,
                sketchId: node.id,
                ...(faces.length > 0 ? { profiles: faces.map((face) => captureProfileRef(face)) } : {}),
            };
        }
        // Body faces: fingerprinted in world coordinates and paired with the picked
        // face's tracked id, so rebuilds re-match by identity, not geometry (the
        // extrude command's press-pull contract).
        const owned: IFace[] = [];
        try {
            const profiles = this.stepDatas[0].shapes.map((data) => {
                const face = SweepFeatureCommand.worldFace(data, owned);
                const faceId = node.faceIdAt(data.indexes[0]);
                if (faceId === undefined) {
                    reportSilentIdLoss(node, "face", "a sweep profile face has no tracked id");
                }
                return captureProfileRef(face, faceId, node.faceIdIsShared(faceId), true);
            });
            return { ...base, source: { nodeId: node.id, profiles } };
        } finally {
            owned.forEach((x) => x.dispose());
        }
    }

    /**
     * The picked face in world coordinates; identity transforms reuse the raw shape,
     * transformed copies are pushed to `owned` for the caller to dispose.
     */
    private static worldFace(data: VisualShapeData, owned: IFace[]): IFace {
        const face = data.shape as unknown as IFace;
        if (data.transform.equals(Matrix4.identity())) return face;
        const world = face.transformedMul(data.transform) as IFace;
        owned.push(world);
        return world;
    }

    /**
     * The path as fingerprinted edge references (node-local coords), so it follows the
     * source node on rebuild. Only edges of the first picked edge's node are kept — a
     * path is one wire on one node.
     */
    private pathRef(): { nodeId: string; edges: EdgeRef[] } {
        const shapes = this.stepDatas[1].shapes;
        const node = shapes[0].owner.node as ShapeNode;
        const edges = shapes
            .filter((data) => data.owner.node === node)
            .map((data) => {
                const tracked = isBodyTrackingNode(node) ? node : undefined;
                const edgeId = tracked?.edgeIdAt(data.indexes[0]);
                const splitPiece =
                    node instanceof ParametricBodyNode ? node.edgeIdIsShared(edgeId) : undefined;
                return captureEdgeRef(data.shape as unknown as IEdge, edgeId, splitPiece);
            });
        return { nodeId: node.id, edges };
    }

    /**
     * The join/cut/intersect target, auto-detected: the first parametric body whose
     * bounding box intersects the swept tool's. (Bounds only — a real interference
     * check would cost a boolean per candidate; overlapping boxes with disjoint
     * geometry just produce a no-op boolean.)
     */
    private findIntersectingBody(): ParametricBodyNode | undefined {
        const built = this.buildToolShape();
        if (built === undefined) return undefined;
        try {
            return this.document.modelManager.findNode(
                (target) =>
                    target instanceof ParametricBodyNode &&
                    target.shape.isOk &&
                    BoundingBox.isIntersect(built.boundingBox(), target.shape.value.boundingBox()),
            ) as ParametricBodyNode | undefined;
        } finally {
            built.dispose();
        }
    }

    /**
     * The swept tool in world coordinates — the picked profile faces (or the whole
     * sketch's outer profiles) along the picked path. The feature rebuilds the same
     * geometry from the stored refs; this is only the interference probe.
     */
    private buildToolShape(): IShape | undefined {
        const owned: IShape[] = [];
        const mapShape = <T extends IShape>(data: VisualShapeData): T => {
            const shape = data.shape as unknown as T;
            if (data.transform.equals(Matrix4.identity())) return shape;
            const mapped = shape.transformedMul(data.transform) as T;
            owned.push(mapped);
            return mapped;
        };
        try {
            let faces = this.stepDatas[0].shapes.map((data) => mapShape<IFace>(data));
            if (faces.length === 0) {
                // Only a whole-sketch pick arrives with no shapes; a body pick always
                // carries its faces.
                const node = this.sourceNode;
                if (!(node instanceof SketchNode)) return undefined;
                const profiles = sketchProfiles(node);
                if (!profiles.isOk) return undefined;
                faces = profiles.value.outer;
            }
            const pathDatas = this.stepDatas[1].shapes;
            const node = pathDatas[0].owner.node;
            const edges = pathDatas
                .filter((data) => data.owner.node === node)
                .map((data) => mapShape<IEdge>(data));
            const wire = shapeFactory.wire(edges);
            if (!wire.isOk) return undefined;
            owned.push(wire.value);
            const swept = shapeFactory.sweep(faces, wire.value, this.isRoundCorner);
            return swept.isOk ? swept.value : undefined;
        } finally {
            owned.forEach((x) => x.dispose());
        }
    }
}
