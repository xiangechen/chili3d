// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type GeometryNode, property, Transaction } from "chili-core";
import { MultistepCommand } from "./multistepCommand";

const count = 1;

export abstract class CreateCommand extends MultistepCommand {
    protected override executeMainTask() {
        Transaction.execute(this.document, `excute ${Object.getPrototypeOf(this).data.name}`, () => {
            const node = this.geometryNode();
            this.document.modelManager.addNode(node);
            this.document.visual.update();
        });
    }

    protected abstract geometryNode(): GeometryNode;
}

export abstract class CreateNodeCommand extends MultistepCommand {
    protected override executeMainTask() {
        Transaction.execute(this.document, `excute ${Object.getPrototypeOf(this).data.name}`, () => {
            this.document.modelManager.addNode(this.getNode());
            this.document.visual.update();
        });
    }

    protected abstract getNode(): GeometryNode;
}

export abstract class CreateFaceableCommand extends CreateCommand {
    protected _isFace: boolean = false;
    @property("option.command.isFace")
    public get isFace() {
        return this._isFace;
    }
    public set isFace(value: boolean) {
        this.setProperty("isFace", value);
    }
}
