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
const touchCenter = (touches: readonly any[]) => {
  if (touches.length < 2) return { x: 0, y: 0 };
  return {
    x: (touches[0].locationX + touches[1].locationX) / 2,
    y: (touches[0].locationY + touches[1].locationY) / 2,
  };
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
  const frameRef = useRef<any>(null);
  const gestureStart = useRef({ scale: 1, x: 0, y: 0, distance: 0, focalX: 0, focalY: 0 });
  const pinchingRef = useRef(false);

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

  const zoomAt = (requestedScale: number, focalX = frameSize.width / 2, focalY = frameSize.height / 2) => {
    const previousScale = scaleRef.current;
    const nextScale = clamp(requestedScale, 1, 4);
    if (Math.abs(nextScale - previousScale) < 0.001) return;

    const centerX = frameSize.width / 2;
    const centerY = frameSize.height / 2;
    const ratio = nextScale / previousScale;
    const nextOffset = {
      x: focalX - centerX - (focalX - centerX - offsetRef.current.x) * ratio,
      y: focalY - centerY - (focalY - centerY - offsetRef.current.y) * ratio,
    };
    commitScale(nextScale);
    clampOffset(nextScale, nextOffset);
  };

  useEffect(() => {
    if (!visible || !uri) return;
    commitScale(1);
    commitOffset(0, 0);
    Image.getSize(uri, (width, height) => setImageSize({ width, height }), () => setImageSize({ width: 1, height: 1 }));
  }, [visible, uri]);

  useEffect(() => {
    if (!visible || Platform.OS !== 'web') return;
    const element = frameRef.current as HTMLElement | null;
    if (!element?.addEventListener) return;

    const preventPageZoom = (event: Event) => event.preventDefault();
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const rect = element.getBoundingClientRect();
      const focalX = clamp(event.clientX - rect.left, 0, frameSize.width);
      const focalY = clamp(event.clientY - rect.top, 0, frameSize.height);
      const factor = Math.exp(-event.deltaY * 0.0025);
      zoomAt(scaleRef.current * factor, focalX, focalY);
    };

    element.addEventListener('wheel', onWheel, { passive: false });
    element.addEventListener('gesturestart', preventPageZoom, { passive: false });
    element.addEventListener('gesturechange', preventPageZoom, { passive: false });
    element.addEventListener('gestureend', preventPageZoom, { passive: false });
    return () => {
      element.removeEventListener('wheel', onWheel);
      element.removeEventListener('gesturestart', preventPageZoom);
      element.removeEventListener('gesturechange', preventPageZoom);
      element.removeEventListener('gestureend', preventPageZoom);
    };
  }, [visible, frameSize.width, frameSize.height, imageSize.width, imageSize.height]);

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: event => {
      const touches = event.nativeEvent.touches;
      const focal = touchCenter(touches);
      gestureStart.current = {
        scale: scaleRef.current,
        x: offsetRef.current.x,
        y: offsetRef.current.y,
        distance: touchDistance(touches),
        focalX: focal.x,
        focalY: focal.y,
      };
      pinchingRef.current = touches.length >= 2;
    },
    onPanResponderMove: (event, gesture) => {
      const touches = event.nativeEvent.touches;
      if (touches.length >= 2) {
        const distance = touchDistance(touches);
        const focal = touchCenter(touches);
        if (!pinchingRef.current || !gestureStart.current.distance) {
          gestureStart.current = {
            scale: scaleRef.current,
            x: offsetRef.current.x,
            y: offsetRef.current.y,
            distance,
            focalX: focal.x,
            focalY: focal.y,
          };
          pinchingRef.current = true;
          return;
        }
        const nextScale = clamp(gestureStart.current.scale * (distance / gestureStart.current.distance), 1, 4);
        const ratio = nextScale / gestureStart.current.scale;
        const centerX = frameSize.width / 2;
        const centerY = frameSize.height / 2;
        commitScale(nextScale);
        clampOffset(nextScale, {
          x: focal.x - centerX - (gestureStart.current.focalX - centerX - gestureStart.current.x) * ratio,
          y: focal.y - centerY - (gestureStart.current.focalY - centerY - gestureStart.current.y) * ratio,
        });
      } else if (!pinchingRef.current) {
        commitOffset(gestureStart.current.x + gesture.dx, gestureStart.current.y + gesture.dy);
      }
    },
    onPanResponderRelease: () => {
      pinchingRef.current = false;
      clampOffset();
    },
    onPanResponderTerminate: () => {
      pinchingRef.current = false;
      clampOffset();
    },
    onPanResponderTerminationRequest: () => false,
  }), [frameSize.width, frameSize.height, imageSize.width, imageSize.height]);

  const displaySize = useMemo(() => {
    const base = Math.max(frameSize.width / imageSize.width, frameSize.height / imageSize.height);
    return { width: imageSize.width * base * scale, height: imageSize.height * base * scale };
  }, [frameSize, imageSize, scale]);

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
          <Text style={styles.guide}>{Platform.OS === 'web' ? 'ドラッグで位置を調整、ホイールまたは二本指で拡大・縮小できます' : '二本指で拡大・縮小、指で画像を動かせます'}</Text>
          <View
            ref={frameRef}
            style={[
              styles.frame,
              { width: frameWidth, height: frameHeight },
              Platform.OS === 'web' ? ({ touchAction: 'none', overscrollBehavior: 'contain' } as any) : null,
            ]}
            onLayout={onFrameLayout}
            {...panResponder.panHandlers}
          >
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
  actions: { width: '100%', marginTop: 15, flexDirection: 'row', gap: 10 },
  cancel: { minHeight: 48, paddingHorizontal: 18, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F0F0F0' },
  cancelText: { color: '#5F5955', fontSize: 13, fontWeight: '900' },
  done: { flex: 1, minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#00AEB8' },
  doneText: { color: '#fff', fontSize: 14, fontWeight: '900' },
});
