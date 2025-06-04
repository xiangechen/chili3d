// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

export function download(data: BlobPart[], name: string) {
    let blob = new Blob(data);
    const url = URL.createObjectURL(blob);
    try {
        let a = document.createElement("a");
        a.style.visibility = "hidden";
        a.href = url;
        a.download = name;
        a.click();
    } finally {
        URL.revokeObjectURL(url);
    }
}
