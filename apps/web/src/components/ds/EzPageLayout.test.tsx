import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EzPageLayout, EzPageHeader } from './EzPageLayout';

describe('EzPageLayout & EzPageHeader', () => {
  describe('EzPageLayout', () => {
    it('renders header and children correctly', () => {
      render(
        <EzPageLayout header={<header data-testid="page-header">My Header</header>}>
          <div data-testid="page-content">Page Content</div>
        </EzPageLayout>
      );
      expect(screen.getByTestId('page-header')).toBeInTheDocument();
      expect(screen.getByTestId('page-content')).toBeInTheDocument();
    });
  });

  describe('EzPageHeader', () => {
    it('renders basic props', () => {
      render(
        <EzPageHeader
          title="Home"
          breadcrumbs={<span>Home / Dash</span>}
          actions={<button>New</button>}
        />
      );
      expect(screen.getByText('Home')).toBeInTheDocument();
      expect(screen.getByText('Home / Dash')).toBeInTheDocument();
      expect(screen.getByText('New')).toBeInTheDocument();
    });

    it('DMTE-541 AC-09: is compact (8px vertical padding, 32px minimum row, 16px side padding below sm and 24px from sm)', () => {
      render(<EzPageHeader title="Home" data-testid="header-root" />);
      const root = screen.getByTestId('header-root');
      expect(root).toHaveClass('py-2', 'px-4', 'sm:px-6');
      expect(root.className).not.toMatch(/(^|\s)py-4(\s|$)/);
      expect(root.className).not.toMatch(/(^|\s)px-6(\s|$)/);
      const row = screen.getByRole('heading', { name: 'Home' }).closest('div[class*="min-h"]') as HTMLElement;
      expect(row).toHaveClass('min-h-[32px]');
      expect(row.className).not.toContain('min-h-[40px]');
    });

    it('DMTE-541 AC-09: keeps the back button, the actions and the page body padding', async () => {
      const onBack = vi.fn();
      const user = userEvent.setup();
      render(
        <EzPageLayout
          header={<EzPageHeader title="Home" showBackButton onBack={onBack} actions={<button>Nova</button>} />}
          data-testid="layout-root"
        >
          <div data-testid="body">corpo</div>
        </EzPageLayout>
      );
      expect(screen.getByRole('button', { name: 'Nova' })).toBeInTheDocument();
      await user.click(screen.getByTitle('Voltar'));
      expect(onBack).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('body').parentElement).toHaveClass('p-6');
    });

    it('renders back button when showBackButton is true and calls onBack', async () => {
      const mockBack = vi.fn();
      const user = userEvent.setup();
      render(<EzPageHeader title="Home" showBackButton onBack={mockBack} />);
      
      const backBtn = screen.getByTitle('Voltar');
      expect(backBtn).toBeInTheDocument();
      
      await user.click(backBtn);
      expect(mockBack).toHaveBeenCalledTimes(1);
    });

    it('renders mode switcher and calls onModeChange', async () => {
      const mockModeChange = vi.fn();
      const user = userEvent.setup();
      render(<EzPageHeader title="Home" activeMode="list" onModeChange={mockModeChange} />);
      
      const listBtn = screen.getByTitle('Modo Lista');
      const formBtn = screen.getByTitle('Modo Formulário');
      
      expect(listBtn).toBeInTheDocument();
      expect(formBtn).toBeInTheDocument();
      
      await user.click(formBtn);
      expect(mockModeChange).toHaveBeenCalledWith('form');
    });

    it('does not render back button when showBackButton is false', () => {
      render(<EzPageHeader title="Home" showBackButton={false} />);
      expect(screen.queryByTitle('Voltar')).not.toBeInTheDocument();
    });
  });
});
