/**
 * Deduplicates in-flight tool calls so that identical (name, args) pairs
 * execute only once.  Subsequent callers receive the same promise and
 * resolve with the same result.
 *
 * How it works
 * ------------
 * The first caller registers a promise keyed by `"name::serializedArgs"`.
 * Subsequent callers with the same key skip the executor and `await` the
 * stored promise instead.  When the executor settles (resolve or reject)
 * the entry is cleaned up from the map so a later, independent call with
 * the same args starts fresh.
 *
 * Promise sharing
 * ---------------
 * A single Promise can be `await`ed by any number of callers — every
 * caller sees the same settled value.  No extra executor invocations.
 *
 * Signal isolation
 * ----------------
 * If a waiting caller's AbortSignal fires, only that caller gets an
 * `AbortError`; the underlying execution continues for other waiters.
 */
export class ToolCallDeduplicator {
    /** Active in-flight operations.  Key = `${name}::${argsJson}`. */
    private inFlight = new Map<string, Promise<string>>();

    /**
     * @param name      Tool name (e.g. "web_fetch").
     * @param argsJson  JSON-serialized arguments.
     * @param executor  Factory that starts the actual work.  Called at most
     *                  once per unique (name, args) pair while in-flight.
     * @param signal    Optional caller's abort signal.  The signal only
     *                  affects *this* caller; the shared promise is untouched.
     * @returns         The tool result (shared with all waiters).
     */
    async deduplicate(
        name: string,
        argsJson: string,
        executor: (signal?: AbortSignal) => Promise<string>,
        signal?: AbortSignal,
    ): Promise<string> {
        const key = `${name}::${argsJson}`;
        const existing = this.inFlight.get(key);

        if (existing) {
            if (signal?.aborted) {
                throw new DOMException('Aborted', 'AbortError');
            }
            return signal
                ? raceWithSignal(existing, signal)
                : existing;
        }

        const promise = executor(signal).finally(() => {
            this.inFlight.delete(key);
        });
        this.inFlight.set(key, promise);
        return promise;
    }

    /** Remove all in-flight entries (e.g. on research abort). */
    clear(): void {
        this.inFlight.clear();
    }
}

/**
 * Race `promise` against a caller's abort signal.
 *
 * If the signal fires, the caller gets `AbortError` but `promise`
 * continues uninterrupted — other waiters still receive the result.
 */
async function raceWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        if (signal.aborted) {
            reject(new DOMException('Aborted', 'AbortError'));
            return;
        }
        const onAbort = () => {
            signal.removeEventListener('abort', onAbort);
            reject(new DOMException('Aborted', 'AbortError'));
        };
        signal.addEventListener('abort', onAbort);
        promise.then(
            (val) => {
                signal.removeEventListener('abort', onAbort);
                resolve(val);
            },
            (err) => {
                signal.removeEventListener('abort', onAbort);
                reject(err);
            },
        );
    });
}
