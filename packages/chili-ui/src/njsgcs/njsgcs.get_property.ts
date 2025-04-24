import { IApplication, Logger, Property, VisualNode } from "chili-core";
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
        let backresult = "";
        for (const entity of entities) {
            const properties = Property.getProperties(Object.getPrototypeOf(entity), Node.prototype);

            Property.getProperties(Object.getPrototypeOf(entity), Node.prototype).map(
                (x) => (backresult += `Property ${x.name} is ${(entity as any)[x.name]}\n`),
            );
        }

        Logger.info(backresult);
        return backresult;
        // entities[0].getPrivateValue(dx);
    }
}
