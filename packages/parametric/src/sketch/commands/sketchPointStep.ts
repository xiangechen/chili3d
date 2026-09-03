// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type AsyncController, type IDocument, type PointSnapData, PointStep } from "@chili3d/core";

/**
 * PointStep for in-sketch drawing commands: the snapped-point marker and the
 * preview geometry render on top, so occluding bodies can't hide them.
 */
export class SketchPointStep extends PointStep {
    protected override getEventHandler(
        document: IDocument,
        controller: AsyncController,
        data: PointSnapData,
    ) {
        const handler = super.getEventHandler(document, controller, data);
        handler.facePreviewOpion = { meshOpacity: 1, onTop: true };
        handler.tempPointOption = { onTop: true };
        return handler;
    }
}
