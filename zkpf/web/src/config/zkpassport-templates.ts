// ZKPassport Policy Templates
// Pre-built verification scenarios for common use cases

import type { ZKPassportPolicyQuery } from '../types/zkpassport';

export interface PolicyTemplate {
  id: string;
  name: string;
  category: TemplateCategory;
  description: string;
  icon: string;
  tags: string[];
  purpose: string;
  query: ZKPassportPolicyQuery;
  useCases: string[];
  devModeRecommended?: boolean;
}

export type TemplateCategory = 
  | 'age-verification'
  | 'kyc-compliance'
  | 'geographic'
  | 'financial'
  | 'access-control'
  | 'gaming'
  | 'healthcare';

export const TEMPLATE_CATEGORIES: Record<TemplateCategory, { label: string; icon: string; description: string }> = {
  'age-verification': {
    label: 'Age Verification',
    icon: '🎂',
    description: 'Verify user age for age-restricted content and services',
  },
  'kyc-compliance': {
    label: 'KYC & Compliance',
    icon: '🔐',
    description: 'Know Your Customer and regulatory compliance scenarios',
  },
  'geographic': {
    label: 'Geographic',
    icon: '🌍',
    description: 'Location and nationality-based verification',
  },
  'financial': {
    label: 'Financial Services',
    icon: '💰',
    description: 'Financial service eligibility and compliance',
  },
  'access-control': {
    label: 'Access Control',
    icon: '🚪',
    description: 'Gated access to platforms and services',
  },
  'gaming': {
    label: 'Gaming & Gambling',
    icon: '🎰',
    description: 'Online gaming and gambling compliance',
  },
  'healthcare': {
    label: 'Healthcare',
    icon: '🏥',
    description: 'Healthcare eligibility and age verification',
  },
};

