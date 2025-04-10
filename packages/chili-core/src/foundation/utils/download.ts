// Copyright (c) 2022-2025 陈仙阁 (Chen Xiange)
// Chili3d is licensed under the AGPL-3.0 License.

export function download(data: BlobPart[], name: string) {
    let blob = new Blob(data);
    let a = document.createElement("a");
    a.style.visibility = "hidden";
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
}
