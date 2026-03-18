import React, { useState, useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import Onboarding from '../screens/Onboarding';
import PairingCode from '../screens/PairingCode';
import Home from '../screens/Home';
import TranscriptionDetail from '../screens/TranscriptionDetail';
import Settings from '../screens/Settings';
import Upgrade from '../screens/Upgrade';
import { whatsappApi } from '../services/api';

const Stack = createNativeStackNavigator();

export default function AppNavigator() {
  const [initialRoute, setInitialRoute] = useState(null);

  useEffect(() => {
    checkAuth();
    setupNotificationNavigation();
  }, []);

  const checkAuth = async () => {
    const token = await AsyncStorage.getItem('access_token');
    if (!token) {
      setInitialRoute('Onboarding');
      return;
    }

    try {
      const res = await whatsappApi.getStatus();
      setInitialRoute(res.data.status === 'connected' ? 'Home' : 'PairingCode');
    } catch {
      setInitialRoute('Onboarding');
    }
  };

  const setupNotificationNavigation = () => {
    Notifications.addNotificationResponseReceivedListener((response) => {
      const { transcriptionId } = response.notification.request.content.data || {};
      if (transcriptionId) {
        // Navigation will be handled by the navigation ref
      }
    });
  };

  if (!initialRoute) return null; // Loading

  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName={initialRoute}
        screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#0a0a0a' } }}
      >
        <Stack.Screen name="Onboarding" component={Onboarding} />
        <Stack.Screen name="PairingCode" component={PairingCode} />
        <Stack.Screen name="Home" component={Home} />
        <Stack.Screen name="TranscriptionDetail" component={TranscriptionDetail} />
        <Stack.Screen name="Settings" component={Settings} />
        <Stack.Screen name="Upgrade" component={Upgrade} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
