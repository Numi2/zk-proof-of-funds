// ZKPassport Verification History
// Track and store verification results locally

import type { ZKPassportPolicyDefinition } from '../types/zkpassport';

export interface VerificationRecord {
  id: string;
  timestamp: number;
  policyId: number | null;
  policyLabel: string;
  status: 'verified' | 'rejected' | 'error' | 'expired';
  uniqueIdentifier?: string;
  requestId: string;
  queryResultSummary?: QueryResultSummary;
  proofCount: number;
  error?: string;
  duration?: number; // milliseconds from request to result
  devMode?: boolean;
}

export interface QueryResultSummary {
  disclosedFields: string[];
  ageVerification?: { type: string; expected: number; result: boolean };
  nationalityCheck?: { type: string; countries: string[]; result: boolean };
  documentValid?: boolean;
}

export interface VerificationHistoryStats {
  totalVerifications: number;
  successfulVerifications: number;
  failedVerifications: number;
  averageDuration: number;
  mostUsedPolicy: string | null;
  lastVerification: number | null;
}

const STORAGE_KEY = 'zkpassport_verification_history';
const MAX_HISTORY_ITEMS = 100;

export class VerificationHistoryManager {
  private records: VerificationRecord[] = [];
  
  constructor() {
    this.loadFromStorage();
  }
  
  private loadFromStorage(): void {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        this.records = JSON.parse(stored);
      }
    } catch (error) {
      console.error('Failed to load verification history:', error);
      this.records = [];
    }
  }
  
  private saveToStorage(): void {
    try {
      // Keep only the latest MAX_HISTORY_ITEMS
      if (this.records.length > MAX_HISTORY_ITEMS) {
        this.records = this.records.slice(-MAX_HISTORY_ITEMS);
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.records));
    } catch (error) {
      console.error('Failed to save verification history:', error);
    }
  }
  
  addRecord(record: Omit<VerificationRecord, 'id' | 'timestamp'>): VerificationRecord {
    const newRecord: VerificationRecord = {
      ...record,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
    };
    
    this.records.push(newRecord);
    this.saveToStorage();
    
    return newRecord;
  }
  
  getRecords(limit?: number): VerificationRecord[] {
    const sorted = [...this.records].sort((a, b) => b.timestamp - a.timestamp);
    return limit ? sorted.slice(0, limit) : sorted;
  }
  
  getRecordById(id: string): VerificationRecord | undefined {
    return this.records.find(r => r.id === id);
  }
  
  getRecordsByPolicy(policyId: number): VerificationRecord[] {
    return this.records
      .filter(r => r.policyId === policyId)
      .sort((a, b) => b.timestamp - a.timestamp);
  }
  
  getRecordsByStatus(status: VerificationRecord['status']): VerificationRecord[] {
    return this.records
      .filter(r => r.status === status)
      .sort((a, b) => b.timestamp - a.timestamp);
  }
  
  deleteRecord(id: string): boolean {
    const index = this.records.findIndex(r => r.id === id);
    if (index === -1) return false;
    
    this.records.splice(index, 1);
    this.saveToStorage();
    return true;
  }
  
  clearHistory(): void {
    this.records = [];
    this.saveToStorage();
  }
  
  getStats(): VerificationHistoryStats {
    if (this.records.length === 0) {
      return {
        totalVerifications: 0,
        successfulVerifications: 0,
        failedVerifications: 0,
        averageDuration: 0,
        mostUsedPolicy: null,
        lastVerification: null,
      };
    }
    
    const successful = this.records.filter(r => r.status === 'verified');
    const failed = this.records.filter(r => r.status !== 'verified');
    
    // Calculate average duration for records that have duration
    const recordsWithDuration = this.records.filter(r => r.duration !== undefined);
    const avgDuration = recordsWithDuration.length > 0
      ? recordsWithDuration.reduce((sum, r) => sum + (r.duration || 0), 0) / recordsWithDuration.length
      : 0;
    
    // Find most used policy
    const policyUsage: Record<string, number> = {};
    for (const record of this.records) {
      const key = record.policyLabel || 'Quick Example';
      policyUsage[key] = (policyUsage[key] || 0) + 1;
    }
    
    const mostUsedPolicy = Object.entries(policyUsage)
      .sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    
    // Get last verification timestamp
    const lastVerification = this.records.length > 0
      ? Math.max(...this.records.map(r => r.timestamp))
      : null;
    
    return {
      totalVerifications: this.records.length,
      successfulVerifications: successful.length,
      failedVerifications: failed.length,
      averageDuration: Math.round(avgDuration),
      mostUsedPolicy,
      lastVerification,
    };
  }
  
  exportHistory(): string {
    return JSON.stringify(this.records, null, 2);
  }
  
  importHistory(json: string): { success: boolean; imported: number; error?: string } {
    try {
      const imported = JSON.parse(json) as VerificationRecord[];
      
      if (!Array.isArray(imported)) {
        return { success: false, imported: 0, error: 'Invalid format: expected array' };
      }
      
      // Validate records have required fields
      const validRecords = imported.filter(r => 
        r.id && r.timestamp && r.requestId && r.status
      );
      
      // Merge with existing, avoiding duplicates
      const existingIds = new Set(this.records.map(r => r.id));
      const newRecords = validRecords.filter(r => !existingIds.has(r.id));
      
      this.records = [...this.records, ...newRecords];
      this.saveToStorage();
      
      return { success: true, imported: newRecords.length };
    } catch (error) {
      return { 
        success: false, 
        imported: 0, 
        error: error instanceof Error ? error.message : 'Failed to parse JSON' 
      };
    }
  }
}

