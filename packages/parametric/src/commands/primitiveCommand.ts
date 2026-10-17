// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    AUTO_TARGETS,
    type BoundingBox,
    Combobox,
    command,
    type I18nKeys,
    Id,
    type IStep,
    LENGTH_UNITS,
    type LengthAtAxisSnapData,
    LengthAtAxisStep,
    LengthAtPlaneStep,
    MathUtils,
    MultistepCommand,
    type ParameterValue,
    type Plane,
    PointStep,
    Precision,
    PubSub,
    property,
    type ShapeMeshData,
    type SnapLengthAtPlaneData,
    type SnapResult,
    type TargetCandidate,
    type TargetSelection,
    Transaction,
    XYZ,
} from "@chili3d/core";
import type { PrimitiveFeatureData, PrimitiveKind } from "../features/feature";
import { measurePrimitiveShape, primitiveFrameXvec } from "../features/primitive";
import type { ParametricBodyNode } from "../parametricBodyNode";
import {
    candidateBodies,
    commitBooleanTargets,
    resolveTargetBodies,
    standaloneBody,
    syncAutoTargets,
    targetCandidate,
} from "./booleanTargets";
import { FORM_FEATURE_OPERATIONS } from "./extrudeCommand";
import { normalizeSignedRect, type RectDragData, rectDataOnPlane, signedHeightAxis } from "./primitivePick";

const OPERATION_NEW: I18nKeys = "option.command.operation.new";

/**
 * The placed primitives (box/cylinder/sphere/cone), placed like the app's create commands:
 * a picked corner/centre, a dragged rectangle or radius, a dragged height (the sphere stops
 * at the radius). The picks write the feature's `origin`, sizes and `axis` (the pick plane's
 * normal — a drag against it stores the axis reversed and the height positive). The sizes
 * also live in the option panel: each drag phase writes its measurement there when it
 * commits, and a panel edit during the NEXT phase wins over the drag — the extrude
 * command's property↔drag arrangement with the drag handler's side replaced by the pick
 * (the phase boundary is the only write point a pick has). Everything stays editable on the
 * feature row afterwards. The operation scope is the form features' own (see the extrude
 * command): "New Body" stands the primitive up alone, anything else appends it to every
 * body the target detection finds in its way — which a real pose, unlike the old
 * default-placement command, finally makes meaningful.
 */
