import type { EpochResponse, ParamsResponse } from '../types/zkpf';
import { bytesToBase64, downloadBytes, formatEpoch, humanFileSize } from '../utils/bytes';

function showToast(message: string, type: 'success' | 'error' = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('toast-show');
  }, 10);
  setTimeout(() => {
    toast.classList.remove('toast-show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

interface ParamsCardProps {
  data?: ParamsResponse;
  isLoading: boolean;
  error?: string;
  onRefresh: () => void;
}

interface EpochCardProps {
  data?: EpochResponse;
  isLoading: boolean;
  error?: string;
  onRefresh: () => void;
}

export function ParamsCard({ data, isLoading, error, onRefresh }: ParamsCardProps) {
  return (
    <div className="card">
      <header>
        <p className="eyebrow">Artifacts</p>
        <h2>Verifier manifest</h2>
      </header>
      {isLoading && <p className="muted">Fetching params…</p>}
      {error && <p className="error">{error}</p>}
      {data && !isLoading && !error && (
        <>
          <dl>
            <div>
              <dt>Circuit version</dt>
              <dd>{data.circuit_version}</dd>
            </div>
            <div>
              <dt>Manifest version</dt>
              <dd>{data.manifest_version}</dd>
            </div>
            <div>
              <dt>Params hash</dt>
              <dd className="mono">{data.params_hash}</dd>
            </div>
            <div>
              <dt>VK hash</dt>
              <dd className="mono">{data.vk_hash}</dd>
            </div>
            <div>
              <dt>PK hash</dt>
              <dd className="mono">{data.pk_hash}</dd>
            </div>
          </dl>
          <div className="artifact-grid">
            <ArtifactButton label="Params" bytes={data.params} fileName="params.bin" />
            <ArtifactButton label="Verifying key" bytes={data.vk} fileName="vk.bin" />
            <ArtifactButton label="Proving key" bytes={data.pk} fileName="pk.bin" />
          </div>
        </>
      )}
      <div className="actions">
        <button type="button" onClick={onRefresh} disabled={isLoading}>
          {isLoading ? (
            <>
              <span className="spinner small"></span>
              <span>Refreshing…</span>
            </>
          ) : (
            <>
              <span>↻</span>
              <span>Refresh</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}

function ArtifactButton({
  bytes,
  label,
  fileName,
}: {
  bytes: number[];
  label: string;
  fileName: string;
}) {
  const size = humanFileSize(bytes.length);
  const base64 = bytesToBase64(bytes);

  const handleDownload = () => {
    downloadBytes(bytes, fileName);
    showToast(`Downloaded ${fileName}`, 'success');
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(base64);
      showToast(`${label} copied to clipboard`, 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      showToast(`Failed to copy ${label}: ${message}`, 'error');
    }
  };

  return (
    <div className="artifact-card">
      <h3>{label}</h3>
      <p className="muted">{size}</p>
      <div className="artifact-actions">
        <button type="button" onClick={handleDownload}>
          Download
        </button>
        <button type="button" className="ghost" onClick={handleCopy}>
          Copy base64
        </button>
      </div>
    </div>
  );
}

export function EpochCard({ data, isLoading, error, onRefresh }: EpochCardProps) {
  return (
    <div className="card">
      <header>
        <p className="eyebrow">Verifier clock</p>
        <h2>Epoch guardrail</h2>
      </header>
      {isLoading && <p className="muted">Refreshing epoch…</p>}
      {error && <p className="error">{error}</p>}
      {data && !isLoading && !error && (
        <dl>
          <div>
            <dt>Current epoch</dt>
            <dd>{formatEpoch(data.current_epoch)}</dd>
          </div>
          <div>
            <dt>Max drift</dt>
            <dd>{data.max_drift_secs} seconds</dd>
          </div>
        </dl>
      )}
      <div className="actions">
        <button type="button" onClick={onRefresh} disabled={isLoading}>
          {isLoading ? (
            <>
              <span className="spinner small"></span>
              <span>Refreshing…</span>
            </>
          ) : (
            <>
              <span>↻</span>
              <span>Refresh</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}

