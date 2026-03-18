import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { subscriptionApi } from '../services/api';

const PLANS = [
  { id: 'starter', name: 'Launch Plan', price: '€5/year', minutes: '100 min/month', highlight: true },
];

const ADDONS = [
  { id: '+100', name: '+100 min/month', price: '+€2' },
  { id: '+300', name: '+300 min/month', price: '+€5' },
  { id: 'unlimited', name: 'Unlimited', price: '+€10' },
];

export default function Upgrade() {
  const handleUpgrade = async (type, id) => {
    try {
      const res = await subscriptionApi.upgrade({ [type]: id });
      Alert.alert('Info', res.data.message || 'Coming soon!');
    } catch (err) {
      Alert.alert('Error', err.response?.data?.error || 'Failed');
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Upgrade</Text>
      <Text style={styles.subtitle}>Get more transcription minutes</Text>

      <Text style={styles.sectionTitle}>PLANS</Text>
      {PLANS.map(plan => (
        <TouchableOpacity
          key={plan.id}
          style={[styles.card, plan.highlight && styles.cardHighlight]}
          onPress={() => handleUpgrade('plan', plan.id)}
        >
          <View>
            <Text style={styles.cardName}>{plan.name}</Text>
            <Text style={styles.cardDetail}>{plan.minutes}</Text>
          </View>
          <Text style={styles.cardPrice}>{plan.price}</Text>
        </TouchableOpacity>
      ))}

      <Text style={[styles.sectionTitle, { marginTop: 24 }]}>ADD-ONS</Text>
      {ADDONS.map(addon => (
        <TouchableOpacity
          key={addon.id}
          style={styles.card}
          onPress={() => handleUpgrade('addon', addon.id)}
        >
          <Text style={styles.cardName}>{addon.name}</Text>
          <Text style={styles.cardPrice}>{addon.price}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a', padding: 16, paddingTop: 60 },
  title: { fontSize: 24, fontWeight: '700', color: '#fff', marginBottom: 4 },
  subtitle: { fontSize: 14, color: '#888', marginBottom: 24 },
  sectionTitle: { fontSize: 11, color: '#666', letterSpacing: 1, marginBottom: 8 },
  card: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#1a1a1a', padding: 16, borderRadius: 12, marginBottom: 8, borderWidth: 1, borderColor: '#333' },
  cardHighlight: { borderColor: '#25D366' },
  cardName: { color: '#fff', fontSize: 16, fontWeight: '600' },
  cardDetail: { color: '#888', fontSize: 13, marginTop: 2 },
  cardPrice: { color: '#25D366', fontSize: 16, fontWeight: '600' },
});
