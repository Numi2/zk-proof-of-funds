const steps = [
  {
    title: 'Sync the verifier context',
    summary: 'The console automatically checks that your verifier settings and time window are up to date.',
    detail:
      'In the background the console calls /zkpf/params and /zkpf/epoch to make sure it is talking to the right circuit version and that the verifier clock is within the allowed window.',
    checklist: [
      'Check that the manifest and circuit versions match the prover you are using.',
      'Note how long a proof stays valid (the epoch drift window).',
    ],
  },
  {
    title: 'Load a proof bundle',
    summary: 'Paste JSON or drag-and-drop the bundle exported by your custody system.',
    detail:
      'Bundles stay in your browser unless you choose to send them to the verifier. Use the rail toggle to mark whether the proof covers on-chain crypto (including Zcash Orchard) or fiat bank accounts.',
    checklist: [
      'Normalize byte arrays to the supported JSON encodings.',
      'You can clear the input at any time with the secondary (ghost) button.',
      'Use the rail toggle to record whether funds are on-chain or fiat.',
    ],
  },
  {
    title: 'Bind to a verifier policy',
    summary: 'Choose the policy ID that matches the minimum balance your counterparty asked for.',
    detail:
      'Each policy describes the currency, minimum balance, custodian, and scope. Use standard currency codes (like USD or EUR) and your internal scope IDs for asset pools.',
    checklist: [
      'Watch for mismatch alerts if the bundle data does not match the policy.',
      'Reload policies after backend configuration changes.',
    ],
  },
  {
    title: 'Send to verifier',
    summary: 'Submit the proof to the verifier from the UI (either /zkpf/verify-bundle or /zkpf/verify).',
    detail:
      'For raw proofs, the console re-encodes public inputs to match the payload your automation would send. The verification banner clearly shows which rail (on-chain, fiat, or Orchard) was used.',
    checklist: [
      'Treat the verification banner as your receipt.',
      'Retry only after resolving backend errors.',
      'Store which rail you used together with the verifier response.',
    ],
  },
  {
    title: 'Share the audit package',
    summary: 'Export the proof JSON and policy context for credit desks, exchanges, or regulators.',
    detail:
      'Download artifacts, copy base64 proofs, and paste verifier responses into your deal room so everyone works from the same attestation.',
    checklist: [
      'Attach the verifier result to your credit memo or internal file.',
      'Store the bundle and policy metadata in your audit log.',
    ],
  },
];

const valuePillars = [
  {
    title: 'Faster diligence loops',
    body:
      'Credit desks and exchanges review the same bundle, policy, and verifier result instead of waiting for custom spreadsheets or screenshots.',
    bullets: [
      'Single link for onboarding and risk teams.',
      'Shared language: circuit version, policy, and scope IDs.',
      'Can be wired into automated retries and alerting.',
    ],
  },
  {
    title: 'Privacy-preserving transparency',
    body:
      'Zero-knowledge proofs show you meet the required total balance while keeping individual wallets and trades private—ideal for OTC and treasury operations.',
    bullets: [
      'No raw addresses or detailed balance breakdowns.',
      'Control how much detail you share by adjusting policies.',
      'Cryptographic receipts instead of PDFs.',
    ],
  },
  {
    title: 'Audit ready by design',
    body:
      'Structured JSON, hashes, and verifier responses map cleanly to SOC 2 / ISAE evidence requirements.',
    bullets: ['Stable bundle schema.', 'Clear manifest and epoch history.', 'Drop artifacts into existing GRC tools.'],
  },
  {
    title: 'Multi-rail coverage',
    body:
      'One workflow covers Zcash Orchard, other digital asset reserves, and fiat treasury balances, so finance, compliance, and crypto teams can share the same tool.',
    bullets: [
      'Rail toggle records where funds are held.',
      'Policy metadata handles ISO currency codes and custody IDs.',
      'Single verifier result no matter which rail you use.',
    ],
  },
];

export function UsageGuide() {
  return (
    <section className="usage-guide">
      <header>
        <p className="eyebrow">How teams use it</p>
        <h2>Step-by-step: from custody proof to counterparty confidence</h2>
        <p className="muted">
          Follow these steps when a lender, exchange, or regulator requests proof-of-funds. Each step highlights the part
          of the UI you will use and the evidence your stakeholders expect to see.
        </p>
      </header>

      <div className="usage-guide-grid">
        <article className="usage-guide-steps card">
          <ol>
            {steps.map((step, index) => (
              <li key={step.title} className="usage-step">
                <div className="usage-step-number">{index + 1}</div>
                <div className="usage-step-body">
                  <p className="usage-step-title">{step.title}</p>
                  <p className="usage-step-summary">{step.summary}</p>
                  <p className="usage-step-detail">{step.detail}</p>
                  <ul className="usage-checklist">
                    {step.checklist.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              </li>
            ))}
          </ol>
        </article>

        <div className="usage-value-column">
          {valuePillars.map((pillar) => (
            <article key={pillar.title} className="value-card">
              <p className="value-card-label">Value</p>
              <h3>{pillar.title}</h3>
              <p className="muted">{pillar.body}</p>
              <ul className="value-list">
                {pillar.bullets.map((bullet) => (
                  <li key={bullet}>{bullet}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

