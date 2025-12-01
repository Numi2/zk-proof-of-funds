import { useCallback, useMemo, useState, useRef, useEffect } from 'react';
import type { ZkpfClient } from '../api/zkpf';
import { ApiError } from '../api/zkpf';
import type { PolicyCategory, PolicyComposeRequest } from '../types/zkpf';

interface Props {
  client: ZkpfClient;
  onComposed?: (policyId: number) => void;
}

// Quick preset templates for one-click policy creation
const PRESETS = [
  { label: '10+ ZEC shielded', description: 'At least 10 ZEC in Orchard', category: 'ZCASH_ORCHARD' as const, currency: 'ZEC', amount: 10 },
  { label: '1+ ZEC shielded', description: 'At least 1 ZEC in Orchard', category: 'ZCASH_ORCHARD' as const, currency: 'ZEC', amount: 1 },
  { label: '0.1+ ZEC shielded', description: 'At least 0.1 ZEC in Orchard', category: 'ZCASH_ORCHARD' as const, currency: 'ZEC', amount: 0.1 },
  { label: 'Empty wallet', description: 'Prove zero ZEC balance', category: 'ZCASH_ORCHARD' as const, currency: 'ZEC', amount: 0, exactZero: true },
] as const;

interface ParsedPolicy {
  category: PolicyCategory;
  currency: 'ZEC';
  amount: number;
  exactZero?: boolean;
  label: string;
}

// Smart parser: extract policy parameters from natural language
function parseNaturalLanguage(input: string): ParsedPolicy | null {
  const text = input.toLowerCase().trim();
  if (!text) return null;

  // ZEC-only: this prover is for Zcash Orchard wallet balances
  const currency: 'ZEC' = 'ZEC';
  let amount = 0;
  const category: PolicyCategory = 'ZCASH_ORCHARD';
  let exactZero = false;

  // Check for zero/empty wallet proof
  if (/\b(zero|empty|no balance|0 zec|nothing)\b/.test(text)) {
    exactZero = true;
    amount = 0;
  } else {
    // Parse amounts with various formats
    const amountPatterns = [
      // 10 ZEC or 10 zcash or shielded
      /([\d,]+(?:\.\d+)?)\s*(k|m|million|thousand)?\s*(?:zec|zcash|shielded)?/i,
      // Generic number at end: "at least 50"
      /(?:at least|minimum|min|>=?|≥)\s*([\d,]+(?:\.\d+)?)\s*(k|m|million|thousand)?/i,
      // Just a number
      /([\d,]+(?:\.\d+)?)\s*(k|m|million|thousand)?$/i,
    ];

    for (const pattern of amountPatterns) {
      const match = text.match(pattern);
      if (match) {
        const numStr = match[1].replace(/,/g, '');
        let num = parseFloat(numStr);
        const multiplier = match[2]?.toLowerCase();
        
        if (multiplier === 'k' || multiplier === 'thousand') {
          num *= 1000;
        } else if (multiplier === 'm' || multiplier === 'million') {
          num *= 1000000;
        }
        
        amount = num;
        break;
      }
    }
  }

  // Generate a nice label
  const formatAmount = (n: number) => {
    if (n >= 1000000) return `${(n / 1000000).toFixed(n % 1000000 === 0 ? 0 : 1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K`;
    return n.toLocaleString();
  };

  let label: string;
  if (exactZero) {
    label = 'Empty wallet (0 ZEC)';
  } else if (amount > 0) {
    label = `≥ ${formatAmount(amount)} ZEC`;
  } else {
    label = 'Custom policy';
  }

  if (amount === 0 && !exactZero) {
    return null; // Need a valid amount unless proving zero
  }

  return { category, currency, amount, exactZero, label };
}

// ZEC currency code (custom ISO-style code for Zcash)
const ZEC_CURRENCY_CODE = 999001;

