import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

type SetterFn = (v: boolean) => void;
type Tuple = [boolean, SetterFn];

const state: {
  needRefresh: Tuple;
  offlineReady: Tuple;
  updateServiceWorker: ReturnType<typeof vi.fn>;
} = {
  needRefresh: [false, vi.fn()],
  offlineReady: [false, vi.fn()],
  updateServiceWorker: vi.fn(),
};

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => state,
}));

import { UpdatePrompt } from '../../src/ui/UpdatePrompt';

describe('UpdatePrompt', () => {
  beforeEach(() => {
    state.needRefresh = [false, vi.fn()];
    state.offlineReady = [false, vi.fn()];
    state.updateServiceWorker = vi.fn();
  });

  it('renders nothing when no update is pending and not offline-ready', () => {
    const { container } = render(<UpdatePrompt />);
    expect(container.firstChild).toBeNull();
  });

  it('shows reload prompt when a new SW is waiting', () => {
    state.needRefresh = [true, vi.fn()];
    render(<UpdatePrompt />);
    expect(screen.getByText(/new version available/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reload/i })).toBeInTheDocument();
  });

  it('calls updateServiceWorker(true) on Reload click', () => {
    state.needRefresh = [true, vi.fn()];
    render(<UpdatePrompt />);
    fireEvent.click(screen.getByRole('button', { name: /reload/i }));
    expect(state.updateServiceWorker).toHaveBeenCalledWith(true);
  });

  it('dismisses both flags when Later is clicked', () => {
    const setNeed = vi.fn();
    const setOffline = vi.fn();
    state.needRefresh = [true, setNeed];
    state.offlineReady = [false, setOffline];
    render(<UpdatePrompt />);
    fireEvent.click(screen.getByRole('button', { name: /later/i }));
    expect(setNeed).toHaveBeenCalledWith(false);
    expect(setOffline).toHaveBeenCalledWith(false);
  });

  it('shows offline-ready toast and Dismiss button when only offlineReady is set', () => {
    state.offlineReady = [true, vi.fn()];
    render(<UpdatePrompt />);
    expect(screen.getByText(/ready to use offline/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reload/i })).toBeNull();
    expect(screen.getByRole('button', { name: /dismiss/i })).toBeInTheDocument();
  });
});
