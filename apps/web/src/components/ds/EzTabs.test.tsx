import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { EzTabs, ezTabId, ezTabPanelId } from './EzTabs';

const dummyTabs = [
  { id: '1', label: 'Overview' },
  { id: '2', label: 'Settings' },
  { id: '3', label: 'Danger Zone', disabled: true },
];

describe('EzTabs', () => {
  it('renders line variant by default and highlights the active tab', () => {
    render(<EzTabs tabs={dummyTabs} activeTab="1" onChange={vi.fn()} />);
    expect(screen.getByText('Overview')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
    
    // In line variant, active tab gets text-brand-600
    expect(screen.getByText('Overview')).toHaveClass('text-brand-600');
    expect(screen.getByText('Settings')).not.toHaveClass('text-brand-600');
  });

  it('renders pills variant and marks disabled state correctly', () => {
    render(<EzTabs tabs={dummyTabs} activeTab="2" onChange={vi.fn()} variant="pills" />);
    // Active pill gets bg-brand-100
    expect(screen.getByText('Settings')).toHaveClass('bg-brand-100');
    
    // Disabled tab has opacity and disabled attribute
    const disabledTab = screen.getByText('Danger Zone');
    expect(disabledTab).toBeDisabled();
    expect(disabledTab).toHaveClass('opacity-50');
  });

  it('fires onChange when a non-disabled tab is clicked', async () => {
    const user = userEvent.setup();
    const mockOnChange = vi.fn();
    render(<EzTabs tabs={dummyTabs} activeTab="1" onChange={mockOnChange} />);

    await user.click(screen.getByText('Settings'));
    expect(mockOnChange).toHaveBeenCalledWith('2');
  });

  it('does not fire onChange when a disabled tab is clicked', async () => {
    const user = userEvent.setup();
    const mockOnChange = vi.fn();
    render(<EzTabs tabs={dummyTabs} activeTab="1" onChange={mockOnChange} />);

    await user.click(screen.getByText('Danger Zone'));
    expect(mockOnChange).not.toHaveBeenCalled();
  });

  describe('keyboard and ARIA (DMTE-532)', () => {
    const tabs = [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
      { id: 'c', label: 'C', disabled: true },
      { id: 'd', label: 'D' },
    ];

    function Controlled({ initial = 'b', ...props }: { initial?: string; role?: string; idPrefix?: string }) {
      const [active, setActive] = useState<string | number>(initial);
      return <EzTabs tabs={tabs} activeTab={active} onChange={setActive} {...props} />;
    }

    it('uses the shared inset focus indicator in both variants', () => {
      const { rerender } = render(<EzTabs tabs={tabs} activeTab="a" onChange={vi.fn()} variant="pills" />);
      for (const variant of ['pills', 'line'] as const) {
        rerender(<EzTabs tabs={tabs} activeTab="a" onChange={vi.fn()} variant={variant} />);
        const tab = screen.getByRole('tab', { name: 'A' });
        expect(tab).toHaveClass('ez-focus-inset');
        expect(tab.className).not.toContain('outline-none');
        expect(tab.className).not.toContain('ring-brand-200');
        expect(tab.className).not.toContain('focus-visible:bg-gray-80');
      }
    });

    it('keeps only the active tab in the tab order', () => {
      const { rerender } = render(<EzTabs tabs={tabs} activeTab="b" onChange={vi.fn()} />);
      const tabIndexes = () => screen.getAllByRole('tab').map((tab) => tab.getAttribute('tabindex'));
      expect(tabIndexes()).toEqual(['-1', '0', '-1', '-1']);

      // without a matching active tab the first enabled one is the way in
      rerender(<EzTabs tabs={tabs} activeTab="zzz" onChange={vi.fn()} />);
      expect(tabIndexes()).toEqual(['0', '-1', '-1', '-1']);
    });

    it('moves focus and selection with arrows, Home and End', async () => {
      const user = userEvent.setup();
      render(<Controlled initial="a" />);

      await user.tab();
      expect(screen.getByRole('tab', { name: 'A' })).toHaveFocus();

      await user.keyboard('{ArrowRight}');
      expect(screen.getByRole('tab', { name: 'B' })).toHaveFocus();
      expect(screen.getByRole('tab', { name: 'B' })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByRole('tab', { name: 'A' })).toHaveAttribute('aria-selected', 'false');

      await user.keyboard('{End}');
      expect(screen.getByRole('tab', { name: 'D' })).toHaveFocus();
      expect(screen.getByRole('tab', { name: 'D' })).toHaveAttribute('aria-selected', 'true');

      await user.keyboard('{Home}');
      expect(screen.getByRole('tab', { name: 'A' })).toHaveFocus();
      expect(screen.getByRole('tab', { name: 'A' })).toHaveAttribute('aria-selected', 'true');
    });

    it('skips disabled tabs and wraps around', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(<EzTabs tabs={tabs} activeTab="b" onChange={onChange} />);

      screen.getByRole('tab', { name: 'B' }).focus();
      await user.keyboard('{ArrowRight}');
      expect(onChange).toHaveBeenLastCalledWith('d');
      expect(screen.getByRole('tab', { name: 'D' })).toHaveFocus();

      await user.keyboard('{ArrowRight}');
      expect(onChange).toHaveBeenLastCalledWith('a');

      await user.keyboard('{ArrowLeft}');
      expect(onChange).toHaveBeenLastCalledWith('d');

      onChange.mockClear();
      await user.keyboard('x{ArrowDown}{Enter}');
      expect(onChange).not.toHaveBeenCalledWith('a');
      expect(onChange).not.toHaveBeenCalledWith('b');
    });

    it('ignores the keyboard with a custom role', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(<EzTabs tabs={tabs} activeTab="a" onChange={onChange} role="group" aria-label="Seções" />);

      expect(screen.queryByRole('tab')).not.toBeInTheDocument();
      const first = screen.getByRole('button', { name: 'A' });
      expect(first).not.toHaveAttribute('tabindex');
      first.focus();
      await user.keyboard('{ArrowRight}{End}');
      expect(onChange).not.toHaveBeenCalled();
    });

    it('links tabs to panels only when an idPrefix is given', () => {
      const { rerender } = render(<EzTabs tabs={tabs} activeTab="a" onChange={vi.fn()} />);
      for (const tab of screen.getAllByRole('tab')) {
        expect(tab).not.toHaveAttribute('id');
        expect(tab).not.toHaveAttribute('aria-controls');
      }

      rerender(<EzTabs tabs={tabs} activeTab="a" onChange={vi.fn()} idPrefix="x" />);
      const tabA = screen.getByRole('tab', { name: 'A' });
      expect(tabA).toHaveAttribute('id', 'x-tab-a');
      expect(tabA).toHaveAttribute('aria-controls', 'x-panel-a');
      expect(ezTabId('x', 'a')).toBe('x-tab-a');
      expect(ezTabPanelId('x', 'a')).toBe('x-panel-a');
      expect(screen.getByRole('tab', { name: 'D' })).toHaveAttribute('aria-controls', 'x-panel-d');
    });
  });
});
