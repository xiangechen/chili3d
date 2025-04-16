// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

export enum ObjectSnapType {
    none = 0,
    endPoint = 1,
    midPoint = 1 << 1,
    center = 1 << 2,
    angle = 1 << 3,
    intersection = 1 << 4,
    perpendicular = 1 << 5,
    extension = 1 << 6,
    parallel = 1 << 7,
    special = 1 << 8,
    nearest = 1 << 9,
    vertex = 1 << 10,
    grid = 1 << 11,
}

export namespace ObjectSnapType {
    export function has(snapTypes: ObjectSnapType, targetType: ObjectSnapType) {
        return (snapTypes & targetType) === targetType;
    }

    export function add(snapTypes: ObjectSnapType, targetType: ObjectSnapType) {
        return snapTypes | targetType;
    }

    export function remove(snapTypes: ObjectSnapType, targetType: ObjectSnapType) {
        return snapTypes & ~targetType;
    }
}
