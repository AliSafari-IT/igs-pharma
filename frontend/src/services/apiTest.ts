import axios from 'axios';

// Test function to check API connectivity
export const testApiConnection = async () => {
  try {
    const response = await axios.get('http://localhost:5000/api/products');
    console.log('API connection successful:', response.data);
    return { success: true, data: response.data };
  } catch (error) {
    console.error('API connection failed:', error);
    return { success: false, error };
  }
};
