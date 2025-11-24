import type { RequestArguments } from '@metamask/providers';
import { useMetaMaskContext } from '../MetaMaskContext';

export type Request = (params: RequestArguments) => Promise<unknown | null>;

/**
 * Extract a human-readable error message from MetaMask provider errors.
 * MetaMask errors are often plain objects with `message` or `data.message` properties,
 * not standard Error instances, so String(err) would produce "[object Object]".
 */
function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === 'string') {
    return err;
  }
  if (err && typeof err === 'object') {
    // MetaMask errors typically have a message property
    const errObj = err as Record<string, unknown>;
    if (typeof errObj.message === 'string') {
      return errObj.message;
    }
    // Some errors have nested data.message
    if (errObj.data && typeof errObj.data === 'object') {
      const data = errObj.data as Record<string, unknown>;
      if (typeof data.message === 'string') {
        return data.message;
      }
    }
    // Try JSON stringification as last resort for objects
    try {
      return JSON.stringify(err);
    } catch {
      return 'Unknown error';
    }
  }
  return 'Unknown error';
}

export const useRequest = (): Request => {
  const { provider, setError } = useMetaMaskContext();

  const request: Request = async ({ method, params }) => {
    try {
      const data =
        (await provider?.request({
          method,
          params,
        } as RequestArguments)) ?? null;
      return data;
    } catch (err) {
      const message = extractErrorMessage(err);
      const error = err instanceof Error ? err : new Error(message);
      setError(error);
      throw error;
    }
  };

  return request;
};


