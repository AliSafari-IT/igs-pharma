import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Register from '../Register';
import * as authApi from '../../services/api';

// Mock the authApi module
vi.mock('../../services/api');

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
});

const renderWithProviders = (ui: React.ReactElement) => {
  return render(
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        {ui}
      </BrowserRouter>
    </QueryClientProvider>
  );
};

describe('Registration Component', () => {
  beforeEach(() => {
    // Clear all mocks before each test
    vi.clearAllMocks();
  });

  test('renders registration form', () => {
    renderWithProviders(<Register />);
    
    // Check if form elements are rendered
    expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/confirm password/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/first name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/last name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/card id/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /register/i })).toBeInTheDocument();
  });

  test('validates required fields', async () => {
    renderWithProviders(<Register />);
    
    // Submit empty form
    fireEvent.click(screen.getByRole('button', { name: /register/i }));
    
    // Check for required field errors
    expect(await screen.findByText('Username is required')).toBeInTheDocument();
    expect(await screen.findByText('Email is required')).toBeInTheDocument();
    expect(await screen.findByText('Password is required')).toBeInTheDocument();
    expect(await screen.findByText('Password confirmation is required')).toBeInTheDocument();
    expect(await screen.findByText('First name is required')).toBeInTheDocument();
    expect(await screen.findByText('Last name is required')).toBeInTheDocument();
    expect(await screen.findByText('Card ID is required')).toBeInTheDocument();
  });

  test('validates email format', async () => {
    renderWithProviders(<Register />);
    
    // Enter invalid email
    const emailInput = screen.getByLabelText(/email/i);
    fireEvent.change(emailInput, { target: { value: 'invalid-email' } });
    fireEvent.blur(emailInput);
    
    expect(await screen.findByText('Invalid email format')).toBeInTheDocument();
  });

  test('validates password confirmation', async () => {
    renderWithProviders(<Register />);
    
    // Enter different passwords
    const passwordInput = screen.getByLabelText(/password/i);
    const confirmPasswordInput = screen.getByLabelText(/confirm password/i);
    
    fireEvent.change(passwordInput, { target: { value: 'password123' } });
    fireEvent.change(confirmPasswordInput, { target: { value: 'different' } });
    
    fireEvent.click(screen.getByRole('button', { name: /register/i }));
    
    expect(await screen.findByText('Passwords must match')).toBeInTheDocument();
  });

  test('submits form with valid data', async () => {
    // Mock successful registration
    const mockRegister = vi.fn().mockResolvedValueOnce({
      data: {
        id: '1',
        username: 'testuser',
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        role: 'Cashier',
        isActive: true,
        createdAt: new Date().toISOString(),
        message: 'User registered successfully'
      }
    });
    
    // @ts-ignore - Mocking the authApi module
    authApi.authApi.register = mockRegister;
    
    renderWithProviders(<Register />);
    
    // Fill out the form
    fireEvent.change(screen.getByLabelText(/username/i), { target: { value: 'testuser' } });
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'Test@123456' } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'Test@123456' } });
    fireEvent.change(screen.getByLabelText(/first name/i), { target: { value: 'Test' } });
    fireEvent.change(screen.getByLabelText(/last name/i), { target: { value: 'User' } });
    fireEvent.change(screen.getByLabelText(/card id/i), { target: { value: 'CARD123' } });
    
    // Submit the form
    fireEvent.click(screen.getByRole('button', { name: /register/i }));
    
    // Check if the API was called with the correct data
    await waitFor(() => {
      expect(mockRegister).toHaveBeenCalledWith({
        username: 'testuser',
        email: 'test@example.com',
        password: 'Test@123456',
        confirmPassword: 'Test@123456',
        firstName: 'Test',
        lastName: 'User',
        phoneNumber: null,
        department: null,
        role: 'Cashier',
        employeeId: null,
        cardId: 'CARD123',
        cardExpiryDate: null
      });
    });
    
    // Check for success message
    expect(await screen.findByText(/registration successful/i)).toBeInTheDocument();
  });

  test('handles API errors', async () => {
    // Mock failed registration
    const errorMessage = 'Username is already taken';
    const mockRegister = vi.fn().mockRejectedValueOnce({
      response: {
        data: {
          message: errorMessage
        }
      }
    });
    
    // @ts-ignore - Mocking the authApi module
    authApi.authApi.register = mockRegister;
    
    renderWithProviders(<Register />);
    
    // Fill out the form with minimal required fields
    fireEvent.change(screen.getByLabelText(/username/i), { target: { value: 'existinguser' } });
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'Test@123456' } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'Test@123456' } });
    fireEvent.change(screen.getByLabelText(/first name/i), { target: { value: 'Test' } });
    fireEvent.change(screen.getByLabelText(/last name/i), { target: { value: 'User' } });
    fireEvent.change(screen.getByLabelText(/card id/i), { target: { value: 'CARD123' } });
    
    // Submit the form
    fireEvent.click(screen.getByRole('button', { name: /register/i }));
    
    // Check if the error message is displayed
    expect(await screen.findByText(errorMessage)).toBeInTheDocument();
  });

  test('handles validation errors from server', async () => {
    // Mock validation error response
    const validationErrors = {
      errors: {
        Username: ['Username is already taken'],
        Email: ['Email is already in use']
      }
    };
    
    const mockRegister = vi.fn().mockRejectedValueOnce({
      response: {
        status: 400,
        data: validationErrors
      }
    });
    
    // @ts-ignore - Mocking the authApi module
    authApi.authApi.register = mockRegister;
    
    renderWithProviders(<Register />);
    
    // Fill out the form with minimal required fields
    fireEvent.change(screen.getByLabelText(/username/i), { target: { value: 'existinguser' } });
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'exists@example.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'Test@123456' } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'Test@123456' } });
    fireEvent.change(screen.getByLabelText(/first name/i), { target: { value: 'Test' } });
    fireEvent.change(screen.getByLabelText(/last name/i), { target: { value: 'User' } });
    fireEvent.change(screen.getByLabelText(/card id/i), { target: { value: 'CARD123' } });
    
    // Submit the form
    fireEvent.click(screen.getByRole('button', { name: /register/i }));
    
    // Check if the validation errors are displayed
    expect(await screen.findByText('Username is already taken')).toBeInTheDocument();
    expect(await screen.findByText('Email is already in use')).toBeInTheDocument();
  });
});
