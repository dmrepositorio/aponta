import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EzGridWrapper } from './EzGrid';

describe('EzGridWrapper', () => {
  it('renders children correctly', () => {
    render(
      <EzGridWrapper tableLabel="Grade de exemplo">
        <tbody>
          <tr><td data-testid="grid-cell">Cell Data</td></tr>
        </tbody>
      </EzGridWrapper>
    );
    expect(screen.getByTestId('grid-cell')).toHaveTextContent('Cell Data');
  });

  it('adds given custom className', () => {
    const { container } = render(<EzGridWrapper tableLabel="Grade de exemplo" className="my-custom-grid" />);
    expect(container.firstChild).toHaveClass('my-custom-grid');
    expect(container.firstChild).toHaveClass('overflow-hidden');
  });

  it('renders persistent horizontal scrollbar with thumb and accessibility attributes when alwaysShowHorizontalScrollbar is true', () => {
    render(
      <EzGridWrapper tableLabel="Grade de exemplo" alwaysShowHorizontalScrollbar>
        <tbody>
          <tr><td>Data</td></tr>
        </tbody>
      </EzGridWrapper>
    );

    const scrollbar = screen.getByTestId('ez-grid-horizontal-scrollbar');
    expect(scrollbar).toBeInTheDocument();

    const thumb = screen.getByTestId('ez-grid-horizontal-scrollbar-thumb');
    expect(thumb).toBeInTheDocument();
    expect(thumb).toHaveAttribute('role', 'scrollbar');
    expect(thumb).toHaveAttribute('aria-orientation', 'horizontal');
    expect(thumb).toHaveAttribute('aria-label', 'Barra de rolagem horizontal');
  });

  it('does not render horizontal scrollbar when showHorizontalScrollbar is false', () => {
    render(
      <EzGridWrapper tableLabel="Grade de exemplo" alwaysShowHorizontalScrollbar showHorizontalScrollbar={false}>
        <tbody>
          <tr><td>Data</td></tr>
        </tbody>
      </EzGridWrapper>
    );

    expect(screen.queryByTestId('ez-grid-horizontal-scrollbar')).not.toBeInTheDocument();
  });

  it('updates metrics on container scroll', () => {
    render(
      <EzGridWrapper tableLabel="Grade de exemplo" alwaysShowHorizontalScrollbar>
        <tbody>
          <tr><td>Data</td></tr>
        </tbody>
      </EzGridWrapper>
    );

    const scrollContainer = screen.getByTestId('ez-grid-scroll-region');
    expect(scrollContainer).toBeInTheDocument();

    Object.defineProperty(scrollContainer, 'scrollWidth', { value: 800, configurable: true });
    Object.defineProperty(scrollContainer, 'clientWidth', { value: 400, configurable: true });
    Object.defineProperty(scrollContainer, 'scrollLeft', { value: 100, configurable: true, writable: true });

    fireEvent.scroll(scrollContainer);

    const thumb = screen.getByTestId('ez-grid-horizontal-scrollbar-thumb');
    expect(thumb).toBeInTheDocument();
  });

  it('handles keyboard navigation (ArrowLeft and ArrowRight) on thumb', () => {
    render(
      <EzGridWrapper tableLabel="Grade de exemplo" alwaysShowHorizontalScrollbar>
        <tbody>
          <tr><td>Data</td></tr>
        </tbody>
      </EzGridWrapper>
    );

    const scrollContainer = screen.getByTestId('ez-grid-scroll-region');
    expect(scrollContainer).toBeInTheDocument();
    scrollContainer.scrollLeft = 50;

    const thumb = screen.getByTestId('ez-grid-horizontal-scrollbar-thumb');

    fireEvent.keyDown(thumb, { key: 'ArrowRight' });
    expect(scrollContainer.scrollLeft).toBe(90);

    fireEvent.keyDown(thumb, { key: 'ArrowLeft' });
    expect(scrollContainer.scrollLeft).toBe(50);

    // Other key should not change scrollLeft
    fireEvent.keyDown(thumb, { key: 'Enter' });
    expect(scrollContainer.scrollLeft).toBe(50);
  });

  it('handles mouse dragging on thumb', () => {
    render(
      <EzGridWrapper tableLabel="Grade de exemplo" alwaysShowHorizontalScrollbar>
        <tbody>
          <tr><td>Data</td></tr>
        </tbody>
      </EzGridWrapper>
    );

    const scrollContainer = screen.getByTestId('ez-grid-scroll-region');
    Object.defineProperty(scrollContainer, 'scrollWidth', { value: 1000, configurable: true });
    Object.defineProperty(scrollContainer, 'clientWidth', { value: 500, configurable: true });
    scrollContainer.scrollLeft = 0;

    const thumb = screen.getByTestId('ez-grid-horizontal-scrollbar-thumb');

    // Mouse down on thumb
    fireEvent.mouseDown(thumb, { clientX: 100 });

    // Window mouse move
    fireEvent.mouseMove(window, { clientX: 150 });

    // Window mouse up
    fireEvent.mouseUp(window);
  });

  it('handles clicking on scrollbar track', () => {
    render(
      <EzGridWrapper tableLabel="Grade de exemplo" alwaysShowHorizontalScrollbar>
        <tbody>
          <tr><td>Data</td></tr>
        </tbody>
      </EzGridWrapper>
    );

    const scrollContainer = screen.getByTestId('ez-grid-scroll-region');
    Object.defineProperty(scrollContainer, 'scrollWidth', { value: 1000, configurable: true });
    Object.defineProperty(scrollContainer, 'clientWidth', { value: 500, configurable: true });

    const track = screen.getByTestId('ez-grid-horizontal-scrollbar');
    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 500,
      height: 12,
      right: 500,
      bottom: 12,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    fireEvent.click(track, { clientX: 250 });
  });

  it('observes container resize via ResizeObserver', () => {
    let observerCallback: (() => void) | undefined;
    const observeMock = vi.fn();
    const disconnectMock = vi.fn();

    const originalResizeObserver = global.ResizeObserver;
    global.ResizeObserver = class {
      constructor(callback: () => void) {
        observerCallback = callback;
      }
      observe = observeMock;
      unobserve = vi.fn();
      disconnect = disconnectMock;
    } as unknown as typeof ResizeObserver;

    const { unmount } = render(
      <EzGridWrapper tableLabel="Grade de exemplo">
        <tbody>
          <tr><td>Data</td></tr>
        </tbody>
      </EzGridWrapper>
    );

    expect(observeMock).toHaveBeenCalled();
    if (observerCallback) {
      observerCallback();
    }

    unmount();
    expect(disconnectMock).toHaveBeenCalled();

    global.ResizeObserver = originalResizeObserver;
  });
});

