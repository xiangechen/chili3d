// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { Result } from "..";

export async function readFilesAsync(accept: string, multiple: boolean): Promise<Result<FileList>> {
    return new Promise((resolve, _reject) => {
        let input = document.createElement("input");
        input.type = "file";
        input.multiple = multiple;
        input.accept = accept;
        input.style.visibility = "hidden";
        input.onchange = async () => {
            document.body.removeChild(input);
            let files = input.files;
            if (files === null) {
                resolve(Result.err(`no files selected`));
            } else {
                resolve(Result.ok(files));
            }
        };
        input.oncancel = () => {
            document.body.removeChild(input);
            resolve(Result.err(`cancel`));
        };
        document.body.appendChild(input);
        input.click();
    });
}

export interface FileData {
    fileName: string;
    data: string;
}

export async function readFileAsync(
    accept: string,
    multiple: boolean,
    method: "readAsText" | "readAsDataURL" = "readAsText",
): Promise<Result<FileData[]>> {
    let files = await readFilesAsync(accept, multiple);
    if (!files.isOk) {
        return files.parse();
    }

    return readInputedFiles(files.value, method);
}

async function readInputedFiles(files: FileList, method: "readAsText" | "readAsDataURL") {
    let result: FileData[] = [];
    for (const file of files) {
        let data = await readFileDataAsync(file, method);
        if (!data) {
            return Result.err(`Error occurred reading file: ${file.name}`);
        }

        result.push({
            fileName: file.name,
            data,
        });
    }
    return Result.ok(result);
}

function readFileDataAsync(file: File, method: any): Promise<string | null> {
    return new Promise((resolve) => {
        let reader = new FileReader();
        reader.onload = (e) => {
            if (e.target?.readyState === FileReader.DONE) {
                resolve(e.target.result as string);
            }
        };
        reader.onerror = () => {
            resolve(null);
        };
        (reader as any)[method](file);
    });
}
