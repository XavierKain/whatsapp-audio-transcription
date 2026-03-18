import React, { useState, useEffect } from 'react';
import { View, Text, Switch, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { settingsApi, whatsappApi, referralApi, subscriptionApi } from '../services/api';

const LANGUAGES = [
  { code: 'en', label: 'English', flag: '🇬🇧' },
  { code: 'fr', label: 'French', flag: '🇫🇷' },
  { code: 'es', label: 'Spanish', flag: '🇪🇸' },
  { code: 'de', label: 'German', flag: '🇩🇪' },
  { code: 'pt', label: 'Portuguese', flag: '🇧🇷' },
  { code: 'it', label: 'Italian', flag: '🇮🇹' },
];

export default function Settings({ navigation }) {
  const [settings, setSettings] = useState(null);
  const [waStatus, setWaStatus] = useState('loading');
  const [referralCode, setReferralCode] = useState('');
  const [subscription, setSubscription] = useState(null);

  useEffect(() => {
    Promise.all([
      settingsApi.get(),
      whatsappApi.getStatus(),
      referralApi.getCode(),
      subscriptionApi.get(),
    ]).then(([settingsRes, statusRes, refRes, subRes]) => {
      setSettings(settingsRes.data);
      setWaStatus(statusRes.data.status);
      setReferralCode(refRes.data.referralCode || refRes.data.referral_code || '');
      setSubscription(subRes.data);
    }).catch(console.error);
  }, []);

  const toggleLanguage = async (langCode) => {
    if (!settings) return;
    const current = settings.preferred_languages || [];
    const updated = current.includes(langCode)
      ? current.filter(l => l !== langCode)
      : [...current, langCode];

    if (updated.length === 0) {
      Alert.alert('Error', 'Select at least one language');
      return;
    }

    try {
      const res = await settingsApi.update({ preferredLanguages: updated });
      setSettings(res.data);
    } catch (err) {
      Alert.alert('Error', 'Failed to update settings');
    }
  };

  const toggleNotifications = async (value) => {
    try {
      const res = await settingsApi.update({ notificationsEnabled: value });
      setSettings(res.data);
    } catch (err) {
      Alert.alert('Error', 'Failed to update settings');
    }
  };

  const handleDisconnect = () => {
    Alert.alert('Disconnect WhatsApp?', 'You will stop receiving transcriptions.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disconnect',
        style: 'destructive',
        onPress: async () => {
          await whatsappApi.disconnect();
          navigation.replace('PairingCode');
        },
      },
    ]);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Settings</Text>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>WHATSAPP</Text>
        <View style={styles.row}>
          <Text style={styles.rowText}>Status</Text>
          <Text style={[styles.rowValue, waStatus === 'connected' && { color: '#25D366' }]}>
            {waStatus === 'connected' ? 'Connected ✓' : waStatus}
          </Text>
        </View>
        {waStatus === 'connected' && (
          <TouchableOpacity onPress={handleDisconnect}>
            <Text style={styles.disconnectText}>Disconnect</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>LANGUAGES</Text>
        {LANGUAGES.map(lang => (
          <TouchableOpacity
            key={lang.code}
            style={styles.row}
            onPress={() => toggleLanguage(lang.code)}
          >
            <Text style={styles.rowText}>{lang.flag} {lang.label}</Text>
            <Text style={styles.rowValue}>
              {settings?.preferred_languages?.includes(lang.code) ? '✓' : ''}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>NOTIFICATIONS</Text>
        <View style={styles.row}>
          <Text style={styles.rowText}>Push notifications</Text>
          <Switch
            value={settings?.notifications_enabled ?? true}
            onValueChange={toggleNotifications}
            trackColor={{ true: '#25D366' }}
          />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>SUBSCRIPTION</Text>
        <View style={styles.row}>
          <Text style={styles.rowText}>Plan</Text>
          <Text style={styles.rowValue}>{subscription?.plan || 'Free'}</Text>
        </View>
        <TouchableOpacity style={styles.upgradeButton} onPress={() => navigation.navigate('Upgrade')}>
          <Text style={styles.upgradeText}>Upgrade plan</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>REFERRAL</Text>
        <Text style={styles.referralCode}>{referralCode}</Text>
        <Text style={styles.referralHint}>Share to earn bonus minutes</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a', paddingTop: 60 },
  header: { fontSize: 24, fontWeight: '700', color: '#fff', paddingHorizontal: 16, marginBottom: 24 },
  section: { paddingHorizontal: 16, marginBottom: 24 },
  sectionTitle: { fontSize: 11, color: '#666', letterSpacing: 1, marginBottom: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#222' },
  rowText: { color: '#fff', fontSize: 15 },
  rowValue: { color: '#888', fontSize: 15 },
  disconnectText: { color: '#F55036', fontSize: 14, paddingVertical: 8 },
  upgradeButton: { backgroundColor: '#25D366', padding: 12, borderRadius: 8, alignItems: 'center', marginTop: 8 },
  upgradeText: { color: '#fff', fontWeight: '600' },
  referralCode: { fontFamily: 'monospace', fontSize: 18, color: '#fff', marginBottom: 4 },
  referralHint: { color: '#666', fontSize: 12 },
});
