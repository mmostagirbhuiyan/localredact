import { describe, it, expect } from 'vitest';
import { render, within } from '@testing-library/react';
import { ShareCard } from '../ShareCard';

describe('ShareCard', () => {
  it('renders nothing when not visible', () => {
    const { container } = render(<ShareCard entityCount={5} visible={false} />);
    expect(container.innerHTML).toBe('');
  });

  it('shows entity count for plural', () => {
    const { container } = render(<ShareCard entityCount={14} visible={true} />);
    expect(within(container).getByText(/Redacted 14 PII entities/)).toBeInTheDocument();
  });

  it('uses singular when count is 1', () => {
    const { container } = render(<ShareCard entityCount={1} visible={true} />);
    expect(within(container).getByText(/Redacted 1 PII entity/)).toBeInTheDocument();
  });

  it('shows zero bytes uploaded message', () => {
    const { container } = render(<ShareCard entityCount={5} visible={true} />);
    // Text may be split by the Lock icon - search in the full container text
    expect(container.textContent).toContain('Zero bytes uploaded');
  });

  it('mentions LocalRedact branding', () => {
    const { container } = render(<ShareCard entityCount={5} visible={true} />);
    expect(container.textContent).toContain('LocalRedact');
  });
});