abstract class PrimitiveCommandBase extends MultistepCommand {
    abstract readonly primitive: PrimitiveKind;

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
        this.showTargets = value !== OPERATION_NEW;
    }

    /**
     * Which bodies the join/cut/intersect combines with. The set is the command's, and the
     * detection fills it while it is still on auto — see `applyAutoTargets`.
     */
    @property("option.command.targets", {
        type: "targets",
        dependencies: [{ property: "showTargets", value: true }],
    })
    get targets(): TargetSelection {
        return this.getPrivateValue("targets", AUTO_TARGETS);
    }
    set targets(value: TargetSelection) {
        this.setProperty("targets", value);
    }

    /** The list only means something once an operation gives the feature a body to combine with. */
    get showTargets(): boolean {
        return this.getPrivateValue("showTargets", this.operation !== OPERATION_NEW);
    }
    set showTargets(value: boolean) {
        this.setProperty("showTargets", value);
    }

    targetCandidates(): readonly TargetCandidate[] {
        return candidateBodies(this.document).map(targetCandidate);
    }

    setTargets(selection: TargetSelection): void {
        this.targets = selection;
    }

    /**
     * The detection's write path. It goes around the setter because the write is a consequence
     * of the detection itself, not a request for another one — but the property event still
     * goes out, and that is what redraws the checkbox list (the extrude command's twin).
     */
    private applyAutoTargets(selection: TargetSelection): void {
        const previous = this.targets;
        this.setPrivateValue("targets", selection);
        this.emitPropertyChanged("targets", previous);
    }

    protected override beforeExecute(): void {
        super.beforeExecute();
        // The option cache restores this command's own last run too, so a set left over from it
        // must not decide this one (see the extrude command).
        this.targets = AUTO_TARGETS;
    }

    protected override executeMainTask(): void {
        const feature = this.buildFeature();
        if (feature === undefined) return;
        Transaction.execute(this.document, "excute feature.primitive", () => {
            const operation = FORM_FEATURE_OPERATIONS[this.operation];
            if (operation === undefined) {
                standaloneBody(this.document, feature);
            } else {
                commitBooleanTargets(
                    this.document,
                    feature,
                    operation,
                    this.resolveTargets(this.toolBox(feature)),
                );
            }
            this.document.visual.update();
        });
    }

    /** The feature payload from the picks; undefined — after a toast — when they are degenerate. */
    protected abstract buildFeature(): PrimitiveFeatureData | undefined;

    /**
     * Commit-time backstop behind the step validators, which already refuse degenerate picks.
     * Expression values are resolved when possible; one the command cannot resolve passes —
     * the feature's rebuild reports it with the row's error UI.
     */
    protected sizesArePositive(...sizes: ParameterValue[]): boolean {
        const valid = sizes.every((size) => {
            const resolved = this.resolvedSize(size);
            return resolved === undefined || resolved > Precision.Distance;
        });
        if (!valid) {
            PubSub.default.pub("showToast", "error.default:{0}", "Primitive sizes must be positive");
        }
        return valid;
    }

    /** A size field as a number: a literal directly, an expression resolved when possible. */
    protected resolvedSize(size: ParameterValue): number | undefined {
        if (typeof size === "number") return size;
        const resolved = this.resolveParameter(size, LENGTH_UNITS);
        return resolved.isOk ? resolved.value : undefined;
    }

    /** The bodies this run combines with, refreshing the auto set from the tool's box first. */
    private resolveTargets(box: BoundingBox | undefined): ParametricBodyNode[] {
        if (box !== undefined) {
            syncAutoTargets(this.document, box, this.targets, (next) => this.applyAutoTargets(next));
        }
        return resolveTargetBodies(this.document, box, this.targets);
    }

    /**
     * The primitive's box, built only to be measured: the detection needs the tool's bounds,
     * and a primitive that cannot be built at all leaves the feature standing on its own.
     */
    private toolBox(feature: PrimitiveFeatureData): BoundingBox | undefined {
        const built = measurePrimitiveShape(feature, this.document.variables.evaluate().scope);
        if (!built.isOk) return undefined;
        try {
            return built.value.boundingBox();
        } finally {
            built.value.dispose();
        }
    }
}

/**
 * The round primitives' shared flow (centre → radius → height). The cone differs from the
 * cylinder only in the height preview's wireframe and in carrying a `radius2` the panel
 * edits (nothing picks it).
 */
abstract class RoundPrimitiveCommandBase extends PrimitiveCommandBase {
    @property("circle.radius", { unit: LENGTH_UNITS })
    get radius(): ParameterValue {
        return this.getPrivateValue("radius", 5);
    }
    set radius(value: ParameterValue) {
        this.setProperty("radius", value);
    }

    @property("common.height", { unit: LENGTH_UNITS })
    get height(): ParameterValue {
        return this.getPrivateValue("height", 10);
    }
    set height(value: ParameterValue) {
        this.setProperty("height", value);
    }

    protected override getSteps(): IStep[] {
        return [
            new PointStep("prompt.pickCircleCenter"),
            new LengthAtPlaneStep("prompt.pickRadius", this.getRadiusData),
            new LengthAtAxisStep("prompt.pickNextPoint", this.getHeightStepData),
        ];
    }

    private readonly getRadiusData = (): SnapLengthAtPlaneData => {
        const { point, view } = this.stepDatas[0];
        return {
            point: () => point!,
            preview: this.circlePreview,
            plane: (tmp: XYZ | undefined) => this.findPlane(view, point!, tmp),
            validator: (p: XYZ) => {
                if (p.distanceTo(point!) < Precision.Distance) return false;
                const plane = this.findPlane(view, point!, p);
                return p.sub(point!).isParallelTo(plane.normal) === false;
            },
        };
    };

    protected readonly circlePreview = (point: XYZ | undefined) => {
        if (!point) return [this.meshPoint(this.stepDatas[0].point!)];
        const start = this.stepDatas[0].point!;
        const plane = this.findPlane(this.stepDatas[0].view, start, point);
        return [
            this.meshPoint(start),
            this.meshLine(start, point),
            this.meshCreatedShape("circle", plane.normal, start, plane.projectDistance(start, point)),
        ];
    };

