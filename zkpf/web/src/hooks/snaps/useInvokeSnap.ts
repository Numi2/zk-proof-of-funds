import { defaultSnapOrigin } from '../../config/snap';
import { useRequest } from './useRequest';

export type InvokeSnapParams = {
  method: string;
  params?: Record<string, unknown>;
};

export const useInvokeSnap = (snapId = defaultSnapOrigin) => {
  const request = useRequest();

  const invokeSnap = async ({ method, params }: InvokeSnapParams) =>
    request({
      method: 'wallet_invokeSnap',
      params: {
        snapId,
        request: params ? { method, params } : { method },
      },
    });

  return invokeSnap;
};