// Singleton instance
let historyManager: VerificationHistoryManager | null = null;

export function getVerificationHistoryManager(): VerificationHistoryManager {
  if (!historyManager) {
    historyManager = new VerificationHistoryManager();
  }
  return historyManager;
}

// Helper function to create a summary from query results
export function createQueryResultSummary(result: any, policy?: ZKPassportPolicyDefinition): QueryResultSummary {
  const summary: QueryResultSummary = {
    disclosedFields: [],
  };
  
  // Extract disclosed fields
  const disclosureFields = [
    'firstname', 'lastname', 'fullname', 'nationality', 'birthdate',
    'expiry_date', 'document_number', 'document_type', 'issuing_country', 'gender'
  ];
  
  for (const field of disclosureFields) {
    if (result[field]?.disclose?.result !== undefined) {
      summary.disclosedFields.push(field);
    }
  }
  
  // Extract age verification
  if (result.age) {
    if (result.age.gte) {
      summary.ageVerification = {
        type: 'gte',
        expected: result.age.gte.expected,
        result: result.age.gte.result,
      };
    } else if (result.age.lte) {
      summary.ageVerification = {
        type: 'lte',
        expected: result.age.lte.expected,
        result: result.age.lte.result,
      };
    } else if (result.age.range) {
      summary.ageVerification = {
        type: 'range',
        expected: result.age.range.expected,
        result: result.age.range.result,
      };
    }
  }
  
  // Extract nationality check
  if (result.nationality?.in) {
    summary.nationalityCheck = {
      type: 'in',
      countries: result.nationality.in.expected || [],
      result: result.nationality.in.result,
    };
  } else if (result.nationality?.out) {
    summary.nationalityCheck = {
      type: 'out',
      countries: result.nationality.out.expected || [],
      result: result.nationality.out.result,
    };
  }
  
  // Document validity (if expiry date was checked)
  if (result.expiry_date?.gte?.result !== undefined) {
    summary.documentValid = result.expiry_date.gte.result;
  }
  
  return summary;
}

// Helper to format duration
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

// Helper to format relative time
export function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
  if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
  if (days < 7) return `${days} day${days !== 1 ? 's' : ''} ago`;
  
  return new Date(timestamp).toLocaleDateString();
}

