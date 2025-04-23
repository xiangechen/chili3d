import { IApplication, Logger, Property, VisualNode } from "chili-core";
import { findPropertyControl } from "../property/utils";
export class njsgcs_get_property {
    static async get_property(app: IApplication) {
        Logger.info("njsgcs_get_property:");
        const document = app.activeView?.document;
        if (!document) {
            Logger.info("document is null");
            return;
        }
        const geometries = document.selection.getSelectedNodes();
        for (const geometry of geometries) {
            Logger.info(`SelectedNode class: ${geometry.constructor.name}`);
        }
        const entities = geometries.filter((x) => x instanceof VisualNode);
        Logger.info(...Property.getProperties(Object.getPrototypeOf(entities[0]), Node.prototype));

        Logger.info(
            ...Property.getProperties(Object.getPrototypeOf(entities[0]), Node.prototype).map((x) =>
                findPropertyControl(document, entities, x),
            ),
        );

        // entities[0].getPrivateValue("dx");
    }
}
