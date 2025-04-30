// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { GeometryNode, Property, Transaction } from "chili-core";
import { MultistepCommand } from "./multistepCommand";

let count = 1;

export abstract class CreateCommand extends MultistepCommand {
    protected override executeMainTask() {
        Transaction.execute(this.document, `excute ${Object.getPrototypeOf(this).data.name}`, () => {
            let node = this.geometryNode();
            this.document.addNode(node);
            this.document.visual.update();
        });
    }

    protected abstract geometryNode(): GeometryNode;
}

export abstract class CreateNodeCommand extends MultistepCommand {
    protected override executeMainTask() {
        Transaction.execute(this.document, `excute ${Object.getPrototypeOf(this).data.name}`, () => {
            this.document.addNode(this.getNode());
            this.document.visual.update();
        });
    }

    protected abstract getNode(): GeometryNode;
}

export abstract class CreateFaceableCommand extends CreateCommand {
    protected _isFace: boolean = false;
    @Property.define("option.command.isFace")
    public get isFace() {
        return this._isFace;
    }
    public set isFace(value: boolean) {
        this.setProperty("isFace", value);
    }
}
