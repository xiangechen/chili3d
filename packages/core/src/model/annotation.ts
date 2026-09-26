// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument } from "../document";
import { Id } from "../foundation";
import type { I18nKeys } from "../i18n";
import { BoundingBox, type XYZ } from "../math";
import { LENGTH_UNITS } from "../parameters/unitSpec";
import { property } from "../property";
import { serializable, serialize } from "../serialize";
import { angularDimensionSweep, DIMENSION_TEXT_HEIGHT } from "./dimensionLayout";
import { VisualNode } from "./visualNode";

export const AnnotationTypes = ["dimension", "text", "refInfiniteLine", "refSegment"] as const;
export type AnnotationType = (typeof AnnotationTypes)[number];

interface AnnotationOptionsBase {
    document: IDocument;
    annotationType: AnnotationType;
    name: string;
    id?: string;
    color?: number;
    visible?: boolean;
}

export type DimensionType = "linear" | "angular" | "radial" | "diameter";

export interface DimensionAnnotationOptions extends AnnotationOptionsBase {
    annotationType: "dimension";
    startPoint: XYZ;
    endPoint: XYZ;
    /** Where the user placed the dimension text; fixes the dimension plane and offset side. */
    textPoint: XYZ;
    /** The angle vertex — only an angular dimension carries one. */
    centerPoint?: XYZ;
    /**
     * The circle's axis — only radial/diameter dimensions carry one. Their three
     * points are collinear by construction, so the dimension plane cannot be
     * rederived from them; this pins it.
     */
    planeNormal?: XYZ;
    dimensionType?: DimensionType;
    /** World-space text height (mm); arrows and gaps scale with it. Defaults to `DIMENSION_TEXT_HEIGHT`. */
    textHeight?: number;
    /** Text shown instead of the measured value; `<>` inside it stands for that value. */
    textOverride?: string;
}

export interface TextAnnotationOptions extends AnnotationOptionsBase {
    annotationType: "text";
    content: string;
    position: XYZ;
}

export interface RefInfiniteLineAnnotationOptions extends AnnotationOptionsBase {
    annotationType: "refInfiniteLine";
    point: XYZ;
    direction: XYZ;
}

export interface RefSegmentAnnotationOptions extends AnnotationOptionsBase {
    annotationType: "refSegment";
    startPoint: XYZ;
    endPoint: XYZ;
}

export type AnnotationOptions =
    | DimensionAnnotationOptions
    | TextAnnotationOptions
    | RefInfiniteLineAnnotationOptions
    | RefSegmentAnnotationOptions;

/**
 * An annotation's points are its local geometry; placement happens through the
 * inherited `transform`, exactly like any other `VisualNode`. That lets an
 * annotation live inside a `Component` and be carried by the instance matrices.
 */
export abstract class Annotation extends VisualNode {
    @serialize()
    readonly annotationType: AnnotationType;
    @serialize()
    get color(): number {
        return this.getPrivateValue("color", 0xffff00);
    }
    set color(value: number) {
        this.setProperty("color", value);
    }

    constructor(options: AnnotationOptionsBase) {
        super(options.document, options.name, options.id ?? Id.generate());
        this.annotationType = options.annotationType;
        if (options.color !== undefined) this.setPrivateValue("color", options.color);
        if (options.visible !== undefined) this.visible = options.visible;
    }

    override display(): I18nKeys {
        return "annotation";
    }
    override boundingBox(): BoundingBox | undefined {
        return undefined;
    }
}

@serializable()
export class DimensionAnnotation extends Annotation {
    declare readonly annotationType: "dimension";

    @serialize()
    get dimensionType(): DimensionType {
        return this.getPrivateValue("dimensionType", "linear");
    }
    set dimensionType(value: DimensionType) {
        this.setProperty("dimensionType", value);
    }

    @serialize()
    get startPoint(): XYZ {
        return this.getPrivateValue("startPoint");
    }
    set startPoint(value: XYZ) {
        this.setProperty("startPoint", value);
    }

    @serialize()
    get endPoint(): XYZ {
        return this.getPrivateValue("endPoint");
    }
    set endPoint(value: XYZ) {
        this.setProperty("endPoint", value);
    }

    @serialize()
    get textPoint(): XYZ {
        return this.getPrivateValue("textPoint");
    }
    set textPoint(value: XYZ) {
        this.setProperty("textPoint", value);
    }

    /** The angle vertex — set only on angular dimensions, undefined otherwise. */
    @serialize()
    get centerPoint(): XYZ | undefined {
        return this.getPrivateValue("centerPoint", undefined);
    }
    set centerPoint(value: XYZ | undefined) {
        this.setProperty("centerPoint", value);
    }

    /** The circle's axis — set only on radial/diameter dimensions, pinning their plane. */
    @serialize()
    get planeNormal(): XYZ | undefined {
        return this.getPrivateValue("planeNormal", undefined);
    }
    set planeNormal(value: XYZ | undefined) {
        this.setProperty("planeNormal", value);
    }

