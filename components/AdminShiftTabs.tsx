import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

type Props = {
  active: 'view' | 'create';
};

export default function AdminShiftTabs({ active }: Props) {
  const router = useRouter();
  const [role, setRole] = useState('');

  useEffect(() => {
    AsyncStorage.getItem('loggedInUser').then(raw => {
      if (!raw) return;
      try {
        const user = JSON.parse(raw);
        setRole(user.role || '');
      } catch {}
    });
  }, []);

  const goView = () => {
    if (active !== 'view') router.push('/shift-view' as any);
  };
  const goCreate = () => {
    if (active === 'create') return;
    if (role === 'staff') router.push('/shift' as any);
    else router.push('/shift-create' as any);
  };

  return (
    <View style={styles.wrap}>
      <TouchableOpacity
        style={[styles.tab, active === 'view' && styles.tabActive]}
        onPress={goView}
        activeOpacity={0.82}
      >
        <Ionicons name="calendar-outline" size={17} color={active === 'view' ? '#FFFFFF' : '#2D8BE8'} />
        <Text style={[styles.tabText, active === 'view' && styles.tabTextActive]}>確認する</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.tab, active === 'create' && styles.tabActive]}
        onPress={goCreate}
        activeOpacity={0.82}
      >
        <Ionicons name="create-outline" size={17} color={active === 'create' ? '#FFFFFF' : '#2D8BE8'} />
        <Text style={[styles.tabText, active === 'create' && styles.tabTextActive]}>{role === 'staff' ? '提出する' : '作成する'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    gap: 8,
    marginHorizontal: 14,
    marginTop: 10,
    marginBottom: 4,
    padding: 4,
    borderRadius: 18,
    backgroundColor: '#EAF6FF',
    borderWidth: 1,
    borderColor: '#CDEBFF',
  },
  tab: {
    flex: 1,
    minHeight: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  tabActive: {
    backgroundColor: '#2D8BE8',
    shadowColor: '#2D8BE8',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 2,
  },
  tabText: {
    fontSize: 13,
    fontWeight: '900',
    color: '#2D8BE8',
  },
  tabTextActive: {
    color: '#FFFFFF',
  },
});