// Country group presets
export const COUNTRY_GROUPS = {
  EU: ['AUT', 'BEL', 'BGR', 'HRV', 'CYP', 'CZE', 'DNK', 'EST', 'FIN', 'FRA', 'DEU', 'GRC', 'HUN', 'IRL', 'ITA', 'LVA', 'LTU', 'LUX', 'MLT', 'NLD', 'POL', 'PRT', 'ROU', 'SVK', 'SVN', 'ESP', 'SWE'],
  EEA: ['AUT', 'BEL', 'BGR', 'HRV', 'CYP', 'CZE', 'DNK', 'EST', 'FIN', 'FRA', 'DEU', 'GRC', 'HUN', 'IRL', 'ITA', 'LVA', 'LTU', 'LUX', 'MLT', 'NLD', 'POL', 'PRT', 'ROU', 'SVK', 'SVN', 'ESP', 'SWE', 'ISL', 'LIE', 'NOR'],
  SCHENGEN: ['AUT', 'BEL', 'CZE', 'DNK', 'EST', 'FIN', 'FRA', 'DEU', 'GRC', 'HUN', 'ISL', 'ITA', 'LVA', 'LIE', 'LTU', 'LUX', 'MLT', 'NLD', 'NOR', 'POL', 'PRT', 'SVK', 'SVN', 'ESP', 'SWE', 'CHE'],
  G7: ['USA', 'GBR', 'FRA', 'DEU', 'ITA', 'JPN', 'CAN'],
  G20: ['ARG', 'AUS', 'BRA', 'CAN', 'CHN', 'FRA', 'DEU', 'IND', 'IDN', 'ITA', 'JPN', 'MEX', 'RUS', 'SAU', 'ZAF', 'KOR', 'TUR', 'GBR', 'USA'],
  BRICS: ['BRA', 'RUS', 'IND', 'CHN', 'ZAF', 'EGY', 'ETH', 'IRN', 'SAU', 'ARE'],
  NATO: ['ALB', 'BEL', 'BGR', 'CAN', 'HRV', 'CZE', 'DNK', 'EST', 'FIN', 'FRA', 'DEU', 'GRC', 'HUN', 'ISL', 'ITA', 'LVA', 'LTU', 'LUX', 'MNE', 'NLD', 'MKD', 'NOR', 'POL', 'PRT', 'ROU', 'SVK', 'SVN', 'ESP', 'SWE', 'TUR', 'GBR', 'USA'],
  FIVE_EYES: ['USA', 'GBR', 'CAN', 'AUS', 'NZL'],
  OECD: ['AUS', 'AUT', 'BEL', 'CAN', 'CHL', 'COL', 'CRI', 'CZE', 'DNK', 'EST', 'FIN', 'FRA', 'DEU', 'GRC', 'HUN', 'ISL', 'IRL', 'ISR', 'ITA', 'JPN', 'KOR', 'LVA', 'LTU', 'LUX', 'MEX', 'NLD', 'NZL', 'NOR', 'POL', 'PRT', 'SVK', 'SVN', 'ESP', 'SWE', 'CHE', 'TUR', 'GBR', 'USA'],
  LATIN_AMERICA: ['ARG', 'BOL', 'BRA', 'CHL', 'COL', 'CRI', 'CUB', 'DOM', 'ECU', 'SLV', 'GTM', 'HND', 'MEX', 'NIC', 'PAN', 'PRY', 'PER', 'URY', 'VEN'],
  ASEAN: ['BRN', 'KHM', 'IDN', 'LAO', 'MYS', 'MMR', 'PHL', 'SGP', 'THA', 'VNM'],
  APAC: ['AUS', 'BRN', 'KHM', 'CHN', 'FJI', 'HKG', 'IDN', 'JPN', 'KOR', 'LAO', 'MYS', 'MNG', 'MMR', 'NZL', 'PHL', 'SGP', 'TWN', 'THA', 'VNM'],
  COMMONWEALTH: ['AUS', 'BGD', 'BWA', 'BRN', 'CMR', 'CAN', 'CYP', 'FJI', 'GMB', 'GHA', 'GRD', 'GUY', 'IND', 'JAM', 'KEN', 'KIR', 'LSO', 'MWI', 'MYS', 'MDV', 'MLT', 'MUS', 'MOZ', 'NAM', 'NRU', 'NZL', 'NGA', 'PAK', 'PNG', 'RWA', 'WSM', 'SYC', 'SLE', 'SGP', 'SLB', 'ZAF', 'LKA', 'SWZ', 'TZA', 'TGO', 'TON', 'TTO', 'TUV', 'UGA', 'GBR', 'VUT', 'ZMB'],
  SANCTIONED: ['AFG', 'BLR', 'BDI', 'CAF', 'COD', 'CUB', 'ERI', 'ETH', 'HTI', 'IRN', 'IRQ', 'LBN', 'LBY', 'MLI', 'MMR', 'NIC', 'PRK', 'RUS', 'SOM', 'SSD', 'SDN', 'SYR', 'VEN', 'YEM', 'ZWE'],
  HIGH_RISK_AML: ['AFG', 'ALB', 'BLR', 'BIH', 'BFA', 'BDI', 'KHM', 'CAF', 'CHN', 'COD', 'CUB', 'ERI', 'GNQ', 'HTI', 'IRN', 'IRQ', 'KEN', 'PRK', 'LBY', 'MLI', 'MRT', 'MOZ', 'MMR', 'NIC', 'PAK', 'RUS', 'SOM', 'SSD', 'SDN', 'SYR', 'TJK', 'TKM', 'UGA', 'UZB', 'VEN', 'YEM', 'ZWE'],
} as const;

export const COUNTRY_GROUP_LABELS: Record<keyof typeof COUNTRY_GROUPS, string> = {
  EU: 'European Union',
  EEA: 'European Economic Area',
  SCHENGEN: 'Schengen Area',
  G7: 'G7 Nations',
  G20: 'G20 Nations',
  BRICS: 'BRICS+ Nations',
  NATO: 'NATO Members',
  FIVE_EYES: 'Five Eyes',
  OECD: 'OECD Members',
  LATIN_AMERICA: 'Latin America',
  ASEAN: 'ASEAN',
  APAC: 'Asia-Pacific',
  COMMONWEALTH: 'Commonwealth of Nations',
  SANCTIONED: 'Sanctioned Countries',
  HIGH_RISK_AML: 'High-Risk AML Countries',
};

