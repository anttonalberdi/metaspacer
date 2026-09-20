import type { ConfidenceTier } from '../../shared/results-bundle';
import { tierDescriptions, tierLabels } from '../theme';

const tiers: ConfidenceTier[] = ['measured', 'interpolated', 'extrapolated'];

export function TierGuide() {
  return (
    <section className="tier-guide" aria-label="Confidence tier definitions">
      {tiers.map((tier, index) => (
        <article key={tier} className={`tier-guide-item tier-${tier}`}>
          <span className="tier-number">0{index + 1}</span>
          <div>
            <strong>{tierLabels[tier]}</strong>
            <p>{tierDescriptions[tier]}</p>
          </div>
        </article>
      ))}
    </section>
  );
}
