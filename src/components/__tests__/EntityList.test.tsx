import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { EntityList } from '../EntityList';
import { DetectedEntity } from '../../lib/entity-types';

function makeEntity(overrides: Partial<DetectedEntity> & { id: string; text: string; start: number; end: number }): DetectedEntity {
  return {
    category: 'EMAIL',
    source: 'regex',
    accepted: true,
    ...overrides,
  };
}

describe('EntityList', () => {
  it('shows "No PII detected yet" when entities are empty', () => {
    render(
      <EntityList entities={[]} onToggle={vi.fn()} onScrollTo={vi.fn()} />,
    );
    expect(screen.getByText('No PII detected yet')).toBeInTheDocument();
  });

  it('displays accepted count badge', () => {
    const entities = [
      makeEntity({ id: '1', text: 'a@b.com', start: 0, end: 7, accepted: true }),
      makeEntity({ id: '2', text: 'c@d.com', start: 10, end: 17, accepted: false }),
    ];
    render(
      <EntityList entities={entities} onToggle={vi.fn()} onScrollTo={vi.fn()} />,
    );
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
  });

  it('groups entities by category', () => {
    const entities = [
      makeEntity({ id: '1', text: 'a@b.com', start: 0, end: 7, category: 'EMAIL' }),
      makeEntity({ id: '2', text: '123-45-6789', start: 10, end: 21, category: 'SSN' }),
    ];
    render(
      <EntityList entities={entities} onToggle={vi.fn()} onScrollTo={vi.fn()} />,
    );
    expect(screen.getByText(/Email \(1\)/i)).toBeInTheDocument();
    expect(screen.getByText(/SSN \(1\)/i)).toBeInTheDocument();
  });

  it('calls onToggle when toggle button is clicked', () => {
    const onToggle = vi.fn();
    const entities = [
      makeEntity({ id: 'e1', text: 'a@b.com', start: 0, end: 7 }),
    ];
    const { container } = render(
      <EntityList entities={entities} onToggle={onToggle} onScrollTo={vi.fn()} />,
    );

    // Find the Reject button within the rendered container
    const rejectBtns = within(container).getAllByTitle('Reject');
    fireEvent.click(rejectBtns[0]);
    expect(onToggle).toHaveBeenCalledWith('e1');
  });

  it('shows entity text', () => {
    const entities = [
      makeEntity({ id: '1', text: 'john@example.com', start: 0, end: 16 }),
    ];
    render(
      <EntityList entities={entities} onToggle={vi.fn()} onScrollTo={vi.fn()} />,
    );
    expect(screen.getByText('john@example.com')).toBeInTheDocument();
  });
});
