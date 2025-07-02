import axios, { AxiosError, AxiosInstance } from 'axios';

/**
 * Creates an axios instance with request and response interceptors for
 * consistent error handling and logging
 * @param baseURL The base URL for API requests
 * @returns Configured axios instance
 */
export const createApiWithInterceptors = (baseURL: string): AxiosInstance => {
  const api = axios.create({
    baseURL,
    headers: {
      'Content-Type': 'application/json',
    },
  });

  // Request interceptor for logging and authentication
  api.interceptors.request.use(
    (config) => {
      // Log outgoing requests in development
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[API Request] ${config.method?.toUpperCase()} ${config.url}`, {
          headers: config.headers,
          data: config.data,
          params: config.params,
        });
      }

      // Get token from localStorage - use auth_token instead of token
      const token = localStorage.getItem('auth_token');
      
      // If token exists, add to authorization header
      if (token && config.headers) {
        config.headers.Authorization = `Bearer ${token}`;
        console.log(`Adding auth token to request: Bearer ${token.substring(0, 10)}...`);
        
        // Debug: Log the full headers for Auth/users endpoint
        if (config.url?.includes('/Auth/users')) {
          console.log('Full headers for /Auth/users request:', config.headers);
        }
      } else {
        console.warn('No auth token found in localStorage');
      }
      
      return config;
    },
    (error) => {
      console.error('[API Request Error]', error);
      return Promise.reject(error);
    }
  );

  // Response interceptor for logging and error handling
  api.interceptors.response.use(
    (response) => {
      // Log successful responses in development
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[API Response] ${response.config.method?.toUpperCase()} ${response.config.url}`, {
          status: response.status,
          statusText: response.statusText,
          data: response.data,
        });
        
        // Special logging for users endpoint
        if (response.config.url?.includes('/Auth/users')) {
          console.log('Users API response details:', {
            dataType: typeof response.data,
            isArray: Array.isArray(response.data),
            hasUsers: response.data?.users ? true : false,
            keys: response.data ? Object.keys(response.data) : [],
            userCount: Array.isArray(response.data) ? response.data.length : 
                      (Array.isArray(response.data?.users) ? response.data.users.length : 'N/A')
          });
        }
      }
      
      return response;
    },
    (error: AxiosError) => {
      // Log detailed error information
      console.error('[API Response Error]', {
        url: error.config?.url,
        method: error.config?.method?.toUpperCase(),
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        message: error.message,
      });

      // Handle specific error cases
      if (error.response) {
        // Server responded with error status
        const status = error.response.status;
        
        // Handle authentication errors (401)
        if (status === 401) {
          // Clear token and redirect to login if not already there
          localStorage.removeItem('token');
          
          if (window.location.pathname !== '/login') {
            window.location.href = '/login';
          }
        }
        
        // Handle forbidden errors (403)
        if (status === 403) {
          console.warn('Access forbidden. User lacks necessary permissions.');
        }
        
        // Handle server errors (500+)
        if (status >= 500) {
          console.error('Server error occurred:', error.response.data);
        }
      } else if (error.request) {
        // Request made but no response received (network error)
        console.error('Network error - no response received:', error.request);
      } else {
        // Error in setting up the request
        console.error('Error setting up request:', error.message);
      }
      
      return Promise.reject(error);
    }
  );

  return api;
};

// Export a default instance with the base URL from environment
export default createApiWithInterceptors(
  import.meta.env.VITE_API_URL || 'http://localhost:5000/api'
);
