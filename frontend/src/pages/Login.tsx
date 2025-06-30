import React, { useState, useEffect } from 'react';
import {
  Box,
  Card,
  CardContent,
  TextField,
  Button,
  Typography,
  Alert,
  Divider,
  IconButton,
  InputAdornment,
  CircularProgress,
  Chip,
  Stack,
  Link,
} from '@mui/material';
import {
  Visibility,
  VisibilityOff,
  CreditCard,
  Login as LoginIcon,
  Security,
  Nfc,
  Usb,
} from '@mui/icons-material';
import { useFormik } from 'formik';
import * as yup from 'yup';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

interface CardReaderStatus {
  connected: boolean;
  type: 'none' | 'serial' | 'usb' | 'nfc';
  device?: any;
}

const validationSchema = yup.object({
  username: yup.string().required('Username is required'),
  password: yup.string().min(6, 'Password must be at least 6 characters').required('Password is required'),
});

const Login: React.FC = () => {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [cardReading, setCardReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cardReaderStatus, setCardReaderStatus] = useState<CardReaderStatus>({
    connected: false,
    type: 'none',
  });

  // Check for available card readers on component mount
  useEffect(() => {
    checkCardReaderSupport();
  }, []);

  const checkCardReaderSupport = async () => {
    try {
      // Check Web Serial API support (for USB card readers)
      if ('serial' in navigator) {
        setCardReaderStatus(prev => ({ ...prev, type: 'serial' }));
      }
      // Check WebUSB API support
      else if ('usb' in navigator) {
        setCardReaderStatus(prev => ({ ...prev, type: 'usb' }));
      }
      // Check WebNFC API support (for NFC cards)
      else if ('NDEFReader' in window) {
        setCardReaderStatus(prev => ({ ...prev, type: 'nfc' }));
      }
    } catch (error) {
      console.log('Card reader APIs not supported:', error);
    }
  };

  const formik = useFormik({
    initialValues: {
      username: '',
      password: '',
    },
    validationSchema,
    onSubmit: async (values) => {
      setLoading(true);
      setError(null);
      
      try {
        // Simulate API call for traditional login
        const response = await fetch(`${import.meta.env.VITE_API_URL}/auth/login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(values),
        });

        if (response.ok) {
          const data = await response.json();
          await login(data.token, data.user);
          navigate('/dashboard');
        } else {
          const errorData = await response.json();
          setError(errorData.message || 'Login failed');
        }
      } catch (error) {
        setError('Network error. Please try again.');
      } finally {
        setLoading(false);
      }
    },
  });

  const handleCardLogin = async () => {
    setCardReading(true);
    setError(null);

    try {
      let cardData = null;

      switch (cardReaderStatus.type) {
        case 'serial':
          cardData = await readSerialCard();
          break;
        case 'usb':
          cardData = await readUSBCard();
          break;
        case 'nfc':
          cardData = await readNFCCard();
          break;
        default:
          throw new Error('No supported card reader found');
      }

      if (cardData) {
        // Send card data to backend for authentication
        const response = await fetch(`${import.meta.env.VITE_API_URL}/auth/card-login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ cardData }),
        });

        if (response.ok) {
          const data = await response.json();
          await login(data.token, data.user);
          navigate('/dashboard');
        } else {
          const errorData = await response.json();
          setError(errorData.message || 'Card authentication failed');
        }
      }
    } catch (error: any) {
      setError(error.message || 'Card reading failed');
    } finally {
      setCardReading(false);
    }
  };

  const readSerialCard = async (): Promise<any> => {
    try {
      // Request access to serial port
      const port = await (navigator as any).serial.requestPort();
      await port.open({ baudRate: 9600 });

      // Read card data
      const reader = port.readable.getReader();
      const { value } = await reader.read();
      reader.releaseLock();
      
      await port.close();

      // Parse card data (this depends on your card format)
      const cardData = new TextDecoder().decode(value);
      return parseCardData(cardData);
    } catch (error) {
      throw new Error('Failed to read serial card');
    }
  };

  const readUSBCard = async (): Promise<any> => {
    try {
      // Request USB device access
      const device = await (navigator as any).usb.requestDevice({
        filters: [
          { vendorId: 0x08e6 }, // Example: Gemalto card readers
          { vendorId: 0x072f }, // Example: ACS card readers
          // Add more vendor IDs as needed
        ]
      });

      await device.open();
      // Configure device and read card data
      // This is highly device-specific
      
      const cardData = await device.transferIn(1, 64); // Example endpoint
      await device.close();

      return parseCardData(new TextDecoder().decode(cardData.data));
    } catch (error) {
      throw new Error('Failed to read USB card');
    }
  };

  const readNFCCard = async (): Promise<any> => {
    try {
      const ndef = new (window as any).NDEFReader();
      await ndef.scan();

      return new Promise((resolve, reject) => {
        ndef.addEventListener('reading', ({ message }: any) => {
          const cardData = message.records[0].data;
          resolve(parseCardData(new TextDecoder().decode(cardData)));
        });

        ndef.addEventListener('readingerror', () => {
          reject(new Error('Failed to read NFC card'));
        });

        // Timeout after 10 seconds
        setTimeout(() => {
          reject(new Error('Card reading timeout'));
        }, 10000);
      });
    } catch (error) {
      throw new Error('Failed to read NFC card');
    }
  };

  const parseCardData = (rawData: string): any => {
    // Parse card data based on your ID card format
    // This is a simplified example - adjust based on your card structure
    try {
      // Example: Parse delimited data
      const parts = rawData.split('|');
      return {
        cardId: parts[0],
        employeeId: parts[1],
        name: parts[2],
        department: parts[3],
        // Add more fields as needed
      };
    } catch (error) {
      throw new Error('Invalid card data format');
    }
  };

  const getCardReaderIcon = () => {
    switch (cardReaderStatus.type) {
      case 'serial':
      case 'usb':
        return <Usb />;
      case 'nfc':
        return <Nfc />;
      default:
        return <CreditCard />;
    }
  };

  const getCardReaderLabel = () => {
    switch (cardReaderStatus.type) {
      case 'serial':
        return 'Serial Card Reader';
      case 'usb':
        return 'USB Card Reader';
      case 'nfc':
        return 'NFC Card Reader';
      default:
        return 'Card Reader';
    }
  };

  return (
    <Box
      display="flex"
      justifyContent="center"
      alignItems="center"
      minHeight="100vh"
      sx={{
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        padding: 2,
      }}
    >
      <Card
        sx={{
          maxWidth: 450,
          width: '100%',
          boxShadow: '0 8px 32px rgba(0,0,0,0.1)',
          borderRadius: 3,
        }}
      >
        <CardContent sx={{ p: 4 }}>
          <Box textAlign="center" mb={3}>
            <Security sx={{ fontSize: 48, color: 'primary.main', mb: 1 }} />
            <Typography variant="h4" fontWeight="bold" gutterBottom>
              IGS Pharmacy
            </Typography>
            <Typography variant="body2" color="textSecondary">
              Secure Login Portal
            </Typography>
          </Box>

          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          {/* Card Reader Section */}
          {cardReaderStatus.type !== 'none' && (
            <>
              <Box mb={3}>
                <Stack direction="row" spacing={1} alignItems="center" mb={2}>
                  <Chip
                    icon={getCardReaderIcon()}
                    label={getCardReaderLabel()}
                    color="primary"
                    variant="outlined"
                    size="small"
                  />
                  <Chip
                    label={cardReaderStatus.connected ? 'Connected' : 'Available'}
                    color={cardReaderStatus.connected ? 'success' : 'default'}
                    size="small"
                  />
                </Stack>

                <Button
                  fullWidth
                  variant="contained"
                  size="large"
                  startIcon={cardReading ? <CircularProgress size={20} /> : <CreditCard />}
                  onClick={handleCardLogin}
                  disabled={cardReading}
                  sx={{ mb: 2 }}
                >
                  {cardReading ? 'Reading Card...' : 'Login with ID Card'}
                </Button>
              </Box>

              <Divider sx={{ mb: 3 }}>
                <Typography variant="body2" color="textSecondary">
                  OR
                </Typography>
              </Divider>
            </>
          )}

          {/* Traditional Login Form */}
          <form onSubmit={formik.handleSubmit}>
            <TextField
              fullWidth
              id="username"
              name="username"
              label="Username"
              value={formik.values.username}
              onChange={formik.handleChange}
              onBlur={formik.handleBlur}
              error={formik.touched.username && Boolean(formik.errors.username)}
              helperText={formik.touched.username && formik.errors.username}
              margin="normal"
              autoComplete="username"
            />

            <TextField
              fullWidth
              id="password"
              name="password"
              label="Password"
              type={showPassword ? 'text' : 'password'}
              value={formik.values.password}
              onChange={formik.handleChange}
              onBlur={formik.handleBlur}
              error={formik.touched.password && Boolean(formik.errors.password)}
              helperText={formik.touched.password && formik.errors.password}
              margin="normal"
              autoComplete="current-password"
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      onClick={() => setShowPassword(!showPassword)}
                      edge="end"
                    >
                      {showPassword ? <VisibilityOff /> : <Visibility />}
                    </IconButton>
                  </InputAdornment>
                ),
              }}
            />

            <Button
              type="submit"
              fullWidth
              variant="contained"
              size="large"
              startIcon={loading ? <CircularProgress size={20} /> : <LoginIcon />}
              disabled={loading}
              sx={{ mt: 3, mb: 2 }}
            >
              {loading ? 'Signing In...' : 'Sign In'}
            </Button>
          </form>

          <Box sx={{ textAlign: 'center', mt: 2 }}>
            <Typography variant="body2">
              Don't have an account?{' '}
              <Link
                component="button"
                variant="body2"
                onClick={() => navigate('/register')}
                sx={{ textDecoration: 'none' }}
              >
                Register here
              </Link>
            </Typography>
          </Box>

          <Box textAlign="center" mt={2}>
            <Typography variant="body2" color="textSecondary">
              Secure pharmacy management system
            </Typography>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
};

export default Login;
