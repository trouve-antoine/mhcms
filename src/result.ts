export function ok<V>(value: V) {
    return new OkResult<V>(value);
}

export function ng<V, E>(error: E, fromError?: NgResult<E>) {
    return new NgResult<E>(error, fromError);
}

class OkResult<V> {
    constructor(public value: V) { }

    isOk(): this is OkResult<V> { return true; }
    isNg(): this is NgResult<any> { return false; }
}

class NgResult<E> {
    constructor(public error: E, public fromError?: NgResult<E>) { }

    isOk(): this is OkResult<any> { return false; }
    isNg(): this is NgResult<E> { return true; }

    pretty(): string {
        let res = String(this.error);
        if (this.fromError) {
            res += " / " + this.fromError.pretty();
        }
        return res;
    }
}

export type Result<V, E> = OkResult<V> | NgResult<E>;