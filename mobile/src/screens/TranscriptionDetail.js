import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { transcriptionsApi } from '../services/api';

export default function TranscriptionDetail({ route }) {
  const { id } = route.params;
  const [item, setItem] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    transcriptionsApi.get(id)
      .then(res => setItem(res.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return <View style={styles.container}><ActivityIndicator color="#25D366" /></View>;
  }

  if (!item) {
    return <View style={styles.container}><Text style={styles.error}>Transcription not found</Text></View>;
  }

  const date = new Date(item.created_at).toLocaleString();
  const duration = item.audio_duration_sec
    ? `${Math.floor(item.audio_duration_sec / 60)}:${String(item.audio_duration_sec % 60).padStart(2, '0')}`
    : '';

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.sender}>{item.sender_name || 'Unknown'}</Text>
      <Text style={styles.meta}>{date} · {duration}</Text>

      {!item.language_ok && (
        <View style={styles.warning}>
          <Text style={styles.warningText}>Transcription may be inaccurate</Text>
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.label}>SUMMARY</Text>
        <Text style={styles.summary}>{item.summary}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>FULL TRANSCRIPT</Text>
        <Text style={styles.transcript}>{item.transcript}</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a', padding: 16, paddingTop: 60 },
  sender: { fontSize: 22, fontWeight: '700', color: '#fff', marginBottom: 4 },
  meta: { fontSize: 13, color: '#666', marginBottom: 16 },
  warning: { backgroundColor: '#F5503620', padding: 12, borderRadius: 8, marginBottom: 16, borderWidth: 1, borderColor: '#F5503640' },
  warningText: { color: '#F55036', fontSize: 13 },
  section: { backgroundColor: '#1a1a1a', borderRadius: 12, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#333' },
  label: { fontSize: 11, color: '#666', marginBottom: 8, letterSpacing: 1 },
  summary: { fontSize: 16, color: '#fff', lineHeight: 24 },
  transcript: { fontSize: 15, color: '#ccc', lineHeight: 24 },
  error: { color: '#F55036', fontSize: 16, textAlign: 'center' },
});
