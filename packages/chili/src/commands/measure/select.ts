// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { div } from "chili-controls";
import {
    AsyncController,
    BoundingBox,
    CancelableCommand,
    Combobox,
    command,
    I18n,
    I18nKeys,
    IEdge,
    IFace,
    ISolid,
    Matrix4,
    Property,
    ShapeType,
    VisualConfig,
    VisualShapeData,
    XYZ,
} from "chili-core";
import { SelectShapeStep } from "../../step";

@command({
    key: "measure.select",
    icon: "icon-measureSelect",
})
export class SelectMeasure extends CancelableCommand {
    #isChangedType = false;
    #sumUI?: HTMLElement;
    #sum = 0;
    get sum() {
        return this.#sum;
    }
    set sum(value: number) {
        this.#sum = value;
        this.#sumUI!.textContent = this.sumText();
    }

    @Property.define("common.type")
    public get category(): Combobox<string> {
        return this.getPrivateValue("category", this.initCombobox());
    }
    public set category(value: Combobox<string>) {
        this.getPrivateValue("category")?.clearPropertyChanged();
        value.onPropertyChanged(this.onTypeChange);
        this.setProperty("category", value);
    }

    private initCombobox() {
        const box = new Combobox<string>();
        box.items.push(
            I18n.translate("common.length"),
            I18n.translate("common.area"),
            I18n.translate("common.volume"),
        );
        box.onPropertyChanged(this.onTypeChange);
        return box;
    }

    private readonly onTypeChange = () => {
        this.#isChangedType = true;
        this.controller?.cancel();
        this.sum = 0;
    };

    protected override beforeExecute(): void {
        super.beforeExecute();

        this.#sumUI = div({
            textContent: this.sumText(),
            style: {
                position: "absolute",
                top: "10px",
                left: "10px",
                zIndex: "1000",
                padding: "4px 8px",
                backgroundColor: "var(--panel-background-color)",
                border: "1px solid var(--border-color)",
                borderRadius: "8px",
            },
        });
        this.application.activeView?.dom?.append(this.#sumUI);
    }

    private sumText() {
        return `Sum(${this.category.selectedItem}): ${this.#sum.toFixed(2)}`;
    }

    protected override afterExecute(): void {
        super.afterExecute();
        this.category?.clearPropertyChanged();
        this.#sumUI?.remove();
    }

    protected override async executeAsync(): Promise<void> {
        while (true) {
            this.controller = new AsyncController();
            let type: [ShapeType, I18nKeys] = [ShapeType.Edge, "prompt.select.edges"];
            if (this.category.selectedIndex === 1) {
                type = [ShapeType.Face, "prompt.select.faces"];
            } else if (this.category.selectedIndex === 2) {
                type = [ShapeType.Solid, "prompt.select.solids"];
            }

            const step = new SelectShapeStep(type[0], type[1]);
            const result = await step.execute(this.document, this.controller);
            if (this.controller.result?.status !== "success") {
                if (this.#isChangedType) {
                    this.#isChangedType = false;
                    continue;
                } else {
                    return;
                }
            }
            this.createMeasure(result?.shapes[0]);
        }
    }

    private readonly createMeasure = (shape: VisualShapeData | undefined) => {
        if (!shape) return;
        if (shape.shape.shapeType === ShapeType.Edge) {
            this.edgeMeasure(shape.shape as IEdge, shape.transform);
        } else if (shape.shape.shapeType === ShapeType.Face) {
            this.faceMeasure(shape.shape as IFace, shape.transform);
        } else if (shape.shape.shapeType === ShapeType.Solid) {
            this.solidMeasure(
                shape.shape as ISolid,
                shape.transform,
                BoundingBox.center(shape.owner.boundingBox()),
            );
        }
    };

    private edgeMeasure(edge: IEdge, transform: Matrix4) {
        edge = edge.transformedMul(transform) as IEdge;
        const start = edge.curve.startPoint();
        const end = edge.curve.endPoint();
        const length = edge.length();
        this.sum += length;
        const mesh = edge.mesh.edges!;
        edge.dispose();
        mesh.lineWidth = 3;
        mesh.color = VisualConfig.highlightEdgeColor;

        const id = this.document.visual.context.displayMesh(mesh);
        this.application.activeView!.htmlText(length.toFixed(2), start.add(end).multiply(0.5), {
            onDispose: () => {
                this.document.visual.context.removeMesh(id);
            },
        });
    }

    private faceMeasure(face: IFace, transform: Matrix4) {
        const wire = face.outerWire();
        const mesh = wire.mesh.edges!;
        wire.dispose();
        mesh.lineWidth = 3;
        mesh.color = VisualConfig.highlightEdgeColor;
        mesh.position = new Float32Array(transform.ofPoints(mesh.position));

        const area = face.area();
        this.sum += area;
        const center = this.wireCenter(mesh.position);
        const id = this.document.visual.context.displayMesh(mesh);
        this.application.activeView!.htmlText(area.toFixed(2), center, {
            onDispose: () => {
                this.document.visual.context.removeMesh(id);
            },
        });
    }

    private wireCenter(points: ArrayLike<number>) {
        const center = { x: 0, y: 0, z: 0 };
        for (let i = 0; i < points.length; i += 3) {
            center.x += points[i];
            center.y += points[i + 1];
            center.z += points[i + 2];
        }

        const length = points.length / 3;
        center.x /= length;
        center.y /= length;
        center.z /= length;
        return center;
    }

    private solidMeasure(solid: ISolid, transform: Matrix4, center: XYZ) {
        const mesh = solid.mesh.edges!;
        mesh.lineWidth = 3;
        mesh.color = VisualConfig.highlightEdgeColor;
        mesh.position = new Float32Array(transform.ofPoints(mesh.position));

        const volume = solid.volume();
        this.sum += volume;
        const id = this.document.visual.context.displayMesh(mesh);
        this.application.activeView!.htmlText(volume.toFixed(2), transform.ofPoint(center), {
            onDispose: () => {
                this.document.visual.context.removeMesh(id);
            },
        });
    }
}
