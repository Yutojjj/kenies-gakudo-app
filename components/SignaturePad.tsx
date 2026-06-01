import React, { useRef, useState } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

type Props = {
  onSave: (dataUrl: string) => void;
};

export default function SignaturePad({ onSave }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawing = useRef(false);
  const [hasSignature, setHasSignature] = useState(false);

  if (Platform.OS !== 'web') {
    return (
      <View style={styles.fallback}>
        <Text style={styles.fallbackText}>サイン機能はWeb版でのみ利用できます</Text>
      </View>
    );
  }

  const getPos = (e: any) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const touch = e.touches?.[0] || e;
    return {
      x: (touch.clientX - rect.left) * (canvas.width / rect.width),
      y: (touch.clientY - rect.top) * (canvas.height / rect.height),
    };
  };

  const startDraw = (e: any) => {
    e.preventDefault();
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    isDrawing.current = true;
    const { x, y } = getPos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const draw = (e: any) => {
    e.preventDefault();
    if (!isDrawing.current) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = getPos(e);
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#1a1a2e';
    ctx.lineTo(x, y);
    ctx.stroke();
    setHasSignature(true);
  };

  const stopDraw = (e: any) => {
    e.preventDefault();
    isDrawing.current = false;
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !canvas) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
  };

  const save = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL('image/png');
    onSave(dataUrl);
  };

  // Web用canvas
  const canvasStyle: React.CSSProperties = {
    width: '100%',
    height: '160px',
    border: '2px dashed #ccc',
    borderRadius: '12px',
    touchAction: 'none',
    cursor: 'crosshair',
    backgroundColor: '#FAFAFA',
  };

  return (
    <View style={styles.container}>
      <Text style={styles.hint}>枠内にサインしてください</Text>
      {/* @ts-ignore */}
      <canvas
        ref={canvasRef}
        width={600}
        height={160}
        style={canvasStyle}
        onMouseDown={startDraw}
        onMouseMove={draw}
        onMouseUp={stopDraw}
        onMouseLeave={stopDraw}
        onTouchStart={startDraw}
        onTouchMove={draw}
        onTouchEnd={stopDraw}
      />
      <View style={styles.btnRow}>
        <TouchableOpacity style={styles.clearBtn} onPress={clear}>
          <Text style={styles.clearBtnText}>クリア</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.saveBtn, !hasSignature && styles.saveBtnDisabled]}
          onPress={save}
          disabled={!hasSignature}
        >
          <Text style={styles.saveBtnText}>サインを保存</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginTop: 8 },
  hint: { fontSize: 12, color: '#888', marginBottom: 8, textAlign: 'center' },
  fallback: { padding: 20, alignItems: 'center' },
  fallbackText: { color: '#888', fontSize: 13 },
  btnRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  clearBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1.5, borderColor: '#ccc', alignItems: 'center' },
  clearBtnText: { color: '#666', fontWeight: 'bold', fontSize: 14 },
  saveBtn: { flex: 2, paddingVertical: 12, borderRadius: 12, backgroundColor: '#FF7043', alignItems: 'center' },
  saveBtnDisabled: { backgroundColor: '#ccc' },
  saveBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },
});