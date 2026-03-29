/**
 * Wraps fetch() so that it rejects immediately when the AbortSignal fires,
 * even if the underlying socket hasn't closed yet. Works around Node.js
 * undici not always aborting in-flight requests promptly.
 */
export function abortAwareFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const signal = init?.signal;
  if (!signal) return fetch(input, init);

  return Promise.race([
    fetch(input, init),
    new Promise<never>((_, reject) => {
      if (signal.aborted) {
        reject(signal.reason ?? new DOMException('The operation was aborted', 'AbortError'));
        return;
      }
      signal.addEventListener('abort', () => {
        reject(signal.reason ?? new DOMException('The operation was aborted', 'AbortError'));
      }, { once: true });
    }),
  ]);
}
