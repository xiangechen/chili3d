// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    command,
    Id,
    type IStep,
    LENGTH_UNITS,
    type LengthAtAxisSnapData,
    LengthAtAxisStep,
    LengthAtPlaneStep,
    MultistepCommand,
    type ParameterValue,
    PointStep,
    Precision,
    PubSub,
    property,
    type ShapeMeshData,
    type SnapLengthAtPlaneData,
    Transaction,
    type XYZ,
} from "@chili3d/core";
import type { HelixFeatureData } from "../features/feature";
import { primitiveFrameXvec } from "../features/primitive";
import { ParametricBodyNode } from "../parametricBodyNode";
import { signedHeightAxis } from "./primitivePick";

/**
 * Helix: a spring's centreline as its own wire body, placed like the app's create command —
 * a picked centre, a dragged radius (circle preview), a dragged height (live coil preview).
 * The picks write the feature's `origin` and `axis` (the pick plane's normal — a drag against
 * it stores the axis reversed and the length positive) and feed the option panel: the radius
 * drag writes its measurement there when its step commits, so a panel edit during the height
 * drag wins over the drag; the length is written at the commit itself, with no edit window in
 * between, so the pick always wins (the primitive commands' property↔pick arrangement). The
 * pitch is panel-only — nothing picks it. The preview meshes the coil with the same sizes,
 * deterministic frame and two-of-three derivation the feature rebuilds with, so what drags by
 * is what gets stored. The wire is consumed as a later sweep's path, not combined into a
 * solid, so there is no operation/targets scope — the primitive command without its boolean
 * half.
 */
@command({ key: "feature.helix", icon: "icon-helix" })
export class HelixFeatureCommand extends MultistepCommand {
    @property("circle.radius", { unit: LENGTH_UNITS })
    get radius(): ParameterValue {
        return this.getPrivateValue("radius", 5);
    }
    set radius(value: ParameterValue) {
        this.setProperty("radius", value);
    }

    @property("common.length", { unit: LENGTH_UNITS })
    get length(): ParameterValue {
        return this.getPrivateValue("length", 20);
    }
    set length(value: ParameterValue) {
        this.setProperty("length", value);
    }

    @property("helix.pitch", { unit: LENGTH_UNITS })
    get pitch(): ParameterValue {
        return this.getPrivateValue("pitch", 2);
    }
    set pitch(value: ParameterValue) {
        this.setProperty("pitch", value);
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

    private readonly circlePreview = (point: XYZ | undefined) => {
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
            preview: this.helixPreview,
            validator: (p: XYZ) => Math.abs(this.signedHeight(p)) > Precision.Distance,
        };
    };

    /**
     * The coil the drag means, meshed with what the feature will rebuild from: the panel's
     * radius and pitch, the deterministic frame xvec (`primitiveFrameXvec` — the coil's start
     * phase is referenced by nothing and persists nowhere, so the picked radius point is NOT
     * stored for it), and the drag's height over the pitch as the swept angle. Without a
     * height point, or with a pitch the coil cannot sweep on, the committed circle stands in.
     */
    private readonly helixPreview = (end: XYZ | undefined): ShapeMeshData[] => {
        const pitch = this.resolvedSize(this.pitch);
        const radius = this.resolvedSize(this.radius) ?? this.pickedRadius();
        if (
            end === undefined ||
            pitch === undefined ||
            Math.abs(pitch) <= Precision.Distance ||
            radius <= Precision.Distance
        ) {
            return this.circlePreview(this.stepDatas[1].point);
        }
        const center = this.stepDatas[0].point!;
        const { axis, height } = signedHeightAxis(this.stepDatas[1].plane!.normal, this.signedHeight(end));
        return [
            this.meshPoint(center),
            this.meshCreatedShape(
                "helix",
                center,
                axis,
                primitiveFrameXvec(axis),
                radius,
                Math.abs(pitch),
                (height / Math.abs(pitch)) * 360,
            ),
        ];
    };

    /** The signed climb of a point along the committed radius plane's normal. */
    private signedHeight(point: XYZ): number {
        return point.sub(this.stepDatas[0].point!).dot(this.stepDatas[1].plane!.normal);
    }

    /** The dragged radius: the two picks' distance, projected onto the radius plane. */
    private pickedRadius(): number {
        return this.stepDatas[1].plane!.projectDistance(this.stepDatas[0].point!, this.stepDatas[1].point!);
    }

    /** A size field as a number: a literal directly, an expression resolved when possible. */
    private resolvedSize(size: ParameterValue): number | undefined {
        if (typeof size === "number") return size;
        const resolved = this.resolveParameter(size, LENGTH_UNITS);
        return resolved.isOk ? resolved.value : undefined;
    }

    protected override executeMainTask(): void {
        const feature = this.buildFeature();
        if (feature === undefined) return;
        Transaction.execute(this.document, "excute feature.helix", () => {
            this.document.modelManager.addNode(
                new ParametricBodyNode({ document: this.document, features: [feature] }),
            );
            this.document.visual.update();
        });
    }

    /** The feature payload from the picks; undefined — after a toast — when they are degenerate. */
    private buildFeature(): HelixFeatureData | undefined {
        const { axis, height } = signedHeightAxis(
            this.stepDatas[1].plane!.normal,
            this.signedHeight(this.stepDatas[2].point!),
        );
        // The length is written to its property only now: the commit follows the last pick
        // with no window in between, so a panel edit to it mid-drag does not stand (radius,
        // written when its own step committed, keeps its window). The write still lands so
        // the panel shows what was placed.
        this.length = height;
        if (!this.sizesAreValid()) return undefined;
        const center = this.stepDatas[0].point!;
        return {
            id: Id.generate(),
            type: "helix",
            origin: { x: center.x, y: center.y, z: center.z },
            radius: this.radius,
            length: this.length,
            pitch: this.pitch,
            axis: { x: axis.x, y: axis.y, z: axis.z },
        };
    }

    /**
     * Commit-time backstop behind the step validators, which already refuse degenerate picks
     * (the primitive commands' `sizesArePositive` arrangement): radius and length positive,
     * the pitch non-zero — the two-of-three coil rule divides by it. Expression values are
     * resolved when possible; one the command cannot resolve passes — the feature's rebuild
     * reports it with the row's error UI.
     */
    private sizesAreValid(): boolean {
        const radius = this.resolvedSize(this.radius);
        const length = this.resolvedSize(this.length);
        const pitch = this.resolvedSize(this.pitch);
        const valid =
            (radius === undefined || radius > Precision.Distance) &&
            (length === undefined || length > Precision.Distance) &&
            (pitch === undefined || Math.abs(pitch) > Precision.Distance);
        if (!valid) {
            PubSub.default.pub(
                "showToast",
                "error.default:{0}",
                "Helix radius and length must be positive, and the pitch non-zero",
            );
        }
        return valid;
    }
}
