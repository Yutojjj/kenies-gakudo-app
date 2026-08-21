import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { addDoc, collection, doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, SafeAreaView, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import AdminBottomNav from '../../components/AdminBottomNav';
import EditablePickerModal from '../../components/EditablePickerModal';
import { COLORS } from '../../constants/theme';
import { db } from '../../firebase';
import { useRequireRole } from '../../hooks/useRequireRole';
import { navigateHome } from '../../utils/navigationHome';

const WEEK_DAYS = ['月', '火', '水', '木', '金'] as const;
type DayType = typeof WEEK_DAYS[number];

const kanaToRomaji = (kana: string): string => {
  const romanMap: Record<string, string> = {
    'あ': 'a', 'い': 'i', 'う': 'u', 'え': 'e', 'お': 'o', 'か': 'ka', 'き': 'ki', 'く': 'ku', 'け': 'ke', 'こ': 'ko',
    'さ': 'sa', 'し': 'shi', 'す': 'su', 'せ': 'se', 'そ': 'so', 'た': 'ta', 'ち': 'chi', 'つ': 'tsu', 'て': 'te', 'と': 'to',
    'な': 'na', 'に': 'ni', 'ぬ': 'nu', 'ね': 'ne', 'の': 'no', 'は': 'ha', 'ひ': 'hi', 'ふ': 'fu', 'へ': 'he', 'ほ': 'ho',
    'ま': 'ma', 'み': 'mi', 'む': 'mu', 'め': 'me', 'も': 'mo', 'や': 'ya', 'ゆ': 'yu', 'よ': 'yo',
    'ら': 'ra', 'り': 'ri', 'る': 'ru', 'れ': 're', 'ろ': 'ro', 'わ': 'wa', 'を': 'wo', 'ん': 'n',
    'が': 'ga', 'ぎ': 'gi', 'ぐ': 'gu', 'げ': 'ge', 'ご': 'go', 'ざ': 'za', 'じ': 'ji', 'ず': 'zu', 'ぜ': 'ze', 'ぞ': 'zo',
    'だ': 'da', 'ぢ': 'ji', 'づ': 'zu', 'で': 'de', 'ど': 'do', 'ば': 'ba', 'び': 'bi', 'ぶ': 'bu', 'べ': 'be', 'ぼ': 'bo',
    'ぱ': 'pa', 'ぴ': 'pi', 'ぷ': 'pu', 'ぺ': 'pe', 'ぽ': 'po',
    'きょ': 'kyo', 'きゅ': 'kyu', 'きゃ': 'kya', 'しょ': 'sho', 'しゅ': 'shu', 'しゃ': 'sha', 'ちょ': 'cho', 'ちゅ': 'chu', 'ちゃ': 'cha',
    'にょ': 'nyo', 'にゅ': 'nyu', 'にゃ': 'nya', 'ひょ': 'hyo', 'ひゅ': 'hyu', 'ひゃ': 'hya', 'みょ': 'myo', 'みゅ': 'myu', 'みゃ': 'mya',
    'りょ': 'ryo', 'りゅ': 'ryu', 'りゃ': 'rya',
  };
  let res = '';
  let i = 0;
  while (i < kana.length) {
    const char2 = kana.substring(i, i + 2);
    if (romanMap[char2]) { res += romanMap[char2]; i += 2; } 
    else { const char1 = kana.substring(i, i + 1); res += romanMap[char1] || char1; i += 1; }
  }
  return res.toLowerCase().replace(/[^a-z]/g, '');
};

const generateRandomDigits = () => Math.floor(1000 + Math.random() * 9000).toString();

export default function AccountFormScreen() {
  const { verified, checking } = useRequireRole('admin');

  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const isEditMode = !!id;

  const [initialLoading, setInitialLoading] = useState(isEditMode);
  const [loading, setLoading] = useState(false);

  const [schools, setSchools] = useState(['ケーニーズ小学校', '第一小学校', '第二小学校']);
  const [grades, setGrades] = useState(['小1', '小2', '小3', '小4', '小5', '小6']);
  const [pickerConfig, setPickerConfig] = useState({ visible: false, type: '', targetIndex: -1 });

  const [role, setRole] = useState<'user' | 'staff'>('user');
  const [name, setName] = useState('');
  const [nicknameKana, setNicknameKana] = useState('');
  const [empType, setEmpType] = useState('アルバイト');
  const [skills, setSkills] = useState({ drive: false, program: false, child: false });
  const [showInShiftTable, setShowInShiftTable] = useState(true);
  const [canEditEvents, setCanEditEvents] = useState(false);

  const [staffChildren, setStaffChildren] = useState<any[]>([]);

  const [school, setSchool] = useState('');
  const [grade, setGrade] = useState('');
  const [usageType, setUsageType] = useState('定期利用');
  const [days, setDays] = useState<Record<DayType, boolean>>({ 月: false, 火: false, 水: false, 木: false, 金: false });
  const [pickupTimes, setPickupTimes] = useState<string[]>([]);
  const [newPickupTime, setNewPickupTime] = useState('');
  const [siblings, setSiblings] = useState<any[]>([]);

  useEffect(() => {
    let isMounted = true;

    const fetchWithRetry = async (fetchFunction: () => Promise<void>, retries = 3) => {
      for (let i = 0; i < retries; i++) {
        try {
          await fetchFunction();
          return;
        } catch (error: any) {
          if (error.code === 'unavailable' || error.message.includes('offline')) {
            console.warn(`Firestore offline error. Retrying... (${i + 1}/${retries})`);
            await new Promise(resolve => setTimeout(resolve, 2000));
          } else {
            console.error("Firestore error:", error);
            break;
          }
        }
      }
    };

    const fetchMasterData = async () => {
        const masterRef = doc(db, 'settings', 'master_data');
        const masterSnap = await getDoc(masterRef);
        if (masterSnap.exists() && isMounted) {
          const data = masterSnap.data();
          if (data.schools && data.schools.length > 0) setSchools(data.schools);
          if (data.grades && data.grades.length > 0) setGrades(data.grades);
        } else if (isMounted) {
          await setDoc(masterRef, { schools, grades });
        }
    };

    const fetchAccountData = async () => {
        const docRef = doc(db, 'accounts', id);
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists() && isMounted) {
          const data = docSnap.data();
          setRole(data.role || 'user');
          setName(data.name || '');
          setNicknameKana(data.nicknameKana || '');
          
          if (data.role === 'staff') {
            setEmpType(data.empType || 'アルバイト');
            setSkills(data.skills || { drive: false, program: false, child: false });
            setShowInShiftTable(data.showInShiftTable !== false);
            setCanEditEvents(data.canEditEvents === true);
            
            const loadedStaffChildren = data.staffChildren || [];
            if (loadedStaffChildren.length === 0 && data.childName) {
              // ★ ④ IDの付与
              loadedStaffChildren.push({ id: `${id}_staffchild_0`, name: data.childName, school: data.childSchool, grade: data.childGrade });
            }
            setStaffChildren(loadedStaffChildren);
            
          } else {
            setSchool(data.school || '');
            setGrade(data.grade || '');
            setUsageType(data.usageType || '定期利用');
            setDays(data.days || { 月: false, 火: false, 水: false, 木: false, 金: false });
            setPickupTimes(data.pickupTimes || []);
            
            // ★ ④ 古いデータ（IDなし）にIDを付与して読み込む
            const loadedSiblings = data.siblings || [];
            const sanitizedSiblings = loadedSiblings.map((sib: any, idx: number) => ({
              ...sib,
              id: sib.id || `${id}_sib_${idx}`
            }));
            setSiblings(sanitizedSiblings);
          }
        }
        if (isMounted) setInitialLoading(false);
    };

    fetchWithRetry(fetchMasterData);

    if (isEditMode) {
      fetchWithRetry(fetchAccountData);
    }

    return () => { isMounted = false; };
  }, [id, isEditMode]);

  const updateMasterDataInDB = async (newSchools: string[], newGrades: string[]) => {
    try { await setDoc(doc(db, 'settings', 'master_data'), { schools: newSchools, grades: newGrades }, { merge: true }); } 
    catch (e) { console.error("Master data update error:", e); }
  };

  const handleSave = async () => {
    if (!name || !nicknameKana) return Alert.alert('入力エラー', '氏名とニックネーム(かな)は必須項目です。');
    setLoading(true);

    try {
      const romaji = kanaToRomaji(nicknameKana);
      // 新規作成時はここでドキュメントIDをあらかじめ発行するか、addDoc後に更新する必要がありますが、
      // 兄弟のID生成を完全にするために、保存時のデータにプレースホルダーIDを入れておき、
      // 表示側で「親ID_sib_0」のように生成する運用が最も安全です。

      let accountData: any = {
        name, nicknameKana, updatedAt: serverTimestamp(),
        ...(role === 'staff' ? { 
          empType, skills, showInShiftTable, canEditEvents,
          hasChild: skills.child,
          // ★ ④ 保存時にIDの抜け漏れがないように補完
          staffChildren: skills.child ? staffChildren.map((c, i) => ({...c, id: c.id || `temp_staffchild_${i}`})) : [] 
        } : { 
          school, grade, usageType, days, pickupTimes,
          // ★ ④ 保存時にIDの抜け漏れがないように補完 
          siblings: siblings.map((s, i) => ({...s, id: s.id || `temp_sib_${i}`})) 
        }),
      };

      if (isEditMode) {
        await updateDoc(doc(db, 'accounts', id), accountData);
        Alert.alert('更新完了', 'アカウント情報を更新しました。');
      } else {
        const generatedId = `${romaji}${generateRandomDigits()}`;
        const generatedPw = `${romaji}${generateRandomDigits()}`;
        accountData.role = role; accountData.generatedId = generatedId; accountData.generatedPw = generatedPw; accountData.createdAt = serverTimestamp();
        
        // 新規作成
        const docRef = await addDoc(collection(db, 'accounts'), accountData);
        
        // ★ ④ 新規作成直後に、確定した親のIDを使って兄弟のIDを正しい形式で上書き保存する
        // ★ QRコードURLも同時に生成・保存する
        const appBaseUrl = typeof window !== 'undefined' ? window.location.origin : (process.env.EXPO_PUBLIC_APP_URL || '');
        const qrCodeUrl = `${appBaseUrl}/qr-scan?id=${docRef.id}`;

        if (role === 'staff' && accountData.staffChildren.length > 0) {
           const finalChildren = accountData.staffChildren.map((c:any, i:number) => ({...c, id: `${docRef.id}_staffchild_${i}`}));
           await updateDoc(docRef, { staffChildren: finalChildren, qrCode: qrCodeUrl });
        } else if (role === 'user') {
          const updatePayload: any = { qrCode: qrCodeUrl };
          if (accountData.siblings.length > 0) {
            const finalSiblings = accountData.siblings.map((s:any, i:number) => ({
              ...s,
              id: `${docRef.id}_sib_${i}`,
              qrCode: `${appBaseUrl}/qr-scan?id=${docRef.id}_sib_${i}`,
            }));
            updatePayload.siblings = finalSiblings;
          }
          await updateDoc(docRef, updatePayload);
        } else {
          await updateDoc(docRef, { qrCode: qrCodeUrl });
        }

        Alert.alert('保存完了', `アカウントを保存しました。\nID: ${generatedId}\nPW: ${generatedPw}`);
      }
      router.back();
    } catch (error: any) { Alert.alert('エラー', 'データの保存に失敗しました。'); } 
    finally { setLoading(false); }
  };

  const addSibling = () => setSiblings([...siblings, { id: `temp_sib_${Date.now()}`, name: '', nicknameKana: '', school: '', grade: '', usageType: '定期利用', days: { 月: false, 火: false, 水: false, 木: false, 金: false } }]);
  const updateSibling = (index: number, field: string, value: any) => { const newSiblings = [...siblings]; newSiblings[index][field] = value; setSiblings(newSiblings); };
  const removeSibling = (index: number) => setSiblings(siblings.filter((_, i) => i !== index));

  const addStaffChild = () => setStaffChildren([...staffChildren, { id: `temp_staffchild_${Date.now()}`, name: '', school: '', grade: '' }]);
  const updateStaffChild = (index: number, field: string, value: any) => { const newChildren = [...staffChildren]; newChildren[index][field] = value; setStaffChildren(newChildren); };
  const removeStaffChild = (index: number) => setStaffChildren(staffChildren.filter((_, i) => i !== index));

  const openPicker = (type: string, targetIndex = -1) => setPickerConfig({ visible: true, type, targetIndex });

  const handlePickerSelect = (item: string) => {
    if (pickerConfig.type === 'school') setSchool(item);
    if (pickerConfig.type === 'grade') setGrade(item);
    if (pickerConfig.type === 'sibling_school') updateSibling(pickerConfig.targetIndex, 'school', item);
    if (pickerConfig.type === 'sibling_grade') updateSibling(pickerConfig.targetIndex, 'grade', item);
    if (pickerConfig.type === 'staff_child_school') updateStaffChild(pickerConfig.targetIndex, 'school', item);
    if (pickerConfig.type === 'staff_child_grade') updateStaffChild(pickerConfig.targetIndex, 'grade', item);
    setPickerConfig({ ...pickerConfig, visible: false });
  };

  const handlePickerAdd = (item: string) => {
    if (pickerConfig.type.includes('school')) { const newSchools = [...schools, item]; setSchools(newSchools); updateMasterDataInDB(newSchools, grades); }
    if (pickerConfig.type.includes('grade')) { const newGrades = [...grades, item]; setGrades(newGrades); updateMasterDataInDB(schools, newGrades); }
  };

  const handlePickerDelete = (item: string) => {
    if (pickerConfig.type.includes('school')) { const newSchools = schools.filter(s => s !== item); setSchools(newSchools); updateMasterDataInDB(newSchools, grades); }
    if (pickerConfig.type.includes('grade')) { const newGrades = grades.filter(g => g !== item); setGrades(newGrades); updateMasterDataInDB(schools, newGrades); }
  };

  if (initialLoading) return <SafeAreaView style={[styles.container, styles.center]}><ActivityIndicator size="large" color={COLORS.primary} /></SafeAreaView>;

  if (checking || !verified) return null;
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigateHome(router)}>
          <Ionicons name="chevron-back" size={24} color="#5D4037" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{isEditMode ? 'アカウント編集' : '新規アカウント作成'}</Text>
      </View>
      <ScrollView contentContainerStyle={styles.formContainer}>
        <View style={styles.segmentedControl}>
          <TouchableOpacity style={[styles.segmentBtn, role === 'user' && styles.segmentBtnActive, isEditMode && styles.segmentBtnDisabled]} onPress={() => !isEditMode && setRole('user')} disabled={isEditMode}>
            <Ionicons name="school" size={18} color={role === 'user' ? COLORS.primary : COLORS.textLight} style={styles.segmentIcon} />
            <Text style={[styles.segmentText, role === 'user' && styles.segmentTextActive]}>利用者</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.segmentBtn, role === 'staff' && styles.segmentBtnActive, isEditMode && styles.segmentBtnDisabled]} onPress={() => !isEditMode && setRole('staff')} disabled={isEditMode}>
            <Ionicons name="briefcase" size={18} color={role === 'staff' ? COLORS.primary : COLORS.textLight} style={styles.segmentIcon} />
            <Text style={[styles.segmentText, role === 'staff' && styles.segmentTextActive]}>スタッフ</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.label}><Ionicons name="person-outline" size={16} /> 氏名</Text>
        <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="山田 太郎" placeholderTextColor="#BBBBBB" />
        <Text style={styles.label}><Ionicons name="text-outline" size={16} /> ニックネーム (かな)</Text>
        <TextInput style={styles.input} value={nicknameKana} onChangeText={setNicknameKana} placeholder="けんた" placeholderTextColor="#BBBBBB" autoCapitalize="none" />

        {role === 'staff' ? (
          <View>
            <Text style={styles.label}><Ionicons name="business-outline" size={16} /> 雇用形態</Text>
            <View style={styles.row}>
              {['アルバイト', '社員'].map(type => (
                <TouchableOpacity key={type} style={[styles.radioBtn, empType === type && styles.radioBtnActive]} onPress={() => setEmpType(type)}>
                  <Text style={[styles.radioText, empType === type && styles.radioTextActive]}>{type}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.shiftVisibilityCard}>
              <View style={styles.shiftVisibilityTextWrap}>
                <Text style={styles.shiftVisibilityTitle}>シフト表に表示</Text>
                <Text style={styles.shiftVisibilityDescription}>オフにするとシフト表とPDFに表示されません</Text>
              </View>
              <Switch
                value={showInShiftTable}
                onValueChange={setShowInShiftTable}
                trackColor={{ false: '#D7DCDE', true: '#9AD9D3' }}
                thumbColor={showInShiftTable ? '#158F87' : '#F5F5F5'}
                accessibilityLabel="シフト表に表示"
              />
            </View>

            <View style={styles.eventPermissionCard}>
              <View style={styles.shiftVisibilityTextWrap}>
                <Text style={styles.shiftVisibilityTitle}>イベントを編集</Text>
                <Text style={styles.shiftVisibilityDescription}>年行事・長期休み・イベント管理の編集を許可します</Text>
              </View>
              <Switch
                value={canEditEvents}
                onValueChange={setCanEditEvents}
                trackColor={{ false: '#D7DCDE', true: '#9AD9D3' }}
                thumbColor={canEditEvents ? '#158F87' : '#F5F5F5'}
                accessibilityLabel="イベントを編集"
              />
            </View>

            <Text style={styles.label}><Ionicons name="options-outline" size={16} /> スキル・条件 (タップで選択)</Text>
            <View style={styles.skillsGrid}>
              <TouchableOpacity style={[styles.skillBtn, skills.drive && styles.skillBtnActive]} onPress={() => setSkills({ ...skills, drive: !skills.drive })}>
                <Ionicons name="car-outline" size={24} color={skills.drive ? COLORS.white : COLORS.primary} /><Text style={[styles.skillText, skills.drive && styles.skillTextActive]}>運転可能</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.skillBtn, skills.program && styles.skillBtnActive]} onPress={() => setSkills({ ...skills, program: !skills.program })}>
                <Ionicons name="laptop-outline" size={24} color={skills.program ? COLORS.white : COLORS.primary} /><Text style={[styles.skillText, skills.program && styles.skillTextActive]}>プログラム</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.skillBtn, skills.child && styles.skillBtnActive]} onPress={() => {
                const isChild = !skills.child;
                setSkills({ ...skills, child: isChild });
                if (isChild && staffChildren.length === 0) addStaffChild();
              }}>
                <Ionicons name="happy-outline" size={24} color={skills.child ? COLORS.white : COLORS.primary} /><Text style={[styles.skillText, skills.child && styles.skillTextActive]}>子供利用あり</Text>
              </TouchableOpacity>
            </View>

            {skills.child && (
              <View style={styles.childBox}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}><Ionicons name="people-outline" size={20} /> 子供の利用情報</Text>
                  <TouchableOpacity style={styles.smallAddBtn} onPress={addStaffChild}>
                    <Ionicons name="add" size={16} color={COLORS.white} /><Text style={styles.btnTextWhiteSmall}>子供を追加</Text>
                  </TouchableOpacity>
                </View>
                
                {staffChildren.map((child, index) => (
                  <View key={index} style={styles.siblingCard}>
                    <View style={styles.siblingCardHeader}>
                      <Text style={styles.siblingIndexText}>子供 {index + 1}</Text>
                      {staffChildren.length > 1 && (
                        <TouchableOpacity onPress={() => removeStaffChild(index)} style={styles.deleteSiblingBtn}>
                          <Ionicons name="close" size={16} color={COLORS.danger} /><Text style={styles.deleteText}>削除</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                    <Text style={styles.label}>氏名</Text>
                    <TextInput style={styles.input} value={child.name} onChangeText={(v) => updateStaffChild(index, 'name', v)} placeholder="子供の氏名" placeholderTextColor="#BBBBBB" />
                    <Text style={styles.label}>学校名</Text>
                    <TouchableOpacity style={styles.selectBox} onPress={() => openPicker('staff_child_school', index)}>
                      <Text style={styles.selectBoxText}>{child.school || '選択してください'}</Text>
                      <Ionicons name="chevron-down" size={20} color={COLORS.primary} />
                    </TouchableOpacity>
                    <Text style={styles.label}>学年</Text>
                    <TouchableOpacity style={styles.selectBox} onPress={() => openPicker('staff_child_grade', index)}>
                      <Text style={styles.selectBoxText}>{child.grade || '選択してください'}</Text>
                      <Ionicons name="chevron-down" size={20} color={COLORS.primary} />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
          </View>
        ) : (
          <View>
            <Text style={styles.label}><Ionicons name="business-outline" size={16} /> 学校名</Text>
            <TouchableOpacity style={styles.selectBox} onPress={() => openPicker('school')}>
              <Text style={styles.selectBoxText}>{school || '選択してください'}</Text>
              <Ionicons name="chevron-down" size={20} color={COLORS.primary} />
            </TouchableOpacity>

            <Text style={styles.label}><Ionicons name="book-outline" size={16} /> 学年</Text>
            <TouchableOpacity style={styles.selectBox} onPress={() => openPicker('grade')}>
              <Text style={styles.selectBoxText}>{grade || '選択してください'}</Text>
              <Ionicons name="chevron-down" size={20} color={COLORS.primary} />
            </TouchableOpacity>

            <Text style={styles.label}><Ionicons name="calendar-outline" size={16} /> 利用形態</Text>
            <View style={styles.row}>
              {['定期利用', '回数券', '不定期'].map(type => (
                <TouchableOpacity key={type} style={[styles.radioBtn, usageType === type && styles.radioBtnActive]} onPress={() => setUsageType(type)}>
                  <Text style={[styles.radioText, usageType === type && styles.radioTextActive]}>{type}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {usageType === '定期利用' && (
              <View>
                <Text style={styles.label}><Ionicons name="time-outline" size={16} /> 利用曜日</Text>
                <View style={styles.daysRow}>
                  {WEEK_DAYS.map((day) => (
                    <TouchableOpacity key={day} style={[styles.dayBtn, days[day] && styles.dayBtnActive]} onPress={() => setDays({ ...days, [day]: !days[day] })}>
                      <Text style={[styles.dayText, days[day] && styles.dayTextActive]}>{day}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}

            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}><Ionicons name="people-outline" size={20} /> 兄弟等</Text>
              <TouchableOpacity style={styles.smallAddBtn} onPress={addSibling}>
                <Ionicons name="add" size={16} color={COLORS.white} /><Text style={styles.btnTextWhiteSmall}>追加</Text>
              </TouchableOpacity>
            </View>

            {siblings.map((sib, index) => (
              <View key={index} style={styles.siblingCard}>
                <View style={styles.siblingCardHeader}>
                  <Text style={styles.siblingIndexText}>兄弟 {index + 1}</Text>
                  <TouchableOpacity onPress={() => removeSibling(index)} style={styles.deleteSiblingBtn}>
                    <Ionicons name="close" size={16} color={COLORS.danger} /><Text style={styles.deleteText}>削除</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.label}>氏名</Text>
                <TextInput style={styles.input} value={sib.name} onChangeText={(v) => updateSibling(index, 'name', v)} placeholder="氏名" placeholderTextColor="#BBBBBB" />
                <Text style={styles.label}>ニックネーム (かな)</Text>
                <TextInput style={styles.input} value={sib.nicknameKana} onChangeText={(v) => updateSibling(index, 'nicknameKana', v)} placeholder="かな" placeholderTextColor="#BBBBBB" autoCapitalize="none" />
                <Text style={styles.label}>学校名</Text>
                <TouchableOpacity style={styles.selectBox} onPress={() => openPicker('sibling_school', index)}>
                  <Text style={styles.selectBoxText}>{sib.school || '選択してください'}</Text>
                  <Ionicons name="chevron-down" size={20} color={COLORS.primary} />
                </TouchableOpacity>
                <Text style={styles.label}>学年</Text>
                <TouchableOpacity style={styles.selectBox} onPress={() => openPicker('sibling_grade', index)}>
                  <Text style={styles.selectBoxText}>{sib.grade || '選択してください'}</Text>
                  <Ionicons name="chevron-down" size={20} color={COLORS.primary} />
                </TouchableOpacity>
                <Text style={styles.label}>利用形態</Text>
                <View style={styles.row}>
                  {['定期利用', '回数券', '不定期'].map(type => (
                    <TouchableOpacity key={type} style={[styles.radioBtn, sib.usageType === type && styles.radioBtnActive]} onPress={() => updateSibling(index, 'usageType', type)}>
                      <Text style={[styles.radioText, sib.usageType === type && styles.radioTextActive]}>{type}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {sib.usageType === '定期利用' && (
                  <View style={styles.daysRow}>
                    {WEEK_DAYS.map((day) => (
                      <TouchableOpacity key={`sib-${index}-${day}`} style={[styles.dayBtn, sib.days[day] && styles.dayBtnActive]} onPress={() => updateSibling(index, 'days', { ...sib.days, [day]: !sib.days[day] })}>
                        <Text style={[styles.dayText, sib.days[day] && styles.dayTextActive]}>{day}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            ))}
          </View>
        )}

        <TouchableOpacity style={[styles.primaryBtn, loading && { opacity: 0.7 }]} onPress={handleSave} disabled={loading}>
          {loading ? <ActivityIndicator color={COLORS.white} /> : (
            <><Ionicons name={isEditMode ? "save-outline" : "checkmark-circle-outline"} size={24} color={COLORS.white} style={{marginRight: 8}} /><Text style={styles.btnTextWhite}>{isEditMode ? '更新して保存' : 'アカウントを生成して保存'}</Text></>
          )}
        </TouchableOpacity>
      </ScrollView>

      <EditablePickerModal
        visible={pickerConfig.visible}
        title={pickerConfig.type.includes('school') ? '学校名' : '学年'}
        items={pickerConfig.type.includes('school') ? schools : grades}
        onClose={() => setPickerConfig({ ...pickerConfig, visible: false })}
        onSelect={handlePickerSelect}
        onAdd={handlePickerAdd}
        onDelete={handlePickerDelete}
      />
      <AdminBottomNav active="menu" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: '#FFF8F0', borderBottomLeftRadius: 16, borderBottomRightRadius: 16 },
  backBtn: { marginRight: 12 },
  headerTitle: { fontSize: 18, fontWeight: 'bold', color: '#5D4037', flex: 1 },
  formContainer: { padding: 20, paddingBottom: 60 },
  segmentedControl: { flexDirection: 'row', backgroundColor: COLORS.surface, borderRadius: 12, padding: 6, marginBottom: 24, borderWidth: 1, borderColor: COLORS.border },
  segmentBtn: { flex: 1, flexDirection: 'row', paddingVertical: 12, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  segmentBtnActive: { backgroundColor: COLORS.white, shadowColor: COLORS.primary, shadowOpacity: 0.15, shadowRadius: 8, elevation: 3, borderWidth: 1, borderColor: COLORS.accent },
  segmentBtnDisabled: { opacity: 0.5 },
  segmentIcon: { marginRight: 6 },
  segmentText: { fontSize: 16, color: COLORS.textLight, fontWeight: 'bold' },
  segmentTextActive: { color: COLORS.primary },
  label: { fontSize: 14, color: COLORS.text, fontWeight: 'bold', marginBottom: 8, marginTop: 20 },
  input: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, padding: 16, fontSize: 16, color: COLORS.text },
  selectBox: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, padding: 16, marginTop: 4 },
  selectBoxText: { fontSize: 16, color: COLORS.text },
  row: { flexDirection: 'row', gap: 10, marginTop: 4 },
  radioBtn: { flex: 1, borderWidth: 1, borderColor: COLORS.border, paddingVertical: 14, alignItems: 'center', borderRadius: 12, backgroundColor: COLORS.surface },
  radioBtnActive: { borderColor: COLORS.primary, backgroundColor: COLORS.accent + '20' },
  radioText: { fontSize: 14, color: COLORS.textLight, fontWeight: 'bold' },
  radioTextActive: { color: COLORS.primary },
  shiftVisibilityCard: { marginTop: 16, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: '#CFE1DF', backgroundColor: '#F5FBFA', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  eventPermissionCard: { marginTop: 10, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: '#F2D6B8', backgroundColor: '#FFF9F1', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  shiftVisibilityTextWrap: { flex: 1 },
  shiftVisibilityTitle: { fontSize: 14, fontWeight: '900', color: '#263638' },
  shiftVisibilityDescription: { marginTop: 3, fontSize: 11, lineHeight: 16, color: '#68777A' },
  skillsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8 },
  skillBtn: { width: '31%', aspectRatio: 1, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 16, alignItems: 'center', justifyContent: 'center', padding: 8 },
  skillBtnActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary, shadowColor: COLORS.primary, shadowOpacity: 0.3, shadowRadius: 6, elevation: 4 },
  skillText: { fontSize: 12, color: COLORS.text, fontWeight: 'bold', marginTop: 8, textAlign: 'center' },
  skillTextActive: { color: COLORS.white },
  childBox: { backgroundColor: '#F0F8FF', padding: 16, borderRadius: 12, marginTop: 20, borderWidth: 1, borderColor: COLORS.primary },
  daysRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  dayBtn: { width: 52, height: 52, borderRadius: 26, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.surface },
  dayBtnActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary, shadowColor: COLORS.primary, shadowOpacity: 0.3, shadowRadius: 6, elevation: 4 },
  dayText: { fontSize: 16, color: COLORS.textLight, fontWeight: 'bold' },
  dayTextActive: { color: COLORS.white },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, marginBottom: 16, borderBottomWidth: 1, borderColor: COLORS.border, paddingBottom: 12 },
  sectionTitle: { fontSize: 20, fontWeight: 'bold', color: COLORS.text },
  smallAddBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.primary, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  btnTextWhiteSmall: { color: COLORS.white, fontWeight: 'bold', marginLeft: 4 },
  siblingCard: { backgroundColor: COLORS.white, borderRadius: 16, padding: 20, marginBottom: 16, borderWidth: 1, borderColor: COLORS.border, shadowColor: COLORS.primary, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  siblingCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, borderBottomWidth: 1, borderColor: COLORS.border, paddingBottom: 12 },
  siblingIndexText: { fontSize: 18, fontWeight: 'bold', color: COLORS.primary },
  deleteSiblingBtn: { flexDirection: 'row', alignItems: 'center' },
  deleteText: { color: COLORS.danger, fontWeight: 'bold', marginLeft: 4 },
  primaryBtn: { flexDirection: 'row', backgroundColor: COLORS.primary, padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 48, height: 60, justifyContent: 'center', shadowColor: COLORS.primary, shadowOpacity: 0.3, shadowRadius: 10, elevation: 5 },
  btnTextWhite: { color: COLORS.white, fontSize: 18, fontWeight: 'bold' }
});
