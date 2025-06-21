// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { div, h1, h2, span, ul } from "chili-controls";
import {
    AsyncController,
    BoundingBox,
    CancelableCommand,
    Combobox,
    command,
    I18nKeys,
    IDisposable,
    IEdge,
    IFace,
    ISolid,
    Localize,
    Matrix4,
    Property,
    ShapeType,
    VisualConfig,
    VisualShapeData,
    XYZ,
} from "chili-core";
import { SelectShapeStep } from "../../step";
import style from "./select.module.css";

@command({
    key: "measure.select",
    icon: "icon-measureSelect",
})
export class SelectMeasure extends CancelableCommand {
    #isChangedType = false;
    #sum = 0;
    #sumUI?: {
        container: HTMLDivElement;
        header: HTMLHeadingElement;
        list: HTMLUListElement;
        value: HTMLSpanElement;
    };
    readonly #disposeSet: Set<IDisposable> = new Set();

    #category?: Combobox<I18nKeys>;
    @Property.define("common.type")
    public get category(): Combobox<I18nKeys> {
        if (!this.#category) {
            this.#category = this.initCombobox();
        }
        return this.#category;
    }
    public set category(value: Combobox<I18nKeys>) {
        this.#category?.clearPropertyChanged();
        this.#category = value;
        this.#category.onPropertyChanged(this.onTypeChange);
    }

    private initCombobox() {
        const box = new Combobox<I18nKeys>();
        box.items.push("common.length", "common.area", "common.volume");
        box.onPropertyChanged(this.onTypeChange);
        return box;
    }

    private readonly onTypeChange = () => {
        this.#isChangedType = true;
        this.controller?.cancel();
        this.#sumUI?.container.remove();
        this.#sumUI = undefined;
        this.#disposeSet.forEach((d) => d.dispose());
        this.#disposeSet.clear();
        this.#sum = 0;
    };

    private initSumUI() {
        if (this.#sumUI) {
            this.#sumUI.container.remove();
        }
        this.#sumUI = {
            container: div({
                className: style.selectSum,
            }),
            header: h1({ textContent: new Localize(this.#category!.selectedItem!) }),
            list: ul(),
            value: span({
                textContent: "0.00",
            }),
        };
        this.#sumUI.container.append(this.#sumUI.header, this.#sumUI.list, h2(this.#sumUI.value));

        this.application.activeView?.dom?.append(this.#sumUI.container);
    }

    private addSumItem(item: number) {
        this.#sum += item;
        if (!this.#sumUI) {
            this.initSumUI();
        }

        const li = document.createElement("li");
        li.textContent = item.toFixed(2);
        this.#sumUI!.list.append(li);
        this.#sumUI!.value.textContent = this.#sum.toFixed(2);
    }

    protected override afterExecute(): void {
        super.afterExecute();
        this.category?.clearPropertyChanged();
        this.#disposeSet.forEach((d) => d.dispose());
        this.#disposeSet.clear();
        this.#sumUI?.container.remove();
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
        this.addSumItem(length);
        const mesh = edge.mesh.edges!;
        edge.dispose();
        mesh.lineWidth = 3;
        mesh.color = VisualConfig.highlightEdgeColor;

        const id = this.document.visual.context.displayMesh([mesh]);
        this.#disposeSet.add(
            this.application.activeView!.htmlText(length.toFixed(2), start.add(end).multiply(0.5), {
                hideDelete: true,
                onDispose: () => {
                    this.document.visual.context.removeMesh(id);
                },
            }),
        );
    }

    private faceMeasure(face: IFace, transform: Matrix4) {
        const wire = face.outerWire();
        const mesh = wire.mesh.edges!;
        wire.dispose();
        mesh.lineWidth = 3;
        mesh.color = VisualConfig.highlightEdgeColor;
        mesh.position = new Float32Array(transform.ofPoints(mesh.position));

        const area = face.area();
        this.addSumItem(area);
        const center = this.wireCenter(mesh.position);
        const id = this.document.visual.context.displayMesh([mesh]);
        this.#disposeSet.add(
            this.application.activeView!.htmlText(area.toFixed(2), center, {
                hideDelete: true,
                onDispose: () => {
                    this.document.visual.context.removeMesh(id);
                },
            }),
        );
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
        this.addSumItem(volume);
        const id = this.document.visual.context.displayMesh([mesh]);
        this.#disposeSet.add(
            this.application.activeView!.htmlText(volume.toFixed(2), transform.ofPoint(center), {
                hideDelete: true,
                onDispose: () => {
                    this.document.visual.context.removeMesh(id);
                },
            }),
        );
    }
}
