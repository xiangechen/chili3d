// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Binding, Config, IApplication, ICommand, command } from "chili-core";

@command({
    key: "workingPlane.toggleDynamic",
    toggle: new Binding(Config.instance, "dynamicWorkplane"),
    icon: "icon-dynamicPlane",
})
export class ToggleDynamicWorkplaneCommand implements ICommand {
    async execute(app: IApplication): Promise<void> {
        Config.instance.dynamicWorkplane = !Config.instance.dynamicWorkplane;
    }
}
