// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type BodyInstanceNode,
    command,
    FaceMaterialPair,
    GetOrSelectNodeStep,
    Id,
    type IInstanceNode,
    type INode,
    type IStep,
    isInstanceNode,
    Matrix4,
    MeshNode,
    MultistepCommand,
    PubSub,
    ShapeNode,
    Transaction,
    type VisualNode,
} from "@chili3d/core";
import {
    type BooleanFeatureData,
    type FeatureData,
    featureHandler,
    isRigidTransform,
    remapFeatureRefs,
} from "../features";
import { ParametricBodyNode } from "../parametricBodyNode";
import { SketchNode } from "../sketch/sketchNode";

/**
 * Turns an instance into an independent copy of its source.
 *
 * The copy gets its own feature list, its own copy of every sketch and consumed boolean
 * tool those features reference, and the instance's placement as a trailing `transform`
 * feature. The source's rollback bar is materialized: only the visible features are
 * copied, so the detached geometry matches the instance the user was looking at.
 *
 * Sketch *internal* references are deliberately not remapped: a sketch drawn on the
 * source's face keeps pointing at the source, which is the geometry its fingerprints
 * were taken from (see `nodeRefRemap.ts`).
 */
@command({ key: "modify.detach", icon: "icon-copy" })
export class DetachCommand extends MultistepCommand {
    protected override getSteps(): IStep[] {
        return [
            new GetOrSelectNodeStep("prompt.select.models", {
                filter: { allow: (node: INode) => isInstanceNode(node) },
            }),
        ];
    }

    protected override executeMainTask(): void {
        const picked = this.stepDatas[0].nodes?.[0];
        if (!isInstanceNode(picked) || picked.source === undefined) {
            PubSub.default.pub("showToast", "error.default:{0}", "Select an instance");
            return;
        }
        const instance = picked as INode & IInstanceNode & VisualNode;
        if (!isRigidTransform(instance.transform)) {
            PubSub.default.pub(
                "showToast",
                "error.default:{0}",
                "The instance placement is not a rigid transform; it cannot be detached",
            );
            return;
        }

        if (instance.source instanceof ParametricBodyNode) {
            // A body with no feature chain has nothing to remap: its definition IS its
            // placement, so it detaches like any plain shape (copy + write the placement).
            if (instance.source.features.length === 0) {
                this.detachClone(instance, instance.source);
            } else {
                this.detachParametric(instance as BodyInstanceNode, instance.source);
            }
        } else if (instance.source instanceof ShapeNode || instance.source instanceof MeshNode) {
            this.detachClone(instance, instance.source);
        } else {
            PubSub.default.pub(
                "showToast",
                "error.default:{0}",
                "This instance source cannot be made independent",
            );
        }
    }

    /** A plain solid/mesh clone already is an independent copy — one placement write. */
    private detachClone(instance: INode & IInstanceNode & VisualNode, source: ShapeNode | MeshNode): void {
        Transaction.execute(this.document, "excute modify.detach", () => {
            const copy = source.clone() as VisualNode;
            copy.transform = instance.transform;
            this.copyAppearance(instance, copy);
            this.replace(instance, copy);
            // The panel that offered "make independent" should now inspect the copy.
            this.document.selection.setSelectedNodes([copy], false);
            this.document.visual.update();
        });
    }

    private detachParametric(instance: BodyInstanceNode, source: ParametricBodyNode): void {
        const visible = this.visibleFeatures(source);
        if (visible.length === 0) {
            PubSub.default.pub("showToast", "error.default:{0}", "The source has no visible features");
            return;
        }

        Transaction.execute(this.document, "excute modify.detach", () => {
            const copy = source.clone();
            // Clear the persisted bar without the setter: the property setter rebuilds the
            // chain eagerly, which would replay the very features the bar hides (a failed
            // one would surface its error) for a node whose feature list is replaced below.
            copy.setPrivateValue("rollbackBarIndex", undefined);
            const mapping = new Map<string, string>([[source.id, copy.id]]);
            this.cloneSketches(visible, mapping);
            this.cloneTools(source, visible, mapping);

            const features = visible.map((feature) => {
                const remapped = remapFeatureRefs(feature, mapping);
                if (remapped.type !== "boolean") return remapped;
                // Consumed tools were copied: keep them consumed so the copy adopts and
                // hides them (and does not steal the source's originals). A tool that was
                // NOT copied is shared and must stay an ordinary reference.
                const original = feature as BooleanFeatureData;
                const allCopied =
                    original.consumeTools !== false && original.toolIds.every((id) => mapping.has(id));
                return { ...remapped, consumeTools: allCopied ? undefined : false };
            });
            if (!instance.transform.equals(Matrix4.identity())) {
                features.push({
                    id: Id.generate(),
                    type: "transform",
                    matrix: instance.transform.toArray(),
                });
            }
            copy.setFeaturesEmitShapeChanged(features);
            // The instance carries its own paint (it was copied at creation and may have
            // been edited since); cloning the source would restore the source's.
            this.copyAppearance(instance, copy);
            copy.transform = Matrix4.identity();

            this.replace(instance, copy);
            // The panel that offered "make independent" should now inspect the copy.
            this.document.selection.setSelectedNodes([copy], false);
            this.document.visual.update();
        });
    }

