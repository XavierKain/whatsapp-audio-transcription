import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export default function UsageBanner({ usage }) {
  if (!usage) return null;

  const { minutesUsed, minutesLimit, resetDate } = usage;
  const percent = minutesLimit > 0 ? Math.min((minutesUsed / minutesLimit) * 100, 100) : 0;
  const isNearLimit = percent >= 80;

  return (
    <View style={[styles.container, isNearLimit && styles.containerWarning]}>
      <Text style={styles.text}>
        {minutesUsed} / {minutesLimit === Infinity ? '∞' : minutesLimit} min used this month
      </Text>
      <View style={styles.bar}>
        <View style={[styles.fill, { width: `${percent}%` }, isNearLimit && styles.fillWarning]} />
      </View>
      {resetDate && (
        <Text style={styles.resetText}>Resets {new Date(resetDate).toLocaleDateString()}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: '#1a1a1a', padding: 12, marginHorizontal: 16, borderRadius: 8, marginBottom: 12, borderWidth: 1, borderColor: '#333' },
  containerWarning: { borderColor: '#F5503640', backgroundColor: '#F5503610' },
  text: { color: '#ccc', fontSize: 13, marginBottom: 8 },
  bar: { height: 4, backgroundColor: '#333', borderRadius: 2, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: '#25D366', borderRadius: 2 },
  fillWarning: { backgroundColor: '#F55036' },
  resetText: { color: '#666', fontSize: 11, marginTop: 6 },
});
