// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    AsyncController,
    command,
    type GeometryNode,
    type IEdge,
    type IShape,
    type IStep,
    type IWire,
    PreviewVisual,
    PubSub,
    property,
    Result,
    SelectShapeStep,
    type ShapeType,
    ShapeTypes,
    type SnapResult,
    type VisualShapeData,
    VisualStates,
} from "@chili3d/core";
import { SweepedNode } from "../../bodys";
import { CreateFromSelectionCommand } from "../createCommand";

@command({
    key: "create.sweep",
    icon: "icon-sweep",
})
export class Sweep extends CreateFromSelectionCommand {
    private readonly preview = new PreviewVisual();
    private pathWire: IWire | undefined;

    @property("option.command.isRoundCorner")
    get round() {
        return this.getPrivateValue("round", false);
    }

    set round(value: boolean) {
        this.setProperty("round", value);
    }

    protected override geometryNode(): GeometryNode {
        const profiles = this.transformdShapes(this.stepDatas[0], false) as (IWire | IEdge)[];
        return new SweepedNode({
            document: this.document,
            profile: profiles,
            path: this.pathShape(),
            round: this.round,
        });
    }

    /** The committed path; `canExecute` already built and validated it for a real run. */
    private pathShape(): IWire {
        if (this.pathWire !== undefined) return this.pathWire;
        const wire = this.buildWire(this.stepDatas.at(1)?.shapes ?? []);
        if (!wire.isOk) throw wire.error;
        return wire.value;
    }

    protected override canExecute(): boolean {
        if (!super.canExecute()) return false;

        this.pathWire = undefined;
        const path = this.stepDatas.at(1)?.shapes ?? [];
        if (path.length === 0) {
            PubSub.default.pub("showToast", "error.default:{0}", "Sweep requires a path");
            return false;
        }
        const wire = this.buildWire(path);
        if (!wire.isOk) {
            PubSub.default.pub("showToast", "error.default:{0}", wire.error);
            return false;
        }
        this.pathWire = wire.value;
        return true;
    }

    protected override getSteps(): IStep[] {
        return [
            new SelectShapeStep((ShapeTypes.edge | ShapeTypes.wire) as ShapeType, "prompt.select.section", {
                multiple: true,
                showConfirmControl: true,
                selectedState: VisualStates.edgeSelected,
            }),
            new SelectShapeStep((ShapeTypes.edge | ShapeTypes.wire) as ShapeType, "prompt.select.path", {
                multiple: false,
                showConfirmControl: true,
                highlightState: VisualStates.edgeHighlight,
                selectedState: VisualStates.edgeSelected,
            }),
        ];
    }

    /**
     * The pick loop: the profiles in one pick, then the path edges one click at a time, with
     * the swept tool re-shown after each. A multi path pick would resolve once at the end and
     * leave nothing to preview in between; the picks accumulate into `stepDatas[1]` so the
     * sweep still sees the whole path at once.
     */
    protected override async executeSteps(): Promise<boolean> {
        const steps = this.getSteps();
        const profile = await this.runStep(steps[0]);
        if (profile === undefined) return false;

        const path: SnapResult = { view: profile.view, type: "shape", shapes: [] };
        this.stepDatas.push(profile, path);
        try {
            while (true) {
                const picked = await this.runStep(steps[1]);
                if (picked === undefined) {
                    // The bar's confirm reports success with nothing under the cursor; a
                    // cancel reports cancel. Either way the list is over — but a sweep with
                    // no path at all has nothing to commit.
                    return path.shapes.length > 0 && this.controller?.result?.status === "success";
                }
                path.shapes.push(...picked.shapes);
                this.displayPreview();
            }
        } finally {
            this.preview.hide(this.document);
            if (!this._isRestarting) this.document?.selection.clearSelection();
        }
    }

    private async runStep(step: IStep): Promise<SnapResult | undefined> {
        this.controller = new AsyncController();
        return step.execute(this.document, this.controller);
    }

    /** The preview so far, refreshed after every path pick. */
    private displayPreview(): void {
        const tool = this.buildTool();
        if (!tool.isOk) {
            // A path that cannot be swept yet simply has no preview.
            this.preview.show(this.document, []);
            return;
        }
        try {
            const faces = tool.value.mesh.faces;
            this.preview.show(this.document, faces === undefined ? [] : [faces]);
        } finally {
            tool.value.dispose();
        }
    }

    /** The swept tool in world coordinates, built from the picks so far. */
    private buildTool(): Result<IShape> {
        const path = this.stepDatas.at(1)?.shapes ?? [];
        if (path.length === 0) return Result.err("Sweep has no path");
        const wire = this.buildWire(path);
        if (!wire.isOk) return Result.err(wire.error);

        const profiles = this.stepDatas[0].shapes.map((x) => x.shape.transformedMul(x.transform));
        try {
            return shapeFactory.sweep(profiles as (IWire | IEdge)[], wire.value, this.round);
        } finally {
            wire.value.dispose();
            profiles.forEach((x) => x.dispose());
        }
    }

    /** The picked path as one wire in world coordinates — a whole wire, or a chain of edges. */
    private buildWire(path: readonly VisualShapeData[]): Result<IWire> {
        const wires = path.filter((x) => x.shape.shapeType === ShapeTypes.wire);
        if (wires.length > 0) {
            if (path.length !== 1) return Result.err("A sweep path is one wire or a chain of edges");
            return Result.ok(path[0].shape.transformedMul(path[0].transform) as IWire);
        }
        const edges = path.map((x) => x.shape.transformedMul(x.transform) as IEdge);
        try {
            return shapeFactory.wire(edges);
        } finally {
            // The copies exist only to feed the wire; the kernel keeps its own shape.
            edges.forEach((x) => x.dispose());
        }
    }
}
