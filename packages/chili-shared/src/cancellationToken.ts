export class CancellationToken {
    private _isCanceled: boolean = false;

    get isCanceled() {
        return this._isCanceled;
    }

    cancel() {
        this._isCanceled = true;
    }
}
