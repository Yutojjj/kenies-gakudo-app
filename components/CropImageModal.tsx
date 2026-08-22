import { Ionicons } from '@expo/vector-icons';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Image, LayoutChangeEvent, Modal, PanResponder, Platform,
  StyleSheet, Text, TouchableOpacity, useWindowDimensions, View,
} from 'react-native';

type Props = {
  visible: boolean;
  uri: string;
  title?: string;
  onCancel: () => void;
  onDone: (uri: string) => void;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const touchDistance = (touches: readonly any[]) => {
  if (touches.length < 2) return 0;
  const dx = touches[0].pageX - touches[1].pageX;
  const dy = touches[0].pageY - touches[1].pageY;
  return Math.sqrt(dx * dx + dy * dy);
};

export default function CropImageModal({ visible, uri, title = '写真をトリミング', onCancel, onDone }: Props) {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const [imageSize, setImageSize] = useState({ width: 1, height: 1 });
  const [frameSize, setFrameSize] = useState({ width: 1, height: 1 });
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [saving, setSaving] = useState(false);
  const scaleRef = useRef(1);
  const offsetRef = useRef({ x: 0, y: 0 });
  const gestureStart = useRef({ scale: 1, x: 0, y: 0, distance: 0 });

  const frameWidth = Math.min(windowWidth - 36, 680);
  const frameHeight = Math.min(frameWidth * 9 / 16, windowHeight * 0.5);

  const commitScale = (next: number) => {
    const value = clamp(next, 1, 4);
    scaleRef.current = value;
    setScale(value);
  };
  const commitOffset = (x: number, y: number) => {
    offsetRef.current = { x, y };
    setOffset({ x, y });
  };

  const clampOffset = (nextScale = scaleRef.current, next = offsetRef.current) => {
    const base = Math.max(frameSize.width / imageSize.width, frameSize.height / imageSize.height);
    const displayWidth = imageSize.width * base * nextScale;
    const displayHeight = imageSize.height * base * nextScale;
    const maxX = Math.max(0, (displayWidth - frameSize.width) / 2);
    const maxY = Math.max(0, (displayHeight - frameSize.height) / 2);
    commitOffset(clamp(next.x, -maxX, maxX), clamp(next.y, -maxY, maxY));
  };

  useEffect(() => {
    if (!visible || !uri) return;
    commitScale(1);
    commitOffset(0, 0);
    Image.getSize(uri, (width, height) => setImageSize({ width, height }), () => setImageSize({ width: 1, height: 1 }));
  }, [visible, uri]);

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: event => {
      gestureStart.current = {
        scale: scaleRef.current,
        x: offsetRef.current.x,
        y: offsetRef.current.y,
        distance: touchDistance(event.nativeEvent.touches),
      };
    },
    onPanResponderMove: (event, gesture) => {
      const touches = event.nativeEvent.touches;
      if (touches.length >= 2) {
        const distance = touchDistance(touches);
        const initial = gestureStart.current.distance || distance;
        commitScale(gestureStart.current.scale * (distance / initial));
      } else {
        commitOffset(gestureStart.current.x + gesture.dx, gestureStart.current.y + gesture.dy);
      }
    },
    onPanResponderRelease: () => clampOffset(),
    onPanResponderTerminate: () => clampOffset(),
  }), [frameSize.width, frameSize.height, imageSize.width, imageSize.height]);

  const displaySize = useMemo(() => {
    const base = Math.max(frameSize.width / imageSize.width, frameSize.height / imageSize.height);
    return { width: imageSize.width * base * scale, height: imageSize.height * base * scale };
  }, [frameSize, imageSize, scale]);

  const nudge = (x: number, y: number) => {
    commitOffset(offsetRef.current.x + x, offsetRef.current.y + y);
    requestAnimationFrame(() => clampOffset());
  };
  const zoom = (amount: number) => {
    commitScale(scaleRef.current + amount);
    requestAnimationFrame(() => clampOffset());
  };

  const crop = async () => {
    if (!uri || saving) return;
    setSaving(true);
    try {
      const base = Math.max(frameSize.width / imageSize.width, frameSize.height / imageSize.height);
      const displayScale = base * scaleRef.current;
      const renderedWidth = imageSize.width * displayScale;
      const renderedHeight = imageSize.height * displayScale;
      const left = (frameSize.width - renderedWidth) / 2 + offsetRef.current.x;
      const top = (frameSize.height - renderedHeight) / 2 + offsetRef.current.y;
      const originX = clamp(-left / displayScale, 0, imageSize.width - 1);
      const originY = clamp(-top / displayScale, 0, imageSize.height - 1);
      const width = Math.min(frameSize.width / displayScale, imageSize.width - originX);
      const height = Math.min(frameSize.height / displayScale, imageSize.height - originY);
      const result = await manipulateAsync(uri, [{ crop: { originX, originY, width, height } }], { compress: 0.9, format: SaveFormat.JPEG });
      onDone(result.uri);
    } finally {
      setSaving(false);
    }
  };

  const onFrameLayout = (event: LayoutChangeEvent) => setFrameSize({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height });

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            <TouchableOpacity style={styles.close} onPress={onCancel}><Ionicons name="close" size={29} color="#302B28" /></TouchableOpacity>
          </View>
          <Text style={styles.guide}>{Platform.OS === 'web' ? 'ボタンまたはドラッグで位置を調整してください' : '二本指で拡大・縮小、指で画像を動かせます'}</Text>
          <View style={[styles.frame, { width: frameWidth, height: frameHeight }]} onLayout={onFrameLayout} {...panResponder.panHandlers}>
            <Image
              source={{ uri }}
              style={{ width: displaySize.width, height: displaySize.height, transform: [{ translateX: offset.x }, { translateY: offset.y }] }}
              resizeMode="stretch"
            />
            <View pointerEvents="none" style={styles.frameBorder} />
            <View pointerEvents="none" style={[styles.gridLineVertical, { left: '33.333%' }]} />
            <View pointerEvents="none" style={[styles.gridLineVertical, { left: '66.666%' }]} />
            <View pointerEvents="none" style={[styles.gridLineHorizontal, { top: '33.333%' }]} />
            <View pointerEvents="none" style={[styles.gridLineHorizontal, { top: '66.666%' }]} />
          </View>
          <View style={styles.controls}>
            <TouchableOpacity style={styles.controlButton} onPress={() => zoom(-0.15)}><Ionicons name="remove" size={24} color="#275F63" /></TouchableOpacity>
            <TouchableOpacity style={styles.controlButton} onPress={() => nudge(0, 16)}><Ionicons name="arrow-up" size={22} color="#275F63" /></TouchableOpacity>
            <TouchableOpacity style={styles.controlButton} onPress={() => nudge(16, 0)}><Ionicons name="arrow-back" size={22} color="#275F63" /></TouchableOpacity>
            <TouchableOpacity style={styles.controlButton} onPress={() => nudge(-16, 0)}><Ionicons name="arrow-forward" size={22} color="#275F63" /></TouchableOpacity>
            <TouchableOpacity style={styles.controlButton} onPress={() => nudge(0, -16)}><Ionicons name="arrow-down" size={22} color="#275F63" /></TouchableOpacity>
            <TouchableOpacity style={styles.controlButton} onPress={() => zoom(0.15)}><Ionicons name="add" size={24} color="#275F63" /></TouchableOpacity>
            <TouchableOpacity style={styles.resetButton} onPress={() => { commitScale(1); commitOffset(0, 0); }}><Text style={styles.resetText}>リセット</Text></TouchableOpacity>
          </View>
          <View style={styles.actions}>
            <TouchableOpacity style={styles.cancel} onPress={onCancel}><Text style={styles.cancelText}>キャンセル</Text></TouchableOpacity>
            <TouchableOpacity style={styles.done} onPress={crop} disabled={saving}>{saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.doneText}>この範囲で決定</Text>}</TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, padding: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(20,18,17,0.72)' },
  card: { width: '100%', maxWidth: 760, maxHeight: '96%', padding: 16, borderRadius: 18, alignItems: 'center', backgroundColor: '#fff' },
  header: { width: '100%', minHeight: 48, paddingLeft: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: '#302B28', fontSize: 20, fontWeight: '900' },
  close: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  guide: { marginBottom: 12, color: '#6F6A67', fontSize: 12, fontWeight: '700', textAlign: 'center' },
  frame: { overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: '#1F1F1F' },
  frameBorder: { ...StyleSheet.absoluteFillObject, borderWidth: 3, borderColor: '#fff' },
  gridLineVertical: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: 'rgba(255,255,255,0.5)' },
  gridLineHorizontal: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: 'rgba(255,255,255,0.5)' },
  controls: { marginTop: 13, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 7 },
  controlButton: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E8F7F7', borderWidth: 1, borderColor: '#B4DDDF' },
  resetButton: { height: 42, paddingHorizontal: 14, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F1F1F1' },
  resetText: { color: '#5D5956', fontSize: 12, fontWeight: '900' },
  actions: { width: '100%', marginTop: 15, flexDirection: 'row', gap: 10 },
  cancel: { minHeight: 48, paddingHorizontal: 18, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F0F0F0' },
  cancelText: { color: '#5F5955', fontSize: 13, fontWeight: '900' },
  done: { flex: 1, minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#00AEB8' },
  doneText: { color: '#fff', fontSize: 14, fontWeight: '900' },
});
