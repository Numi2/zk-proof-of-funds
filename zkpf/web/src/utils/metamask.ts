import type {
  EIP6963AnnounceProviderEvent,
  MetaMaskInpageProvider,
} from '@metamask/providers';

export async function hasSnapsSupport(provider: MetaMaskInpageProvider | undefined) {
  if (!provider) return false;
  try {
    await provider.request({ method: 'wallet_getSnaps' });
    return true;
  } catch {
    return false;
  }
}

async function getMetaMaskEip6963Provider() {
  return new Promise<MetaMaskInpageProvider | null>((rawResolve) => {
    const timeout = setTimeout(() => {
      resolve(null);
    }, 500);

    function resolve(provider: MetaMaskInpageProvider | null) {
      window.removeEventListener('eip6963:announceProvider', onAnnounceProvider as EventListener);
      clearTimeout(timeout);
      rawResolve(provider);
    }

    function onAnnounceProvider(event: EIP6963AnnounceProviderEvent) {
      const { detail } = event;
      if (!detail) return;
      const { info, provider } = detail;
      if (info.rdns.includes('io.metamask')) {
        resolve(provider);
      }
    }

    window.addEventListener('eip6963:announceProvider', onAnnounceProvider as EventListener);
    window.dispatchEvent(new Event('eip6963:requestProvider'));
  });
}

export async function getSnapsProvider(): Promise<MetaMaskInpageProvider | null> {
  if (typeof window === 'undefined') {
    return null;
  }

  const anyWindow = window as typeof window & {
    ethereum?: MetaMaskInpageProvider & {
      detected?: MetaMaskInpageProvider[];
      providers?: MetaMaskInpageProvider[];
    };
  };

  if (await hasSnapsSupport(anyWindow.ethereum)) {
    return anyWindow.ethereum ?? null;
  }

  if (anyWindow.ethereum?.detected) {
    for (const provider of anyWindow.ethereum.detected) {
      if (await hasSnapsSupport(provider)) {
        return provider;
      }
    }
  }

  if (anyWindow.ethereum?.providers) {
    for (const provider of anyWindow.ethereum.providers) {
      if (await hasSnapsSupport(provider)) {
        return provider;
      }
    }
  }

  const eipProvider = await getMetaMaskEip6963Provider();
  if (eipProvider && (await hasSnapsSupport(eipProvider))) {
    return eipProvider;
  }

  return null;
}


