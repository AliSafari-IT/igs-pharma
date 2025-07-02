import { AxiosError } from 'axios';

/**
 * Formats API error messages for display
 * @param error The error object from axios
 * @returns A formatted error message string
 */
export const formatApiError = (error: unknown): string => {
  if (error instanceof Error) {
    // Handle Axios errors
    if ((error as AxiosError).isAxiosError) {
      const axiosError = error as AxiosError;
      
      // Handle different response status codes
      if (axiosError.response) {
        const status = axiosError.response.status;
        const data = axiosError.response.data as any;
        
        // Handle validation errors (typically 400)
        if (status === 400 && data.errors) {
          return Object.values(data.errors)
            .flat()
            .join(', ');
        }
        
        // Handle unauthorized (401)
        if (status === 401) {
          return 'You are not authorized to perform this action. Please log in again.';
        }
        
        // Handle forbidden (403)
        if (status === 403) {
          return 'You do not have permission to perform this action.';
        }
        
        // Handle not found (404)
        if (status === 404) {
          return 'The requested resource was not found.';
        }
        
        // Handle server errors (500)
        if (status >= 500) {
          return `Server error: ${data.message || 'An unexpected server error occurred'}`;
        }
        
        // Handle other error responses with messages
        if (data.message) {
          return data.message;
        }
        
        // Generic error with status
        return `Error ${status}: ${data.title || 'An error occurred'}`;
      }
      
      // Network errors
      if (axiosError.request && !axiosError.response) {
        return 'Network error: Unable to connect to the server. Please check your connection.';
      }
    }
    
    // Generic error with message
    return error.message || 'An unexpected error occurred';
  }
  
  // Unknown error type
  return 'An unknown error occurred';
};

/**
 * Logs errors to console with additional context
 * @param error The error object
 * @param context Additional context about where the error occurred
 */
export const logError = (error: unknown, context: string): void => {
  console.error(`[${context}] Error:`, error);
  
  if (error instanceof Error) {
    console.error(`[${context}] Error message:`, error.message);
    console.error(`[${context}] Error stack:`, error.stack);
    
    if ((error as AxiosError).isAxiosError) {
      const axiosError = error as AxiosError;
      if (axiosError.response) {
        console.error(`[${context}] Response data:`, axiosError.response.data);
        console.error(`[${context}] Response status:`, axiosError.response.status);
        console.error(`[${context}] Response headers:`, axiosError.response.headers);
      }
    }
  }
};