    /**
     * World-space height of the dimension text (mm) — the whole annotation
     * (arrows, extension gaps) scales with it. Non-positive values are refused:
     * they would make the layout collapse instead of drawing.
     */
    @serialize()
    @property("dimension.textHeight", { unit: LENGTH_UNITS })
    get textHeight(): number {
        return this.getPrivateValue("textHeight", DIMENSION_TEXT_HEIGHT);
    }
    set textHeight(value: number) {
        if (value > 0) this.setProperty("textHeight", value);
    }

    /**
     * Text shown instead of the measured value — a `<>` inside it expands to that
     * value, so "Ø<>" draws as "Ø10.00". Empty (the default) shows the measurement
     * with the dimension kind's affix (R / Ø / °).
     */
    @serialize()
    @property("dimension.textOverride")
    get textOverride(): string {
        return this.getPrivateValue("textOverride", "");
    }
    set textOverride(value: string) {
        this.setProperty("textOverride", value);
    }

    /**
     * The measured value, derived from the attachment points — never stored. An
     * angular dimension reports the drawn sweep in degrees (the text point picks
     * the reflex side, so the number and the arc never disagree); the rest report
     * a distance.
     */
    get value(): number {
        if (this.dimensionType === "angular" && this.centerPoint !== undefined) {
            const sweep = angularDimensionSweep(
                this.centerPoint,
                this.startPoint,
                this.endPoint,
                this.textPoint,
            );
            if (sweep !== undefined) return (Math.abs(sweep) * 180) / Math.PI;
        }
        return this.startPoint.distanceTo(this.endPoint);
    }

    /**
     * The dimension text: the override as written (with `<>` expanded), or the
     * measured value with its kind's affix — `R12.00`, `Ø24.00`, `45.0°`.
     */
    formattedValue(digits?: number): string {
        const places = digits ?? (this.dimensionType === "angular" ? 1 : 2);
        const measured = this.value.toFixed(places);
        if (this.textOverride !== "") return this.textOverride.replaceAll("<>", measured);
        const prefix = this.dimensionType === "radial" ? "R" : this.dimensionType === "diameter" ? "Ø" : "";
        const suffix = this.dimensionType === "angular" ? "°" : "";
        return `${prefix}${measured}${suffix}`;
    }

    constructor(options: DimensionAnnotationOptions) {
        super(options);
        this.setPrivateValue("dimensionType", options.dimensionType ?? "linear");
        this.setPrivateValue("startPoint", options.startPoint);
        this.setPrivateValue("endPoint", options.endPoint);
        this.setPrivateValue("textPoint", options.textPoint);
        if (options.centerPoint !== undefined) {
            this.setPrivateValue("centerPoint", options.centerPoint);
        }
        if (options.planeNormal !== undefined) {
            this.setPrivateValue("planeNormal", options.planeNormal);
        }
        if (options.textHeight !== undefined && options.textHeight > 0) {
            this.setPrivateValue("textHeight", options.textHeight);
        }
        if (options.textOverride !== undefined) {
            this.setPrivateValue("textOverride", options.textOverride);
        }
    }

    override display(): I18nKeys {
        return "annotation.dimension";
    }

    override boundingBox(): BoundingBox | undefined {
        const points = [this.startPoint, this.endPoint, this.textPoint];
        if (this.centerPoint !== undefined) points.push(this.centerPoint);
        return BoundingBox.fromPoints(points);
    }
}

@serializable()
export class TextAnnotation extends Annotation {
    declare readonly annotationType: "text";

    @serialize()
    get content(): string {
        return this.getPrivateValue("content");
    }
    set content(value: string) {
        this.setProperty("content", value);
    }

    @serialize()
    get position(): XYZ {
        return this.getPrivateValue("position");
    }
    set position(value: XYZ) {
        this.setProperty("position", value);
    }

    constructor(options: TextAnnotationOptions) {
        super(options);
        this.setPrivateValue("content", options.content);
        this.setPrivateValue("position", options.position);
    }
}

@serializable()
export class RefInfiniteLineAnnotation extends Annotation {
    declare readonly annotationType: "refInfiniteLine";

    @serialize()
    get point(): XYZ {
        return this.getPrivateValue("point");
    }
    set point(value: XYZ) {
        this.setProperty("point", value);
    }

    @serialize()
    get direction(): XYZ {
        return this.getPrivateValue("direction");
    }
    set direction(value: XYZ) {
        this.setProperty("direction", value);
    }

    constructor(options: RefInfiniteLineAnnotationOptions) {
        super(options);
        this.setPrivateValue("point", options.point);
        this.setPrivateValue("direction", options.direction);
    }
}

@serializable()
export class RefSegmentAnnotation extends Annotation {
    declare readonly annotationType: "refSegment";

    @serialize()
    get startPoint(): XYZ {
        return this.getPrivateValue("startPoint");
    }
    set startPoint(value: XYZ) {
        this.setProperty("startPoint", value);
    }

    @serialize()
    get endPoint(): XYZ {
        return this.getPrivateValue("endPoint");
    }
    set endPoint(value: XYZ) {
        this.setProperty("endPoint", value);
    }

    constructor(options: RefSegmentAnnotationOptions) {
        super(options);
        this.setPrivateValue("startPoint", options.startPoint);
        this.setPrivateValue("endPoint", options.endPoint);
    }

    override boundingBox(): BoundingBox | undefined {
        return BoundingBox.fromPoints([this.startPoint, this.endPoint]);
    }
}
