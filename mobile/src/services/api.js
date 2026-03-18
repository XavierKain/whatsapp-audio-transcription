import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

const API_URL = __DEV__ ? 'http://localhost:3000' : 'https://your-production-url.com';

const api = axios.create({ baseURL: API_URL });

// Attach auth token to every request
api.interceptors.request.use(async (config) => {
  const token = await AsyncStorage.getItem('access_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export const authApi = {
  signup: (email, password, referralCode) =>
    api.post('/auth/signup', { email, password, referralCode }),
  login: (email, password) =>
    api.post('/auth/login', { email, password }),
};

export const whatsappApi = {
  requestPairingCode: (phoneNumber) =>
    api.post('/whatsapp/pair', { phoneNumber }),
  getStatus: () => api.get('/whatsapp/status'),
  disconnect: () => api.delete('/whatsapp/disconnect'),
};

export const transcriptionsApi = {
  list: (page = 1, limit = 20) =>
    api.get(`/transcriptions?page=${page}&limit=${limit}`),
  get: (id) => api.get(`/transcriptions/${id}`),
};

export const usageApi = {
  getCurrent: () => api.get('/usage/current'),
};

export const settingsApi = {
  get: () => api.get('/settings'),
  update: (data) => api.put('/settings', data),
};

export const pushApi = {
  register: (expoPushToken, platform) =>
    api.post('/push/register', { expoPushToken, platform }),
};

export const subscriptionApi = {
  get: () => api.get('/subscription'),
  upgrade: (data) => api.post('/subscription/upgrade', data),
};

export const referralApi = {
  getCode: () => api.get('/referral/code'),
};

export default api;