// Pre-built policy templates
export const POLICY_TEMPLATES: PolicyTemplate[] = [
  // Age Verification Templates
  {
    id: 'adult-content-18',
    name: 'Adult Content (18+)',
    category: 'age-verification',
    description: 'Verify users are 18+ for adult content access',
    icon: '🔞',
    tags: ['age', 'adult', 'content'],
    purpose: 'Verify user is at least 18 years old to access age-restricted content',
    query: {
      ageGte: 18,
    },
    useCases: ['Age Verification'],
  },
  {
    id: 'adult-content-21',
    name: 'Alcohol/Cannabis (21+)',
    category: 'age-verification',
    description: 'Verify users are 21+ for alcohol or cannabis purchases',
    icon: '🍺',
    tags: ['age', 'alcohol', 'cannabis', '21+'],
    purpose: 'Verify user is at least 21 years old for age-restricted purchases',
    query: {
      ageGte: 21,
    },
    useCases: ['Age Verification'],
  },
  {
    id: 'senior-discount',
    name: 'Senior Discount (65+)',
    category: 'age-verification',
    description: 'Verify users qualify for senior discounts',
    icon: '👴',
    tags: ['age', 'senior', 'discount'],
    purpose: 'Verify user is at least 65 years old for senior discount eligibility',
    query: {
      ageGte: 65,
    },
    useCases: ['Age Verification'],
  },
  {
    id: 'youth-program',
    name: 'Youth Program (Under 25)',
    category: 'age-verification',
    description: 'Verify users are under 25 for youth programs',
    icon: '🧑',
    tags: ['age', 'youth', 'young'],
    purpose: 'Verify user is under 25 years old for youth program eligibility',
    query: {
      ageLte: 24,
    },
    useCases: ['Age Verification'],
  },
  
  // KYC & Compliance Templates
  {
    id: 'basic-kyc',
    name: 'Basic KYC',
    category: 'kyc-compliance',
    description: 'Basic identity verification with name and nationality',
    icon: '📋',
    tags: ['kyc', 'identity', 'compliance'],
    purpose: 'Verify user identity for basic KYC requirements',
    query: {
      discloseFirstname: true,
      discloseLastname: true,
      discloseNationality: true,
      ageGte: 18,
    },
    useCases: ['KYC', 'Personhood'],
  },
  {
    id: 'enhanced-kyc',
    name: 'Enhanced KYC',
    category: 'kyc-compliance',
    description: 'Full identity verification with document details',
    icon: '🔍',
    tags: ['kyc', 'identity', 'compliance', 'enhanced'],
    purpose: 'Comprehensive identity verification for enhanced KYC requirements',
    query: {
      discloseFullname: true,
      discloseBirthdate: true,
      discloseNationality: true,
      discloseDocumentType: true,
      discloseDocumentNumber: true,
      discloseIssuingCountry: true,
      discloseExpiryDate: true,
      ageGte: 18,
    },
    useCases: ['KYC', 'Personhood', 'Client-Server'],
  },
  {
    id: 'aml-screening',
    name: 'AML Screening',
    category: 'kyc-compliance',
    description: 'Anti-money laundering nationality check',
    icon: '🚨',
    tags: ['aml', 'compliance', 'sanctions'],
    purpose: 'Verify user is not from high-risk AML jurisdictions',
    query: {
      discloseNationality: true,
      nationalityOut: [...COUNTRY_GROUPS.HIGH_RISK_AML],
      ageGte: 18,
    },
    useCases: ['KYC', 'Nationality'],
  },
  {
    id: 'sanctions-check',
    name: 'Sanctions Compliance',
    category: 'kyc-compliance',
    description: 'Verify user is not from sanctioned countries',
    icon: '⛔',
    tags: ['sanctions', 'compliance', 'restricted'],
    purpose: 'Verify user nationality is not from OFAC/EU sanctioned countries',
    query: {
      discloseNationality: true,
      nationalityOut: [...COUNTRY_GROUPS.SANCTIONED],
      ageGte: 18,
    },
    useCases: ['KYC', 'Nationality'],
  },
  {
    id: 'document-validity',
    name: 'Document Validity Check',
    category: 'kyc-compliance',
    description: 'Verify document is not expired',
    icon: '📄',
    tags: ['document', 'validity', 'expiry'],
    purpose: 'Verify passport/ID document has not expired',
    query: {
      discloseExpiryDate: true,
      discloseDocumentType: true,
      // Expiry date should be greater than today
      expiryDateGte: new Date().toISOString().split('T')[0],
    },
    useCases: ['KYC'],
  },
  
  // Geographic Templates
  {
    id: 'eu-residents',
    name: 'EU Residents Only',
    category: 'geographic',
    description: 'Restrict access to EU nationals',
    icon: '🇪🇺',
    tags: ['eu', 'europe', 'nationality'],
    purpose: 'Verify user is a national of an EU member state',
    query: {
      discloseNationality: true,
      nationalityIn: [...COUNTRY_GROUPS.EU],
    },
    useCases: ['Nationality', 'Residency'],
  },
  {
    id: 'eea-residents',
    name: 'EEA Residents',
    category: 'geographic',
    description: 'European Economic Area nationals',
    icon: '🌍',
    tags: ['eea', 'europe', 'nationality'],
    purpose: 'Verify user is a national of an EEA member state',
    query: {
      discloseNationality: true,
      nationalityIn: [...COUNTRY_GROUPS.EEA],
    },
    useCases: ['Nationality', 'Residency'],
  },
  {
    id: 'us-residents',
    name: 'US Residents Only',
    category: 'geographic',
    description: 'Restrict access to US nationals',
    icon: '🇺🇸',
    tags: ['us', 'usa', 'nationality'],
    purpose: 'Verify user is a US national',
    query: {
      discloseNationality: true,
      nationalityIn: ['USA'],
    },
    useCases: ['Nationality'],
  },
  {
    id: 'non-us',
    name: 'Non-US Only',
    category: 'geographic',
    description: 'Exclude US nationals (common for crypto services)',
    icon: '🌏',
    tags: ['non-us', 'crypto', 'restriction'],
    purpose: 'Verify user is NOT a US national for regulatory compliance',
    query: {
      discloseNationality: true,
      nationalityOut: ['USA'],
    },
    useCases: ['Nationality'],
  },
  {
    id: 'g7-nations',
    name: 'G7 Nations',
    category: 'geographic',
    description: 'Restrict to G7 country nationals',
    icon: '🏛️',
    tags: ['g7', 'developed', 'nationality'],
    purpose: 'Verify user is from a G7 nation',
    query: {
      discloseNationality: true,
      nationalityIn: [...COUNTRY_GROUPS.G7],
    },
    useCases: ['Nationality'],
  },
  {
    id: 'oecd-nations',
    name: 'OECD Members',
    category: 'geographic',
    description: 'Restrict to OECD country nationals',
    icon: '📊',
    tags: ['oecd', 'developed', 'nationality'],
    purpose: 'Verify user is from an OECD member country',
    query: {
      discloseNationality: true,
      nationalityIn: [...COUNTRY_GROUPS.OECD],
    },
    useCases: ['Nationality'],
  },
  {
    id: 'apac-region',
    name: 'Asia-Pacific Region',
    category: 'geographic',
    description: 'Asia-Pacific regional access',
    icon: '🌏',
    tags: ['apac', 'asia', 'pacific'],
    purpose: 'Verify user is from the Asia-Pacific region',
    query: {
      discloseNationality: true,
      nationalityIn: [...COUNTRY_GROUPS.APAC],
    },
    useCases: ['Nationality'],
  },
  
  // Financial Services Templates
  {
    id: 'crypto-exchange',
    name: 'Crypto Exchange KYC',
    category: 'financial',
    description: 'Standard crypto exchange compliance',
    icon: '₿',
    tags: ['crypto', 'exchange', 'kyc'],
    purpose: 'Verify user identity and eligibility for cryptocurrency exchange access',
    query: {
      discloseFullname: true,
      discloseBirthdate: true,
      discloseNationality: true,
      nationalityOut: [...COUNTRY_GROUPS.SANCTIONED],
      ageGte: 18,
    },
    useCases: ['KYC', 'Nationality', 'Age Verification'],
  },
  {
    id: 'defi-access',
    name: 'DeFi Protocol Access',
    category: 'financial',
    description: 'Basic verification for DeFi protocol access',
    icon: '🔗',
    tags: ['defi', 'crypto', 'web3'],
    purpose: 'Verify user eligibility for decentralized finance protocol access',
    query: {
      discloseNationality: true,
      nationalityOut: ['USA', ...COUNTRY_GROUPS.SANCTIONED],
      ageGte: 18,
    },
    useCases: ['Nationality', 'Age Verification'],
  },
  {
    id: 'accredited-investor',
    name: 'Accredited Investor Check',
    category: 'financial',
    description: 'Age and identity for investment platforms',
    icon: '📈',
    tags: ['investor', 'accredited', 'finance'],
    purpose: 'Verify user meets basic accredited investor requirements',
    query: {
      discloseFullname: true,
      discloseBirthdate: true,
      discloseNationality: true,
      ageGte: 21,
    },
    useCases: ['KYC', 'Age Verification'],
  },
  {
    id: 'banking-kyc',
    name: 'Banking KYC',
    category: 'financial',
    description: 'Full KYC for banking services',
    icon: '🏦',
    tags: ['banking', 'kyc', 'finance'],
    purpose: 'Comprehensive identity verification for banking service access',
    query: {
      discloseFullname: true,
      discloseBirthdate: true,
      discloseNationality: true,
      discloseDocumentType: true,
      discloseDocumentNumber: true,
      discloseIssuingCountry: true,
      discloseExpiryDate: true,
      nationalityOut: [...COUNTRY_GROUPS.HIGH_RISK_AML],
      ageGte: 18,
    },
    useCases: ['KYC', 'Personhood', 'Nationality'],
  },
  
  // Gaming & Gambling Templates
  {
    id: 'online-gambling-uk',
    name: 'UK Online Gambling',
    category: 'gaming',
    description: 'UK gambling compliance (18+)',
    icon: '🎰',
    tags: ['gambling', 'uk', '18+'],
    purpose: 'Verify user is 18+ and UK resident for online gambling',
    query: {
      discloseFullname: true,
      discloseBirthdate: true,
      discloseNationality: true,
      nationalityIn: ['GBR'],
      ageGte: 18,
    },
    useCases: ['Age Verification', 'Nationality'],
  },
  {
    id: 'online-gambling-eu',
    name: 'EU Online Gambling',
    category: 'gaming',
    description: 'EU gambling compliance',
    icon: '🎲',
    tags: ['gambling', 'eu', 'gaming'],
    purpose: 'Verify user is adult and EU resident for online gambling',
    query: {
      discloseFullname: true,
      discloseBirthdate: true,
      discloseNationality: true,
      nationalityIn: [...COUNTRY_GROUPS.EU],
      ageGte: 18,
    },
    useCases: ['Age Verification', 'Nationality'],
  },
  {
    id: 'esports-betting',
    name: 'Esports Betting',
    category: 'gaming',
    description: 'Age verification for esports betting platforms',
    icon: '🎮',
    tags: ['esports', 'betting', 'gaming'],
    purpose: 'Verify user is of legal gambling age for esports betting',
    query: {
      discloseBirthdate: true,
      discloseNationality: true,
      nationalityOut: [...COUNTRY_GROUPS.SANCTIONED],
      ageGte: 18,
    },
    useCases: ['Age Verification', 'Nationality'],
  },
  
  // Access Control Templates
  {
    id: 'platform-personhood',
    name: 'Proof of Personhood',
    category: 'access-control',
    description: 'Verify user is a real person without revealing identity',
    icon: '👤',
    tags: ['personhood', 'sybil', 'verification'],
    purpose: 'Verify user is a real person to prevent Sybil attacks',
    query: {
      ageGte: 13,
    },
    useCases: ['Personhood'],
  },
  {
    id: 'gated-community',
    name: 'Gated Community Access',
    category: 'access-control',
    description: 'Exclusive access for verified members',
    icon: '🚪',
    tags: ['gated', 'exclusive', 'access'],
    purpose: 'Verify user identity for exclusive community access',
    query: {
      discloseFirstname: true,
      discloseLastname: true,
      ageGte: 18,
    },
    useCases: ['Personhood', 'Age Verification'],
  },
  {
    id: 'dao-membership',
    name: 'DAO Membership',
    category: 'access-control',
    description: 'Identity verification for DAO voting rights',
    icon: '🗳️',
    tags: ['dao', 'governance', 'voting'],
    purpose: 'Verify user identity for DAO membership and voting rights',
    query: {
      discloseNationality: true,
      nationalityOut: [...COUNTRY_GROUPS.SANCTIONED],
      ageGte: 18,
    },
    useCases: ['Personhood', 'Nationality'],
  },
  
  // Healthcare Templates
  {
    id: 'healthcare-minor',
    name: 'Healthcare - Minor',
    category: 'healthcare',
    description: 'Verify user is under 18 for pediatric services',
    icon: '👶',
    tags: ['healthcare', 'minor', 'pediatric'],
    purpose: 'Verify user is under 18 for pediatric healthcare services',
    query: {
      discloseBirthdate: true,
      ageLte: 17,
    },
    useCases: ['Age Verification'],
  },
  {
    id: 'healthcare-adult',
    name: 'Healthcare - Adult',
    category: 'healthcare',
    description: 'Verify user is 18+ for adult medical services',
    icon: '🏥',
    tags: ['healthcare', 'adult', 'medical'],
    purpose: 'Verify user is 18+ for adult healthcare services',
    query: {
      discloseBirthdate: true,
      discloseFullname: true,
      ageGte: 18,
    },
    useCases: ['Age Verification', 'KYC'],
  },
  {
    id: 'telehealth',
    name: 'Telehealth Verification',
    category: 'healthcare',
    description: 'Identity verification for telehealth services',
    icon: '💻',
    tags: ['telehealth', 'remote', 'healthcare'],
    purpose: 'Verify user identity for remote healthcare consultations',
    query: {
      discloseFullname: true,
      discloseBirthdate: true,
      discloseNationality: true,
      ageGte: 18,
    },
    useCases: ['KYC', 'Age Verification'],
  },
];

// Helper functions
export function getTemplatesByCategory(category: TemplateCategory): PolicyTemplate[] {
  return POLICY_TEMPLATES.filter(t => t.category === category);
}

export function searchTemplates(query: string): PolicyTemplate[] {
  const lowerQuery = query.toLowerCase();
  return POLICY_TEMPLATES.filter(t => 
    t.name.toLowerCase().includes(lowerQuery) ||
    t.description.toLowerCase().includes(lowerQuery) ||
    t.tags.some(tag => tag.toLowerCase().includes(lowerQuery))
  );
}

export function getTemplateById(id: string): PolicyTemplate | undefined {
  return POLICY_TEMPLATES.find(t => t.id === id);
}

export function getCountryGroupList(groupKey: keyof typeof COUNTRY_GROUPS): string[] {
  return [...COUNTRY_GROUPS[groupKey]];
}

