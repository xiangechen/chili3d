// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type I18nKeys,
    type IDocument,
    type IShape,
    ParameterShapeNode,
    Plane,
    property,
    type Result,
    serializable,
    serialize,
    XYZ,
} from "@chili3d/core";
import { metresToMillimetres } from "../units";
import { MCT88 } from "../catalogue";

export interface TowerCraneBodyNodeOptions {
    document: IDocument;
    /** Crane catalogue entry; defaults to MCT 88. */
    crane?: typeof MCT88;
    /** Jib length in metres. Defaults to catalogue defaultJibM. */
    jibLengthM?: number;
}

@serializable()
export class TowerCraneBodyNode extends ParameterShapeNode {
    private readonly _crane: typeof MCT88;

    override display(): I18nKeys {
        return "body.parametricBody";
    }

    @serialize()
    get craneId(): string {
        return this._crane.id;
    }

    @serialize()
    @property("towerplanner.jibLength" as any)
    get jibLengthM(): number {
        return this.getPrivateValue("jibLengthM");
    }
    set jibLengthM(value: number) {
        if (!Number.isFinite(value)) {
            throw new Error("jibLengthM must be a finite number");
        }
        if (value <= 0) {
            throw new Error("jibLengthM must be greater than 0");
        }
        const maxJib = this._crane.maxJibLengthM.value;
        if (value > maxJib + 1e-9) {
            throw new Error(`jibLengthM ${value} m exceeds crane maximum ${maxJib} m`);
        }
        this.setPropertyEmitShapeChanged("jibLengthM", value);
    }

    get crane(): typeof MCT88 {
        return this._crane;
    }

    constructor(options: TowerCraneBodyNodeOptions) {
        super({ document: options.document, name: "Tower Crane" });
        this._crane = options.crane ?? MCT88;
        this.setPrivateValue(
            "jibLengthM",
            options.jibLengthM ?? this._crane.defaultJibM.value,
        );
    }

    generateShape(): Result<IShape> {
        const crane = this._crane;
        const jibLengthMm = metresToMillimetres(this.jibLengthM);
        const mastWidthMm = metresToMillimetres(crane.dimensions.mastWidthM.value);
        const counterJibLengthMm = metresToMillimetres(crane.dimensions.counterJibLengthM.value);

        // Mast height: INDICATIVE - freestanding height for MCT 88 is approximately 50m
        // This is not a sourced value; a real project would use the specific mast configuration.
        const MAST_HEIGHT_M_INDICATIVE = 50;
        const mastHeightMm = metresToMillimetres(MAST_HEIGHT_M_INDICATIVE);

        // Cross-section dimensions (INDICATIVE)
        const JIB_WIDTH_MM = metresToMillimetres(2.0);    // 2m wide
        const JIB_DEPTH_MM = metresToMillimetres(2.5);    // 2.5m deep
        const MAST_RADIUS_MM = mastWidthMm / 2;
        const COUNTER_JIB_WIDTH_MM = metresToMillimetres(3.0);
        const COUNTER_JIB_DEPTH_MM = metresToMillimetres(2.5);
        const SLEW_UNIT_HEIGHT_MM = metresToMillimetres(4.0);

        const planeXY = Plane.XY;
        const shapes: IShape[] = [];

        // 1. Mast - vertical cylinder at origin
        const mastResult = shapeFactory.cylinder(
            XYZ.unitZ,
            XYZ.zero,
            MAST_RADIUS_MM,
            mastHeightMm,
        );
        if (!mastResult.isOk) return mastResult;
        shapes.push(mastResult.value);

        // 2. Slewing unit - box on top of mast
        const slewPlane = planeXY.translateTo(new XYZ({ x: 0, y: 0, z: mastHeightMm }));
        const slewResult = shapeFactory.box(
            slewPlane,
            metresToMillimetres(3.0), // 3m wide
            metresToMillimetres(3.0), // 3m deep
            SLEW_UNIT_HEIGHT_MM,
        );
        if (!slewResult.isOk) return slewResult;
        shapes.push(slewResult.value);

        // 3. Jib - horizontal box extending along +X from slewing unit center
        // Jib starts at slewing unit center (x=0) and extends to +jibLengthMm
        const jibPlane = planeXY.translateTo(
            new XYZ({ x: 0, y: 0, z: mastHeightMm + SLEW_UNIT_HEIGHT_MM / 2 }),
        );
        const jibResult = shapeFactory.box(
            jibPlane,
            jibLengthMm,
            JIB_WIDTH_MM,
            JIB_DEPTH_MM,
        );
        if (!jibResult.isOk) return jibResult;
        shapes.push(jibResult.value);

        // 4. Counter-jib - horizontal box extending along -X
        const counterJibPlane = planeXY.translateTo(
            new XYZ({ x: -counterJibLengthMm, y: 0, z: mastHeightMm + SLEW_UNIT_HEIGHT_MM / 2 }),
        );
        const counterJibResult = shapeFactory.box(
            counterJibPlane,
            counterJibLengthMm,
            COUNTER_JIB_WIDTH_MM,
            COUNTER_JIB_DEPTH_MM,
        );
        if (!counterJibResult.isOk) return counterJibResult;
        shapes.push(counterJibResult.value);

        // 5. Counterweights - simplified as a box at the end of counter-jib
        const cwPlane = planeXY.translateTo(
            new XYZ({
                x: -counterJibLengthMm - metresToMillimetres(1.0),
                y: 0,
                z: mastHeightMm + SLEW_UNIT_HEIGHT_MM / 2,
            }),
        );
        const cwResult = shapeFactory.box(
            cwPlane,
            metresToMillimetres(2.0),
            metresToMillimetres(4.0),
            metresToMillimetres(2.0),
        );
        if (!cwResult.isOk) return cwResult;
        shapes.push(cwResult.value);

        // Combine all components into a single compound
        return shapeFactory.combine(shapes);
    }
}

// Re-export for convenience
export { MCT88 } from "../catalogue";
export { metresToMillimetres } from "../units";