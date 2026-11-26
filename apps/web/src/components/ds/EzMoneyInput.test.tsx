import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EzMoneyInput } from './EzMoneyInput';

function Harness({
  initial = null,
  onValue,
  max,
  disabled,
}: {
  initial?: number | null;
  onValue?: (cents: number | null) => void;
  max?: number;
  disabled?: boolean;
}) {
  const [value, setValue] = useState<number | null>(initial);
  return (
    <>
      <EzMoneyInput
        id="money"
        label="Valor"
        value={value}
        max={max}
        disabled={disabled}
        onChange={(cents) => {
          onValue?.(cents);
          setValue(cents);
        }}
      />
      <button type="button" onClick={() => setValue(4200)}>
        definir 42
      </button>
      <output data-testid="cents">
        {value === null ? 'null' : String(value)}
      </output>
    </>
  );
}

const field = () => screen.getByLabelText('Valor');
const cents = () => screen.getByTestId('cents').textContent;

describe('EzMoneyInput', () => {
  it('is a text field with a decimal keyboard, no spinner and no step', () => {
    render(<Harness />);
    expect(field()).toHaveAttribute('type', 'text');
    expect(field()).toHaveAttribute('inputmode', 'decimal');
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(field()).not.toHaveAttribute('step');
  });

  it('shows the initial cents as R$ pt-BR and an empty value as an empty field', () => {
    const { unmount } = render(<Harness initial={123456} />);
    expect(field()).toHaveValue('R$ 1.234,56');
    unmount();
    render(<Harness initial={null} />);
    expect(field()).toHaveValue('');
  });

  it('shows zero as a real value, distinct from empty', () => {
    render(<Harness initial={0} />);
    expect(field()).toHaveValue('R$ 0,00');
    expect(cents()).toBe('0');
  });

  it('types 1234,56 character by character into R$ 1.234,56 and reports 123456 cents', async () => {
    const user = userEvent.setup();
    const seen: Array<number | null> = [];
    render(<Harness onValue={(c) => seen.push(c)} />);
    await user.type(field(), '1234,56');
    expect(field()).toHaveValue('R$ 1.234,56');
    expect(cents()).toBe('123456');
    expect(seen.every((c) => c === null || Number.isInteger(c))).toBe(true);
    expect(seen.at(-1)).toBe(123456);
  });

  it('groups thousands as the digits grow', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(field(), '1234567');
    expect(field()).toHaveValue('R$ 1.234.567');
    expect(cents()).toBe('123456700');
  });

  it('keeps a typed zero as 0 cents and pads the decimals on blur', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(field(), '0');
    expect(cents()).toBe('0');
    await user.tab();
    expect(field()).toHaveValue('R$ 0,00');
    expect(cents()).toBe('0');
  });

  it('pads a single decimal digit on blur without changing the value', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(field(), '12,5');
    expect(cents()).toBe('1250');
    await user.tab();
    expect(field()).toHaveValue('R$ 12,50');
    expect(cents()).toBe('1250');
  });

  it('reports null, not zero, when the field is cleared', async () => {
    const user = userEvent.setup();
    render(<Harness initial={500} />);
    await user.clear(field());
    expect(field()).toHaveValue('');
    expect(cents()).toBe('null');
  });

  it('accepts a decimal point as typed by a numeric keypad', () => {
    render(<Harness />);
    fireEvent.change(field(), { target: { value: '1500.50' } });
    expect(field()).toHaveValue('R$ 1.500,50');
    expect(cents()).toBe('150050');
  });

  it('rejects e, minus and letters and keeps the previous value', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(field(), '12');
    await user.type(field(), 'e');
    await user.type(field(), '-');
    await user.type(field(), 'x');
    expect(field()).toHaveValue('R$ 12');
    expect(cents()).toBe('1200');
  });

  it('never goes negative, even by paste', () => {
    render(<Harness initial={500} />);
    fireEvent.paste(field(), { clipboardData: { getData: () => '-5' } });
    expect(field()).toHaveValue('R$ 5,00');
    expect(cents()).toBe('500');
  });

  it('ignores a third decimal digit instead of rounding', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(field(), '1,999');
    expect(field()).toHaveValue('R$ 1,99');
    expect(cents()).toBe('199');
  });

  it('pastes a pt-BR amount as a whole value', () => {
    render(<Harness initial={100} />);
    fireEvent.paste(field(), {
      clipboardData: { getData: () => 'R$ 1.234,56' },
    });
    expect(field()).toHaveValue('R$ 1.234,56');
    expect(cents()).toBe('123456');
  });

  it('pastes a plain decimal point amount and an ambiguous one is refused', () => {
    render(<Harness initial={100} />);
    fireEvent.paste(field(), { clipboardData: { getData: () => '1234.56' } });
    expect(cents()).toBe('123456');
    fireEvent.paste(field(), { clipboardData: { getData: () => '1,234' } });
    expect(cents()).toBe('123456');
    expect(field()).toHaveValue('R$ 1.234,56');
  });

  it('refuses a value above max and keeps the last accepted one', async () => {
    const user = userEvent.setup();
    render(<Harness max={2147483647} />);
    await user.type(field(), '21474836,47');
    expect(cents()).toBe('2147483647');
    await user.type(field(), '1');
    expect(cents()).toBe('2147483647');
    expect(field()).toHaveValue('R$ 21.474.836,47');
  });

  it('refuses a paste above max', () => {
    render(<Harness initial={100} max={1000} />);
    fireEvent.paste(field(), { clipboardData: { getData: () => '10,01' } });
    expect(cents()).toBe('100');
  });

  it('holds very large amounts exactly, without floating point', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(field(), '9007199254740,99');
    expect(cents()).toBe('900719925474099');
  });

  it('follows a value changed from outside', async () => {
    const user = userEvent.setup();
    render(<Harness initial={100} />);
    await user.click(screen.getByRole('button', { name: 'definir 42' }));
    expect(field()).toHaveValue('R$ 42,00');
  });

  it('does not call onChange when the user only focuses and leaves the field', async () => {
    const user = userEvent.setup();
    const onValue = vi.fn();
    render(<Harness initial={500} onValue={onValue} />);
    await user.click(field());
    await user.tab();
    expect(onValue).not.toHaveBeenCalled();
    expect(field()).toHaveValue('R$ 5,00');
  });

  it('is disabled when asked to', () => {
    render(<Harness initial={500} disabled />);
    expect(field()).toBeDisabled();
  });
});

