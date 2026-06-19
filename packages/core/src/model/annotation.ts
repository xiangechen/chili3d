// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument } from "../document";
import { Id } from "../foundation";
import type { I18nKeys } from "../i18n";
import { BoundingBox, type XYZ } from "../math";
import { serializable, serialize } from "../serialize";
import { Node } from "./node";
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

export interface DimensionAnnotationOptions extends AnnotationOptionsBase {
    annotationType: "dimension";
    startPoint: XYZ;
    endPoint: XYZ;
    value?: number;
    dimensionType?: "linear" | "angular" | "radial";
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
        return "annotation" as I18nKeys;
    }
    override boundingBox(): BoundingBox | undefined {
        return undefined;
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
