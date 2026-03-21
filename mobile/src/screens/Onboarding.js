import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { authApi } from '../services/api';

export default function Onboarding({ navigation }) {
  const [isLogin, setIsLogin] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [referralCode, setReferralCode] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!email || !password) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    setLoading(true);
    try {
      console.log('[AUTH] Attempting', isLogin ? 'login' : 'signup', 'to', 'http://49.13.25.233:3001');
      const res = isLogin
        ? await authApi.login(email, password)
        : await authApi.signup(email, password, referralCode || undefined);

      console.log('[AUTH] Response status:', res.status);
      const session = res.data.session;
      if (session?.access_token) {
        await AsyncStorage.setItem('access_token', session.access_token);
        await AsyncStorage.setItem('refresh_token', session.refresh_token);
        console.log('[AUTH] Token saved, navigating to PairingCode');
      }

      navigation.replace('PairingCode');
    } catch (err) {
      console.log('[AUTH] Error:', JSON.stringify({
        message: err.message,
        code: err.code,
        status: err.response?.status,
        data: err.response?.data,
        url: err.config?.baseURL + err.config?.url,
      }));
      const msg = err.response?.data?.error || err.message || 'Something went wrong';
      Alert.alert('Error', msg + '\n\nURL: ' + (err.config?.baseURL || '') + (err.config?.url || 'unknown'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>AudioReadr</Text>
      <Text style={styles.subtitle}>Your voice messages, transcribed instantly</Text>

      <TextInput
        style={styles.input}
        placeholder="Email"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        placeholderTextColor="#666"
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCorrect={false}
        autoComplete="password"
        textContentType="password"
        autoCapitalize="none"
        placeholderTextColor="#666"
      />
      {!isLogin && (
        <TextInput
          style={styles.input}
          placeholder="Referral code (optional)"
          value={referralCode}
          onChangeText={setReferralCode}
          autoCapitalize="characters"
          placeholderTextColor="#666"
        />
      )}

      <TouchableOpacity style={styles.button} onPress={handleSubmit} disabled={loading}>
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>{isLogin ? 'Log in' : 'Sign up'}</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity onPress={() => setIsLogin(!isLogin)}>
        <Text style={styles.toggleText}>
          {isLogin ? "Don't have an account? Sign up" : 'Already have an account? Log in'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.button, { backgroundColor: '#333', marginTop: 20 }]}
        onPress={async () => {
          try {
            const resp = await fetch('http://49.13.25.233:3001/health');
            const data = await resp.json();
            Alert.alert('API Test', JSON.stringify(data));
          } catch (e) {
            Alert.alert('API Test Failed', e.message + '\n\n' + e.toString());
          }
        }}>
        <Text style={styles.buttonText}>Test API Connection</Text>
      </TouchableOpacity>

      {!isLogin && (
        <Text style={styles.freeText}>5 min/month free, no credit card required</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#0a0a0a' },
  title: { fontSize: 32, fontWeight: '700', color: '#fff', textAlign: 'center', marginBottom: 8 },
  subtitle: { fontSize: 16, color: '#888', textAlign: 'center', marginBottom: 40 },
  input: { backgroundColor: '#1a1a1a', color: '#fff', padding: 16, borderRadius: 12, marginBottom: 12, fontSize: 16, borderWidth: 1, borderColor: '#333' },
  button: { backgroundColor: '#25D366', padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 8 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  toggleText: { color: '#25D366', textAlign: 'center', marginTop: 16, fontSize: 14 },
  freeText: { color: '#666', textAlign: 'center', marginTop: 24, fontSize: 12 },
});
