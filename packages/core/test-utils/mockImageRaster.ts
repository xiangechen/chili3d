// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { rs } from "@rstest/core";

export interface ImageRasterOptions {
    /** What a loaded image reports as its intrinsic size. */
    width: number;
    height: number;
    /** Fail the load instead of settling it. */
    fail?: boolean;
    /** Leave the load hanging, the way a request that never answers does. */
    never?: boolean;
    /** What a stubbed canvas answers for `toDataURL`. */
    toDataURL?: string;
}

/**
 * Lets code that rasterizes an image run under happy-dom, where `new Image()` never settles and
 * `getContext("2d")` returns null: images load at the given intrinsic size (or fail, or never
 * answer), and canvases take draws and answer `toDataURL` themselves.
 *
 * Undo it with `rs.restoreAllMocks(); rs.unstubAllGlobals();`.
 */
export function stubImageRaster(options: ImageRasterOptions): void {
    class StubImage {
        naturalWidth = 0;
        naturalHeight = 0;
        width = 0;
        height = 0;
        crossOrigin: string | null = null;
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;

        set src(_url: string) {
            if (options.never === true) return;
            queueMicrotask(() => {
                if (options.fail === true) {
                    this.onerror?.();
                    return;
                }
                this.naturalWidth = options.width;
                this.naturalHeight = options.height;
                this.onload?.();
            });
        }
    }
    rs.stubGlobal("Image", StubImage);

    rs.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => ({
        drawImage: () => {},
    })) as unknown as (typeof HTMLCanvasElement.prototype)["getContext"]);
    rs.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
        options.toDataURL ?? "data:image/png;base64,stub",
    );
}
