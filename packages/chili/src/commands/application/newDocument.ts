// Copyright (c) 2022-2025 陈仙阁 (Chen Xiange)
// Chili3d is licensed under the AGPL-3.0 License.

import { IApplication, ICommand, command } from "chili-core";

let count = 1;

@command({
    name: "doc.new",
    display: "command.document.new",
    icon: "icon-new",
})
export class NewDocument implements ICommand {
    async execute(app: IApplication): Promise<void> {
        await app.newDocument(`undefined ${count++}`);
    }
}
