import { useState, useMemo, useCallback, useEffect } from 'react';
import {
  getVerificationHistoryManager,
  formatDuration,
  formatRelativeTime,
  type VerificationRecord,
  type VerificationHistoryStats,
} from '../utils/zkpassport-history';

interface Props {
  onSelectRecord?: (record: VerificationRecord) => void;
}

export function ZKPassportHistory({ onSelectRecord }: Props) {
  const [records, setRecords] = useState<VerificationRecord[]>([]);
  const [stats, setStats] = useState<VerificationHistoryStats | null>(null);
  const [filter, setFilter] = useState<'all' | 'verified' | 'failed'>('all');
  const [showExport, setShowExport] = useState(false);
  const [importText, setImportText] = useState('');
  const [importResult, setImportResult] = useState<{ success: boolean; message: string } | null>(null);

  const historyManager = useMemo(() => getVerificationHistoryManager(), []);

  const loadData = useCallback(() => {
    setRecords(historyManager.getRecords());
    setStats(historyManager.getStats());
  }, [historyManager]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filteredRecords = useMemo(() => {
    if (filter === 'all') return records;
    if (filter === 'verified') return records.filter(r => r.status === 'verified');
    return records.filter(r => r.status !== 'verified');
  }, [records, filter]);

  const handleDelete = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Delete this verification record?')) {
      historyManager.deleteRecord(id);
      loadData();
    }
  }, [historyManager, loadData]);

  const handleClearAll = useCallback(() => {
    if (confirm('Clear all verification history? This cannot be undone.')) {
      historyManager.clearHistory();
      loadData();
    }
  }, [historyManager, loadData]);

  const handleExport = useCallback(() => {
    const data = historyManager.exportHistory();
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `zkpassport-history-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [historyManager]);

  const handleImport = useCallback(() => {
    const result = historyManager.importHistory(importText);
    if (result.success) {
      setImportResult({ success: true, message: `Imported ${result.imported} records` });
      setImportText('');
      loadData();
    } else {
      setImportResult({ success: false, message: result.error || 'Import failed' });
    }
    setTimeout(() => setImportResult(null), 3000);
  }, [historyManager, importText, loadData]);

  const getStatusIcon = (status: VerificationRecord['status']) => {
    switch (status) {
      case 'verified': return '✓';
      case 'rejected': return '✗';
      case 'error': return '⚠';
      case 'expired': return '⏱';
      default: return '?';
    }
  };

  const getStatusClass = (status: VerificationRecord['status']) => {
    switch (status) {
      case 'verified': return 'status-verified';
      case 'rejected': return 'status-rejected';
      case 'error': return 'status-error';
      case 'expired': return 'status-expired';
      default: return '';
    }
  };

  return (
    <div className="zkpassport-history">
      <header className="history-header">
        <div>
          <h3>Verification History</h3>
          <p className="muted small">Track your ZKPassport verification attempts</p>
        </div>
        <div className="history-actions">
          <button className="tiny-button" onClick={() => setShowExport(!showExport)}>
            {showExport ? 'Hide Export' : 'Import/Export'}
          </button>
          {records.length > 0 && (
            <button 
              className="tiny-button" 
              onClick={handleClearAll}
              style={{ background: 'rgba(248, 113, 113, 0.15)', borderColor: 'rgba(248, 113, 113, 0.5)', color: '#f87171' }}
            >
              Clear All
            </button>
          )}
        </div>
      </header>

      {showExport && (
        <div className="history-export-panel">
          <div className="export-actions">
            <button className="tiny-button" onClick={handleExport}>
              📥 Download History
            </button>
          </div>
          <div className="import-section">
            <label>
              <span>Import History (JSON)</span>
              <textarea
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder="Paste exported history JSON here..."
                rows={3}
              />
            </label>
            <button 
              className="tiny-button" 
              onClick={handleImport}
              disabled={!importText.trim()}
            >
              📤 Import
            </button>
            {importResult && (
              <span className={importResult.success ? 'success-message inline' : 'error-message inline'}>
                {importResult.message}
              </span>
            )}
          </div>
        </div>
      )}

      {stats && stats.totalVerifications > 0 && (
        <div className="history-stats">
          <div className="stat-card">
            <span className="stat-label">Total</span>
            <strong className="stat-value">{stats.totalVerifications}</strong>
          </div>
          <div className="stat-card success">
            <span className="stat-label">Successful</span>
            <strong className="stat-value">{stats.successfulVerifications}</strong>
          </div>
          <div className="stat-card error">
            <span className="stat-label">Failed</span>
            <strong className="stat-value">{stats.failedVerifications}</strong>
          </div>
          {stats.averageDuration > 0 && (
            <div className="stat-card">
              <span className="stat-label">Avg Duration</span>
              <strong className="stat-value">{formatDuration(stats.averageDuration)}</strong>
            </div>
          )}
        </div>
      )}

      <div className="history-filters">
        <button
          className={`filter-pill ${filter === 'all' ? 'active' : ''}`}
          onClick={() => setFilter('all')}
        >
          All ({records.length})
        </button>
        <button
          className={`filter-pill ${filter === 'verified' ? 'active' : ''}`}
          onClick={() => setFilter('verified')}
        >
          ✓ Verified ({records.filter(r => r.status === 'verified').length})
        </button>
        <button
          className={`filter-pill ${filter === 'failed' ? 'active' : ''}`}
          onClick={() => setFilter('failed')}
        >
          ✗ Failed ({records.filter(r => r.status !== 'verified').length})
        </button>
      </div>

      <div className="history-list">
        {filteredRecords.length === 0 ? (
          <div className="history-empty">
            <p className="muted">
              {records.length === 0 
                ? 'No verification history yet. Complete a verification to see it here.' 
                : 'No records match the selected filter.'}
            </p>
          </div>
        ) : (
          filteredRecords.map((record) => (
            <div
              key={record.id}
              className={`history-record ${onSelectRecord ? 'clickable' : ''}`}
              onClick={() => onSelectRecord?.(record)}
            >
              <div className="record-header">
                <div className={`record-status ${getStatusClass(record.status)}`}>
                  <span className="status-icon">{getStatusIcon(record.status)}</span>
                  <span className="status-text">{record.status}</span>
                </div>
                <span className="record-time">{formatRelativeTime(record.timestamp)}</span>
              </div>
              
              <div className="record-body">
                <div className="record-policy">
                  <strong>{record.policyLabel || 'Quick Example'}</strong>
                  {record.policyId && <span className="policy-id">#{record.policyId}</span>}
                </div>
                
                {record.uniqueIdentifier && (
                  <div className="record-detail">
                    <span className="detail-label">Unique ID:</span>
                    <code className="detail-value">{record.uniqueIdentifier.slice(0, 16)}...</code>
                  </div>
                )}

                {record.queryResultSummary && (
                  <div className="record-summary">
                    {record.queryResultSummary.ageVerification && (
                      <span className={`summary-badge ${record.queryResultSummary.ageVerification.result ? 'success' : 'error'}`}>
                        Age {record.queryResultSummary.ageVerification.type === 'gte' ? '≥' : '≤'} {record.queryResultSummary.ageVerification.expected}
                      </span>
                    )}
                    {record.queryResultSummary.nationalityCheck && (
                      <span className={`summary-badge ${record.queryResultSummary.nationalityCheck.result ? 'success' : 'error'}`}>
                        Nationality {record.queryResultSummary.nationalityCheck.type}
                      </span>
                    )}
                    {record.queryResultSummary.disclosedFields.length > 0 && (
                      <span className="summary-badge info">
                        {record.queryResultSummary.disclosedFields.length} fields disclosed
                      </span>
                    )}
                  </div>
                )}

                {record.error && (
                  <div className="record-error">
                    {record.error}
                  </div>
                )}
              </div>

              <div className="record-footer">
                {record.duration && (
                  <span className="record-duration">
                    Duration: {formatDuration(record.duration)}
                  </span>
                )}
                <span className="record-proofs">
                  {record.proofCount} proof{record.proofCount !== 1 ? 's' : ''}
                </span>
                {record.devMode && (
                  <span className="dev-mode-badge">DEV</span>
                )}
                <button
                  className="record-delete"
                  onClick={(e) => handleDelete(record.id, e)}
                  aria-label="Delete record"
                >
                  🗑
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

