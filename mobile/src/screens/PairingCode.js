import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { whatsappApi } from '../services/api';
import { registerForPushNotifications } from '../services/notifications';

export default function PairingCode({ navigation }) {
  const [phoneNumber, setPhoneNumber] = useState('');
  const [countryCode, setCountryCode] = useState('+33');
  const [pairingCode, setPairingCode] = useState(null);
  const [countdown, setCountdown] = useState(60);
  const [loading, setLoading] = useState(false);
  const [polling, setPolling] = useState(false);
  const intervalRef = useRef(null);
  const countdownRef = useRef(null);

  useEffect(() => {
    // Register push notifications early
    registerForPushNotifications();
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  const requestCode = async () => {
    const fullNumber = countryCode + phoneNumber.replace(/\s/g, '');
    if (fullNumber.length < 10) {
      Alert.alert('Error', 'Please enter a valid phone number');
      return;
    }

    setLoading(true);
    try {
      const res = await whatsappApi.requestPairingCode(fullNumber);
      const code = res.data.code;
      // Format as XXXX-XXXX
      const formatted = code.length === 8
        ? `${code.slice(0, 4)}-${code.slice(4)}`
        : code;
      setPairingCode(formatted);
      setCountdown(60);
      startCountdown();
      startPolling();
    } catch (err) {
      Alert.alert('Error', err.response?.data?.error || 'Failed to get pairing code');
    } finally {
      setLoading(false);
    }
  };

  const startCountdown = () => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    let seconds = 60;
    countdownRef.current = setInterval(() => {
      seconds -= 1;
      setCountdown(seconds);
      if (seconds <= 0) {
        clearInterval(countdownRef.current);
        setPairingCode(null);
      }
    }, 1000);
  };

  const startPolling = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    setPolling(true);
    intervalRef.current = setInterval(async () => {
      try {
        const res = await whatsappApi.getStatus();
        if (res.data.status === 'connected') {
          clearInterval(intervalRef.current);
          clearInterval(countdownRef.current);
          setPolling(false);
          navigation.replace('Home');
        }
      } catch (err) {
        // ignore polling errors
      }
    }, 3000);
  };

  if (pairingCode) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Enter this code in WhatsApp</Text>
        <Text style={styles.code}>{pairingCode}</Text>
        <Text style={styles.countdown}>Expires in {countdown}s</Text>

        <View style={styles.instructions}>
          <Text style={styles.step}>1. Open WhatsApp</Text>
          <Text style={styles.step}>2. Settings → Linked Devices</Text>
          <Text style={styles.step}>3. Link a Device</Text>
          <Text style={styles.step}>4. Link with phone number</Text>
          <Text style={styles.step}>5. Enter the code above</Text>
        </View>

        {polling && (
          <View style={styles.pollingRow}>
            <ActivityIndicator size="small" color="#25D366" />
            <Text style={styles.pollingText}>Waiting for connection...</Text>
          </View>
        )}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Connect WhatsApp</Text>
      <Text style={styles.subtitle}>Enter your WhatsApp phone number</Text>

      <View style={styles.phoneRow}>
        <TextInput
          style={[styles.input, { width: 80 }]}
          value={countryCode}
          onChangeText={setCountryCode}
          keyboardType="phone-pad"
          placeholderTextColor="#666"
        />
        <TextInput
          style={[styles.input, { flex: 1 }]}
          placeholder="6 12 34 56 78"
          value={phoneNumber}
          onChangeText={setPhoneNumber}
          keyboardType="phone-pad"
          placeholderTextColor="#666"
        />
      </View>

      <TouchableOpacity style={styles.button} onPress={requestCode} disabled={loading}>
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Get pairing code</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#0a0a0a' },
  title: { fontSize: 24, fontWeight: '700', color: '#fff', textAlign: 'center', marginBottom: 8 },
  subtitle: { fontSize: 14, color: '#888', textAlign: 'center', marginBottom: 32 },
  code: { fontSize: 36, fontWeight: '700', fontFamily: 'monospace', color: '#25D366', textAlign: 'center', letterSpacing: 4, marginVertical: 24 },
  countdown: { fontSize: 14, color: '#888', textAlign: 'center' },
  instructions: { backgroundColor: '#1a1a1a', borderRadius: 12, padding: 16, marginTop: 24, borderWidth: 1, borderColor: '#25D36633' },
  step: { color: '#ccc', fontSize: 14, marginBottom: 6, lineHeight: 22 },
  pollingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 24, gap: 8 },
  pollingText: { color: '#888', fontSize: 14 },
  phoneRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  input: { backgroundColor: '#1a1a1a', color: '#fff', padding: 16, borderRadius: 12, fontSize: 16, borderWidth: 1, borderColor: '#333' },
  button: { backgroundColor: '#25D366', padding: 16, borderRadius: 12, alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
