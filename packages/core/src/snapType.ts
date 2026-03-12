// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

export const ObjectSnapTypes = {
    none: 0,
    endPoint: 1,
    midPoint: 2,
    center: 4,
    angl: 8,
    intersection: 16,
    perpendicular: 32,
    extension: 64,
    parallel: 128,
    special: 256,
    nearest: 512,
    vertex: 1024,
    grid: 2048,
} as const;

export type ObjectSnapType = (typeof ObjectSnapTypes)[keyof typeof ObjectSnapTypes];

export class ObjectSnapTypeUtils {
    static hasType(snapTypes: ObjectSnapType, targetType: ObjectSnapType) {
        return (snapTypes & targetType) === targetType;
    }

    static addType(snapTypes: ObjectSnapType, targetType: ObjectSnapType) {
        return (snapTypes | targetType) as ObjectSnapType;
    }

    static removeType(snapTypes: ObjectSnapType, targetType: ObjectSnapType) {
        return (snapTypes & ~targetType) as ObjectSnapType;
    }

    static combine(...snapTypes: ObjectSnapType[]) {
        return snapTypes.reduce(ObjectSnapTypeUtils.addType, 0);
    }
}