describe('EzMoneyInput editing the masked text (QA CTR-07)', () => {
  const at = (position: number) => ({ initialSelectionStart: position, initialSelectionEnd: position });

  it('keeps the value when deleting the last digit of a thousands amount', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(field(), '1500');
    expect(field()).toHaveValue('R$ 1.500');
    await user.type(field(), '{Backspace}');
    expect(field()).toHaveValue('R$ 150');
    expect(cents()).toBe('15000');
    await user.type(field(), '0');
    expect(field()).toHaveValue('R$ 1.500');
    expect(cents()).toBe('150000');
  });

  it.each([
    ['1000', 'R$ 100', '10000'],
    ['10000', 'R$ 1.000', '100000'],
    ['123456', 'R$ 12.345', '1234500'],
    ['1234567', 'R$ 123.456', '12345600'],
  ])('Backspace after typing %s leaves %s', async (typed, shown, expected) => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(field(), typed);
    await user.type(field(), '{Backspace}');
    expect(field()).toHaveValue(shown);
    expect(cents()).toBe(expected);
  });

  it('deletes digit by digit through the comma without changing the order of magnitude', async () => {
    const user = userEvent.setup();
    render(<Harness initial={150050} />);
    expect(field()).toHaveValue('R$ 1.500,50');
    await user.type(field(), '{Backspace}');
    expect(field()).toHaveValue('R$ 1.500,5');
    expect(cents()).toBe('150050');
    await user.type(field(), '{Backspace}');
    expect(field()).toHaveValue('R$ 1.500,');
    expect(cents()).toBe('150000');
    await user.type(field(), '{Backspace}');
    expect(field()).toHaveValue('R$ 1.500');
    expect(cents()).toBe('150000');
    await user.type(field(), '{Backspace}');
    expect(field()).toHaveValue('R$ 150');
    expect(cents()).toBe('15000');
  });

  it('deletes everything down to an empty field, and reports null', async () => {
    const user = userEvent.setup();
    render(<Harness initial={150000} />);
    await user.type(field(), '{Backspace}'.repeat(12));
    expect(field()).toHaveValue('');
    expect(cents()).toBe('null');
  });

  it('Delete in the middle removes the digit after the caret and regroups', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(field(), '1500');
    await user.type(field(), '{Delete}', at(3));
    expect(field()).toHaveValue('R$ 500');
    expect(cents()).toBe('50000');
  });

  it('Delete at the very start (on the R) never changes the value', async () => {
    const user = userEvent.setup();
    render(<Harness initial={150000} />);
    await user.type(field(), '{Delete}', at(0));
    expect(field()).toHaveValue('R$ 1.500,00');
    expect(cents()).toBe('150000');
  });

  it('replaces everything when all the text is selected and a digit is typed', async () => {
    const user = userEvent.setup();
    render(<Harness initial={150000} />);
    await user.type(field(), '7', { initialSelectionStart: 0, initialSelectionEnd: 11 });
    expect(field()).toHaveValue('R$ 7');
    expect(cents()).toBe('700');
  });

  it('a decimal point typed at the end becomes the decimal comma', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(field(), '1500.50');
    expect(field()).toHaveValue('R$ 1.500,50');
    expect(cents()).toBe('150050');
  });

  it('pastes an amount with thousands: 1.500,50 is accepted and 1,234 is still refused', () => {
    render(<Harness initial={100} />);
    fireEvent.paste(field(), { clipboardData: { getData: () => '1.500,50' } });
    expect(field()).toHaveValue('R$ 1.500,50');
    expect(cents()).toBe('150050');
    fireEvent.paste(field(), { clipboardData: { getData: () => '1,234' } });
    expect(cents()).toBe('150050');
  });

  it('typing digit by digit up to the ceiling stops accepting digits past it', async () => {
    const user = userEvent.setup();
    render(<Harness max={2147483647} />);
    await user.type(field(), '2147483647');
    expect(field()).toHaveValue('R$ 21.474.836');
    expect(cents()).toBe('2147483600');
    await user.type(field(), ',47');
    expect(field()).toHaveValue('R$ 21.474.836,47');
    expect(cents()).toBe('2147483647');
    await user.type(field(), '9');
    expect(cents()).toBe('2147483647');
    await user.type(field(), '{Backspace}{Backspace}');
    expect(field()).toHaveValue('R$ 21.474.836,');
    expect(cents()).toBe('2147483600');
  });

  it('survives an edit round trip: delete then retype keeps the original value', async () => {
    const user = userEvent.setup();
    render(<Harness initial={123456} />);
    await user.type(field(), '{Backspace}6');
    expect(field()).toHaveValue('R$ 1.234,56');
    expect(cents()).toBe('123456');
  });
});
