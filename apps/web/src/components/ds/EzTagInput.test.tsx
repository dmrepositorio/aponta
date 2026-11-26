import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { EzTagInput } from './EzTagInput';

describe('EzTagInput', () => {
  it('renders the existing tags', () => {
    render(<EzTagInput tags={['bug', 'urgente']} onChange={() => undefined} />);
    expect(screen.getByText('bug')).toBeInTheDocument();
    expect(screen.getByText('urgente')).toBeInTheDocument();
  });

  it('adds a new tag when typing text and pressing Enter', async () => {
    const handleChange = vi.fn();
    render(<EzTagInput tags={['bug']} onChange={handleChange} />);
    const input = screen.getByPlaceholderText('Adicionar e pressionar Enter...');
    await userEvent.type(input, 'novo{Enter}');
    expect(handleChange).toHaveBeenCalledWith(['bug', 'novo']);
  });

  it('removes a tag when its X button is clicked', async () => {
    const handleChange = vi.fn();
    render(<EzTagInput tags={['bug', 'urgente']} onChange={handleChange} />);
    await userEvent.click(screen.getByLabelText('Remover bug'));
    expect(handleChange).toHaveBeenCalledWith(['urgente']);
  });

  it('applies the brand chip classes to each tag', () => {
    render(<EzTagInput tags={['bug']} onChange={() => undefined} />);
    expect(screen.getByText('bug').closest('span')).toHaveClass('text-brand-700');
  });

  describe('sugestões (KNW-07)', () => {
    const suggestions = ['Senha', 'Servidor', 'acesso'];

    it('lists the suggestions that contain the typed text, ignoring case', async () => {
      render(<EzTagInput id="t" label="Tags" tags={[]} suggestions={suggestions} onChange={() => undefined} />);
      await userEvent.type(screen.getByLabelText('Tags'), 'SE');
      const options = screen.getAllByRole('option').map((o) => o.textContent);
      expect(options).toEqual(['Senha', 'Servidor']);
    });

    it('shows nothing before typing and for text that matches no suggestion', async () => {
      render(<EzTagInput id="t" label="Tags" tags={[]} suggestions={suggestions} onChange={() => undefined} />);
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      await userEvent.type(screen.getByLabelText('Tags'), 'zzz');
      expect(screen.queryByRole('option')).not.toBeInTheDocument();
    });

    it('does not suggest a tag that is already selected, whatever its case', async () => {
      render(<EzTagInput id="t" label="Tags" tags={['senha']} suggestions={suggestions} onChange={() => undefined} />);
      await userEvent.type(screen.getByLabelText('Tags'), 'se');
      expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Servidor']);
    });

    it('adds a clicked suggestion with the suggestion casing', async () => {
      const handleChange = vi.fn();
      render(<EzTagInput id="t" label="Tags" tags={[]} suggestions={suggestions} onChange={handleChange} />);
      await userEvent.type(screen.getByLabelText('Tags'), 'sen');
      await userEvent.click(screen.getByRole('option', { name: 'Senha' }));
      expect(handleChange).toHaveBeenCalledWith(['Senha']);
    });

    it('moves through the suggestions with the arrow keys and adds the active one with Enter', async () => {
      const handleChange = vi.fn();
      render(<EzTagInput id="t" label="Tags" tags={[]} suggestions={suggestions} onChange={handleChange} />);
      const input = screen.getByLabelText('Tags');
      await userEvent.type(input, 'se{ArrowDown}{ArrowDown}');
      expect(screen.getByRole('option', { name: 'Servidor' })).toHaveAttribute('aria-selected', 'true');
      expect(input).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { name: 'Servidor' }).id);
      await userEvent.keyboard('{Enter}');
      expect(handleChange).toHaveBeenCalledWith(['Servidor']);
    });

    it('closes the suggestions with Escape', async () => {
      render(<EzTagInput id="t" label="Tags" tags={[]} suggestions={suggestions} onChange={() => undefined} />);
      await userEvent.type(screen.getByLabelText('Tags'), 'se');
      expect(screen.getByRole('listbox')).toBeInTheDocument();
      await userEvent.keyboard('{Escape}');
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('adds the draft with the casing of a matching suggestion', async () => {
      const handleChange = vi.fn();
      render(<EzTagInput id="t" label="Tags" tags={[]} suggestions={suggestions} onChange={handleChange} />);
      await userEvent.type(screen.getByLabelText('Tags'), 'ACESSO{Enter}');
      expect(handleChange).toHaveBeenCalledWith(['acesso']);
    });
  });

  describe('duplicidade e separadores (KNW-07)', () => {
    it('does not add a tag that differs only by case from a selected one', async () => {
      const handleChange = vi.fn();
      render(<EzTagInput tags={['senha']} onChange={handleChange} />);
      await userEvent.type(screen.getByPlaceholderText('Adicionar e pressionar Enter...'), 'Senha{Enter}');
      expect(handleChange).not.toHaveBeenCalled();
    });

    it('adds the tag when a comma is typed, keeping the old comma habit working', async () => {
      const handleChange = vi.fn();
      render(<EzTagInput tags={[]} onChange={handleChange} />);
      await userEvent.type(screen.getByPlaceholderText('Adicionar e pressionar Enter...'), 'rh,');
      expect(handleChange).toHaveBeenCalledWith(['rh']);
    });

    it('commits the typed text on blur only when addOnBlur is set', async () => {
      const handleChange = vi.fn();
      const { rerender } = render(<EzTagInput tags={[]} onChange={handleChange} />);
      const input = screen.getByPlaceholderText('Adicionar e pressionar Enter...');
      await userEvent.type(input, 'rh');
      await userEvent.tab();
      expect(handleChange).not.toHaveBeenCalled();

      rerender(<EzTagInput tags={[]} onChange={handleChange} addOnBlur />);
      await userEvent.click(input);
      await userEvent.tab();
      expect(handleChange).toHaveBeenCalledWith(['rh']);
    });
  });
});
