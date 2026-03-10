import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { RedactControls } from '../RedactControls';

function renderControls(overrides = {}) {
  const props = {
    entityCount: 5,
    acceptedCount: 3,
    redactStyle: 'text' as const,
    onRedactStyleChange: vi.fn(),
    onAcceptAll: vi.fn(),
    onRejectAll: vi.fn(),
    onRedact: vi.fn(),
    onDownload: vi.fn(),
    redacted: false,
    ...overrides,
  };
  const result = render(<RedactControls {...props} />);
  return { ...result, props };
}

describe('RedactControls', () => {
  it('shows redact button with entity count when not redacted', () => {
    renderControls();
    expect(screen.getByText(/Redact 3 Entities/)).toBeInTheDocument();
  });

  it('shows download button when redacted', () => {
    renderControls({ redacted: true });
    expect(screen.getByText(/Download Redacted/)).toBeInTheDocument();
  });

  it('disables redact button when no entities accepted', () => {
    renderControls({ acceptedCount: 0 });
    const btn = screen.getByText(/Redact 0 Entities/).closest('button')!;
    expect(btn).toHaveStyle({ opacity: '0.5' });
  });

  it('calls onAcceptAll when Accept All clicked', () => {
    const { container, props } = renderControls();
    const btn = within(container).getAllByText(/Accept All/)[0];
    fireEvent.click(btn);
    expect(props.onAcceptAll).toHaveBeenCalled();
  });

  it('calls onRejectAll when Reject All clicked', () => {
    const { container, props } = renderControls();
    const btn = within(container).getAllByText(/Reject All/)[0];
    fireEvent.click(btn);
    expect(props.onRejectAll).toHaveBeenCalled();
  });

  it('calls onRedact when redact button clicked', () => {
    const { container, props } = renderControls();
    const btn = within(container).getByText(/Redact 3 Entities/);
    fireEvent.click(btn);
    expect(props.onRedact).toHaveBeenCalled();
  });

  it('calls onDownload when download button clicked', () => {
    const { container, props } = renderControls({ redacted: true });
    const btn = within(container).getByText(/Download Redacted/);
    fireEvent.click(btn);
    expect(props.onDownload).toHaveBeenCalled();
  });

  it('shows entity count summary', () => {
    const { container } = renderControls();
    expect(within(container).getByText(/3 of 5 entities selected for redaction/)).toBeInTheDocument();
  });

  it('switches redact style to blocks', () => {
    const { container, props } = renderControls();
    const blocksBtn = within(container).getAllByText('\u2588\u2588\u2588\u2588')[0];
    fireEvent.click(blocksBtn);
    expect(props.onRedactStyleChange).toHaveBeenCalledWith('blocks');
  });
});
