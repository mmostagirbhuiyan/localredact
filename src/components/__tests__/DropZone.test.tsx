import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { DropZone } from '../DropZone';

describe('DropZone', () => {
  it('renders drop mode by default', () => {
    render(
      <DropZone onFileSelect={vi.fn()} onTextPaste={vi.fn()} loading={false} />,
    );
    expect(screen.getByText('Drop PDFs here')).toBeInTheDocument();
  });

  it('switches to paste mode when clicking Paste Text tab', async () => {
    render(
      <DropZone onFileSelect={vi.fn()} onTextPaste={vi.fn()} loading={false} />,
    );
    const pasteButtons = screen.getAllByText('Paste Text');
    fireEvent.click(pasteButtons[0]);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Paste your text here...')).toBeInTheDocument();
    });
  });

  it('does not call onTextPaste when paste text is empty', async () => {
    const onPaste = vi.fn();
    render(
      <DropZone onFileSelect={vi.fn()} onTextPaste={onPaste} loading={false} />,
    );
    const pasteButtons = screen.getAllByText('Paste Text');
    fireEvent.click(pasteButtons[0]);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Paste your text here...')).toBeInTheDocument();
    });

    // Find the "Scan for PII" button — it should be disabled since no text entered
    const scanBtns = screen.getAllByText('Scan for PII');
    fireEvent.click(scanBtns[0]);

    // Should not have been called since text is empty
    expect(onPaste).not.toHaveBeenCalled();
  });

  it('shows loading state', () => {
    render(
      <DropZone onFileSelect={vi.fn()} onTextPaste={vi.fn()} loading={true} />,
    );
    expect(screen.getByText('Parsing PDF...')).toBeInTheDocument();
  });

  it('has hidden file input accepting only PDFs', () => {
    render(
      <DropZone onFileSelect={vi.fn()} onTextPaste={vi.fn()} loading={false} />,
    );
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.accept).toBe('.pdf');
    expect(input.className).toContain('hidden');
  });

  it('shows batch processing hint', () => {
    const { container } = render(
      <DropZone onFileSelect={vi.fn()} onTextPaste={vi.fn()} loading={false} />,
    );
    expect(container.textContent).toContain('Drop multiple files for batch processing');
  });
});
