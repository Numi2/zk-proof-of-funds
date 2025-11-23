// ZKPassport Policy Types

export interface ZKPassportPolicyQuery {
  // Disclosure fields
  discloseNationality?: boolean;
  discloseBirthdate?: boolean;
  discloseFullname?: boolean;
  discloseFirstname?: boolean;
  discloseLastname?: boolean;
  discloseExpiryDate?: boolean;
  discloseDocumentNumber?: boolean;
  discloseDocumentType?: boolean;
  discloseIssuingCountry?: boolean;
  discloseGender?: boolean;

  // Age verification
  ageGte?: number;
  ageLt?: number;
  ageLte?: number;
  ageRange?: [number, number];

  // Birthdate verification
  birthdateGte?: string; // ISO date string
  birthdateLt?: string;
  birthdateLte?: string;
  birthdateRange?: [string, string];

  // Expiry date verification
  expiryDateGte?: string;
  expiryDateLt?: string;
  expiryDateLte?: string;
  expiryDateRange?: [string, string];

  // Nationality checks
  nationalityIn?: string[];
  nationalityOut?: string[];

  // Issuing country checks
  issuingCountryIn?: string[];
  issuingCountryOut?: string[];

  // Equality checks
  eqChecks?: Array<{ field: string; value: string | number | Date }>;

  // Binding
  bindUserAddress?: string;
  bindChain?: 'ethereum' | 'ethereum_sepolia';
  bindCustomData?: string;
}

export interface ZKPassportPolicyDefinition {
  policy_id: number;
  label: string;
  description?: string;
  purpose: string;
  scope?: string;
  validity?: number; // seconds
  devMode?: boolean;
  query: ZKPassportPolicyQuery;
  useCases?: string[]; // e.g., ["Age Verification", "Nationality", "KYC"]
  created_at?: number;
  updated_at?: number;
}

export interface ZKPassportPolicyComposeRequest {
  label: string;
  description?: string;
  purpose: string;
  scope?: string;
  validity?: number;
  devMode?: boolean;
  query: ZKPassportPolicyQuery;
  useCases?: string[];
}

export interface ZKPassportPolicyComposeResponse {
  policy: ZKPassportPolicyDefinition;
  summary: string;
  created: boolean;
}

export interface ZKPassportPoliciesResponse {
  policies: ZKPassportPolicyDefinition[];
}

export interface ZKPassportVerificationResult {
  policy_id: number;
  verified: boolean;
  uniqueIdentifier?: string;
  queryResult?: any;
  queryResultErrors?: any;
  proofs?: any[];
  error?: string;
}

