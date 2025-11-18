// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IViewGizmo } from "chili-core";

export class ViewGizmo extends HTMLElement implements IViewGizmo {
    update(): void {}
    dispose(): void {}
    setDom(dom: HTMLElement) {}
}

customElements.define("view-gizmo", ViewGizmo);
