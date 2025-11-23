import type { ReactNode } from 'react';

export type ChecklistStatus = 'pending' | 'active' | 'complete' | 'error';

export interface ChecklistStep {
  id: string;
  title: string;
  description: string | ReactNode;
  status: ChecklistStatus;
  hint?: string;
  disabled?: boolean;
  action?: ReactNode;
}

interface ProgressChecklistProps {
  steps: ChecklistStep[];
  onStepClick?: (id: string) => void;
}

export function ProgressChecklist({ steps, onStepClick }: ProgressChecklistProps) {
  return (
    <section className="progress-checklist card">
      <header className="progress-checklist-header">
        <p className="eyebrow">Checklist</p>
        <h2>Walk through the proof-of-funds flow</h2>
      </header>
      <div className="progress-checklist-grid">
        {steps.map((step, index) => {
          const clickable = !!onStepClick && !step.disabled;
          const handleClick = () => {
            if (!clickable) return;
            onStepClick?.(step.id);
          };
          return (
            <button
              key={step.id}
              type="button"
              className={`checklist-step ${step.status} ${clickable ? 'clickable' : ''}`}
              onClick={clickable ? handleClick : undefined}
              disabled={!clickable}
            >
              <div className="checklist-step-index">{String(index + 1).padStart(2, '0')}</div>
              <div className="checklist-step-body">
                <p className="checklist-step-title">{step.title}</p>
                {typeof step.description === 'string' ? (
                  <p className="checklist-step-description">{step.description}</p>
                ) : (
                  <div className="checklist-step-description checklist-step-description-node">
                    {step.description}
                  </div>
                )}
                {step.hint && <p className="checklist-step-hint">{step.hint}</p>}
              </div>
              {step.action && <div className="checklist-step-action">{step.action}</div>}
            </button>
          );
        })}
      </div>
    </section>
  );
}


