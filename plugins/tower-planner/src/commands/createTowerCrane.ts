// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { command, type I18nKeys, type IApplication, type ICommand, PubSub, CancelableCommand } from "@chili3d/core";
import { TowerCraneBodyNode } from "../body/towerCraneBody";
import { MCT88 } from "../catalogue";

@command({
    key: "towerplanner.createCrane" as any,
    icon: "icon-box",
    helpText: "towerplanner.createCrane.help" as I18nKeys,
})
export class CreateTowerCraneCommand extends CancelableCommand implements ICommand {
    protected override async executeAsync(): Promise<void> {
        const doc = this.document;
        if (!doc) {
            PubSub.default.pub("showToast", "toast.document.noActivated");
            return;
        }

        // Create the tower crane body node with MCT 88 catalogue data
        const craneBody = new TowerCraneBodyNode({
            document: doc,
            crane: MCT88,
            jibLengthM: 30,
        });

        // Add to document
        doc.modelManager.addNode(craneBody);
        
        // Select it so it's visible in property panel
        doc.selection.setSelectedNodes([craneBody], false);

        PubSub.default.pub("showToast", "towerplanner.craneCreated" as I18nKeys);
    }
}