    private readonly getHeightStepData = (): LengthAtAxisSnapData => {
        // The radius step just committed: write its measurement to the option panel, so the
        // user sees — and can still override — the dragged radius while picking the height.
        this.radius = this.pickedRadius();
        return {
            point: this.stepDatas[0].point!,
            direction: this.stepDatas[1].plane!.normal,
            preview: this.heightPreview,
            validator: (p: XYZ) => Math.abs(this.signedHeight(p)) > Precision.Distance,
        };
    };

    private readonly heightPreview = (end: XYZ | undefined): ShapeMeshData[] => {
        if (end === undefined) return this.circlePreview(this.stepDatas[1].point);
        return this.previewWithHeight(end);
    };

    /** The drag's third-phase preview, once a height point exists. */
    protected abstract previewWithHeight(end: XYZ): ShapeMeshData[];

    /** The signed climb of a point along the committed radius plane's normal. */
    protected signedHeight(point: XYZ): number {
        return point.sub(this.stepDatas[0].point!).dot(this.stepDatas[1].plane!.normal);
    }

    /** The dragged radius: the two picks' distance, projected onto the radius plane. */
    protected pickedRadius(): number {
        return this.stepDatas[1].plane!.projectDistance(this.stepDatas[0].point!, this.stepDatas[1].point!);
    }

    protected buildRoundFeature(radius2?: ParameterValue): PrimitiveFeatureData | undefined {
        const { axis, height } = signedHeightAxis(
            this.stepDatas[1].plane!.normal,
            this.signedHeight(this.stepDatas[2].point!),
        );
        // The height is written to its property only now: the commit follows the last pick
        // with no window in between, so a panel edit to it mid-drag does not stand (radius,
        // written when its own step committed, keeps its window). The write still lands so
        // the panel shows what was placed.
        this.height = height;
        if (!this.sizesArePositive(this.radius, this.height)) return undefined;
        const center = this.stepDatas[0].point!;
        return {
            id: Id.generate(),
            type: "primitive",
            primitive: this.primitive,
            origin: { x: center.x, y: center.y, z: center.z },
            radius: this.radius,
            ...(radius2 === undefined ? {} : { radius2 }),
            height: this.height,
            axis: { x: axis.x, y: axis.y, z: axis.z },
        };
    }
}

@command({ key: "feature.primitiveBox", icon: "icon-box" })
export class PrimitiveBoxCommand extends PrimitiveCommandBase {
    readonly primitive = "box";

    @property("box.dx", { unit: LENGTH_UNITS })
    get dx(): ParameterValue {
        return this.getPrivateValue("dx", 10);
    }
    set dx(value: ParameterValue) {
        this.setProperty("dx", value);
    }

    @property("box.dy", { unit: LENGTH_UNITS })
    get dy(): ParameterValue {
        return this.getPrivateValue("dy", 10);
    }
    set dy(value: ParameterValue) {
        this.setProperty("dy", value);
    }

    @property("box.dz", { unit: LENGTH_UNITS })
    get dz(): ParameterValue {
        return this.getPrivateValue("dz", 10);
    }
    set dz(value: ParameterValue) {
        this.setProperty("dz", value);
    }

    protected override getSteps(): IStep[] {
        return [
            new PointStep("prompt.pickFistPoint"),
            new LengthAtPlaneStep("prompt.pickNextPoint", this.getRectSnapData),
            new LengthAtAxisStep("prompt.pickNextPoint", this.getHeightStepData),
        ];
    }

    private readonly getRectSnapData = (): SnapLengthAtPlaneData => {
        const { point, view } = this.stepDatas[0];
        return {
            point: () => point!,
            preview: this.previewRect,
            plane: (tmp: XYZ | undefined) => this.findPlane(view, point!, tmp),
            validator: (end: XYZ) => {
                const data = this.rectData(end);
                return !MathUtils.anyEqualZero(data.dx, data.dy);
            },
            prompt: (snaped: SnapResult) => {
                const data = this.rectData(snaped.point!);
                return `${Math.abs(data.dx).toFixed(2)}, ${Math.abs(data.dy).toFixed(2)}`;
            },
        };
    };

    /**
     * The dragged rectangle. Mid-drag the second step has committed nothing yet, so its plane
     * comes from the live pick; afterwards the committed step's plane stands (the app's
     * `rectDataFromTwoSteps` arrangement).
     */
    private rectData(tmp: XYZ): RectDragData {
        const { view, point } = this.stepDatas[0];
        const plane = this.stepDatas[1]?.plane ?? this.findPlane(view, point!, tmp);
        return rectDataOnPlane(plane, point!, tmp);
    }

