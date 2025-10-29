// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

export interface IViewGizmo {
    update(): void;
    setDom(dom: HTMLElement): void;
    dispose(): void;
}
