const steps = [
  {
    title: 'Sync the verifier context',
    summary: 'Refresh the manifest + epoch cards to confirm circuit + clock alignment.',
    detail:
      'Use the Artifacts and Epoch guardrail cards above to pull /zkpf/params and /zkpf/epoch. Keep these receipts for your ops runbook.',
    checklist: ['Confirm the manifest + circuit versions match the prover you are using.', 'Note the epoch drift window.'],
  },
  {
    title: 'Load a proof bundle',
    summary: 'Paste JSON or drag-and-drop the bundle exported by your custody system.',
    detail:
      'Bundles never leave the browser until you click Send to verifier. Use the rail toggle to note whether the proof covers on-chain wallets or fiat settlement accounts.',
    checklist: [
      'Normalize byte arrays to the supported JSON encodings.',
      'Clear the input anytime with the ghost button.',
      'Flip the rail toggle to document on-chain vs fiat provenance.',
    ],
  },
  {
    title: 'Bind to a verifier policy',
    summary: 'Choose the policy ID that corresponds to the requested counterparty threshold.',
    detail:
      'Policy metadata mirrors what compliance teams expect: required currency code, custodian ID, scope ID, and threshold. Use ISO codes for fiat currencies and internal scope IDs for digital asset pools.',
    checklist: ['Watch for mismatch alerts if bundle inputs disagree with the policy.', 'Reload policies after backend config changes.'],
  },
  {
    title: 'Send to verifier',
    summary: 'Call /zkpf/verify-bundle or /zkpf/verify directly from the UI.',
    detail:
      'The workbench re-encodes public inputs when using /zkpf/verify, so you get the same payload shape as your automation. The verification banner now records which rail (on-chain or fiat) was asserted.',
    checklist: [
      'Keep the verification banner as an immutable receipt.',
      'Retry only after resolving backend errors.',
      'Store the rail context alongside the verifier response.',
    ],
  },
  {
    title: 'Share the audit package',
    summary: 'Export normalized JSON + policy context for credit desks, exchanges, or regulators.',
    detail:
      'Download artifacts, copy base64 proofs, and paste verifier responses into your deal room so every party sees the same attestation.',
    checklist: ['Attach the response banner to your credit memo.', 'Store bundle + policy metadata in your audit log.'],
  },
];

const valuePillars = [
  {
    title: 'Faster diligence loops',
    body:
      'Credit desks and exchanges review the same bundle, policy, and verifier receipt without waiting for custom spreadsheets or ad-hoc screenshots.',
    bullets: ['Single link for onboarding teams.', 'Shared vocabulary: circuit, policy, scope IDs.', 'Automated retries + alerting.'],
  },
  {
    title: 'Privacy-preserving transparency',
    body:
      'Zero-knowledge proofs show aggregate coverage while keeping underlying wallet structure private—ideal for OTC and treasury operations.',
    bullets: ['No raw addresses or balance breakdowns.', 'Selective disclosure via policy binding.', 'Cryptographic receipts instead of PDFs.'],
  },
  {
    title: 'Audit ready by design',
    body:
      'Normalized JSON, hash references, and verifier responses align with SOC 2 / ISAE evidence collection requirements.',
    bullets: ['Deterministic bundle schema.', 'Manifest + epoch provenance.', 'Drop artifacts into existing GRC tools.'],
  },
  {
    title: 'Dual-rail coverage',
    body:
      'One workflow addresses both digital asset reserves and fiat treasury balances, so finance, compliance, and crypto-ops can share the same tool.',
    bullets: ['Rail toggle documents provenance.', 'Policy metadata handles ISO + custody IDs.', 'Single verifier receipt for both rails.'],
  },
];

export function UsageGuide() {
  return (
    <section className="usage-guide">
      <header>
        <p className="eyebrow">How teams use it</p>
        <h2>Guide: from custody proof to counterparty confidence</h2>
        <p className="muted">
          Follow these steps when a lender, exchange, or regulator requests proof-of-funds. Each step calls out the UI surface and the
          evidence stakeholders expect.
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

