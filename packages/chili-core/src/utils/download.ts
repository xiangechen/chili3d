// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

export function download(data: BlobPart[], name: string) {
    let blob = new Blob(data);
    let a = document.createElement("a");
    a.style.visibility = "hidden";
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
}
