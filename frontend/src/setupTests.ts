// Import jest-dom matchers
import '@testing-library/jest-dom';
import { afterAll, beforeAll, vi } from 'vitest';

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated
    removeListener: vi.fn(), // deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock console.error to make test output cleaner
const originalError = console.error;
beforeAll(() => {
  console.error = (...args) => {
    // Suppress specific error messages if needed
    if (args[0] && args[0].includes('A component is changing an uncontrolled input to be controlled')) {
      return;
    }
    originalError.call(console, ...args);
  };
});

afterAll(() => {
  console.error = originalError;
});
