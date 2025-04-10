// Copyright (c) 2022-2025 陈仙阁 (Chen Xiange)
// Chili3d is licensed under the AGPL-3.0 License.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const COPYRIGHT = `// Copyright (c) 2022-2025 陈仙阁 (Chen Xiange)\n`;

const ROOT_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const TARGET_PATHS = [
    {
        dir: path.join(ROOT_DIR, "packages"),
        extensions: [".ts"],
    },
    {
        dir: path.join(ROOT_DIR, "cpp", "src"),
        extensions: [".hpp", ".cpp"],
    },
];

function addCopyrightToFile(filePath) {
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split("\n");

    const hasExistingCopyright = lines[0].includes("Copyright");

    if (hasExistingCopyright) {
        const newContent = COPYRIGHT + lines.slice(1).join("\n");
        fs.writeFileSync(filePath, newContent);
    } else if (!content.startsWith(COPYRIGHT)) {
        fs.writeFileSync(filePath, COPYRIGHT + content);
    }
}

function processDirectory(dirPath, extensions) {
    const files = fs.readdirSync(dirPath);

    for (const file of files) {
        const fullPath = path.join(dirPath, file);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
            processDirectory(fullPath, extensions);
        } else if (extensions.includes(path.extname(file))) {
            addCopyrightToFile(fullPath);
        }
    }
}

function main() {
    for (const target of TARGET_PATHS) {
        if (fs.existsSync(target.dir)) {
            processDirectory(target.dir, target.extensions);
        } else {
            console.warn(`Directory not found: ${target.dir}`);
        }
    }
}

main();
