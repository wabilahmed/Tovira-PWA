import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button, PageHeader, Page, ListRow, Chip, ChipGroup, Tabs, Select, FileButton, Banner, Toast, EmptyState, Badge, Card, ActionRow } from './index.js';

/** [P39] The design-system components behave as the rest of the app relies on. */
describe('[P39] components', () => {
  it('Button: variants, loading disables and marks busy', async () => {
    const onClick = vi.fn();
    const { rerender } = render(<Button variant="primary" onClick={onClick}>Save</Button>);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button')).toHaveClass('ui-btn--primary');
    rerender(<Button variant="primary" loading onClick={onClick}>Save</Button>);
    expect(screen.getByRole('button')).toBeDisabled();
    expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true');
  });

  it('PageHeader: title, subtitle, "← Back" returns, optional action; inside the page template', async () => {
    const onBack = vi.fn();
    render(<Page><PageHeader title="Needs your answer" subtitle="4 to answer" back={{ label: 'Today', onBack }} action={<Button>Go</Button>} /></Page>);
    expect(screen.getByRole('heading', { level: 1, name: 'Needs your answer' })).toBeInTheDocument();
    expect(screen.getByText('4 to answer')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Back to Today' }));
    expect(onBack).toHaveBeenCalled();
    expect(screen.getByTestId('page').contains(screen.getByTestId('page-header'))).toBe(true);
  });

  it('ListRow: title, secondary, meta, trailing action, tappable', async () => {
    const onOpen = vi.fn();
    render(<ul><ListRow title="Sara Khan" secondary="3BR Townhouse · Arabian Ranches · AED 2.2M" meta="Last message 3 days ago" trailing={<Badge>Warm</Badge>} onOpen={onOpen} openLabel="Open Sara Khan" /></ul>);
    await userEvent.click(screen.getByRole('button', { name: 'Open Sara Khan' }));
    expect(onOpen).toHaveBeenCalled();
    expect(screen.getByText('Warm')).toBeInTheDocument();
  });

  it('ChipGroup: chips toggle with aria-pressed and show counts', async () => {
    const onClick = vi.fn();
    render(<ChipGroup label="Filter"><Chip selected count={5} onClick={vi.fn()}>All</Chip><Chip count={1} onClick={onClick}>Warm</Chip></ChipGroup>);
    expect(screen.getByRole('button', { name: /All/ })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: /Warm/ }));
    expect(onClick).toHaveBeenCalled();
  });

  it('Tabs: the selected tab shows its panel; arrow keys move', async () => {
    const onChange = vi.fn();
    render(<Tabs label="Phone" tabs={[{ value: 'ios', label: 'iPhone' }, { value: 'android', label: 'Android' }]} value="ios" onChange={onChange}><p>iPhone steps</p></Tabs>);
    expect(screen.getByRole('tab', { name: 'iPhone' })).toHaveAttribute('aria-selected', 'true');
    screen.getByRole('tab', { name: 'iPhone' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenCalledWith('android');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('iPhone steps');
  });

  it('Select: a styled control (no native <select>) that opens a sheet and picks', async () => {
    const onChange = vi.fn();
    const { container } = render(<Select label="Sort" value="last" options={[{ value: 'last', label: 'Last message' }, { value: 'name', label: 'Name' }]} onChange={onChange} />);
    expect(container.querySelector('select')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Sort: Last message' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Name' }));
    expect(onChange).toHaveBeenCalledWith('name');
  });

  it('FileButton: a labelled button, then the chosen file name + size — never "No file chosen"', async () => {
    const onFiles = vi.fn();
    const { rerender } = render(<FileButton label="Choose the chat export (.zip or .txt)" onFiles={onFiles} />);
    expect(screen.getByText('Choose the chat export (.zip or .txt)')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/No file chosen|Choose file/);
    await userEvent.upload(screen.getByLabelText('Choose the chat export (.zip or .txt)'), new File(['x'.repeat(2048)], 'WhatsApp Chat.zip'));
    expect(onFiles).toHaveBeenCalled();
    rerender(<FileButton label="Choose the chat export (.zip or .txt)" onFiles={onFiles} chosen={[{ name: 'WhatsApp Chat.zip', size: 2048 }]} />);
    expect(screen.getByTestId('file-chosen')).toHaveTextContent('WhatsApp Chat.zip · 2 KB');
  });

  it('Card actions sit in their own row; Banner, Toast, EmptyState render their parts', () => {
    render(<>
      <Card><p>Question?</p><ActionRow><Button>Yes</Button><Button>No</Button></ActionRow></Card>
      <Banner tone="warning" actions={<Button>Buy more usage</Button>}>80% used</Banner>
      <Toast action={<Button variant="text">Undo</Button>}>Moved</Toast>
      <EmptyState title="No clients yet." action={<Button>+ Add client</Button>}>Add your first client from a chat.</EmptyState>
    </>);
    const row = screen.getByRole('button', { name: 'Yes' }).parentElement!;
    expect(row).toHaveClass('ui-actions');
    expect(within(row).getAllByRole('button')).toHaveLength(2);
    expect(screen.getByText('80% used')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
    expect(screen.getByText('No clients yet.')).toBeInTheDocument();
  });
});
