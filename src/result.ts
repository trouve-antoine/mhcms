export function ok<V>(value: V) {
    return new OkResult<V>(value);
}

export function ng<E>(error: E, fromError?: NgResult<E>, exception?: any) {
    return new NgResult<E>(error, fromError, exception);
}

class OkResult<V> {
    constructor(public value: V) { }

    isOk(): this is OkResult<V> { return true; }
    isNg(): this is NgResult<any> { return false; }
}

class NgResult<E> {
    constructor(public error: E, public fromError?: NgResult<E>, public exception?: any) { }

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