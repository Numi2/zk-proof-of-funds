// ZKPassport SDK utilities
// This file can be used for server-side verification if needed
// For client-side usage, see ZKPassportPage component

import { ZKPassport } from "@zkpassport/sdk"

export function createZKPassportClient(domain: string = "zkpf.dev") {
  return new ZKPassport(domain);
}

// Example server-side verification function
export async function verifyProofs({
  proofs,
  queryResult,
  scope,
  devMode,
  validity,
}: {
  proofs: Array<any>;
  queryResult: any;
  scope?: string;
  devMode?: boolean;
  validity?: number;
}) {
  const zkPassport = new ZKPassport("zkpf.dev");
  return await zkPassport.verify({
    proofs,
    queryResult,
    scope,
    devMode,
    validity,
  });
}