    private readonly previewRect = (end: XYZ | undefined) => {
        if (end === undefined) return [this.meshPoint(this.stepDatas[0].point!)];
        const { plane, dx, dy } = this.rectData(end);
        return [
            this.meshPoint(this.stepDatas[0].point!),
            this.meshPoint(end),
            this.meshCreatedShape("rect", plane, dx, dy),
        ];
    };

    private readonly getHeightStepData = (): LengthAtAxisSnapData => {
        const plane = this.stepDatas[1].plane;
        if (plane === undefined) throw new Error("plane is undefined, please report bug");
        // The rectangle just committed: write its spans to the option panel, so the user
        // sees — and can still override — the dragged size while picking the height. The
        // spans are measured in the frame the rebuild will use (`primitiveFrameXvec`), which
        // a rotated workplane's own pick frame can differ from; sign folding only moves the
        // origin, so the absolute spans are what dx/dy mean.
        const xvec = primitiveFrameXvec(plane.normal);
        const yvec = plane.normal.cross(xvec);
        const vector = this.stepDatas[1].point!.sub(this.stepDatas[0].point!);
        this.dx = Math.abs(vector.dot(xvec));
        this.dy = Math.abs(vector.dot(yvec));
        return {
            point: this.stepDatas[1].point!,
            direction: plane.normal,
            preview: this.previewBox,
            validator: (p: XYZ) => Math.abs(this.signedHeight(plane, p)) > Precision.Distance,
        };
    };

    private readonly previewBox = (end: XYZ | undefined) => {
        if (!end) return this.previewRect(this.stepDatas[1].point);
        const { plane, dx, dy } = this.rectData(this.stepDatas[1].point!);
        return [
            this.meshPoint(this.stepDatas[0].point!),
            this.meshPoint(this.stepDatas[1].point!),
            this.meshCreatedShape("box", plane, dx, dy, this.signedHeight(plane, end)),
        ];
    };

    private signedHeight(plane: Plane, point: XYZ): number {
        return point.sub(this.stepDatas[1].point!).dot(plane.normal);
    }

    protected buildFeature(): PrimitiveFeatureData | undefined {
        const rect = this.rectData(this.stepDatas[1].point!);
        // Negative height flips the stored axis; negative dx/dy fold into the origin — the
        // feature only ever stores positive sizes (see `primitivePick.ts`). The spans are
        // re-measured against the frame the rebuild will use (`primitiveFrameXvec`), so the
        // stored dx/dy reproduce exactly the rectangle the user dragged, whatever workplane
        // orientation it was dragged on.
        const { axis, height } = signedHeightAxis(
            rect.plane.normal,
            this.signedHeight(rect.plane, this.stepDatas[2].point!),
        );
        // The commit follows the height pick with no window in between, so dz's property is
        // written from the pick here — unlike dx/dy (written when the rectangle committed),
        // a panel edit to dz during the height drag does not stand.
        this.dz = height;
        const xvec = primitiveFrameXvec(axis);
        const yvec = axis.cross(xvec);
        const vector = this.stepDatas[1].point!.sub(this.stepDatas[0].point!);
        const normalized = normalizeSignedRect(
            this.stepDatas[0].point!,
            xvec,
            yvec,
            vector.dot(xvec),
            vector.dot(yvec),
        );
        // The sizes are the option panel's, the pose the pick's: an edited dx/dy does not
        // move the picked corner — the box grows from it (folded positive) along the frame's
        // +x/+y, possibly past where the drag reached.
        if (!this.sizesArePositive(this.dx, this.dy, this.dz)) return undefined;
        return {
            id: Id.generate(),
            type: "primitive",
            primitive: "box",
            origin: { x: normalized.origin.x, y: normalized.origin.y, z: normalized.origin.z },
            dx: this.dx,
            dy: this.dy,
            dz: this.dz,
            axis: { x: axis.x, y: axis.y, z: axis.z },
        };
    }
}

@command({ key: "feature.primitiveCylinder", icon: "icon-cylinder" })
export class PrimitiveCylinderCommand extends RoundPrimitiveCommandBase {
    readonly primitive = "cylinder";

    protected previewWithHeight(end: XYZ): ShapeMeshData[] {
        const plane = this.stepDatas[1].plane!;
        const height = this.signedHeight(end);
        return [
            this.meshPoint(this.stepDatas[0].point!),
            this.meshCreatedShape(
                "cylinder",
                height < 0 ? plane.normal.reverse() : plane.normal,
                this.stepDatas[0].point!,
                this.pickedRadius(),
                Math.abs(height),
            ),
        ];
    }

