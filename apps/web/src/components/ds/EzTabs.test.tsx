import { fireEvent, render, screen } from '@testing-library/react';
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
    
    // Disabled tab keeps the disabled attribute (no opacity, see DS-26)
    const disabledTab = screen.getByText('Danger Zone');
    expect(disabledTab).toBeDisabled();
    expect(disabledTab.className).not.toContain('opacity-50');
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
      await user.keyboard('x{ArrowDown}{PageUp}');
      expect(onChange).not.toHaveBeenCalled();
    });

    it('lands Home and End on enabled tabs when the ends are disabled', async () => {
      const user = userEvent.setup();
      const edged = [
        { id: 'x', label: 'X', disabled: true },
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
        { id: 'y', label: 'Y', disabled: true },
      ];
      function Edged() {
        const [active, setActive] = useState<string | number>('a');
        return <EzTabs tabs={edged} activeTab={active} onChange={setActive} />;
      }
      render(<Edged />);

      screen.getByRole('tab', { name: 'A' }).focus();
      await user.keyboard('{End}');
      expect(screen.getByRole('tab', { name: 'B' })).toHaveFocus();
      expect(screen.getByRole('tab', { name: 'B' })).toHaveAttribute('aria-selected', 'true');
      await user.keyboard('{Home}');
      expect(screen.getByRole('tab', { name: 'A' })).toHaveFocus();
      expect(screen.getByRole('tab', { name: 'A' })).toHaveAttribute('aria-selected', 'true');
    });

    it('leaves browser shortcuts alone: Alt, Ctrl and Meta with an arrow do nothing', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(<EzTabs tabs={tabs} activeTab="b" onChange={onChange} />);

      screen.getByRole('tab', { name: 'B' }).focus();
      await user.keyboard('{Alt>}{ArrowLeft}{/Alt}');
      await user.keyboard('{Control>}{ArrowRight}{/Control}');
      await user.keyboard('{Meta>}{Home}{/Meta}');
      expect(onChange).not.toHaveBeenCalled();
      expect(screen.getByRole('tab', { name: 'B' })).toHaveFocus();
    });

    it('does not call onChange when the key lands on the tab that is already active', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(<EzTabs tabs={tabs} activeTab="a" onChange={onChange} />);

      screen.getByRole('tab', { name: 'A' }).focus();
      await user.keyboard('{Home}');
      expect(onChange).not.toHaveBeenCalled();
      expect(screen.getByRole('tab', { name: 'A' })).toHaveFocus();
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


  describe('overflow e aba desabilitada (DS-26)', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ id: `t${i}`, label: `Aba ${i}` }));

    function mockOverflow(el: HTMLElement, scrollWidth: number, clientWidth: number, scrollLeft = 0) {
      Object.defineProperty(el, 'scrollWidth', { configurable: true, value: scrollWidth });
      Object.defineProperty(el, 'clientWidth', { configurable: true, value: clientWidth });
      Object.defineProperty(el, 'scrollLeft', { configurable: true, writable: true, value: scrollLeft });
    }

    it('shows no overflow indicator when the tabs fit', () => {
      render(<EzTabs tabs={many} activeTab="t0" onChange={vi.fn()} />);
      expect(screen.queryByTestId('ez-tabs-overflow-end')).not.toBeInTheDocument();
      expect(screen.queryByTestId('ez-tabs-overflow-start')).not.toBeInTheDocument();
    });

    it('shows the end indicator when the list overflows and the start one after scrolling', () => {
      render(<EzTabs tabs={many} activeTab="t0" onChange={vi.fn()} />);
      const list = screen.getByRole('tablist');
      mockOverflow(list, 900, 390, 0);
      fireEvent.scroll(list);
      expect(screen.getByTestId('ez-tabs-overflow-end')).toBeInTheDocument();
      expect(screen.queryByTestId('ez-tabs-overflow-start')).not.toBeInTheDocument();

      list.scrollLeft = 200;
      fireEvent.scroll(list);
      expect(screen.getByTestId('ez-tabs-overflow-start')).toBeInTheDocument();
      expect(screen.getByTestId('ez-tabs-overflow-end')).toBeInTheDocument();

      list.scrollLeft = 510;
      fireEvent.scroll(list);
      expect(screen.queryByTestId('ez-tabs-overflow-end')).not.toBeInTheDocument();
    });

    it('scrolls the active tab into view on mount and when it changes', () => {
      const scrollIntoView = vi.fn();
      Element.prototype.scrollIntoView = scrollIntoView;
      try {
        const { rerender } = render(<EzTabs tabs={many} activeTab="t0" onChange={vi.fn()} />);
        expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
        scrollIntoView.mockClear();
        rerender(<EzTabs tabs={many} activeTab="t5" onChange={vi.fn()} />);
        expect(scrollIntoView).toHaveBeenCalledTimes(1);
        expect(scrollIntoView.mock.contexts[0]).toBe(screen.getByRole('tab', { name: 'Aba 5' }));
      } finally {
        delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
      }
    });

    it('styles disabled tabs with a gray text token instead of opacity-50 in both variants', () => {
      for (const variant of ['line', 'pills'] as const) {
        const { unmount } = render(<EzTabs tabs={dummyTabs} activeTab="1" onChange={vi.fn()} variant={variant} />);
        const disabled = screen.getByRole('tab', { name: 'Danger Zone' });
        expect(disabled).toBeDisabled();
        expect(disabled.className).not.toContain('opacity-50');
        expect(disabled).toHaveClass('text-gray-400');
        expect(disabled).toHaveClass('cursor-not-allowed');
        unmount();
      }
    });
  });
});
