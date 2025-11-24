import type { RequestArguments } from '@metamask/providers';
import { useMetaMaskContext } from '../MetaMaskContext';

export type Request = (params: RequestArguments) => Promise<unknown | null>;

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
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      throw error;
    }
  };

  return request;
};


