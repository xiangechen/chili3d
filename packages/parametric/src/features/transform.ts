// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    ANGLE_UNITS,
    type FeatureParameter,
    type IShape,
    LENGTH_UNITS,
    Matrix4,
    type ParameterValue,
    Result,
    XYZ,
    type XYZLike,
} from "@chili3d/core";
import { type FeatureHandler, registerFeature, type TransformFeatureData } from "./feature";

/** Rigid enough for `gp_Trsf`: orthonormal columns, |det| = 1, no perspective row. */
const RIGID_EPSILON = 1e-6;

const TRANSLATION_KEYS = ["tx", "ty", "tz"] as const;
const ROTATION_KEYS = ["rx", "ry", "rz"] as const;

function finiteMatrix(matrix: readonly number[] | undefined): Matrix4 | undefined {
    if (!Array.isArray(matrix) || matrix.length !== 16) return undefined;
    if (!matrix.every((value) => Number.isFinite(value))) return undefined;
    return Matrix4.fromArray(matrix);
}

function translationOf(matrix: Matrix4): XYZ {
    const array = matrix.toArray();
    return new XYZ({ x: array[12], y: array[13], z: array[14] });
}

function column(array: readonly number[], index: number): XYZ {
    return new XYZ({ x: array[index], y: array[index + 1], z: array[index + 2] });
}

/**
 * `gp_Trsf` is a similarity transform: a non-uniform scale or a shear is silently
 * orthogonalized by OCCT, so the geometry would quietly change shape. Reject it here
 * instead. A mirror (determinant −1) is a legitimate similarity and is kept.
 */
export function isRigidTransform(matrix: Matrix4): boolean {
    const array = matrix.toArray();
    if (Math.abs(array[3]) > RIGID_EPSILON) return false;
    if (Math.abs(array[7]) > RIGID_EPSILON) return false;
    if (Math.abs(array[11]) > RIGID_EPSILON) return false;
    if (Math.abs(array[15] - 1) > RIGID_EPSILON) return false;

    const columns = [column(array, 0), column(array, 4), column(array, 8)];
    for (const vector of columns) {
        if (Math.abs(vector.length() - 1) > RIGID_EPSILON) return false;
    }
    const [x, y, z] = columns;
    if (Math.abs(x.dot(y)) > RIGID_EPSILON) return false;
    if (Math.abs(x.dot(z)) > RIGID_EPSILON) return false;
    if (Math.abs(y.dot(z)) > RIGID_EPSILON) return false;
    return Math.abs(Math.abs(matrix.determinant()) - 1) <= RIGID_EPSILON;
}

/** Euler angles in DEGREES for the panel, or undefined for a mirror / non-rigid matrix. */
function eulerDegrees(matrix: Matrix4): XYZLike | undefined {
    if (!isRigidTransform(matrix) || matrix.determinant() < 0) return undefined;
    const euler = matrix.getEulerAngles();
    const rebuilt = Matrix4.createFromTRS(translationOf(matrix), euler, { x: 1, y: 1, z: 1 });
    if (!sameMatrix(rebuilt, matrix)) return undefined;
    return {
        x: radiansToDegrees(euler.pitch),
        y: radiansToDegrees(euler.yaw),
        z: radiansToDegrees(euler.roll),
    };
}

function rebuild(translation: XYZLike, rotation: XYZLike): Matrix4 {
    return Matrix4.createFromTRS(
        translation,
        {
            pitch: degreesToRadians(rotation.x),
            yaw: degreesToRadians(rotation.y),
            roll: degreesToRadians(rotation.z),
        },
        { x: 1, y: 1, z: 1 },
    );
}

function sameMatrix(left: Matrix4, right: Matrix4): boolean {
    const a = left.toArray();
    const b = right.toArray();
    return a.every((value, index) => Math.abs(value - b[index]) <= RIGID_EPSILON);
}

const radiansToDegrees = (radians: number) => (radians * 180) / Math.PI;
const degreesToRadians = (degrees: number) => (degrees * Math.PI) / 180;

function numeric(value: ParameterValue | boolean): number | undefined {
    if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
    if (typeof value === "string") {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
}

function translationParameters(matrix: Matrix4): FeatureParameter[] {
    const translation = translationOf(matrix);
    const values = [translation.x, translation.y, translation.z];
    const displays = [
        "feature.transform.translateX",
        "feature.transform.translateY",
        "feature.transform.translateZ",
    ] as const;
    return TRANSLATION_KEYS.map((key, index) => ({
        key,
        display: displays[index],
        value: values[index],
        unit: LENGTH_UNITS,
    }));
}

function rotationParameters(matrix: Matrix4): FeatureParameter[] {
    const rotation = eulerDegrees(matrix);
    if (rotation === undefined) return [];
    const values = [rotation.x, rotation.y, rotation.z];
    const displays = [
        "feature.transform.rotateX",
        "feature.transform.rotateY",
        "feature.transform.rotateZ",
    ] as const;
    return ROTATION_KEYS.map((key, index) => ({
        key,
        display: displays[index],
        value: values[index],
        unit: ANGLE_UNITS,
    }));
}

const transformHandler: FeatureHandler<TransformFeatureData> = {
    display: "command.feature.transform",
    icon: "icon-move",

    nodeIds: () => [],

    parameters: (feature) => {
        const matrix = finiteMatrix(feature.matrix);
        if (matrix === undefined) return [];
        return [...translationParameters(matrix), ...rotationParameters(matrix)];
    },

    setParameter: (feature, key, value) => {
        const matrix = finiteMatrix(feature.matrix);
        if (matrix === undefined) return feature;
        const array = [...matrix.toArray()];

        const translation = translationOf(matrix);
        if (key === "tx" || key === "ty" || key === "tz") {
            const next = numeric(value);
            if (next === undefined) return feature;
            array[12 + TRANSLATION_KEYS.indexOf(key)] = next;
            return { ...feature, matrix: array };
        }

        const rotationIndex = ROTATION_KEYS.indexOf(key as (typeof ROTATION_KEYS)[number]);
        if (rotationIndex < 0) return feature;
        const next = numeric(value);
        const rotation = eulerDegrees(matrix);
        if (next === undefined || rotation === undefined) return feature;
        const angles = [rotation.x, rotation.y, rotation.z];
        angles[rotationIndex] = next;
        return {
            ...feature,
            matrix: rebuild(translation, { x: angles[0], y: angles[1], z: angles[2] }).toArray(),
        };
    },

    evaluate(feature, context): Result<IShape> {
        const input = context.input;
        if (input === undefined) return Result.err("Transform requires a preceding feature");
        const matrix = finiteMatrix(feature.matrix);
        if (matrix === undefined) return Result.err("Transform matrix must be 16 finite numbers");
        if (!isRigidTransform(matrix)) {
            return Result.err("Transform supports only rigid transforms (no non-uniform scale)");
        }

        // `BRepBuilderAPI_Transform` rebuilds the topology without reordering its
        // enumeration, so the sub-shape ids carry over positionally (see mirror.ts).
        const tracking = context.tracking;
        if (tracking !== undefined) {
            tracking.outputFaceIds = [...tracking.inputFaceIds];
            tracking.outputEdgeIds = [...tracking.inputEdgeIds];
        }
        if (matrix.equals(Matrix4.identity())) return Result.ok(input);
        return Result.ok(input.transformedMul(matrix));
    },
};

registerFeature("transform", transformHandler);
