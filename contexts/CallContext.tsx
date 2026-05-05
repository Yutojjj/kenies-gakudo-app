import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  addDoc, collection, doc, getDoc, onSnapshot,
  query, serverTimestamp, setDoc, updateDoc, where,
} from 'firebase/firestore';
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Modal, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { db } from '../firebase';

type CallStatus = 'idle' | 'calling' | 'receiving' | 'connected';

type CallContextType = {
  callStatus: CallStatus;
  startCall: (convId: string, calleeName: string) => Promise<void>;
  endCall: () => Promise<void>;
};

const CallContext = createContext<CallContextType>({
  callStatus: 'idle',
  startCall: async () => {},
  endCall: async () => {},
});

export function useCall() {
  return useContext(CallContext);
}

function fmtDuration(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ─── 実験：Web Audio APIを使った音声ルーティング ───
// <audio>や<video>タグで音を鳴らさず、Web Audio APIのパイプラインを通して出力します。
// これによりiOSのハードウェアAECが強制的に有効化されることを狙います。
const playStreamViaWebAudio = (stream: MediaStream) => {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AudioCtx();
    
    // ユーザー操作（タップ）のコンテキスト内で呼ばれるため、resumeでアクティブ化できる
    ctx.resume();

    // iOS Safariの強烈なバグ対策：
    // Web Audio APIを通す場合でも、裏でミュートにした<audio>タグにストリームを食わせておかないと、
    // 数秒でガベージコレクション（メモリ解放）されて無音になる問題を防ぐためのダミー要素
    const dummyAudio = document.createElement('audio');
    dummyAudio.autoplay = true;
    dummyAudio.muted = true; // タグからは絶対に音を出さない
    (dummyAudio as any).playsInline = true;
    dummyAudio.srcObject = stream;
    dummyAudio.play().catch(() => {});

    // 実際の音はここ（Web Audio API）から出す
    const source = ctx.createMediaStreamSource(stream);
    const gainNode = ctx.createGain();
    
    // 通話音量はハウリング（物理ループ）を防ぐために 0.15 (15%) に低くキープ
    gainNode.gain.value = 0.15; 
    
    source.connect(gainNode);
    gainNode.connect(ctx.destination);

    return { ctx, dummyAudio };
  } catch (e) {
    console.error("Web Audio API routing failed:", e);
    return null;
  }
};

