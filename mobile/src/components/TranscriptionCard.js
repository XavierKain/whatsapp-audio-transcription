import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

export default function TranscriptionCard({ item, onPress }) {
  const timeAgo = getTimeAgo(item.created_at);
  const duration = item.audio_duration_sec
    ? `${Math.floor(item.audio_duration_sec / 60)}:${String(item.audio_duration_sec % 60).padStart(2, '0')}`
    : '';

  return (
    <TouchableOpacity style={styles.card} onPress={onPress}>
      <View style={styles.header}>
        <Text style={styles.sender}>{item.sender_name || 'Unknown'}</Text>
        <Text style={styles.time}>{timeAgo}</Text>
      </View>
      <Text style={styles.summary} numberOfLines={2}>
        {!item.language_ok ? '⚠️ ' : ''}{item.summary}
      </Text>
      {duration ? <Text style={styles.duration}>{duration}</Text> : null}
    </TouchableOpacity>
  );
}

function getTimeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  return `${days}d ago`;
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#1a1a1a', borderRadius: 12, padding: 14, marginHorizontal: 16, marginBottom: 8, borderWidth: 1, borderColor: '#222' },
  header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  sender: { color: '#fff', fontWeight: '600', fontSize: 15 },
  time: { color: '#666', fontSize: 12 },
  summary: { color: '#aaa', fontSize: 13, lineHeight: 20 },
  duration: { color: '#555', fontSize: 11, marginTop: 6 },
});
