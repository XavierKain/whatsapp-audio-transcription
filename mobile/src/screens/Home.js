import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import { transcriptionsApi, usageApi } from '../services/api';
import TranscriptionCard from '../components/TranscriptionCard';
import UsageBanner from '../components/UsageBanner';

export default function Home({ navigation }) {
  const [transcriptions, setTranscriptions] = useState([]);
  const [usage, setUsage] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [hiddenCount, setHiddenCount] = useState(0);

  const loadData = useCallback(async (pageNum = 1, append = false) => {
    try {
      const [txnRes, usageRes] = await Promise.all([
        transcriptionsApi.list(pageNum, 20),
        usageApi.getCurrent(),
      ]);

      const newItems = txnRes.data.transcriptions || [];
      setTranscriptions(prev => append ? [...prev, ...newItems] : newItems);
      setHasMore(newItems.length === 20);
      setHiddenCount(txnRes.data.hiddenCount || 0);
      setUsage(usageRes.data);
    } catch (err) {
      console.error('Failed to load data:', err);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const onRefresh = async () => {
    setRefreshing(true);
    setPage(1);
    await loadData(1);
    setRefreshing(false);
  };

  const loadMore = () => {
    if (!hasMore) return;
    const nextPage = page + 1;
    setPage(nextPage);
    loadData(nextPage, true);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.header}>VoiceScribe</Text>

      <FlatList
        data={transcriptions}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <TranscriptionCard
            item={item}
            onPress={() => navigation.navigate('TranscriptionDetail', { id: item.id })}
          />
        )}
        ListHeaderComponent={
          <>
            {usage && <UsageBanner usage={usage} />}
            {hiddenCount > 0 && (
              <View style={styles.hiddenBanner}>
                <Text style={styles.hiddenText}>
                  {hiddenCount} transcription{hiddenCount > 1 ? 's' : ''} waiting — upgrade to unlock
                </Text>
              </View>
            )}
          </>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No transcriptions yet</Text>
            <Text style={styles.emptySubtitle}>Voice messages will appear here automatically</Text>
          </View>
        }
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#25D366" />}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
      />

      <View style={styles.tabBar}>
        <TouchableOpacity style={styles.tab} onPress={() => {}}>
          <Text style={[styles.tabText, styles.tabActive]}>Home</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.tab} onPress={() => navigation.navigate('Settings')}>
          <Text style={styles.tabText}>Settings</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  header: { fontSize: 24, fontWeight: '700', color: '#fff', padding: 16, paddingTop: 60 },
  empty: { alignItems: 'center', padding: 40 },
  emptyTitle: { fontSize: 18, color: '#fff', marginBottom: 8 },
  emptySubtitle: { fontSize: 14, color: '#666' },
  hiddenBanner: { backgroundColor: '#F5503620', padding: 12, marginHorizontal: 16, borderRadius: 8, marginBottom: 8, borderWidth: 1, borderColor: '#F5503640' },
  hiddenText: { color: '#F55036', fontSize: 13, textAlign: 'center' },
  tabBar: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#222', paddingBottom: 20 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  tabText: { color: '#666', fontSize: 14 },
  tabActive: { color: '#25D366' },
});
