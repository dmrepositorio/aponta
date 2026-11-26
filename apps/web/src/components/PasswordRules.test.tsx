import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PasswordRules } from './PasswordRules';

// DMTE-551 T1, AC-07: a tela mostra a regra da senha e o que falta, enquanto a pessoa digita.
const rules = () => screen.getByRole('list', { name: /regras da senha/i });
const item = (text: RegExp) => within(rules()).getAllByRole('listitem').find((li) => text.test(li.textContent ?? ''))!;

describe('PasswordRules', () => {
  it('AC-07: lista as cinco exigências, todas pendentes com a senha vazia', () => {
    render(<PasswordRules password="" />);

    expect(within(rules()).getAllByRole('listitem')).toHaveLength(5);
    for (const rule of [/10 caracteres/i, /maiúscula/i, /minúscula/i, /número/i, /símbolo/i]) {
      expect(item(rule)).toHaveTextContent(/pendente/i);
    }
  });

  it('AC-07: marca como atendida cada exigência que a senha já cumpre e deixa pendente o que falta', () => {
    render(<PasswordRules password="Abcdefghi1" />);

    for (const rule of [/10 caracteres/i, /maiúscula/i, /minúscula/i, /número/i]) {
      expect(item(rule)).toHaveTextContent(/atendida/i);
    }
    expect(item(/símbolo/i)).toHaveTextContent(/pendente/i);
  });

  it('AC-07: só mostra a exigência de nome e e-mail quando a tela conhece o nome ou o e-mail', () => {
    const { rerender } = render(<PasswordRules password="Cavalo#Azul-7418" />);
    expect(within(rules()).getAllByRole('listitem')).toHaveLength(5);

    rerender(<PasswordRules password="Cavalo#Azul-7418" name="João Silva" email="joao@exemplo.com" />);
    expect(item(/nome/i)).toHaveTextContent(/atendida/i);

    rerender(<PasswordRules password="Joao#2026-xyz" name="João Silva" email="joao@exemplo.com" />);
    expect(item(/nome/i)).toHaveTextContent(/pendente/i);
  });

  it('REG-05: anuncia o resumo das regras atendidas numa região aria-live polite', () => {
    const { container, rerender } = render(<PasswordRules password="" />);
    const live = () => container.querySelector('[aria-live="polite"]');
    expect(live()).toHaveTextContent('0 de 5 regras atendidas');

    rerender(<PasswordRules password="Cavalo#Azul-7418" />);
    expect(live()).toHaveTextContent('5 de 5 regras atendidas');
  });
});
