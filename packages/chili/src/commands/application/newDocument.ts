// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { IApplication, ICommand, command } from "chili-core";

let count = 1;

@command({
    key: "doc.new",
    icon: "icon-new",
})
export class NewDocument implements ICommand {
    async execute(app: IApplication): Promise<void> {
        await app.newDocument(`undefined ${count++}`);
    }
}