export function CallProvider({ children }: { children: React.ReactNode }) {
  const [myAccountId, setMyAccountId] = useState('');
  const [myName, setMyName] = useState('');
  const [callStatus, setCallStatus] = useState<CallStatus>('idle');
  const [remotePartyName, setRemotePartyName] = useState('');
  const [activeCallId, setActiveCallId] = useState<string | null>(null);
  const [incomingCallId, setIncomingCallId] = useState<string | null>(null);
  const [callDuration, setCallDuration] = useState(0);

  const peerRef = useRef<any>(null);
  const localStreamRef = useRef<any>(null);
  const remoteAudioRef = useRef<any>(null); // 今回は { ctx, dummyAudio } のオブジェクトが入る
  const callTimerRef = useRef<any>(null);
  const missedTimerRef = useRef<any>(null);
  const ringtoneRef = useRef<any>(null);
  const unsubCallRef = useRef<(() => void) | null>(null);
  const calleeFcmTokenRef = useRef('');

  // ─── ユーザー情報ロード ───
  useEffect(() => {
    AsyncStorage.getItem('loggedInUser').then(raw => {
      if (!raw) return;
      const u = JSON.parse(raw);
      setMyAccountId(u.accountId || (u.role === 'admin' ? 'admin' : u.name));
      setMyName(u.name || '');
    });
  }, []);

  // ─── 着信ベル（Web Audio API） ───
  const startRingtone = () => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    stopRingtone();
    try {
      const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();

      const playRing = () => {
        ([[0, 0.4], [0.55, 0.95]] as [number, number][]).forEach(([s, e]) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain); gain.connect(ctx.destination);
          osc.type = 'sine'; osc.frequency.value = 460;
          const dur = e - s;
          const t = ctx.currentTime + s;
          gain.gain.setValueAtTime(0, t);
          
          // 変更：着信音はしっかり聞こえるように 0.6 (60%) に引き上げました
          gain.gain.linearRampToValueAtTime(0.6, t + 0.03);
          gain.gain.setValueAtTime(0.6, t + dur - 0.05);
          
          gain.gain.linearRampToValueAtTime(0, t + dur);
          osc.start(t); osc.stop(t + dur + 0.01);
        });
      };
      playRing();
      const interval = setInterval(playRing, 2500);

      let vibInterval: ReturnType<typeof setInterval> | null = null;
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        const vibPat = [400, 150, 400, 1550];
        navigator.vibrate(vibPat);
        vibInterval = setInterval(() => navigator.vibrate(vibPat), 2500);
      }

      ringtoneRef.current = { interval, ctx, vibInterval };
    } catch (e) {}
  };

  const stopRingtone = () => {
    if (ringtoneRef.current) {
      clearInterval(ringtoneRef.current.interval);
      if (ringtoneRef.current.vibInterval) {
        clearInterval(ringtoneRef.current.vibInterval);
        try { navigator.vibrate(0); } catch (e) {}
      }
      try { ringtoneRef.current.ctx?.close(); } catch (e) {}
      ringtoneRef.current = null;
    }
  };

  // ─── クリーンアップ ───
  const cleanupCall = () => {
    stopRingtone();
    clearTimeout(missedTimerRef.current);
    clearInterval(callTimerRef.current);
    callTimerRef.current = null;
    unsubCallRef.current?.();
    unsubCallRef.current = null;
    peerRef.current?.close(); peerRef.current = null;
    localStreamRef.current?.getTracks().forEach((t: any) => t.stop());
    localStreamRef.current = null;
    
    // Web Audio APIの破棄処理
    if (remoteAudioRef.current) {
      try { remoteAudioRef.current.ctx.close(); } catch (e) {}
      try { remoteAudioRef.current.dummyAudio.srcObject = null; } catch (e) {}
      remoteAudioRef.current = null;
    }
    
    setCallStatus('idle');
    setActiveCallId(null);
    setIncomingCallId(null);
    setRemotePartyName('');
    setCallDuration(0);
  };

  const startCallTimer = () => {
    clearInterval(callTimerRef.current);
    setCallDuration(0);
    callTimerRef.current = setInterval(() => setCallDuration(p => p + 1), 1000);
  };

  // ─── グローバル着信リスナー ───
  useEffect(() => {
    if (!myAccountId || Platform.OS !== 'web') return;

    const q = query(
      collection(db, 'calls'),
      where('calleeId', '==', myAccountId),
      where('status', '==', 'calling')
    );
    const unsub = onSnapshot(q, snap => {
      if (!snap.empty && callStatus === 'idle') {
        const d = snap.docs[0];
        setIncomingCallId(d.id);
        setRemotePartyName(d.data().callerName || '不明');
        setCallStatus('receiving');
        startRingtone();
        missedTimerRef.current = setTimeout(async () => {
          stopRingtone();
          await setDoc(doc(db, 'calls', d.id), { status: 'missed' }, { merge: true }).catch(() => {});
          setCallStatus('idle');
          setIncomingCallId(null);
          setRemotePartyName('');
        }, 30000);
      }
    });
    return unsub;
  }, [myAccountId, callStatus]);

  // ─── 発信 ───
  const startCall = async (convId: string, calleeName: string) => {
    if (!myAccountId || Platform.OS !== 'web' || typeof window === 'undefined') return;
    const calleeId = myAccountId === 'admin'
      ? convId.replace('direct_', '')
      : 'admin';
    try {
      const pc = new (window as any).RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
        ],
      });
      peerRef.current = pc;

      // 実験：制約を ideal で強制的に要求する
      const constraints = { 
        audio: { 
          echoCancellation: { ideal: true }, 
          noiseSuppression: { ideal: true }, 
          autoGainControl: { ideal: true } 
        }, 
        video: false 
      };
      const stream = await (navigator as any).mediaDevices.getUserMedia(constraints);
      localStreamRef.current = stream;
      stream.getTracks().forEach((t: any) => pc.addTrack(t, stream));

      const callRef = doc(collection(db, 'calls'));
      setActiveCallId(callRef.id);
      setRemotePartyName(calleeName);
      setCallStatus('calling');

      pc.onicecandidate = (e: any) => {
        if (e.candidate) addDoc(collection(db, 'calls', callRef.id, 'callerCandidates'), e.candidate.toJSON()).catch(() => {});
      };
      
      pc.ontrack = (e: any) => {
        // 実験：Web Audio APIを利用して音声を再生
        if (!remoteAudioRef.current) {
          remoteAudioRef.current = playStreamViaWebAudio(e.streams[0]);
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await setDoc(callRef, {
        callerId: myAccountId, callerName: myName,
        calleeId, calleeName,
        status: 'calling', sdpOffer: JSON.stringify(offer),
        createdAt: serverTimestamp(),
      });

      onSnapshot(collection(db, 'calls', callRef.id, 'calleeCandidates'), snap => {
        snap.docChanges().forEach(ch => {
          if (ch.type === 'added') pc.addIceCandidate(new (window as any).RTCIceCandidate(ch.doc.data())).catch(() => {});
        });
      });

      missedTimerRef.current = setTimeout(async () => {
        await setDoc(doc(db, 'calls', callRef.id), { status: 'missed' }, { merge: true }).catch(() => {});
        if (calleeFcmTokenRef.current) {
          fetch('/api/send-notification', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tokens: [calleeFcmTokenRef.current],
              title: '不在着信',
              body: `${myName}からの着信を受け取れませんでした`,
              url: '/messages',
            }),
          }).catch(() => {});
        }
        setRemotePartyName(`${calleeName}（不在）`);
        setTimeout(() => cleanupCall(), 3000);
      }, 30000);

      unsubCallRef.current = onSnapshot(doc(db, 'calls', callRef.id), async snap => {
        const data = snap.data();
        if (!data) return;
        if (data.sdpAnswer && !pc.currentRemoteDescription) {
          clearTimeout(missedTimerRef.current);
          await pc.setRemoteDescription(new (window as any).RTCSessionDescription(JSON.parse(data.sdpAnswer)));
          setCallStatus('connected');
          startCallTimer();
        }
        if (data.status === 'rejected') {
          clearTimeout(missedTimerRef.current);
          setRemotePartyName(`${calleeName}（拒否されました）`);
          setTimeout(() => cleanupCall(), 3000);
        }
        if (data.status === 'ended') cleanupCall();
      });

      const tokenDoc = await getDoc(doc(db, 'fcm_tokens', calleeId));
      if (tokenDoc.exists()) {
        const token = tokenDoc.data().token;
        calleeFcmTokenRef.current = token || '';
        if (token) fetch('/api/send-notification', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tokens: [token], title: `${myName}から着信`,
            body: 'アプリを開いて応答してください', url: '/messages',
          }),
        }).catch(() => {});
      }
    } catch (e) {
      cleanupCall();
      if (typeof window !== 'undefined') window.alert('マイクへのアクセスが必要です。ブラウザ設定を確認してください。');
    }
  };

  // ─── 応答 ───
  const acceptCall = async () => {
    if (!incomingCallId || Platform.OS !== 'web') return;
    const callId = incomingCallId;
    
    stopRingtone();
    clearTimeout(missedTimerRef.current);
    
    try {
      const snap = await getDoc(doc(db, 'calls', callId));
      if (!snap.exists()) { cleanupCall(); return; }
      const data = snap.data();

      const pc = new (window as any).RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
        ],
      });
      peerRef.current = pc;

      // 実験：制約を ideal で強制的に要求する
      const constraints = { 
        audio: { 
          echoCancellation: { ideal: true }, 
          noiseSuppression: { ideal: true }, 
          autoGainControl: { ideal: true } 
        }, 
        video: false 
      };
      const stream = await (navigator as any).mediaDevices.getUserMedia(constraints);
      localStreamRef.current = stream;
      stream.getTracks().forEach((t: any) => pc.addTrack(t, stream));

      pc.ontrack = (e: any) => {
        // 実験：Web Audio APIを利用して音声を再生
        if (!remoteAudioRef.current) {
          remoteAudioRef.current = playStreamViaWebAudio(e.streams[0]);
        }
      };
      
      pc.onicecandidate = (e: any) => {
        if (e.candidate) addDoc(collection(db, 'calls', callId, 'calleeCandidates'), e.candidate.toJSON()).catch(() => {});
      };

      await pc.setRemoteDescription(new (window as any).RTCSessionDescription(JSON.parse(data.sdpOffer)));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await updateDoc(doc(db, 'calls', callId), { sdpAnswer: JSON.stringify(answer), status: 'connected' });

      onSnapshot(collection(db, 'calls', callId, 'callerCandidates'), snap => {
        snap.docChanges().forEach(ch => {
          if (ch.type === 'added') pc.addIceCandidate(new (window as any).RTCIceCandidate(ch.doc.data())).catch(() => {});
        });
      });

      unsubCallRef.current = onSnapshot(doc(db, 'calls', callId), snap => {
        if (snap.data()?.status === 'ended') cleanupCall();
      });

      setActiveCallId(callId);
      setCallStatus('connected');
      setIncomingCallId(null);
      startCallTimer();
    } catch (e) {
      cleanupCall();
      if (typeof window !== 'undefined') window.alert('通話に失敗しました。マイクのアクセスを確認してください。');
    }
  };

  // ─── 拒否 ───
  const rejectCall = async () => {
    if (!incomingCallId) return;
    stopRingtone();
    clearTimeout(missedTimerRef.current);
    await updateDoc(doc(db, 'calls', incomingCallId), { status: 'rejected' }).catch(() => {});
    cleanupCall();
  };

  // ─── 通話終了 ───
  const endCall = async () => {
    if (activeCallId) await setDoc(doc(db, 'calls', activeCallId), { status: 'ended' }, { merge: true }).catch(() => {});
    cleanupCall();
  };

  useEffect(() => () => cleanupCall(), []);

  // ─── 全画面 通話 UI ───
  return (
    <CallContext.Provider value={{ callStatus, startCall, endCall }}>
      {children}
      <Modal visible={callStatus !== 'idle'} transparent={false} animationType="slide" onRequestClose={() => {}}>
        <View style={styles.screen}>
          <Text style={styles.statusTag}>
            {callStatus === 'receiving' ? '着信' : callStatus === 'calling' ? '発信中' : '通話中'}
          </Text>

          <View style={styles.avatarWrap}>
            <View style={[styles.avatar, callStatus === 'connected' && styles.avatarConnected]}>
              <Text style={styles.avatarInitial}>{(remotePartyName || '?')[0]}</Text>
            </View>
          </View>

          <Text style={styles.partyName}>{remotePartyName}</Text>
          <Text style={styles.statusSub}>
            {callStatus === 'receiving' ? '着信中...'
              : callStatus === 'calling' ? '呼び出し中...'
              : fmtDuration(callDuration)}
          </Text>

          <View style={styles.btnRow}>
            {callStatus === 'receiving' ? (
              <>
                <View style={styles.btnItem}>
                  <TouchableOpacity style={[styles.circleBtn, styles.rejectBtn]} onPress={rejectCall}>
                    <Ionicons name="call" size={34} color="#fff" style={{ transform: [{ rotate: '135deg' }] }} />
                  </TouchableOpacity>
                  <Text style={styles.btnLabel}>拒否</Text>
                </View>
                <View style={styles.btnItem}>
                  <TouchableOpacity style={[styles.circleBtn, styles.acceptBtn]} onPress={acceptCall}>
                    <Ionicons name="call" size={34} color="#fff" />
                  </TouchableOpacity>
                  <Text style={styles.btnLabel}>応答</Text>
                </View>
              </>
            ) : (
              <View style={styles.btnItem}>
                <TouchableOpacity style={[styles.circleBtn, styles.hangupBtn]} onPress={endCall}>
                  <Ionicons name="call" size={34} color="#fff" style={{ transform: [{ rotate: '135deg' }] }} />
                </TouchableOpacity>
                <Text style={styles.btnLabel}>終了</Text>
              </View>
            )}
          </View>
        </View>
      </Modal>
    </CallContext.Provider>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1, backgroundColor: '#16213E',
    alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 90, paddingBottom: 90, paddingHorizontal: 40,
  },
  statusTag: { fontSize: 13, color: 'rgba(255,255,255,0.45)', letterSpacing: 3 },
  avatarWrap: { alignItems: 'center' },
  avatar: {
    width: 120, height: 120, borderRadius: 60,
    backgroundColor: '#4a90d9', justifyContent: 'center', alignItems: 'center',
    shadowColor: '#4a90d9', shadowOpacity: 0.7, shadowRadius: 24, elevation: 12,
  },
  avatarConnected: { backgroundColor: '#4CAF50', shadowColor: '#4CAF50' },
  avatarInitial: { fontSize: 52, color: '#fff', fontWeight: 'bold' },
  partyName: { fontSize: 30, fontWeight: 'bold', color: '#fff', textAlign: 'center' },
  statusSub: { fontSize: 17, color: 'rgba(255,255,255,0.5)', marginTop: 4 },
  btnRow: { flexDirection: 'row', gap: 64, justifyContent: 'center' },
  btnItem: { alignItems: 'center', gap: 10 },
  circleBtn: { width: 78, height: 78, borderRadius: 39, justifyContent: 'center', alignItems: 'center' },
  acceptBtn: { backgroundColor: '#4CAF50' },
  rejectBtn: { backgroundColor: '#E53935' },
  hangupBtn: { backgroundColor: '#E53935' },
  btnLabel: { color: 'rgba(255,255,255,0.75)', fontSize: 14 },
});