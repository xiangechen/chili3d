// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Ownership of the kernel objects the wrappers hold.
 *
 * Every shape, curve or surface OCCT hands back through embind arrives as a C++ object that
 * somebody has to `delete()`: the bindings register plain classes (`class_<TopoDS_Shape>`),
 * never smart pointers, and Emscripten only attaches a finalizer of its own to smart-pointer
 * handles (`attachFinalizer` in the generated glue returns early without one). A handle that is
 * never disposed is therefore never destroyed — no collection reaches it — so it holds its
 * `TopoDS_Shape`, and through it the reference that shape keeps on the underlying B-rep, for the
 * life of the page. Nearly every call site is in that position, because the wrappers are
 * transient by design: one matching pass enumerates sub-shapes by the hundred and keeps none.
 *
 * So a wrapper's lifetime is its handle's: the handle is freed when the wrapper is disposed, or
 * — for the ones dropped without a dispose — here, when the wrapper is collected. `release`
 * hands the handle back for the explicit dispose to delete and forgets it, so the two paths can
 * never both free it.
 *
 * A handle belongs to exactly ONE wrapper. `own` says whether it claimed the one it was given,
 * and a wrapper that did not claim its handle must not delete it on dispose: the claimant (a
 * sub-shape's parent, say, which the sub-shape holds a reference to) still owns it.
 *
 * Without a FinalizationRegistry — an old engine, or a test environment that has switched it off
 * — nothing is registered, and the wrapper is back to leaking until disposed. The explicit
 * dispose path is unaffected.
 */
interface KernelHandle {
    delete(): void;
}

const registry =
    typeof FinalizationRegistry === "undefined"
        ? undefined
        : new FinalizationRegistry<KernelHandle>((handle) => handle.delete());
const claimed = new WeakSet<KernelHandle>();

/** Claims `handle` for `wrapper`; false when another wrapper already owns it (see the header). */
export function own(wrapper: object, handle: KernelHandle): boolean {
    if (claimed.has(handle)) return false;
    claimed.add(handle);
    registry?.register(wrapper, handle, handle);
    return true;
}

/** Forgets `handle` and hands it back, for the caller's explicit dispose to delete. */
export function release<T extends KernelHandle>(handle: T): T {
    claimed.delete(handle);
    registry?.unregister(handle);
    return handle;
}
