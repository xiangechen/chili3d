// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

type Tree<T> = T | Tree<T>[];

export function zipTrees<T, U>(
    trees: Tree<T>[],
    fn: (...values: T[]) => U,
    flatOne: boolean = true,
): Tree<U> {
    function helper(nodes: Tree<T>[]): Tree<U> {
        if (nodes.every((node) => !Array.isArray(node))) {
            return fn(...(nodes as T[]));
        }

        const maxLen = Math.max(...nodes.map((node) => (Array.isArray(node) ? node.length : 1)));

        const result: Tree<U>[] = [];

        for (let i = 0; i < maxLen; i++) {
            const nextNodes = nodes.map((node) => {
                if (!Array.isArray(node)) {
                    return node;
                } else {
                    return i < node.length ? node[i] : node[node.length - 1];
                }
            });
            result.push(helper(nextNodes));
        }

        if (flatOne && result.length === 1) {
            return result[0];
        }

        return result;
    }

    return helper(trees);
}

export function flatTree<T>(items: T | T[], filterUndefined = true) {
    const result: T[] = [];

    const helper = (item: T | T[]) => {
        if (Array.isArray(item)) {
            for (const sub of item) {
                helper(sub);
            }
        } else if (!filterUndefined || item) {
            result.push(item);
        }
    };

    helper(items);

    return result;
}
