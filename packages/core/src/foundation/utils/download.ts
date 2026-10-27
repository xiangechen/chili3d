// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Hand `data` to the browser as a file download.
 *
 * The anchor has to be IN the document for the click to download everywhere (Firefox
 * ignores a detached one), and the blob URL has to outlive the click: revoking it in the
 * same tick — which this used to do — cancels the download in Safari and Firefox. It is
 * released a little later instead, once the browser has read the blob.
 */
export function download(data: BlobPart[], name: string) {
    const blob = new Blob(data);
    const url = URL.createObjectURL(blob);
    try {
        const a = document.createElement("a");
        a.style.visibility = "hidden";
        a.href = url;
        a.download = name;
        // Inside the topmost open dialog when there is one: a modal dialog makes everything
        // outside it inert, and an inert anchor's click does not download. This is the
        // common case here — exports run under `Permanent`'s spinner, which is a modal.
        const dialogs = document.querySelectorAll("dialog[open]");
        const host: Element = dialogs.length > 0 ? dialogs[dialogs.length - 1] : document.body;
        host.appendChild(a);
        try {
            a.click();
        } finally {
            a.remove();
        }
    } finally {
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }
}