    /** The chain the instance actually shows: the persisted rollback bar truncates it. */
    private visibleFeatures(source: ParametricBodyNode): FeatureData[] {
        const bar = source.rollbackBarIndex;
        return bar === undefined
            ? source.features
            : source.features.slice(0, Math.min(bar, source.features.length));
    }

    /** Copies each referenced sketch once and records `oldId → newId` for the feature remap. */
    private cloneSketches(features: readonly FeatureData[], mapping: Map<string, string>): void {
        const ids = new Set(
            features.flatMap((feature) => featureHandler(feature.type)?.nodeIds(feature) ?? []),
        );
        for (const id of ids) {
            const node = this.document.modelManager.findNodeDeep((x) => x.id === id);
            if (!(node instanceof SketchNode) || mapping.has(id)) continue;
            const clone = node.clone();
            mapping.set(id, clone.id);
            this.insertCopy(node, clone);
        }
    }

    /**
     * Copies consumed boolean tools (recursively) so the detached body does not read
     * nodes that live under the source and die with it.
     */
    private cloneTools(
        source: ParametricBodyNode,
        features: readonly FeatureData[],
        mapping: Map<string, string>,
    ): void {
        // `consumeTools: false` names an independent body the source does not own: it
        // survives the source and the copy can keep reading it. Only owned (consumed)
        // tools are copied.
        const toolIds = new Set(
            features.flatMap((feature) =>
                feature.type === "boolean" && feature.consumeTools !== false
                    ? feature.toolIds
                    : ([] as readonly string[]),
            ),
        );
        const clones: ShapeNode[] = [];
        for (const id of toolIds) this.cloneTool(source, id, mapping, clones);

        let anchor: INode = source;
        for (const clone of clones) {
            if (source.parent !== undefined) {
                source.parent.insertAfter(anchor, clone);
                anchor = clone;
            } else {
                this.document.modelManager.addNode(clone);
            }
        }

        // A copied tool body reads its own sketches (its extrudes, its section wires);
        // those are not in the source's visible chain, so collect them from the copies
        // as well — otherwise the detached body still follows the source's sketches.
        this.cloneSketches(
            clones.flatMap((clone) => (clone instanceof ParametricBodyNode ? [...clone.features] : [])),
            mapping,
        );

        // Rewrite only after every clone is inserted: a nested tool rebuild must resolve
        // its copies through the document, not read a half-built tree.
        for (const clone of clones) {
            if (!(clone instanceof ParametricBodyNode)) continue;
            const remapped = clone.features.map((feature) => remapFeatureRefs(feature, mapping));
            clone.setFeaturesEmitShapeChanged(remapped);
        }
    }

    private cloneTool(
        source: ParametricBodyNode,
        id: string,
        mapping: Map<string, string>,
        clones: ShapeNode[],
    ): void {
        if (mapping.has(id)) return;
        const node = source.document.modelManager.findNodeDeep((x) => x.id === id);
        if (!(node instanceof ShapeNode)) return;

        const clone = node.clone() as ShapeNode;
        mapping.set(id, clone.id);
        clones.push(clone);
        if (!(clone instanceof ParametricBodyNode)) return;

        // A tool body can itself consume tools; copy that closure too and rewrite its
        // own feature references to the copies.
        const nested = new Set(
            clone.features.flatMap((feature) =>
                feature.type === "boolean" && feature.consumeTools !== false
                    ? feature.toolIds
                    : ([] as readonly string[]),
            ),
        );
        for (const nestedId of nested) this.cloneTool(source, nestedId, mapping, clones);
    }

    /**
     * An instance owns its `materialId` / `faceMaterialPair` (copied at creation, then
     * independent). Making it independent must keep what it was showing, not the
     * source's current paint.
     */
    private copyAppearance(instance: INode, copy: INode): void {
        // `MeshNode` carries `materialId` but no per-face pair table, so both sides are
        // handled structurally rather than through `GeometryNode`.
        const painted = instance as {
            materialId?: string | string[];
            faceMaterialPair?: FaceMaterialPair[];
        };
        const target = copy as {
            materialId?: string | string[];
            faceMaterialPair?: FaceMaterialPair[];
        };
        target.materialId = Array.isArray(painted.materialId) ? [...painted.materialId] : painted.materialId;
        if (painted.faceMaterialPair === undefined) return;
        target.faceMaterialPair = painted.faceMaterialPair.map(
            (pair) =>
                new FaceMaterialPair({
                    faceIndex: pair.faceIndex,
                    materialIndex: pair.materialIndex,
                }),
        );
    }

    /** A source in a Component has no tree parent; the copy lands at the root instead. */
    private insertCopy(original: INode, copy: INode): void {
        if (original.parent !== undefined) {
            original.parent.insertAfter(original, copy);
        } else {
            this.document.modelManager.addNode(copy);
        }
    }

    private replace(instance: INode, copy: VisualNode): void {
        if (instance.parent === undefined) {
            this.document.modelManager.addNode(copy);
            return;
        }
        instance.parent.insertAfter(instance.previousSibling, copy);
        instance.parent.remove(instance);
    }
}