export function PolicyComposer({ client, onComposed }: Props) {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Parse natural language in real-time
  const parsed = useMemo(() => parseNaturalLanguage(input), [input]);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = inputRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
    }
  }, [input]);

  const handlePreset = useCallback((preset: typeof PRESETS[number]) => {
    const { amount } = preset;
    const exactZero = 'exactZero' in preset && preset.exactZero === true;
    
    if (exactZero) {
      setInput('Prove zero ZEC balance (empty wallet)');
    } else {
      setInput(`At least ${amount.toLocaleString()} ZEC`);
    }
    setError(null);
    setSuccess(null);
    inputRef.current?.focus();
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!parsed) {
      setError('Please describe what you want to prove, e.g., "at least 10 ZEC" or "50 ZEC shielded"');
      return;
    }

    setError(null);
    setSuccess(null);
    setLoading(true);

    try {
      const { category, amount, exactZero, label } = parsed;

      // Auto-generate scope ID based on a hash of the policy params for uniqueness
      const scopeId = Math.abs((category.charCodeAt(0) * 100 + amount) % 10000);

      // ZCASH_ORCHARD only
      const thresholdRaw = exactZero ? 0 : Math.round(amount * 1e8); // zats
      
      const payload: PolicyComposeRequest = {
        category,
        rail_id: 'ZCASH_ORCHARD',
        label,
        options: {
          network: 'mainnet',
          pool: 'orchard',
          threshold_zec_display: amount,
          zec_decimals: 8,
          ...(exactZero && { exact_zero: true }),
        },
        threshold_raw: thresholdRaw,
        required_currency_code: ZEC_CURRENCY_CODE,
        verifier_scope_id: scopeId,
      };

      const response = await client.composePolicy(payload);
      setLoading(false);

      const composed = response.policy;
      if (
        composed &&
        typeof composed === 'object' &&
        'policy_id' in composed &&
        typeof (composed as { policy_id: unknown }).policy_id === 'number'
      ) {
        onComposed?.((composed as { policy_id: number }).policy_id);
      }

      setSuccess('Policy created!');
      setInput('');
    } catch (err) {
      setLoading(false);
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError((err as Error).message ?? 'Something went wrong');
      }
    }
  }, [client, parsed, onComposed]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && parsed) {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit, parsed]);

  // Get category label for display
  const getCategoryLabel = (cat: PolicyCategory) => {
    switch (cat) {
      case 'ZCASH_ORCHARD': return 'Zcash Orchard';
      default: return cat;
    }
  };

  return (
    <section className="policy-composer policy-composer--natural">
      <div className="policy-composer-natural-input-wrapper">
        <textarea
          ref={inputRef}
          className="policy-composer-natural-input"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setError(null);
            setSuccess(null);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Describe your policy... e.g., &quot;at least 10 ZEC&quot; or &quot;1 ZEC shielded&quot;"
          rows={1}
          disabled={loading}
        />
        <button
          type="button"
          className="policy-composer-submit-btn"
          onClick={handleSubmit}
          disabled={loading || !parsed}
          title={parsed ? 'Create policy (Enter)' : 'Type a valid policy first'}
        >
          {loading ? (
            <span className="policy-composer-spinner" />
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          )}
        </button>
      </div>

      {/* Quick presets */}
      <div className="policy-composer-presets">
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            className="policy-composer-preset-chip"
            onClick={() => handlePreset(preset)}
            disabled={loading}
            title={preset.description}
          >
            {preset.label}
          </button>
        ))}
      </div>

      {/* Live parsed preview */}
      {parsed && (
        <div className="policy-composer-preview">
          <span className="policy-composer-preview-badge">{getCategoryLabel(parsed.category)}</span>
          <span className="policy-composer-preview-label">{parsed.label}</span>
        </div>
      )}

      {/* Status messages */}
      {error && (
        <div className="policy-composer-message policy-composer-message--error">
          {error}
        </div>
      )}
      {success && !error && (
        <div className="policy-composer-message policy-composer-message--success">
          {success}
        </div>
      )}
    </section>
  );
}
