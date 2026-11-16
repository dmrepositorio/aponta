import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EzSegmented } from './EzSegmented';
import { classesUpTo, heightContractProblems } from '../../test-utils/controlHeight';

const options = [
  { value: 'list', label: 'Lista' },
  { value: 'kanban', label: 'Kanban' },
] as const;

function renderSegmented(props: Partial<Parameters<typeof EzSegmented>[0]> = {}) {
  return render(
    <EzSegmented
      aria-label="Visualização"
      options={[...options]}
      value="kanban"
      onChange={vi.fn()}
      {...props}
    />,
  );
}

describe('EzSegmented (AC-03, AC-15)', () => {
  it('renders the options as buttons inside a named group', () => {
    renderSegmented();
    const group = screen.getByRole('group', { name: 'Visualização' });
    expect(group).toContainElement(screen.getByRole('button', { name: 'Lista' }));
    expect(group).toContainElement(screen.getByRole('button', { name: 'Kanban' }));
  });

  it('exposes the selected option with aria-pressed', () => {
    renderSegmented({ value: 'kanban' });
    expect(screen.getByRole('button', { name: 'Kanban' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Lista' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('calls onChange with the option value on click', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderSegmented({ onChange });
    await user.click(screen.getByRole('button', { name: 'Lista' }));
    expect(onChange).toHaveBeenCalledWith('list');
  });

  it('does not call onChange for a disabled option', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderSegmented({
      onChange,
      options: [
        { value: 'list', label: 'Lista', disabled: true },
        { value: 'kanban', label: 'Kanban' },
      ],
    });
    await user.click(screen.getByRole('button', { name: 'Lista' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('is reachable by keyboard and activates with Enter', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderSegmented({ onChange, value: 'kanban' });
    await user.tab();
    expect(screen.getByRole('button', { name: 'Lista' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith('list');
  });
});

describe('EzSegmented size (DMTE-527 AC-02)', () => {
  const group = () => screen.getByRole('group', { name: 'Visualização' });

  it('AC-02: size="toolbar" is 36 px from sm and at least 44 px below it, and no longer uses the 42 px token', () => {
    renderSegmented({ size: 'toolbar' });
    expect(heightContractProblems(classesUpTo(group()), 'toolbar')).toEqual([]);
    expect(group().className).not.toContain('h-[var(--control-height-md)]');
  });

  it('AC-02: the default size keeps the 42 px token, without the toolbar height', () => {
    renderSegmented();
    expect(group().className).toContain('h-[var(--control-height-md)]');
    expect(group().className).not.toContain('--control-height-toolbar');
  });

  it('AC-02: an explicit size="default" is the same 42 px as no size', () => {
    renderSegmented({ size: 'default' });
    expect(group().className).toContain('h-[var(--control-height-md)]');
    expect(group().className).not.toContain('--control-height-toolbar');
  });

  it('AC-02: size="toolbar" keeps the accessible group, aria-pressed and the click contract', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderSegmented({ size: 'toolbar', onChange });
    expect(screen.getByRole('button', { name: 'Kanban' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Lista' }));
    expect(onChange).toHaveBeenCalledWith('list');
  });
});

describe('EzSegmented story (DMTE-527 AC-02)', () => {
  it('AC-02: the story file covers the default and the toolbar size', () => {
    const story = readFileSync(resolve(__dirname, './EzSegmented.stories.tsx'), 'utf8');
    expect(/size:\s*'toolbar'|size="toolbar"/.test(story)).toBe(true);
    expect(/size:\s*'default'|size="default"/.test(story)).toBe(true);
  });
});
