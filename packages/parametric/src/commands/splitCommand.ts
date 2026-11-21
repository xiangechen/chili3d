// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type AsyncController,
    Combobox,
    command,
    GetOrSelectNodeStep,
    type I18nKeys,
    type IDocument,
    Id,
    type IFace,
    type INode,
    type IShape,
    type IStep,
    MultistepCommand,
    PubSub,
    property,
    Result,
    type SnapResult,
    Transaction,
} from "@chili3d/core";
import type { SplitFeatureData } from "../features/feature";
import { neutralPlaneInHost } from "../features/neutralPlane";
import { splitByPlane, splitBySurface } from "../features/split";
import { ParametricBodyNode } from "../parametricBodyNode";
import { type DragPreview, PreviewConfirmHandler } from "./previewConfirmHandler";
import { type PickedSplitTool, SelectSplitToolStep } from "./splitToolStep";

const KEEP_BOTH: I18nKeys = "option.command.keepSide.both";
const KEEP_POSITIVE: I18nKeys = "option.command.keepSide.positive";
const KEEP_NEGATIVE: I18nKeys = "option.command.keepSide.negative";

interface SplitPreview {
    readonly shape: IShape;
    readonly body: ParametricBodyNode;
}

export class SplitPreviewHandler extends PreviewConfirmHandler {
    private valid = false;

    constructor(
        document: IDocument,
        controller: AsyncController,
        private readonly build: () => SplitPreview | undefined,
        private readonly stateChanged: (handler: SplitPreviewHandler | undefined) => void,
    ) {
        super(document, controller);
        this.start();
    }

    protected override buildPreview(): DragPreview {
        this.valid = false;
        const preview = this.build();
        if (preview === undefined) return { meshes: [] };

        const { faces, edges } = preview.shape.mesh;
        preview.shape.dispose();
        this.valid = true;
        return {
            meshes: [faces, edges].filter((x) => x !== undefined),
            hide: [preview.body],
        };
    }

    protected override canConfirm(): boolean {
        return this.valid;
    }

    protected override onReady(): void {
        this.stateChanged(this);
    }

    protected override onCleanup(): void {
        this.stateChanged(undefined);
    }
}

export class SplitPreviewStep implements IStep {
    constructor(
        private readonly build: () => SplitPreview | undefined,
        private readonly stateChanged: (handler: SplitPreviewHandler | undefined) => void,
    ) {}

    async execute(document: IDocument, controller: AsyncController): Promise<SnapResult | undefined> {
        const handler = new SplitPreviewHandler(document, controller, this.build, this.stateChanged);
        try {
            await document.picker.pickAsync(
                handler,
                "prompt.splitPreview",
                controller,
                "none",
                "select.default",
            );
        } finally {
            handler.dispose();
        }
        const view = handler.commitView ?? document.application.activeView;
        if (controller.result?.status !== "success" || view === undefined) return undefined;
        return { view, shapes: [], type: "input" };
    }
}

/**
 * Split a parametric body with a datum, a plane, or a curved solid face. The pick opens a live
 * preview instead of committing immediately, so the keep-side option can be checked on both
 * sides before Enter or the confirm button appends the feature.
 */
@command({ key: "feature.split", icon: "icon-split" })
export class SplitFeatureCommand extends MultistepCommand {
    @property("option.command.keepSide", {
        combobox: Combobox.from([KEEP_BOTH, KEEP_POSITIVE, KEEP_NEGATIVE]),
    })
    get keepSide(): I18nKeys {
        return this.getPrivateValue("keepSide", KEEP_BOTH);
    }
    set keepSide(value: I18nKeys) {
        this.setProperty("keepSide", value, () => {
            this.lastPreviewError = undefined;
            this.previewHandler?.refresh();
        });
    }

    private tool: PickedSplitTool | undefined;
    private previewHandler: SplitPreviewHandler | undefined;
    private lastPreviewError: string | undefined;

    protected override onRestarting(): void {
        super.onRestarting();
        this.tool = undefined;
        this.previewHandler = undefined;
        this.lastPreviewError = undefined;
    }

    protected override getSteps(): IStep[] {
        return [
            new GetOrSelectNodeStep("prompt.select.models", {
                filter: { allow: (node: INode) => node instanceof ParametricBodyNode },
            }),
            new SelectSplitToolStep((picked) => {
                this.tool = picked;
                if (picked.kind === "surface") this.disposeStack.add(picked.face);
            }),
            new SplitPreviewStep(this.buildPreview, (handler) => {
                this.previewHandler = handler;
            }),
        ];
    }

    private get side(): "both" | "positive" | "negative" {
        if (this.keepSide === KEEP_POSITIVE) return "positive";
        if (this.keepSide === KEEP_NEGATIVE) return "negative";
        return "both";
    }

    private readonly buildPreview = (): SplitPreview | undefined => {
        const body = this.stepDatas[0]?.nodes?.[0];
        const tool = this.tool;
        if (!(body instanceof ParametricBodyNode) || tool === undefined) return undefined;
        const result = this.buildLocalSplit(body, tool);
        if (!result.isOk) return this.reportPreviewError(result.error);
        this.lastPreviewError = undefined;

        const world = result.value.transformedMul(body.worldTransform());
        result.value.dispose();
        return { shape: world, body };
    };

    private reportPreviewError(error: string): undefined {
        if (this.lastPreviewError !== error) {
            this.lastPreviewError = error;
            PubSub.default.pub("showToast", "error.default:{0}", error);
        }
        return undefined;
    }

    private buildLocalSplit(body: ParametricBodyNode, tool: PickedSplitTool): Result<IShape> {
        const shape = body.shape;
        if (!shape.isOk) return Result.err(shape.error);
        if (tool.kind === "plane") {
            const plane = neutralPlaneInHost(tool.picked.plane, body, "Split");
            if (!plane.isOk) return Result.err(plane.error);
            return splitByPlane(shape.value, plane.value, this.side);
        }
        const inverse = body.worldTransform().invert();
        if (inverse === undefined) return Result.err("Split cannot place the surface in the body");
        const localTool = tool.face.transformedMul(inverse) as IFace;
        try {
            return splitBySurface(shape.value, [localTool], this.side);
        } finally {
            localTool.dispose();
        }
    }

    protected override executeMainTask(): void {
        const body = this.stepDatas[0].nodes?.[0];
        if (!(body instanceof ParametricBodyNode)) {
            PubSub.default.pub("showToast", "error.default:{0}", "Select a parametric body");
            return;
        }
        const tool = this.tool;
        if (tool === undefined) {
            PubSub.default.pub("showToast", "error.default:{0}", "Select a split plane or surface");
            return;
        }

        Transaction.execute(this.document, "excute feature.split", () => {
            body.setFeaturesEmitShapeChanged([...body.features, this.feature(tool.ref)]);
            this.document.visual.update();
        });
    }

    private feature(tool: SplitFeatureData["tool"]): SplitFeatureData {
        const keepSide = this.side === "both" ? undefined : this.side;
        return { id: Id.generate(), type: "split", tool, ...(keepSide === undefined ? {} : { keepSide }) };
    }
}
