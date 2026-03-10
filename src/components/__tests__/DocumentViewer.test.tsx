import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DocumentViewer } from '../DocumentViewer';
import { DetectedEntity } from '../../lib/entity-types';

function makeEntity(overrides: Partial<DetectedEntity> & { start: number; end: number; text: string }): DetectedEntity {
  return {
    id: `test-${overrides.start}`,
    category: 'EMAIL',
    source: 'regex',
    accepted: true,
    ...overrides,
  };
}

describe('DocumentViewer', () => {
  it('renders plain text when no entities', () => {
    render(
      <DocumentViewer text="Hello world" entities={[]} onEntityClick={vi.fn()} />,
    );
    expect(screen.getByText('Hello world')).toBeInTheDocument();
  });

  it('highlights accepted entities as clickable spans', () => {
    const text = 'Email me at test@example.com please';
    const entities = [
      makeEntity({ text: 'test@example.com', start: 12, end: 28 }),
    ];

    render(
      <DocumentViewer text={text} entities={entities} onEntityClick={vi.fn()} />,
    );

    const highlighted = screen.getByText('test@example.com');
    expect(highlighted).toBeInTheDocument();
    expect(highlighted.tagName).toBe('SPAN');
    // Verify it has the entity styling (class-based cursor)
    expect(highlighted.className).toContain('cursor-pointer');
  });

  it('does not highlight rejected entities', () => {
    const text = 'Email me at test@example.com please';
    const entities = [
      makeEntity({ text: 'test@example.com', start: 12, end: 28, accepted: false }),
    ];

    render(
      <DocumentViewer text={text} entities={entities} onEntityClick={vi.fn()} />,
    );

    // The full text should render as one unstyled block
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it('calls onEntityClick when clicking a highlighted entity', () => {
    const onClick = vi.fn();
    const text = 'SSN: 123-45-6789';
    const entities = [
      makeEntity({ id: 'ssn-1', text: '123-45-6789', start: 5, end: 16, category: 'SSN' }),
    ];

    render(
      <DocumentViewer text={text} entities={entities} onEntityClick={onClick} />,
    );

    fireEvent.click(screen.getByText('123-45-6789'));
    expect(onClick).toHaveBeenCalledWith('ssn-1');
  });

  it('renders multiple entities with correct surrounding text', () => {
    const text = 'A test@a.com B test@b.com C';
    const entities = [
      makeEntity({ text: 'test@a.com', start: 2, end: 12 }),
      makeEntity({ text: 'test@b.com', start: 15, end: 25 }),
    ];

    render(
      <DocumentViewer text={text} entities={entities} onEntityClick={vi.fn()} />,
    );

    expect(screen.getByText('test@a.com')).toBeInTheDocument();
    expect(screen.getByText('test@b.com')).toBeInTheDocument();
  });
});