describe('EzGridWrapper acessibilidade (DS-27)', () => {
  const body = (
    <tbody>
      <tr><td>Data</td></tr>
    </tbody>
  );

  it('gera ids distintos e aria-controls correspondente com dois grids na mesma tela', () => {
    render(
      <>
        <EzGridWrapper tableLabel="Grade A" alwaysShowHorizontalScrollbar>{body}</EzGridWrapper>
        <EzGridWrapper tableLabel="Grade B" alwaysShowHorizontalScrollbar>{body}</EzGridWrapper>
      </>
    );
    const regions = screen.getAllByRole('region');
    expect(regions).toHaveLength(2);
    expect(regions[0].id).not.toBe('');
    expect(regions[0].id).not.toBe(regions[1].id);
    const thumbs = screen.getAllByTestId('ez-grid-horizontal-scrollbar-thumb');
    expect(thumbs[0]).toHaveAttribute('aria-controls', regions[0].id);
    expect(thumbs[1]).toHaveAttribute('aria-controls', regions[1].id);
  });

  it('nomeia a tabela com tableLabel', () => {
    render(<EzGridWrapper tableLabel="Chamados abertos">{body}</EzGridWrapper>);
    expect(screen.getByRole('table', { name: 'Chamados abertos' })).toBeInTheDocument();
  });

  it('expõe a região rolável como região nomeada e focável pelo teclado', () => {
    render(<EzGridWrapper tableLabel="Chamados abertos">{body}</EzGridWrapper>);
    const region = screen.getByRole('region', { name: /Chamados abertos/ });
    expect(region).toHaveAttribute('tabindex', '0');
  });

  it('não força min-width de 480px em tela estreita', () => {
    render(<EzGridWrapper tableLabel="Chamados abertos">{body}</EzGridWrapper>);
    expect(screen.getByRole('table').className).not.toContain('min-w-[480px]');
  });
});
