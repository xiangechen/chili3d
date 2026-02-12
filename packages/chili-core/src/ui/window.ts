// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IApplication } from "../application";
import type { Ribbon } from "./ribbon";

export interface IWindow extends HTMLElement {
    readonly ribbon: Ribbon;
    init(app: IApplication): Promise<void>;
}