    protected buildFeature(): PrimitiveFeatureData | undefined {
        return this.buildRoundFeature();
    }
}

@command({ key: "feature.primitiveSphere", icon: "icon-sphere" })
export class PrimitiveSphereCommand extends PrimitiveCommandBase {
    readonly primitive = "sphere";

    @property("circle.radius", { unit: LENGTH_UNITS })
    get radius(): ParameterValue {
        return this.getPrivateValue("radius", 5);
    }
    set radius(value: ParameterValue) {
        this.setProperty("radius", value);
    }

    protected override getSteps(): IStep[] {
        return [
            new PointStep("prompt.pickCircleCenter"),
            new LengthAtPlaneStep("prompt.pickRadius", this.getRadiusData),
        ];
    }

    private readonly getRadiusData = (): SnapLengthAtPlaneData => {
        const point = this.stepDatas[0].point!;
        return {
            point: () => point,
            preview: this.previewSphere,
            plane: () => this.stepDatas[0].view.workplane.translateTo(point),
            validator: (p: XYZ) => p.distanceTo(point) > Precision.Distance,
        };
    };

    private readonly previewSphere = (end: XYZ | undefined) => {
        const center = this.stepDatas[0].point!;
        if (!end) return [this.meshPoint(center)];
        const radius = center.distanceTo(end);
        return [
            this.meshPoint(center),
            this.meshCreatedShape("circle", XYZ.unitZ, center, radius),
            this.meshCreatedShape("circle", XYZ.unitY, center, radius),
        ];
    };

    protected buildFeature(): PrimitiveFeatureData | undefined {
        // The sphere's radius is the 3D distance, not a plane projection (the app's sphere).
        // There is no third step: the commit follows the radius pick with no window to edit
        // the panel value in between, so the picked radius always wins — it is written to
        // the property (and read back) only so the panel shows what was placed.
        this.radius = this.stepDatas[0].point!.distanceTo(this.stepDatas[1].point!);
        if (!this.sizesArePositive(this.radius)) return undefined;
        const center = this.stepDatas[0].point!;
        return {
            id: Id.generate(),
            type: "primitive",
            primitive: "sphere",
            origin: { x: center.x, y: center.y, z: center.z },
            radius: this.radius,
        };
    }
}

@command({ key: "feature.primitiveCone", icon: "icon-cone" })
export class PrimitiveConeCommand extends RoundPrimitiveCommandBase {
    readonly primitive = "cone";

    /**
     * The top radius the drag never picks: the panel defaults it to 0 — the pointed cone the
     * wireframe preview draws — while the feature data's own default (2) still governs a
     * feature written without the command. A frustum is a panel edit, before or after.
     */
    @property("feature.primitive.radius2", { unit: LENGTH_UNITS })
    get radius2(): ParameterValue {
        return this.getPrivateValue("radius2", 0);
    }
    set radius2(value: ParameterValue) {
        this.setProperty("radius2", value);
    }

    protected previewWithHeight(end: XYZ): ShapeMeshData[] {
        // The app's wireframe cone: the base circle plus four generators up to the apex.
        const center = this.stepDatas[0].point!;
        const plane = this.stepDatas[1].plane!;
        const radius = this.pickedRadius();
        const apex = center.add(plane.normal.multiply(this.signedHeight(end)));
        return [
            this.meshPoint(center),
            this.meshCreatedShape("circle", plane.normal, center, radius),
            this.meshLine(center.add(plane.xvec.multiply(radius)), apex),
            this.meshLine(center.add(plane.xvec.multiply(-radius)), apex),
            this.meshLine(center.add(plane.yvec.multiply(radius)), apex),
            this.meshLine(center.add(plane.yvec.multiply(-radius)), apex),
        ];
    }

    protected buildFeature(): PrimitiveFeatureData | undefined {
        // radius2 is panel-only — nothing picks it. A negative literal is caught here; an
        // unresolvable expression passes, for the feature's rebuild to report.
        const top = this.resolvedSize(this.radius2);
        if (top !== undefined && top < 0) {
            PubSub.default.pub("showToast", "error.default:{0}", "Cone top radius must be non-negative");
            return undefined;
        }
        return this.buildRoundFeature(this.radius2);
    }
}
