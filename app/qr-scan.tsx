import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { addDoc, collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
import * as Crypto from 'crypto-js';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { COLORS } from '../constants/theme';
import { db } from '../firebase';
import { sendPushNotification } from '../utils/sendPushNotification';
import { navigateHome } from '../utils/navigationHome';

// メニュー画面のヘッダーと同じベースカラー
const THEME_COLOR = '#00C0C7';
const PIN_LENGTH = 4;
const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];

type PinMode = 'setup' | 'confirm' | 'verify';

type ExpectedChild = {
  id: string;
  parentAccountId: string;
  name: string;
  school: string;
  grade: string;
  usageType: string;
  days: Record<string, boolean>;
  isStaffChild?: boolean;
  parentName?: string;
};

const getDateStr = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const hashPin = (pin: string) => Crypto.SHA256(pin).toString();

// 入室用QRコード読み取り画面 および 記録後のランディングページ
export default function QrScanScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [status, setStatus] = useState<'scanning' | 'loading' | 'success' | 'error'>('loading');
  const [childName, setChildName] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [time, setTime] = useState('');
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminName, setAdminName] = useState('管理者');
  const [pinModalVisible, setPinModalVisible] = useState(false);
  const [pinMode, setPinMode] = useState<PinMode>('verify');
  const [pinValue, setPinValue] = useState('');
  const [firstPin, setFirstPin] = useState('');
  const [savedPinHash, setSavedPinHash] = useState('');
  const [pinError, setPinError] = useState('');
  const [pinAuthorized, setPinAuthorized] = useState(false);
  const [expectedChildren, setExpectedChildren] = useState<ExpectedChild[]>([]);
  const [arrivedIds, setArrivedIds] = useState<Set<string>>(new Set());
  const [childrenLoading, setChildrenLoading] = useState(false);
  const [markingChildId, setMarkingChildId] = useState('');
  const [pinNotice, setPinNotice] = useState('');
  
  // カメラの向きを管理するステート（初期値は外カメラ）
  const [facing, setFacing] = useState<'back' | 'front'>('back');

  const goHome = () => navigateHome(router);

  useEffect(() => {
    AsyncStorage.getItem('loggedInUser').then(raw => {
      if (!raw) return;
      try {
        const user = JSON.parse(raw);
        setIsAdmin(user.role === 'admin');
        setAdminName(user.name || '管理者');
      } catch {}
    });
  }, []);

  useEffect(() => {
    if (id) {
      // パラメータにスラッシュ等が含まれているとクラッシュするためサニタイズ（安全化）
      const cleanId = typeof id === 'string' ? id.replace(/[^a-zA-Z0-9_-]/g, '') : '';
      processEntry(cleanId);
    } else {
      setStatus('scanning');
    }
  }, [id]);

  const processEntry = async (scannedData: string) => {
    if (!scannedData) {
      setErrorMsg('QRコードからデータを読み取れませんでした。');
      setStatus('error');
      return;
    }

    setStatus('loading');
    try {
      let accountData = null;
      let finalAccountId = scannedData;

      // 1. まず「qrToken」として検索（一括更新で発行された新しいQRコード用）
      try {
        const q = query(collection(db, 'accounts'), where('qrToken', '==', scannedData));
        const tokenSnap = await getDocs(q);
        if (!tokenSnap.empty) {
          accountData = tokenSnap.docs[0].data();
          finalAccountId = tokenSnap.docs[0].id;
        }
      } catch (tokenErr) {
        console.warn("qrToken検索エラー:", tokenErr);
      }

      // 2. 見つからなければ従来のドキュメントIDとして検索（移行前の古いQRコードを読んだ場合の措置）
      // ※ここで不正な文字列が渡されるとエラーで落ちるため、独立したtry-catchで保護します
      if (!accountData) {
        try {
          const accountSnap = await getDoc(doc(db, 'accounts', scannedData));
          if (accountSnap.exists()) {
            accountData = accountSnap.data();
            finalAccountId = accountSnap.id;
          }
        } catch (docErr) {
          console.warn("docID検索エラー:", docErr);
        }
      }

      // どちらでも見つからなかった場合
      if (!accountData) {
        setErrorMsg(`アカウントが見つかりません。無効なQRコードです。\n\n【読み取ったデータ】\n${scannedData}`);
        setStatus('error');
        return;
      }

      const name = accountData.name || '不明';
      setChildName(name);

      const now = new Date();
      const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
      setTime(timeStr);
      const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

      // 2. 登所ログをFirestoreに記録 (参照キーには実際のドキュメントIDを使用)
      await addDoc(collection(db, 'entry_logs'), {
        accountId: finalAccountId,
        name,
        school: accountData.school || '',
        grade: accountData.grade || '',
        scannedAt: serverTimestamp(),
        scannedAtISO: now.toISOString(),
        dateStr,
      });

      // 3. 保護者（このアカウント）に通知を送る
      try {
        await sendPushNotification({
          accountIds: [finalAccountId],
          title: '🏫 入室のお知らせ',
          body: `${name}さんが ${timeStr} に学童に入室しました。`,
          url: '/menu',
        });
      } catch (notifError) {
        console.warn('通知送信エラー:', notifError);
      }

      setStatus('success');
    } catch (err: any) {
      console.error(err);
      // 万が一別のエラーが出ても、原因が画面に表示されるように修正
      setErrorMsg(`処理中に予期せぬエラーが発生しました。\n\n【読み取ったデータ】\n${scannedData}\n\n【エラー内容】\n${err?.message || ''}`);
      setStatus('error');
    }
  };

  const handleBarCodeScanned = ({ type, data }: { type: string; data: string }) => {
    if (scanned) return;
    setScanned(true);
    
    let extractedId = data;
    
    // URL形式が含まれている場合、確実に「?id=」の後ろを文字列カットして抽出
    if (data.includes('?id=')) {
      extractedId = data.split('?id=')[1].split('&')[0];
    }
    
    // URLエンコードされている場合に戻す (例: %20 など)
    try {
      extractedId = decodeURIComponent(extractedId);
    } catch (e) {}
    
    // データベースがクラッシュするのを完全に防ぐため、英数字とハイフン、アンダースコア以外を除去
    extractedId = extractedId.replace(/[^a-zA-Z0-9_-]/g, '');

    processEntry(extractedId);
  };

  // 内カメラ・外カメラの切り替え処理
  const toggleCameraFacing = () => {
    setFacing(current => (current === 'back' ? 'front' : 'back'));
  };

  const closePinModal = () => {
    setPinModalVisible(false);
    setPinAuthorized(false);
    setPinValue('');
    setFirstPin('');
    setPinError('');
    setPinNotice('');
  };

  const openPinFallback = async () => {
    if (!isAdmin) return;
    setPinModalVisible(true);
    setPinAuthorized(false);
    setPinValue('');
    setFirstPin('');
    setPinError('');
    setPinNotice('');
    try {
      const pinSnap = await getDoc(doc(db, 'settings', 'qr_fallback_pin'));
      const pinHash = pinSnap.exists() ? String(pinSnap.data().pinHash || '') : '';
      setSavedPinHash(pinHash);
      setPinMode(pinHash ? 'verify' : 'setup');
    } catch (error) {
      console.error('PIN設定の取得エラー:', error);
      setPinError('PIN設定を確認できませんでした。通信状況を確認してください。');
    }
  };

  const loadExpectedChildren = async () => {
    setChildrenLoading(true);
    setPinNotice('');
    try {
      const today = new Date();
      const dateStr = getDateStr(today);
      const dayName = DAY_NAMES[today.getDay()];
      const [accountsSnap, schedulesSnap, lessonsSnap, entriesSnap, holidaysSnap, schoolTimesSnap, shiftSnap] = await Promise.all([
        getDocs(collection(db, 'accounts')),
        getDocs(query(collection(db, 'schedules2'), where('dateStr', '==', dateStr))),
        getDocs(query(collection(db, 'lessons'), where('dayOfWeek', '==', dayName))),
        getDocs(query(collection(db, 'entry_logs'), where('dateStr', '==', dateStr))),
        getDoc(doc(db, 'settings', 'holidays_data')),
        getDocs(collection(db, 'school_times')),
        getDoc(doc(db, 'assigned_shifts', dateStr)),
      ]);
      let isPublicHoliday = false;
      try {
        const response = await fetch('https://holidays-jp.github.io/api/v1/date.json');
        const publicHolidays = await response.json();
        isPublicHoliday = Boolean(publicHolidays?.[dateStr]);
      } catch {
        // 祝日APIが利用できない場合も、個別登録された予定は下の判定で表示する。
      }

      const schedules = new Map<string, any>();
      schedulesSnap.forEach(item => schedules.set(String(item.data().childId || ''), item.data()));
      const lessonChildIds = new Set(lessonsSnap.docs.map(item => String(item.data().childId || '')));
      const schoolTimes: Record<string, any> = {};
      schoolTimesSnap.forEach(item => { schoolTimes[item.id] = item.data(); });
      const periods = holidaysSnap.exists() && Array.isArray(holidaysSnap.data().periods) ? holidaysSnap.data().periods : [];
      const isLongHoliday = periods.some((period: any) => dateStr >= period.start && dateStr <= period.end);
      const isWeekday = today.getDay() !== 0 && today.getDay() !== 6;
      const workingStaff = new Set(
        shiftSnap.exists() && Array.isArray(shiftSnap.data().staff)
          ? shiftSnap.data().staff.map((staff: any) => String(staff.name || ''))
          : []
      );

      const children: ExpectedChild[] = [];
      accountsSnap.forEach(accountSnap => {
        const data = accountSnap.data();
        const parentAccountId = accountSnap.id;
        if (data.role === 'user') {
          if (data.school) {
            children.push({
              id: parentAccountId,
              parentAccountId,
              name: data.name || '名前未設定',
              school: data.school || '',
              grade: data.grade || '',
              usageType: data.usageType || '定期利用',
              days: data.days || {},
            });
          }
          if (Array.isArray(data.siblings)) {
            data.siblings.forEach((sibling: any, index: number) => {
              if (!sibling.school) return;
              children.push({
                id: sibling.id || `${parentAccountId}_sib_${index}`,
                parentAccountId,
                name: sibling.name || '名前未設定',
                school: sibling.school || '',
                grade: sibling.grade || '',
                usageType: sibling.usageType || '定期利用',
                days: sibling.days || {},
              });
            });
          }
        } else if (data.role === 'staff' && data.hasChild) {
          const staffChildren = Array.isArray(data.staffChildren) && data.staffChildren.length
            ? data.staffChildren
            : data.childName
              ? [{ name: data.childName, school: data.childSchool, grade: data.childGrade, id: 'staffchild_0' }]
              : [];
          staffChildren.forEach((child: any, index: number) => children.push({
            id: `${parentAccountId}_${child.id || `staffchild_${index}`}`,
            parentAccountId,
            name: child.name || '名前未設定',
            school: child.school || '',
            grade: child.grade || '',
            usageType: '定期利用',
            days: { 月: true, 火: true, 水: true, 木: true, 金: true },
            isStaffChild: true,
            parentName: data.name || '',
          }));
        }
      });

      const expected = children.filter(child => {
        const override = schedules.get(child.id);
        const hasOverrideLessons = Boolean(
          override?.lesson
          || (Array.isArray(override?.lessons) && override.lessons.length > 0)
        );
        if (override && override.pickupTime !== undefined) {
          return Boolean(override.pickupTime || hasOverrideLessons);
        }
        if (hasOverrideLessons || lessonChildIds.has(child.id)) return true;
        if (!isWeekday || isLongHoliday || isPublicHoliday) return false;
        if (child.isStaffChild) {
          return workingStaff.has(child.parentName || '') && Boolean(schoolTimes[child.school]?.[child.grade]?.[dayName]);
        }
        if (override && child.usageType !== '定期利用') {
          return Boolean(schoolTimes[child.school]?.[child.grade]?.[dayName]);
        }
        return child.usageType === '定期利用'
          && Boolean(child.days?.[dayName])
          && Boolean(schoolTimes[child.school]?.[child.grade]?.[dayName]);
      });

      const gradeNumber = (grade: string) => Number(String(grade).match(/\d+/)?.[0] || 99);
      expected.sort((a, b) =>
        a.school.localeCompare(b.school, 'ja')
        || gradeNumber(a.grade) - gradeNumber(b.grade)
        || a.name.localeCompare(b.name, 'ja')
      );

      const arrived = new Set<string>();
      entriesSnap.forEach(item => arrived.add(String(item.data().accountId || '')));
      setExpectedChildren(expected);
      setArrivedIds(arrived);
    } catch (error) {
      console.error('本日の予定取得エラー:', error);
      setPinNotice('本日の予定を取得できませんでした。もう一度お試しください。');
    } finally {
      setChildrenLoading(false);
    }
  };

  const authorizePin = async () => {
    if (pinValue.length !== PIN_LENGTH) {
      setPinError(`${PIN_LENGTH}桁のPINを入力してください。`);
      return;
    }
    setPinError('');

    if (pinMode === 'setup') {
      setFirstPin(pinValue);
      setPinValue('');
      setPinMode('confirm');
      return;
    }

    if (pinMode === 'confirm') {
      if (pinValue !== firstPin) {
        setPinError('PINが一致しません。最初から設定してください。');
        setFirstPin('');
        setPinValue('');
        setPinMode('setup');
        return;
      }
      const pinHash = hashPin(pinValue);
      try {
        await setDoc(doc(db, 'settings', 'qr_fallback_pin'), {
          pinHash,
          updatedAt: serverTimestamp(),
          updatedBy: adminName,
        }, { merge: true });
        setSavedPinHash(pinHash);
      } catch (error) {
        console.error('PIN設定の保存エラー:', error);
        setPinError('PINを保存できませんでした。');
        return;
      }
    } else if (hashPin(pinValue) !== savedPinHash) {
      setPinError('PINが違います。');
      setPinValue('');
      return;
    }

    setPinValue('');
    setPinAuthorized(true);
    await loadExpectedChildren();
  };

  const handlePinKey = (key: string) => {
    setPinError('');
    if (key === 'clear') {
      setPinValue('');
      return;
    }
    if (key === 'backspace') {
      setPinValue(current => current.slice(0, -1));
      return;
    }
    setPinValue(current => current.length < PIN_LENGTH ? `${current}${key}` : current);
  };

  const markChildAsArrived = async (child: ExpectedChild) => {
    if (markingChildId || arrivedIds.has(child.id)) return;
    setMarkingChildId(child.id);
    setPinNotice('');
    try {
      const now = new Date();
      const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      await addDoc(collection(db, 'entry_logs'), {
        accountId: child.id,
        parentAccountId: child.parentAccountId,
        name: child.name,
        school: child.school,
        grade: child.grade,
        entryMethod: 'admin_pin',
        enteredBy: adminName,
        scannedAt: serverTimestamp(),
        scannedAtISO: now.toISOString(),
        dateStr: getDateStr(now),
      });
      try {
        await sendPushNotification({
          accountIds: [child.parentAccountId],
          title: '🏫 入室のお知らせ',
          body: `${child.name}さんが ${timeStr} に学童に入室しました。`,
          url: '/menu',
        });
      } catch (notificationError) {
        console.warn('通知送信エラー:', notificationError);
      }
      setArrivedIds(current => new Set([...current, child.id]));
      setPinNotice(`${child.name}さんを登所済みにしました。`);
    } catch (error) {
      console.error('PIN登所記録エラー:', error);
      setPinNotice('登所を記録できませんでした。もう一度お試しください。');
    } finally {
      setMarkingChildId('');
    }
  };

  const pinModal = (
    <Modal visible={pinModalVisible} transparent animationType="fade" onRequestClose={closePinModal}>
      <Pressable style={styles.pinOverlay} onPress={closePinModal}>
        <Pressable style={styles.pinModalCard} onPress={event => event.stopPropagation()}>
          <View style={styles.pinModalHeader}>
            <View>
              <Text style={styles.pinModalTitle}>{pinAuthorized ? '本日の登所予定' : 'PINコード'}</Text>
              {!pinAuthorized && (
                <Text style={styles.pinModalSubtitle}>
                  {pinMode === 'setup' ? 'はじめに4桁のPINを設定します' : pinMode === 'confirm' ? '確認のため、もう一度入力してください' : '管理者用PINを入力してください'}
                </Text>
              )}
            </View>
            <TouchableOpacity style={styles.pinCloseButton} onPress={closePinModal} activeOpacity={0.75}>
              <Ionicons name="close" size={28} color="#493A35" />
            </TouchableOpacity>
          </View>

          {!pinAuthorized ? (
            <View style={styles.pinEntryContent}>
              <View style={styles.pinDotsRow}>
                {Array.from({ length: PIN_LENGTH }).map((_, index) => (
                  <View key={index} style={[styles.pinDot, index < pinValue.length && styles.pinDotFilled]} />
                ))}
              </View>
              {!!pinError && <Text style={styles.pinErrorText}>{pinError}</Text>}
              <View style={styles.pinKeypad}>
                {['1','2','3','4','5','6','7','8','9','clear','0','backspace'].map(key => (
                  <TouchableOpacity
                    key={key}
                    style={[styles.pinKey, key === 'clear' && styles.pinKeySubtle]}
                    onPress={() => handlePinKey(key)}
                    activeOpacity={0.68}
                  >
                    {key === 'backspace' ? (
                      <Ionicons name="backspace-outline" size={27} color="#493A35" />
                    ) : (
                      <Text style={[styles.pinKeyText, key === 'clear' && styles.pinKeyClearText]}>{key === 'clear' ? 'クリア' : key}</Text>
                    )}
                  </TouchableOpacity>
                ))}
              </View>
              <TouchableOpacity
                style={[styles.pinConfirmButton, pinValue.length !== PIN_LENGTH && styles.pinConfirmButtonDisabled]}
                onPress={authorizePin}
                disabled={pinValue.length !== PIN_LENGTH}
                activeOpacity={0.75}
              >
                <Text style={styles.pinConfirmButtonText}>{pinMode === 'setup' ? '次へ' : pinMode === 'confirm' ? 'PINを設定' : '確認する'}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.childrenContent}>
              <Text style={styles.childrenHelp}>QRを忘れたお子さんを選んでください</Text>
              {!!pinNotice && <Text style={styles.pinNotice}>{pinNotice}</Text>}
              {childrenLoading ? (
                <View style={styles.childrenLoading}><ActivityIndicator size="large" color={THEME_COLOR} /></View>
              ) : (
                <ScrollView style={styles.childrenList} contentContainerStyle={styles.childrenListContent}>
                  {expectedChildren.length === 0 ? (
                    <Text style={styles.emptyChildrenText}>本日の登所予定はありません</Text>
                  ) : expectedChildren.map(child => {
                    const arrived = arrivedIds.has(child.id);
                    const marking = markingChildId === child.id;
                    return (
                      <TouchableOpacity
                        key={child.id}
                        style={[styles.childRow, arrived && styles.childRowArrived]}
                        onPress={() => markChildAsArrived(child)}
                        disabled={arrived || Boolean(markingChildId)}
                        activeOpacity={0.72}
                      >
                        <View style={styles.childInfo}>
                          <Text style={styles.childName}>{child.name}</Text>
                          <Text style={styles.childMeta}>{[child.school, child.grade].filter(Boolean).join('　')}</Text>
                        </View>
                        {marking ? (
                          <ActivityIndicator color={THEME_COLOR} />
                        ) : (
                          <View style={[styles.arrivalBadge, arrived && styles.arrivalBadgeDone]}>
                            <Ionicons name={arrived ? 'checkmark-circle' : 'log-in-outline'} size={18} color={arrived ? '#287A4D' : '#007E84'} />
                            <Text style={[styles.arrivalBadgeText, arrived && styles.arrivalBadgeTextDone]}>{arrived ? '登所済み' : '登所にする'}</Text>
                          </View>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              )}
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );

  if (status === 'scanning') {
    if (!permission) {
      return <View style={styles.centerContainer}><ActivityIndicator size="large" color={THEME_COLOR} /></View>;
    }
    if (!permission.granted) {
      return (
        <SafeAreaView style={styles.centerContainer}>
          <View style={styles.simpleHeader}>
            <TouchableOpacity style={styles.headerBackBtn} onPress={goHome} activeOpacity={0.78}>
              <Ionicons name="chevron-back" size={24} color="#5D4037" />
            </TouchableOpacity>
            <Text style={styles.simpleHeaderTitle}>入室QRリーダー</Text>
            {isAdmin && (
              <TouchableOpacity style={styles.permissionPinButton} onPress={openPinFallback} activeOpacity={0.75}>
                <Text style={styles.pinHeaderButtonText}>手動入力</Text>
              </TouchableOpacity>
            )}
          </View>
          <Text style={{textAlign: 'center', marginBottom: 20}}>カメラの許可が必要です</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={requestPermission}>
            <Text style={styles.retryBtnText}>許可する</Text>
          </TouchableOpacity>
          {pinModal}
        </SafeAreaView>
      );
    }
    return (
      <SafeAreaView style={{flex: 1, backgroundColor: '#000'}}>
        <CameraView
          style={StyleSheet.absoluteFillObject}
          facing={facing}
          onBarcodeScanned={scanned || pinModalVisible ? undefined : handleBarCodeScanned}
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        />
        <View style={styles.scanHeader}>
          <TouchableOpacity style={styles.scanHeaderBackBtn} onPress={goHome} activeOpacity={0.78}>
            <Ionicons name="chevron-back" size={26} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={styles.scanHeaderTitle}>入室QRリーダー</Text>
          {isAdmin && (
            <TouchableOpacity style={styles.pinHeaderButton} onPress={openPinFallback} activeOpacity={0.75}>
              <Text style={styles.pinHeaderButtonText}>手動入力</Text>
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity style={styles.flipBtn} onPress={toggleCameraFacing} activeOpacity={0.78}>
          <Ionicons name="camera-reverse" size={32} color="#FFFFFF" />
        </TouchableOpacity>
        {pinModal}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.headerBg}>
        <TouchableOpacity style={styles.resultHeaderBackBtn} onPress={goHome} activeOpacity={0.78}>
          <Ionicons name="chevron-back" size={24} color="#3F302B" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>ケーニーズクラブ学童保育</Text>
      </View>

      <View style={styles.card}>
        {status === 'loading' && (
          <View style={styles.stateBox}>
            <ActivityIndicator size="large" color={THEME_COLOR} />
            <Text style={styles.loadingText}>読み取り中...</Text>
          </View>
        )}

        {status === 'success' && (
          <View style={styles.stateBox}>
            <View style={styles.iconCircle}>
              <Ionicons name="checkmark-done" size={56} color={THEME_COLOR} />
            </View>
            <Text style={styles.successTitle}>入室の記録 完了</Text>
            <View style={styles.nameBox}>
              <Text style={styles.nameLabel}>お子様のお名前</Text>
              <Text style={styles.nameText}>{childName}</Text>
              <Text style={styles.timeText}>{time} 入室</Text>
            </View>
            <Text style={styles.successMsg}>
              保護者の方に入室通知を送りました。{'\n'}今日も1日よろしくね！
            </Text>
            <View style={styles.divider} />
            <Text style={styles.footerNote}>このページは閉じて構いません。</Text>
            {!id && (
              <TouchableOpacity style={[styles.retryBtn, {marginTop: 20}]} onPress={() => { setScanned(false); setStatus('scanning'); }}>
                <Text style={styles.retryBtnText}>次の人を記録する</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {status === 'error' && (
          <View style={styles.stateBox}>
            <View style={[styles.iconCircle, styles.iconError]}>
              <Ionicons name="alert-circle" size={56} color={COLORS.danger} />
            </View>
            <Text style={styles.errorTitle}>エラーが発生しました</Text>
            <Text style={styles.errorMsg}>{errorMsg}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={() => { setScanned(false); setStatus('scanning'); }}>
              <Text style={styles.retryBtnText}>もう一度やり直す</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.retryBtn, {marginTop: 10, backgroundColor: '#ccc'}]} onPress={() => router.push('/menu')}>
              <Text style={styles.retryBtnText}>トップへ戻る</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F9FA',
  },
  centerContainer: {
    flex: 1,
    backgroundColor: '#F8F9FA',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  simpleHeader: {
    position: 'absolute',
    top: Platform.OS === 'android' ? 24 : 8,
    left: 0,
    right: 0,
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    backgroundColor: '#FFF8F0',
  },
  headerBackBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
  },
  simpleHeaderTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: 'bold',
    color: '#5D4037',
  },
  permissionPinButton: {
    minHeight: 38,
    paddingHorizontal: 12,
    borderRadius: 19,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: THEME_COLOR,
  },
  scanHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingTop: Platform.OS === 'android' ? 28 : 10,
    minHeight: Platform.OS === 'android' ? 82 : 64,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.48)',
    zIndex: 20,
  },
  scanHeaderBackBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
  },
  scanHeaderTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  pinHeaderButton: {
    minHeight: 40,
    paddingHorizontal: 13,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: 'rgba(0, 192, 199, 0.88)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.72)',
  },
  pinHeaderButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: 'bold',
  },
  headerBg: {
    backgroundColor: '#FFF8F0',
    paddingTop: Platform.OS === 'android' ? 40 : 20,
    paddingBottom: 60,
    paddingHorizontal: 20,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  resultHeaderBackBtn: {
    position: 'absolute',
    left: 14,
    top: Platform.OS === 'android' ? 34 : 14,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#3F302B',
    letterSpacing: 1,
  },
  card: {
    width: '90%',
    maxWidth: 400,
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 20,
    elevation: 8,
    alignSelf: 'center',
    marginTop: -30,
    marginBottom: 20,
  },
  stateBox: {
    padding: 32,
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: COLORS.textLight,
  },
  iconCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#FAFAFA',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    borderWidth: 3,
    borderColor: THEME_COLOR,
  },
  iconError: {
    backgroundColor: '#FFF0F0',
    borderColor: COLORS.danger,
  },
  successTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 20,
  },
  nameBox: {
    width: '100%',
    backgroundColor: '#FAFAFA',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    marginBottom: 20,
    borderWidth: 2,
    borderColor: THEME_COLOR,
  },
  nameLabel: {
    fontSize: 13,
    color: COLORS.textLight,
    marginBottom: 6,
    fontWeight: 'bold',
  },
  nameText: {
    fontSize: 28,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 6,
  },
  timeText: {
    fontSize: 16,
    color: THEME_COLOR,
    fontWeight: 'bold',
  },
  successMsg: {
    fontSize: 13,
    color: COLORS.textLight,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 20,
  },
  divider: {
    width: '100%',
    height: 1,
    backgroundColor: COLORS.border,
    marginBottom: 16,
  },
  footerNote: {
    fontSize: 13,
    color: COLORS.textLight,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.danger,
    marginBottom: 12,
  },
  errorMsg: {
    fontSize: 14,
    color: COLORS.textLight,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  retryBtn: {
    backgroundColor: THEME_COLOR,
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 12,
    width: '100%',
    alignItems: 'center',
  },
  retryBtnText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 16,
  },
  backBtn: {
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.48)',
  },
  backBtnText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  flipBtn: {
    position: 'absolute',
    right: 20,
    bottom: 28,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  pinOverlay: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 24,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(25, 20, 18, 0.62)',
  },
  pinModalCard: {
    width: '100%',
    maxWidth: 430,
    maxHeight: '92%',
    borderRadius: 20,
    backgroundColor: '#FFFDF9',
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOpacity: 0.2,
    shadowRadius: 18,
    elevation: 12,
  },
  pinModalHeader: {
    minHeight: 76,
    paddingLeft: 20,
    paddingRight: 12,
    paddingVertical: 13,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#EDE5DC',
    backgroundColor: '#FFF8F0',
  },
  pinModalTitle: {
    color: '#332824',
    fontSize: 20,
    fontWeight: 'bold',
  },
  pinModalSubtitle: {
    marginTop: 4,
    color: '#756761',
    fontSize: 12,
  },
  pinCloseButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5D8CC',
  },
  pinEntryContent: {
    paddingHorizontal: 24,
    paddingTop: 22,
    paddingBottom: 24,
  },
  pinDotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
    minHeight: 34,
    marginBottom: 8,
  },
  pinDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#A89B95',
    backgroundColor: '#FFFFFF',
  },
  pinDotFilled: {
    borderColor: THEME_COLOR,
    backgroundColor: THEME_COLOR,
  },
  pinErrorText: {
    minHeight: 20,
    marginBottom: 5,
    color: '#C63C3C',
    textAlign: 'center',
    fontSize: 13,
    fontWeight: 'bold',
  },
  pinKeypad: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 330,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  pinKey: {
    width: '30%',
    height: 56,
    marginBottom: 10,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DDD4CD',
    shadowColor: '#493A35',
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 1,
  },
  pinKeySubtle: {
    backgroundColor: '#F4EFEB',
  },
  pinKeyText: {
    color: '#332824',
    fontSize: 23,
    fontWeight: 'bold',
  },
  pinKeyClearText: {
    color: '#746762',
    fontSize: 12,
  },
  pinConfirmButton: {
    minHeight: 52,
    marginTop: 5,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: THEME_COLOR,
  },
  pinConfirmButtonDisabled: {
    backgroundColor: '#B8DADC',
  },
  pinConfirmButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  childrenContent: {
    minHeight: 260,
    maxHeight: 590,
    paddingTop: 14,
  },
  childrenHelp: {
    paddingHorizontal: 18,
    color: '#635651',
    fontSize: 13,
    fontWeight: 'bold',
  },
  pinNotice: {
    marginHorizontal: 18,
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    color: '#246A46',
    backgroundColor: '#E9F7EF',
    fontSize: 13,
    fontWeight: 'bold',
  },
  childrenLoading: {
    minHeight: 230,
    alignItems: 'center',
    justifyContent: 'center',
  },
  childrenList: {
    marginTop: 10,
  },
  childrenListContent: {
    paddingHorizontal: 14,
    paddingBottom: 18,
    gap: 8,
  },
  emptyChildrenText: {
    paddingVertical: 70,
    color: '#756A65',
    textAlign: 'center',
    fontSize: 15,
    fontWeight: 'bold',
  },
  childRow: {
    minHeight: 66,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E4DDD7',
  },
  childRowArrived: {
    backgroundColor: '#F0F8F2',
    borderColor: '#A8D2B5',
  },
  childInfo: {
    flex: 1,
  },
  childName: {
    color: '#2F2825',
    fontSize: 16,
    fontWeight: 'bold',
  },
  childMeta: {
    marginTop: 3,
    color: '#766B66',
    fontSize: 12,
  },
  arrivalBadge: {
    minWidth: 94,
    minHeight: 38,
    paddingHorizontal: 10,
    borderRadius: 19,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: '#E5F8F8',
  },
  arrivalBadgeDone: {
    backgroundColor: '#DCEFE2',
  },
  arrivalBadgeText: {
    color: '#007E84',
    fontSize: 12,
    fontWeight: 'bold',
  },
  arrivalBadgeTextDone: {
    color: '#287A4D',
  },
});
