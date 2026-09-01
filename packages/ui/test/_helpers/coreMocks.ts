// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

// Shared stubs for the `@chili3d/core` mocks used by UI tests.
// Test files import one of the sibling `mockCore*.ts` modules (e.g. `mockCoreI18n`,
// `mockCoreProperty`, `mockCorePubSub`) BEFORE importing the module under test;
// each of those registers its `rs.mock("@chili3d/core", ...)` at module scope and
// composes the stubs below (`rs.mock` factories must stay sync — rstest does not
// await async factories — so these helpers are loaded via `rs.hoisted`).
//
// File-specific overrides (PubSub recorders, PropertyUtils, Config, ...) stay in
// the individual test files.

/** I18n stub: `translate` returns the key itself. */
export const I18nMock = {
    translate: (key: unknown, ..._args: unknown[]) => String(key),
};

/** Localize stub: `toString` returns the key itself. */
export class LocalizeMock {
    private key: unknown;
    constructor(key: unknown) {
        this.key = key;
    }
    toString() {
        return String(this.key);
    }
}

export class BindingMock {
    constructor(_value: unknown, _prop?: string, _converter?: unknown) {}
}

export class PathBindingMock {
    constructor(_value: unknown, _prop?: string, _converter?: unknown) {}
}

/** Transaction stub: executes the callback immediately. */
export const TransactionMock = {
    execute: (_doc: unknown, _desc: string, fn: () => void) => fn(),
};

/** FolderNode stub: tests opt a node into `instanceof` by linking its prototype. */
export class FolderNodeMock {}

/** Mirror of core's real guard (the mid-init snapshot can miss function exports). */
export function isFeatureListNodeMock(node: unknown): boolean {
    const candidate = node as {
        featureItems?: unknown;
        setFeatureParameter?: unknown;
        removeFeature?: unknown;
    };
    return (
        typeof candidate?.featureItems === "function" &&
        typeof candidate?.setFeatureParameter === "function" &&
        typeof candidate?.removeFeature === "function"
    );
}

/** No-op PubSub stub. */
export const PubSubMock = {
    default: {
        pub: () => {},
        sub: () => {},
    },
};

/**
 * PubSub stub that records `sub` handlers (keyed by topic) and `pub` calls, so
 * tests can look handlers up, invoke them directly and assert published topics.
 * Call `reset()` between tests.
 */
export function createPubSubRecorder() {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const pubs: { topic: string; args: unknown[] }[] = [];
    return {
        handlers,
        pubs,
        stub: {
            default: {
                pub: (topic: string, ...args: unknown[]) => {
                    pubs.push({ topic, args });
                },
                sub: (topic: string, handler: (...args: unknown[]) => unknown) => {
                    handlers.set(topic, handler);
                },
            },
        },
        reset() {
            handlers.clear();
            pubs.length = 0;
        },
    };
}

export type PubSubRecorder = ReturnType<typeof createPubSubRecorder>;

/** Minimal ObservableCollection stub backed by a plain array. */
// biome-ignore lint/suspicious/noExplicitAny: test mock
export class ObservableCollectionMock<T = any> {
    private items: T[];
    constructor(...items: T[]) {
        this.items = items;
    }
    get length() {
        return this.items.length;
    }
    replace(index: number, item: T) {
        this.items[index] = item;
    }
    find(fn: (m: T) => boolean) {
        return this.items.find(fn);
    }
    forEach(fn: (m: T) => void) {
        this.items.forEach(fn);
    }
}
