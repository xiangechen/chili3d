// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

export interface IEqualityComparer<T> {
    equals(left: T, right: T): boolean;
}
