import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  addDoc, collection, deleteDoc, doc, getDoc,
  getDocs, onSnapshot, query, setDoc, where
} from 'firebase/firestore';
import {
  deleteObject, getDownloadURL,
  ref as storageRef, uploadBytes
} from 'firebase/storage';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Image, Modal, Platform,
  SafeAreaView, ScrollView, StyleSheet, Text,
  TextInput, TouchableOpacity, View
} from 'react-native';
import { COLORS } from '../constants/theme';
import { db, storage } from '../firebase';
import { useRequireRole } from '../hooks/useRequireRole';

// ─── ユーティリティ ────────────────────────────────────────────
const customAlert = (title: string, msg?: string) => {
  if (Platform.OS === 'web') window.alert(msg ? `${title}\n${msg}` : title);
  else { const { Alert } = require('react-native'); Alert.alert(title, msg); }
};
const customConfirm = (title: string, msg: string, onOk: () => void) => {
  if (Platform.OS === 'web') { if (window.confirm(`${title}\n${msg}`)) onOk(); }
  else { const { Alert } = require('react-native'); Alert.alert(title, msg, [{ text: 'キャンセル' }, { text: 'OK', onPress: onOk }]); }
};

// ─── 型定義 ────────────────────────────────────────────────────
type MainTab = 'year' | 'vacation' | 'management';
type VacTab = 'summer' | 'winter' | 'spring';

// リッチテキストのノード
type RichSpan = { text: string; bold?: boolean; italic?: boolean; fontSize?: number; color?: string };
type RichLine = RichSpan[];
type RichDoc = RichLine[];

// イベント詳細（Firestore: year_event_details/{eventId}）
interface YearEventDetail {
  id: string;
  eventId: string;      // events コレクションのID or 独自
  description: RichDoc; // 説明・日時
  items: RichDoc;       // 持ち込み・参加費等
}

// 休み期間の広告画像（Firestore: vacation_flyers/{id}）
interface VacationFlyer {
  id: string;
  vacation: VacTab;
  month: number;
  uri: string;
  storagePath: string;
  title: string;
}

// 去年の写真（Firestore: event_past_photos/{id}）
interface PastPhoto {
  id: string;
  eventId: string;
  uri: string;
  storagePath: string;
  fiscalYear?: number; // アップロード時の年度（前年度として保存）
}

// ─── 学期定義 ──────────────────────────────────────────────────
const TERM1_MONTHS = [4, 5, 6, 7];
const TERM2_MONTHS = [9, 10, 11, 12];
const TERM3_MONTHS = [1, 2, 3];

const VAC_MONTHS: Record<VacTab, number[]> = {
  summer: [7, 8],
  winter: [12, 1],
  spring: [3, 4],
};

const TERM_COLORS = {
  1: { bg: '#FFF8E1', border: '#FFD54F', text: '#F57F17', light: '#FFFDE7' },
  2: { bg: '#E8F5E9', border: '#66BB6A', text: '#2E7D32', light: '#F1F8E9' },
  3: { bg: '#E3F2FD', border: '#42A5F5', text: '#1565C0', light: '#E8F4FE' },
};

const VAC_COLORS: Record<VacTab, { bg: string; border: string; text: string; label: string }> = {
  summer: { bg: '#FFF3E0', border: '#FF8F00', text: '#E65100', label: '夏休み' },
  winter: { bg: '#E3F2FD', border: '#1E88E5', text: '#0D47A1', label: '冬休み' },
  spring: { bg: '#FCE4EC', border: '#E91E63', text: '#880E4F', label: '春休み' },
};

const MONTH_NAMES = ['', '1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

// ─── リッチテキストレンダラー ───────────────────────────────────
// RichDoc→HTML変換（表示用・共有）
const richDocToHtml = (doc: RichDoc): string =>
  doc.map(line =>
    '<div>' + (line.length === 0 || (line.length === 1 && !line[0].text)
      ? '<br>'
      : line.map(s => {
          const st: string[] = [];
          if (s.bold) st.push('font-weight:bold');
          if (s.italic) st.push('font-style:italic');
          if (s.fontSize) st.push(`font-size:${s.fontSize}px`);
          if (s.color && s.color !== '#333333') st.push(`color:${s.color}`);
          return st.length
            ? `<span style="${st.join(';')}">${s.text.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</span>`
            : s.text.replace(/&/g,'&amp;').replace(/</g,'&lt;');
        }).join('')
    ) + '</div>'
  ).join('') || '';

const RichText = ({ doc: rdoc }: { doc: RichDoc }) => {
  if (typeof window === 'undefined') return (
    <View>{rdoc.map((line, li) => <Text key={li}>{line.map(s => s.text).join('')}</Text>)}</View>
  );
  return (
    // @ts-ignore
    <div dangerouslySetInnerHTML={{ __html: richDocToHtml(rdoc) }}
      style={{ fontSize: 14, color: '#333', lineHeight: '1.8', wordBreak: 'break-word' } as any} />
  );
};

// ─── リッチテキストエディタ ────────────────────────────────────
const RichEditor = ({ value, onChange }: { value: RichDoc; onChange: (v: RichDoc) => void }) => {
  const COLORS_LIST = ['#333333','#E53935','#E91E63','#9C27B0','#1E88E5','#00BCD4','#43A047','#FF9800','#795548','#607D8B'];
  const SIZES = [11,12,13,14,15,16,18,20,24,28,32];
  const EMOJI_LIST = [
    // 顔・感情
    '😊','😂','😍','🥰','😎','🤔','😅','😆','🥹','😭','😤','🤯','🥳','😴','🤩','😇','🤗','😏','😒','😬','🤐','😷','🤒','🤕','🥺','😢','😡','🤬','😱','😨',
    // ジェスチャー・人
    '👍','👎','👏','🙏','🤝','✌️','🤞','👋','🤚','✋','🖐️','👌','🤌','🤏','👆','👇','👈','👉','🫶','💪','🦾','🙌','👐','🤲',
    // ハート・記号
    '❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💕','💞','💓','💗','💖','💘','💝','❤️‍🔥','💔','❣️','♥️','🔴','🟠','🟡','🟢','🔵','🟣',
    // 自然・植物
    '🌸','🌺','🌻','🌹','🌷','🌼','💐','🍀','🌿','🌱','🌲','🌳','🍁','🍂','🍃','🌾','🎋','🎍','🌵','🌴','🪷','🪻','🫧',
    // 動物
    '🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🙈','🙉','🙊','🐔','🐧','🐦','🦆','🦅','🦉','🦋','🐛','🐌','🐝','🐞','🦎','🐢','🐠','🐟','🐬','🐳','🐋','🦈','🐙','🦑',
    // 食べ物
    '🍎','🍊','🍋','🍇','🍓','🫐','🍒','🍑','🥭','🍍','🥝','🍅','🥦','🥕','🌽','🍔','🍟','🍕','🌮','🍜','🍣','🍱','🍩','🎂','🍰','🧁','🍫','🍬','🍭','☕','🧋','🥤','🍺','🥂',
    // 活動・スポーツ
    '⚽','🏀','🏈','⚾','🎾','🏐','🏉','🎱','🏓','🏸','🥊','⛷️','🏊','🚴','🤸','🏋️','🤺','🎯','🎳','🎲','🎮','🕹️','🎸','🎹','🎺','🎻','🥁','🎤','🎧','🎬',
    // 旅行・場所
    '✈️','🚀','🛸','🚂','🚢','🏖️','🏝️','🗺️','🗼','🏯','🏰','⛪','🕌','🕍','🗽','🌋','🏔️','🏕️','🌅','🌄','🌃','🌆','🌇','🌉','🎠','🎡','🎢','🎪',
    // 物・道具
    '💎','💍','👑','🎩','👒','🕶️','💼','👜','🎒','🧳','☂️','🌂','📱','💻','⌨️','🖥️','🖨️','📷','📸','📹','📺','📻','🔋','💡','🔦','🕯️','📚','📖','📝','✏️','🖊️','🖋️','📌','📍','📎','✂️','🔑','🗝️','🔒','🔓','🔨','🪓','⚒️','🛠️','🔧','🔩','💊','💉','🩺','🩹','🧲','🔭','🔬','🧪','🧫','🧬',
    // お祝い・イベント
    '🎉','🎊','🎁','🎈','🎀','🎗️','🎟️','🎫','🏆','🥇','🥈','🥉','🎖️','🏅','🎓','📣','📢','🔔','🔕','🎵','🎶','🎼','🎤','🎧','🎷','🎸','🎹','🎺','🎻','🥁','🪘',
    // 天気・自然現象
    '☀️','🌤️','⛅','🌥️','☁️','🌦️','🌧️','⛈️','🌩️','🌨️','❄️','☃️','⛄','🌬️','💨','🌪️','🌫️','🌈','☔','⚡','🔥','💧','🌊','🌙','⭐','🌟','💫','✨','🌠','🌌',
    // サイン・記号
    '✅','❌','⚠️','❗','❓','💯','🔥','💥','⭐','🌟','✨','💫','🎯','📌','🔑','💡','📣','🔔','📍','🚩','🏁','🚫','⛔','🔞','📵','🆕','🆙','🆒','🆓','🆖','🉐','🈴','🈵','🈹','🈲',
  ];
  const EMOJI_CATEGORIES = [
    { label: '顔', start: 0, end: 30 },
    { label: 'ジェスチャー', start: 30, end: 54 },
    { label: 'ハート', start: 54, end: 80 },
    { label: '自然', start: 80, end: 103 },
    { label: '動物', start: 103, end: 142 },
    { label: '食べ物', start: 142, end: 177 },
    { label: '活動', start: 177, end: 207 },
    { label: '旅行', start: 207, end: 236 },
    { label: '物・道具', start: 236, end: 289 },
    { label: 'お祝い', start: 289, end: 319 },
    { label: '天気', start: 319, end: 349 },
    { label: '記号', start: 349 },
  ];
  const [emojiCategory, setEmojiCategory] = React.useState(0);
  const [showEmoji, setShowEmoji] = React.useState(false);
  const [previewHtml, setPreviewHtml] = React.useState('');
  const editorRef = React.useRef<any>(null);

  // 先行スタイル（文字を打つ前に選択するスタイル）
  const [pendingSize, setPendingSize] = React.useState<number | null>(null);
  const [pendingColor, setPendingColor] = React.useState<string | null>(null);
  const pendingSizeRef = React.useRef<number | null>(null);
  const pendingColorRef = React.useRef<string | null>(null);
  React.useEffect(() => { pendingSizeRef.current = pendingSize; }, [pendingSize]);
  React.useEffect(() => { pendingColorRef.current = pendingColor; }, [pendingColor]);

  const docToHtml = (doc: RichDoc): string =>
    doc.map(line =>
      '<div>' + (line.length === 0 || (line.length === 1 && !line[0].text)
        ? '<br>'
        : line.map(s => {
            const st: string[] = [];
            if (s.bold) st.push('font-weight:bold');
            if (s.italic) st.push('font-style:italic');
            if (s.fontSize) st.push(`font-size:${s.fontSize}px`);
            if (s.color) st.push(`color:${s.color}`);
            return st.length
              ? `<span style="${st.join(';')}">${s.text.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</span>`
              : s.text.replace(/&/g,'&amp;').replace(/</g,'&lt;');
          }).join('')
      ) + '</div>'
    ).join('') || '<div><br></div>';

  const htmlToDoc = (html: string): RichDoc => {
    if (typeof window === 'undefined') return [[{ text: '' }]];

    // RGB→HEX変換
    const rgbToHex = (rgb: string): string => {
      const m = rgb.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
      if (!m) return rgb;
      return '#' + [m[1], m[2], m[3]].map(v => parseInt(v).toString(16).padStart(2, '0')).join('');
    };
    const tmp = window.document.createElement('div');
    tmp.innerHTML = html;
    const result: RichDoc = [];
    const divs = tmp.querySelectorAll(':scope > div');

    // スタイルを親から継承しながら再帰的にテキストノードを収集
    const walkInherited = (node: any, inherited: any, spans: any[]) => {
      if (node.nodeType === 3) {
        // テキストノード
        if (node.textContent) {
          spans.push({ ...inherited, text: node.textContent });
        }
        return;
      }
      // 現在のノードのスタイルを取得
      const current = { ...inherited };
      const st = node.style || {};
      if (st.fontWeight === 'bold' || node.nodeName === 'B' || node.nodeName === 'STRONG') current.bold = true;
      if (st.fontStyle === 'italic' || node.nodeName === 'I' || node.nodeName === 'EM') current.italic = true;
      if (st.textDecoration?.includes('underline') || node.nodeName === 'U') current.underline = true;
      if (st.fontSize) current.fontSize = parseInt(st.fontSize);
      if (st.color) current.color = rgbToHex(st.color);
      // font タグ（execCommandが生成）
      if (node.nodeName === 'FONT') {
        if (node.color) current.color = node.color;
      }
      node.childNodes.forEach((c: any) => walkInherited(c, current, spans));
    };

    const processNode = (lines: RichDoc) => {
      if (divs.length === 0) {
        const spans: any[] = [];
        walkInherited(tmp, {}, spans);
        lines.push(spans.length ? spans : [{ text: tmp.innerText || '' }]);
        return;
      }
      divs.forEach((div: any) => {
        const spans: any[] = [];
        div.childNodes.forEach((c: any) => walkInherited(c, {}, spans));
        lines.push(spans.length ? spans : [{ text: '' }]);
      });
    };
    processNode(result);
    return result.length ? result : [[{ text: '' }]];
  };

  // 先行スタイルがある場合、入力された文字をspanで包んで挿入する
  const handleKeyDown = (e: any) => {
    const size = pendingSizeRef.current;
    const color = pendingColorRef.current;
    if (!size && !color) return;
    if (e.key === 'Backspace' || e.key === 'Delete' || e.key === 'Enter' ||
        e.key.startsWith('Arrow') || e.ctrlKey || e.metaKey) return;
    if (e.key.length !== 1) return; // 印刷可能文字のみ
    e.preventDefault();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (!sel.isCollapsed) range.deleteContents();
    const span = document.createElement('span');
    if (size) span.style.fontSize = `${size}px`;
    if (color) span.style.color = color;
    span.textContent = e.key;
    range.insertNode(span);
    // カーソルをspanの後ろへ
    const newRange = document.createRange();
    newRange.setStartAfter(span);
    newRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(newRange);
    editorRef.current?.dispatchEvent(new Event('input', { bubbles: true }));
  };

  const handleInput = () => {    if (!editorRef.current) return;
    const html = editorRef.current.innerHTML;
    setPreviewHtml(html); // プレビュー即時更新
    const newDoc = htmlToDoc(html);
    onChange(newDoc);
  };

  const execCmd = (cmd: string, val?: string) => {
    if (typeof window === 'undefined') return;
    (window.document as any).execCommand(cmd, false, val || null);
    editorRef.current?.focus();
    handleInput();
  };

  const applyFontSize = (size: number) => {
    if (typeof window === 'undefined') return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) {
      // 選択範囲がある場合はそこに即適用
      const range = sel.getRangeAt(0);
      const span = window.document.createElement('span');
      span.style.fontSize = `${size}px`;
      try { range.surroundContents(span); }
      catch { const f = range.extractContents(); span.appendChild(f); range.insertNode(span); }
      editorRef.current?.focus();
      handleInput();
      setPendingSize(null);
    } else {
      // 選択範囲なし → 先行スタイルとしてセット（トグル）
      setPendingSize(prev => prev === size ? null : size);
      editorRef.current?.focus();
    }
  };

  const applyColor = (color: string) => {
    if (typeof window === 'undefined') return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) {
      // 選択範囲がある場合はそこに即適用
      execCmd('foreColor', color);
      setPendingColor(null);
    } else {
      // 選択範囲なし → 先行スタイルとしてセット（トグル）
      setPendingColor(prev => prev === color ? null : color);
      editorRef.current?.focus();
    }
  };

  const insertEmoji = (emoji: string) => {
    execCmd('insertText', emoji);
    setShowEmoji(false);
  };

  const initialized = React.useRef(false);
  React.useEffect(() => {
    if (editorRef.current && !initialized.current) {
      const html = richDocToHtml(value);
      editorRef.current.innerHTML = html;
      setPreviewHtml(html);
      initialized.current = true;
    }
  }, []);

  if (typeof window === 'undefined') return (
    <View style={{ padding: 12, borderWidth: 1, borderColor: '#E0E0E0', borderRadius: 8 }}>
      <Text style={{ color: '#aaa' }}>エディタ読み込み中...</Text>
    </View>
  );

  return (
    <View style={{ borderWidth: 1, borderColor: '#E0E0E0', borderRadius: 12, overflow: 'hidden', backgroundColor: '#fff' }}>
      {/* ツールバー */}
      <View style={{ backgroundColor: '#F8F8F8', borderBottomWidth: 1, borderColor: '#E0E0E0', padding: 8, gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
          {[['B','bold','bold'],['I','italic','italic'],['U','underline','underline']].map(([label, cmd, style]) => (
            <TouchableOpacity key={cmd} onPress={() => execCmd(cmd)}
              style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, borderWidth: 1, borderColor: '#D0D0D0', backgroundColor: '#fff' }}>
              <Text style={{ fontWeight: style === 'bold' ? 'bold' : 'normal', fontStyle: style === 'italic' ? 'italic' : 'normal', textDecorationLine: style === 'underline' ? 'underline' : 'none', fontSize: 13 }}>{label}</Text>
            </TouchableOpacity>
          ))}
          <View style={{ width: 1, height: 22, backgroundColor: '#D0D0D0', marginHorizontal: 4 }} />
          <Text style={{ fontSize: 11, color: '#888' }}>サイズ:</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, maxWidth: 360 }}>
            <View style={{ flexDirection: 'row', gap: 3 }}>
              {SIZES.map(s => (
                <TouchableOpacity key={s} onPress={() => applyFontSize(s)}
                  style={{ paddingHorizontal: 7, paddingVertical: 4, borderRadius: 6, backgroundColor: pendingSize === s ? COLORS.primary : '#fff', borderWidth: 1, borderColor: pendingSize === s ? COLORS.primary : '#D0D0D0' }}>
                  <Text style={{ fontSize: 11, color: pendingSize === s ? '#fff' : '#333' }}>{s}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
          <TouchableOpacity onPress={() => setShowEmoji(v => !v)}
            style={{ paddingHorizontal: 8, paddingVertical: 5, borderRadius: 6, borderWidth: 1, borderColor: '#D0D0D0', backgroundColor: '#fff', marginLeft: 4 }}>
            <Text style={{ fontSize: 14 }}>😊</Text>
          </TouchableOpacity>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <Text style={{ fontSize: 11, color: '#888' }}>色:</Text>
          {COLORS_LIST.map(c => (
            <TouchableOpacity key={c} onPress={() => applyColor(c)}
              style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: c, borderWidth: pendingColor === c ? 3 : 1, borderColor: pendingColor === c ? '#333' : 'rgba(0,0,0,0.15)' }} />
          ))}
        </View>
        {showEmoji && (
          <View style={{ backgroundColor: '#fff', borderRadius: 8, borderWidth: 1, borderColor: '#E0E0E0' }}>
            {/* カテゴリタブ */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ borderBottomWidth: 1, borderColor: '#E8E8E8' }}>
              <View style={{ flexDirection: 'row', padding: 4, gap: 4 }}>
                {EMOJI_CATEGORIES.map((cat, ci) => (
                  <TouchableOpacity key={ci} onPress={() => setEmojiCategory(ci)}
                    style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: emojiCategory === ci ? COLORS.primary : '#F0F0F0' }}>
                    <Text style={{ fontSize: 11, color: emojiCategory === ci ? '#fff' : '#555', fontWeight: 'bold' }}>{cat.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
            {/* 絵文字グリッド */}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 2, padding: 8, maxHeight: 180, overflow: 'scroll' } as any}>
              {EMOJI_LIST.slice(
                EMOJI_CATEGORIES[emojiCategory].start,
                EMOJI_CATEGORIES[emojiCategory].end
              ).map((e, i) => (
                <TouchableOpacity key={i} onPress={() => insertEmoji(e)}
                  style={{ padding: 4, borderRadius: 6 }}>
                  <Text style={{ fontSize: 22 }}>{e}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}
      </View>

      {/* 編集エリア */}
      {/* @ts-ignore */}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        style={{ padding: 12, minHeight: 200, outline: 'none', fontSize: 14, color: '#333', lineHeight: '1.8', whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowY: 'auto', maxHeight: 400 } as any}
      />
    </View>
  );
};




const re = StyleSheet.create({
  wrap: { borderWidth: 1, borderColor: '#E0E0E0', borderRadius: 10, overflow: 'hidden', backgroundColor: '#FAFAFA' },
  toolbar: { backgroundColor: '#F5F5F5', borderBottomWidth: 1, borderColor: '#E0E0E0', paddingVertical: 6, paddingHorizontal: 6 },
  toolBtn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, marginRight: 4, backgroundColor: '#fff', borderWidth: 1, borderColor: '#DDD' },
  toolBtnActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  toolText: { fontWeight: 'bold', fontSize: 13, color: '#555' },
  toolTextActive: { color: '#fff' },
  sep: { width: 1, backgroundColor: '#DDD', marginHorizontal: 4 },
  colorDot: { width: 22, height: 22, borderRadius: 11, marginRight: 4, alignSelf: 'center' },
  spanChip: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: '#E0E0E0', marginRight: 4, marginBottom: 4, backgroundColor: '#fff' },
  spanChipSel: { borderColor: COLORS.primary, borderWidth: 2 },
  addSpanBtn: { width: 26, height: 26, borderRadius: 13, borderWidth: 1, borderColor: COLORS.primary, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  lineInput: { borderWidth: 1, borderColor: '#E0E0E0', borderRadius: 8, padding: 10, fontSize: 14, backgroundColor: '#fff', minHeight: 60, textAlignVertical: 'top', margin: 4 },
  addLineBtn: { flexDirection: 'row', alignItems: 'center', padding: 10, borderTopWidth: 1, borderColor: '#E0E0E0' },
});

const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];
// 4月始まりの年度を返す（例：2026年1月→2025年度、2026年4月→2026年度）
const getFiscalYear = (date: Date): number => {
  const m = date.getMonth() + 1; // 1-12
  return m >= 4 ? date.getFullYear() : date.getFullYear() - 1;
};

const getCurrentFiscalYear = () => getFiscalYear(new Date());

// 年度の開始日・終了日
const getFiscalYearRange = (fy: number) => ({
  start: `${fy}-04-01`,
  end: `${fy + 1}-03-31`,
});

const formatDateWithDay = (dateStr: string) => {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}（${DAY_NAMES[d.getDay()]}）`;
};

const EMPTY_RICH: RichDoc = [[{ text: '' }]];

// ─── メイン画面 ───────────────────────────────────────────────
export default function YearEventsScreen() {
  const { verified, checking } = useRequireRole(['admin', 'user', 'staff']);

  const router = useRouter();
  const { role, name, tab } = useLocalSearchParams<{ role?: string; name?: string; tab?: string }>();
  const isAdmin = role === 'admin';
  const isUser = role === 'user';

  // 参加状態 key: eventId → '参加' | undefined
  const [myParticipations, setMyParticipations] = useState<Record<string, string>>({});
  const [myAccountId, setMyAccountId] = useState<string | null>(null);

  const [mainTab, setMainTab] = useState<MainTab>((tab as MainTab) || 'year');
  const [vacTab, setVacTab] = useState<VacTab>('summer');

  // ── イベント管理タブ用state ──
  const [mgmtDate, setMgmtDate] = useState(new Date());
  const [mgmtEventsMap, setMgmtEventsMap] = useState<Record<string, any>>({});
  const [mgmtParticipants, setMgmtParticipants] = useState<Record<string, any[]>>({});
  const [mgmtSelectedDate, setMgmtSelectedDate] = useState('');
  const [mgmtModalVisible, setMgmtModalVisible] = useState(false);
  const [mgmtTitle, setMgmtTitle] = useState('');
  const [mgmtDesc, setMgmtDesc] = useState('');
  const [mgmtExtName, setMgmtExtName] = useState('');
  const [mgmtExtSchool, setMgmtExtSchool] = useState('');
  const [mgmtExtGrade, setMgmtExtGrade] = useState('');
  const [mgmtPublicHolidays, setMgmtPublicHolidays] = useState<Record<string, string>>({});
  const [mgmtParticipantTab, setMgmtParticipantTab] = useState<'list' | 'add'>('list');
  const [mgmtAddSubTab, setMgmtAddSubTab] = useState<'user' | 'external'>('user');
  const [mgmtAllMembers, setMgmtAllMembers] = useState<{id:string;name:string;nicknameKana?:string;school?:string;grade?:string}[]>([]);
  const [mgmtAllSchools, setMgmtAllSchools] = useState<string[]>([]);
  const [mgmtAllGrades, setMgmtAllGrades] = useState<string[]>([]);
  const [mgmtMemberSearch, setMgmtMemberSearch] = useState('');
  const [mgmtFilterSchool, setMgmtFilterSchool] = useState('');
  const [mgmtFilterGrade, setMgmtFilterGrade] = useState('');

  // Firestore data
  const [events, setEvents] = useState<Record<string, any[]>>({});   // key: "YYYY-MM"→配列 (events collection)
  const [details, setDetails] = useState<Record<string, YearEventDetail>>({});  // key: eventId
  const [pastPhotos, setPastPhotos] = useState<Record<string, PastPhoto[]>>({}); // key: eventId
  const [flyers, setFlyers] = useState<VacationFlyer[]>([]);
  const [holidayPeriods, setHolidayPeriods] = useState<{id: string; name: string; start: string; end: string}[]>([]);

  // 詳細画面
  const [detailEvent, setDetailEvent] = useState<any | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [secDesc, setSecDesc] = useState(false);
  const [secItems, setSecItems] = useState(false);
  const [secPhotos, setSecPhotos] = useState(false);

  // 編集
  const [editDesc, setEditDesc] = useState(false);
  const [editItems, setEditItems] = useState(false);
  const [descDraft, setDescDraft] = useState<RichDoc>(EMPTY_RICH);
  const [itemsDraft, setItemsDraft] = useState<RichDoc>(EMPTY_RICH);
  const [saving, setSaving] = useState(false);

  // 写真プレビュー
  const [previewPhotos, setPreviewPhotos] = useState<PastPhoto[] | null>(null);
  const [previewIdx, setPreviewIdx] = useState(0);
  const [uploading, setUploading] = useState(false);

  // チラシプレビュー
  const [flyerPreview, setFlyerPreview] = useState<VacationFlyer | null>(null);

  // スクロール ref
  const yearScrollRef = useRef<ScrollView>(null);
  const vacScrollRef = useRef<ScrollView>(null);
  const term1Ref = useRef<View>(null);
  const term2Ref = useRef<View>(null);
  const term3Ref = useRef<View>(null);
  const termOffsets = useRef<Record<number, number>>({});
  const vacMonthRefs = useRef<Record<string, number>>({});

  // ─── データロード ──────────────────────────────────────────
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'events'), snap => {
      const map: Record<string, any[]> = {};
      snap.forEach(d => {
        const data = { id: d.id, ...d.data() };
        const ym = (data as any).dateStr?.slice(0, 7);
        if (ym) { if (!map[ym]) map[ym] = []; map[ym].push(data); }
      });
      setEvents(map);
    });
    const unsub2 = onSnapshot(collection(db, 'year_event_details'), snap => {
      const map: Record<string, YearEventDetail> = {};
      snap.forEach(d => {
        const raw = d.data();
        // Firestoreから読み込む際にRichDoc形式に変換
        const toRichDoc = (data: any): RichDoc => {
          if (!data) return [[{ text: '' }]];
          if (Array.isArray(data) && data.length > 0 && 'spans' in data[0]) {
            return data.map((l: any) => l.spans || [{ text: '' }]);
          }
          if (Array.isArray(data)) return data as RichDoc;
          return [[{ text: '' }]];
        };
        const detail: YearEventDetail = {
          id: d.id,
          eventId: raw.eventId,
          description: toRichDoc(raw.description),
          items: toRichDoc(raw.items),
        };
        map[detail.eventId] = detail;
      });
      setDetails(map);
    });
    const unsub3 = onSnapshot(collection(db, 'event_past_photos'), snap => {
      const map: Record<string, PastPhoto[]> = {};
      snap.forEach(d => { const p = { id: d.id, ...d.data() } as PastPhoto; if (!map[p.eventId]) map[p.eventId] = []; map[p.eventId].push(p); });
      setPastPhotos(map);
    });
    const unsub4 = onSnapshot(collection(db, 'vacation_flyers'), snap => {
      setFlyers(snap.docs.map(d => ({ id: d.id, ...d.data() } as VacationFlyer)));
    });
    // 利用者の参加状態ロード
    if (isUser && name) {
      getDocs(query(collection(db, 'accounts'), where('name', '==', name)))
        .then(snap => {
          if (!snap.empty) {
            const accId = snap.docs[0].id;
            setMyAccountId(accId);
            const unsub5 = onSnapshot(
              query(collection(db, 'event_participants'), where('childId', '==', accId)),
              psnap => {
                const map: Record<string, string> = {};
                psnap.forEach(d => { map[d.data().eventId] = d.data().status; });
                setMyParticipations(map);
              }
            );
            return () => unsub5();
          }
        });
    }
    // 長期休み期間ロード
    getDoc(doc(db, 'settings', 'holidays_data')).then(snap => {
      if (snap.exists() && snap.data().periods) setHolidayPeriods(snap.data().periods);
    });
    const unsubHolidays = onSnapshot(doc(db, 'settings', 'holidays_data'), snap => {
      if (snap.exists() && snap.data().periods) setHolidayPeriods(snap.data().periods);
    });

    // イベント管理タブ用データロード
    fetch('https://holidays-jp.github.io/api/v1/date.json')
      .then(r => r.json()).then(d => setMgmtPublicHolidays(d)).catch(() => {});

    // メンバー一覧取得（参加者追加用）
    getDocs(collection(db, 'accounts')).then(snap => {
      const members: {id:string;name:string;nicknameKana?:string;school?:string;grade?:string}[] = [];
      const schoolSet = new Set<string>();
      const gradeSet = new Set<string>();
      snap.forEach(d => {
        const data = d.data();
        const push = (m: {id:string;name:string;nicknameKana?:string;school?:string;grade?:string}) => {
          members.push(m);
          if (m.school) schoolSet.add(m.school);
          if (m.grade) gradeSet.add(m.grade);
        };
        if (data.role === 'user' && data.name) {
          push({ id: d.id, name: data.name, nicknameKana: data.nicknameKana, school: data.school, grade: data.grade });
          (data.siblings || []).forEach((s: any, i: number) => {
            if (s.name) push({ id: `${d.id}_sib_${i}`, name: s.name, nicknameKana: s.nicknameKana, school: s.school, grade: s.grade });
          });
        } else if (data.role === 'staff' && data.hasChild) {
          (data.staffChildren || []).forEach((c: any, i: number) => {
            if (c.name) push({ id: `${d.id}_child_${i}`, name: c.name, school: c.school, grade: c.grade });
          });
        }
      });
      members.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
      const gradeOrder = ['小1','小2','小3','小4','小5','小6'];
      const sortedGrades = [...gradeSet].sort((a, b) => {
        const ai = gradeOrder.indexOf(a), bi = gradeOrder.indexOf(b);
        if (ai === -1 && bi === -1) return a.localeCompare(b, 'ja');
        if (ai === -1) return 1; if (bi === -1) return -1;
        return ai - bi;
      });
      setMgmtAllMembers(members);
      setMgmtAllSchools([...schoolSet].sort((a, b) => a.localeCompare(b, 'ja')));
      setMgmtAllGrades(sortedGrades);
    });

    const unsubMgmt1 = onSnapshot(collection(db, 'events'), snap => {
      const map: Record<string, any> = {};
      snap.forEach(d => { map[d.id] = { id: d.id, ...d.data() }; });
      setMgmtEventsMap(map);
    });
    const unsubMgmt2 = onSnapshot(collection(db, 'event_participants'), snap => {
      const map: Record<string, any[]> = {};
      snap.forEach(d => {
        const item = d.data();
        if (!map[item.eventId]) map[item.eventId] = [];
        map[item.eventId].push({ id: d.id, childName: item.childName, childSchool: item.childSchool || '', childGrade: item.childGrade || '', status: item.status });
      });
      setMgmtParticipants(map);
    });

    return () => { unsub(); unsub2(); unsub3(); unsub4(); unsubHolidays(); unsubMgmt1(); unsubMgmt2(); };
  }, []);

  // ─── ヘルパー ──────────────────────────────────────────────
  const eventsForMonth = (year: number, month: number) => {
    const ym = `${year}-${String(month).padStart(2, '0')}`;
    return events[ym] || [];
  };

  const currentFY = getCurrentFiscalYear();
  const { start: fyStart, end: fyEnd } = getFiscalYearRange(currentFY);

  // 現在年度内かチェック
  const isCurrentFiscalYear = (dateStr: string): boolean =>
    dateStr >= fyStart && dateStr <= fyEnd;

  // イベントが長期休み期間に含まれるか
  const isInAnyHoliday = (dateStr: string): boolean => {
    return holidayPeriods.some(p => dateStr >= p.start && dateStr <= p.end);
  };

  // 長期休み名に対応する期間のイベントを取得（月で絞り込み）
  const eventsForVacMonth = (vacLabel: string, month: number): any[] => {
    const result: any[] = [];
    const periods = holidayPeriods.filter(p => p.name.includes(vacLabel));
    periods.forEach(period => {
      // period.start 〜 period.end の月をまたぐ全イベントを取得
      const start = new Date(period.start);
      const end = new Date(period.end);
      let cur = new Date(start.getFullYear(), start.getMonth(), 1);
      while (cur <= end) {
        const ym = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`;
        const monthNum = cur.getMonth() + 1;
        if (monthNum === month) {
          (events[ym] || []).forEach(ev => {
            if (ev.dateStr >= period.start && ev.dateStr <= period.end && !result.find(r => r.id === ev.id)) {
              result.push(ev);
            }
          });
        }
        cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
      }
    });
    return result;
  };

  // 長期休みに含まれる月一覧を動的に取得
  const getVacMonths = (vacLabel: string): number[] => {
    const months = new Set<number>();
    const periods = holidayPeriods.filter(p => p.name.includes(vacLabel));
    periods.forEach(period => {
      const start = new Date(period.start);
      const end = new Date(period.end);
      let cur = new Date(start.getFullYear(), start.getMonth(), 1);
      while (cur <= end) {
        months.add(cur.getMonth() + 1);
        cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
      }
    });
    // 期間の開始月を基準に並べる（開始月から時系列順）
    const startMonth = periods.length > 0 ? new Date(periods[0].start).getMonth() + 1 : 4;
    const ordered: number[] = [];
    let m = startMonth;
    for (let i = 0; i < 12; i++) {
      if (months.has(m)) ordered.push(m);
      m = m === 12 ? 1 : m + 1;
    }
    return ordered;
  };

  // currentFY / fyStart / fyEnd は上で定義済み

  const openDetail = (ev: any) => {
    setDetailEvent(ev);
    const det = details[ev.id];
    setDescDraft(det?.description || EMPTY_RICH);
    setItemsDraft(det?.items || EMPTY_RICH);
    setSecDesc(false); setSecItems(false); setSecPhotos(false);
    setEditDesc(false); setEditItems(false);
    setDetailOpen(true);
  };

  // FirestoreはネストされたArrayを許可しないのでRichDocをオブジェクト配列に変換
  const richDocToFirestore = (doc: RichDoc) =>
    doc.map((line, li) => ({ lineIndex: li, spans: line }));
  const firestoreToRichDoc = (data: any[]): RichDoc =>
    data.map(l => l.spans || []);

  const saveDetail = async (field: 'description' | 'items') => {
    if (!detailEvent) return;
    setSaving(true);
    const det = details[detailEvent.id];
    const docId = det?.id || detailEvent.id;
    try {
      await setDoc(doc(db, 'year_event_details', docId), {
        eventId: detailEvent.id,
        description: richDocToFirestore(field === 'description' ? descDraft : (det?.description || EMPTY_RICH)),
        items: richDocToFirestore(field === 'items' ? itemsDraft : (det?.items || EMPTY_RICH)),
      }, { merge: true });
      if (field === 'description') setEditDesc(false);
      else setEditItems(false);
    } catch (e: any) {
      console.error('saveDetail error:', e);
      customAlert('保存エラー', e?.message || '保存に失敗しました。Firestore Rulesを確認してください。');
    } finally {
      setSaving(false);
    }
  };

  const toggleParticipation = async (eventId: string) => {
    if (!myAccountId) return;
    const docId = `${eventId}_${myAccountId}`;
    const isJoined = myParticipations[eventId] === '参加';
    if (isJoined) {
      customConfirm('参加を取り消す', 'このイベントの参加を取り消しますか？', async () => {
        await deleteDoc(doc(db, 'event_participants', docId));
      });
    } else {
      customConfirm('参加する', 'このイベントに参加しますか？', async () => {
        await setDoc(doc(db, 'event_participants', docId), {
          eventId, childId: myAccountId, childName: name || '',
          status: '参加', updatedAt: new Date(),
        });
      });
    }
  };

  // ── イベント管理タブ用関数 ──
  const mgmtDaysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate();
  const mgmtFirstDay = (y: number, m: number) => new Date(y, m, 1).getDay();
  const mgmtGenerateDays = () => {
    const y = mgmtDate.getFullYear(), m = mgmtDate.getMonth();
    const days = [];
    for (let i = 0; i < mgmtFirstDay(y, m); i++) days.push(null);
    for (let i = 1; i <= mgmtDaysInMonth(y, m); i++)
      days.push({ day: i, dateStr: `${y}-${String(m+1).padStart(2,'0')}-${String(i).padStart(2,'0')}` });
    return days;
  };
  const mgmtOpenModal = (dateStr: string) => {
    setMgmtSelectedDate(dateStr);
    const ev = Object.values(mgmtEventsMap).find((e: any) => e.dateStr === dateStr);
    setMgmtTitle(ev?.title || '');
    setMgmtDesc(ev?.description || '');
    setMgmtExtName(''); setMgmtExtSchool(''); setMgmtExtGrade('');
    setMgmtParticipantTab('list');
    setMgmtAddSubTab('user');
    setMgmtMemberSearch(''); setMgmtFilterSchool(''); setMgmtFilterGrade('');
    setMgmtModalVisible(true);
  };
  const mgmtSaveEvent = async () => {
    if (!mgmtTitle.trim()) { customAlert('エラー', 'タイトルを入力してください'); return; }
    const ev = Object.values(mgmtEventsMap).find((e: any) => e.dateStr === mgmtSelectedDate);
    const docId = ev?.id || `${mgmtSelectedDate}_${Date.now()}`;
    await setDoc(doc(db, 'events', docId), { id: docId, dateStr: mgmtSelectedDate, title: mgmtTitle, description: mgmtDesc, externalParticipants: ev?.externalParticipants || [] }, { merge: true });
    setMgmtModalVisible(false);
  };
  const mgmtDeleteEvent = async () => {
    const ev = Object.values(mgmtEventsMap).find((e: any) => e.dateStr === mgmtSelectedDate);
    if (!ev) return;
    customConfirm('削除', 'このイベントを削除しますか？', async () => {
      await deleteDoc(doc(db, 'events', ev.id));
      setMgmtModalVisible(false);
    });
  };
  const mgmtAddExternal = async () => {
    if (!mgmtExtName.trim()) return;
    const ev = Object.values(mgmtEventsMap).find((e: any) => e.dateStr === mgmtSelectedDate);
    if (!ev) { customAlert('エラー', '先にイベントを保存してください'); return; }
    const ext = [...(ev.externalParticipants || []), { id: `ext_${Date.now()}`, name: mgmtExtName, school: mgmtExtSchool, grade: mgmtExtGrade }];
    await setDoc(doc(db, 'events', ev.id), { externalParticipants: ext }, { merge: true });
    setMgmtExtName(''); setMgmtExtSchool(''); setMgmtExtGrade('');
  };
  const mgmtRemoveExternal = async (extId: string) => {
    const ev = Object.values(mgmtEventsMap).find((e: any) => e.dateStr === mgmtSelectedDate);
    if (!ev) return;
    const ext = (ev.externalParticipants || []).filter((e: any) => e.id !== extId);
    await setDoc(doc(db, 'events', ev.id), { externalParticipants: ext }, { merge: true });
  };

  const mgmtAddMember = async (member: {id:string;name:string;school?:string;grade?:string}) => {
    const ev = Object.values(mgmtEventsMap).find((e: any) => e.dateStr === mgmtSelectedDate);
    if (!ev) return;
    try {
      await setDoc(doc(db, 'event_participants', `${ev.id}_${member.id}`), {
        eventId: ev.id,
        childId: member.id,
        childName: member.name,
        childSchool: member.school || '',
        childGrade: member.grade || '',
        status: '参加',
        updatedAt: new Date(),
      }, { merge: true });
    } catch { customAlert('エラー', '追加に失敗しました'); }
  };

  const mgmtRemoveMember = (docId: string) =>
    customConfirm('削除確認', 'この参加者を削除しますか？', async () => {
      await deleteDoc(doc(db, 'event_participants', docId));
    });

  const toggleHidden = async (ev: any) => {
    const newHidden = !ev.hidden;
    await setDoc(doc(db, 'events', ev.id), { hidden: newHidden }, { merge: true });
    setDetailEvent((prev: any) => prev ? { ...prev, hidden: newHidden } : prev);
  };

  // ─── 画像アップロード（イベントカバー） ────────────────────
  const deleteEventCover = async (ev: any) => {
    customConfirm('画像を削除', 'カバー画像を削除しますか？', async () => {
      if (ev.coverStoragePath) {
        await deleteObject(storageRef(storage, ev.coverStoragePath)).catch(() => {});
      }
      await setDoc(doc(db, 'events', ev.id), { coverImage: null, coverStoragePath: null }, { merge: true });
      setDetailEvent((prev: any) => prev ? { ...prev, coverImage: null, coverStoragePath: null } : prev);
    });
  };

  const pickEventCover = async (eventId: string) => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'] as any, quality: 0.8 });
    if (result.canceled || !result.assets[0]) return;
    setUploading(true);
    try {
      const asset = result.assets[0];
      const res = await fetch(asset.uri);
      const blob = await res.blob();
      const ext = (asset.mimeType || '').includes('png') ? 'png' : 'jpg';
      const filename = `albums/event_cover_${eventId}_${Date.now()}.${ext}`;
      const sref = storageRef(storage, filename);
      await uploadBytes(sref, blob);
      const url = await getDownloadURL(sref);
      await setDoc(doc(db, 'events', eventId), { coverImage: url, coverStoragePath: filename }, { merge: true });
    } catch (e: any) {
      console.error('cover upload error:', e);
      customAlert('エラー', e?.message || 'アップロードに失敗しました');
    }
    setUploading(false);
  };

  // ─── 去年の写真アップロード ────────────────────────────────
  const uploadPastPhoto = async () => {
    if (!detailEvent) return;
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { customAlert('権限エラー', '写真ライブラリへのアクセスを許可してください'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'] as any,
      allowsMultipleSelection: true,
      quality: 0.7,
    });
    if (result.canceled) return;
    setUploading(true);
    let count = 0;
    for (const asset of result.assets) {
      try {
        const res = await fetch(asset.uri);
        const blob = await res.blob();
        const ext = (asset.mimeType || '').includes('png') ? 'png' : 'jpg';
        const filename = `albums/event_past_${detailEvent.id}_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
        const sref = storageRef(storage, filename);
        await uploadBytes(sref, blob);
        const url = await getDownloadURL(sref);
        await addDoc(collection(db, 'event_past_photos'), {
          eventId: detailEvent.id, uri: url, storagePath: filename,
          fiscalYear: currentFY - 1,  // 前年度として記録
          createdAt: new Date()
        });
        count++;
      } catch (e: any) {
        console.error('upload error:', e);
        customAlert('アップロード失敗', e?.message || String(e));
      }
    }
    setUploading(false);
    if (count > 0) customAlert('完了', `${count}枚アップロードしました`);
  };

  const deletePastPhoto = async (photo: PastPhoto) => {
    customConfirm('削除', 'この写真を削除しますか？', async () => {
      await deleteObject(storageRef(storage, photo.storagePath)).catch(() => {});
      await deleteDoc(doc(db, 'event_past_photos', photo.id));
    });
  };

  // ─── チラシアップロード ────────────────────────────────────
  const uploadFlyer = async (vac: VacTab, month: number) => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9 });
    if (result.canceled || !result.assets[0]) return;
    setUploading(true);
    try {
      const uri = result.assets[0].uri;
      const blob = await fetch(uri).then(r => r.blob());
      const filename = `albums/vacation_flyer_${vac}_${month}_${Date.now()}.jpg`;
      const sref = storageRef(storage, filename);
      await uploadBytes(sref, blob);
      const url = await getDownloadURL(sref);
      const title = `${VAC_COLORS[vac].label} ${month}月`;
      await addDoc(collection(db, 'vacation_flyers'), { vacation: vac, month, uri: url, storagePath: filename, title, createdAt: new Date() });
    } catch (e) { customAlert('エラー', 'アップロードに失敗しました'); }
    setUploading(false);
  };

  const replaceFlyer = async (flyer: VacationFlyer) => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'] as any, quality: 0.9 });
    if (result.canceled || !result.assets[0]) return;
    setUploading(true);
    try {
      // 旧画像削除
      await deleteObject(storageRef(storage, flyer.storagePath)).catch(() => {});
      const asset = result.assets[0];
      const res = await fetch(asset.uri);
      const blob = await res.blob();
      const ext = (asset.mimeType || '').includes('png') ? 'png' : 'jpg';
      const filename = `albums/vacation_flyer_${flyer.vacation}_${flyer.month}_${Date.now()}.${ext}`;
      const sref = storageRef(storage, filename);
      await uploadBytes(sref, blob);
      const url = await getDownloadURL(sref);
      await setDoc(doc(db, 'vacation_flyers', flyer.id), { ...flyer, uri: url, storagePath: filename });
    } catch (e: any) { customAlert('エラー', e?.message || 'アップロードに失敗しました'); }
    setUploading(false);
  };

  const deleteFlyer = async (flyer: VacationFlyer) => {
    customConfirm('削除', 'このチラシを削除しますか？', async () => {
      await deleteObject(storageRef(storage, flyer.storagePath)).catch(() => {});
      await deleteDoc(doc(db, 'vacation_flyers', flyer.id));
    });
  };

  // ─── 月カードのペアレンダリング ───────────────────────────
  const MonthPair = ({ months, termColor }: { months: number[]; termColor: any }) => {
    const pairs: number[][] = [];
    for (let i = 0; i < months.length; i += 2) pairs.push(months.slice(i, i + 2));
    return (
      <View>
        {pairs.map((pair, pi) => (
          <View key={pi} style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
            {pair.map(m => {
              // 年度内のその月のデータ取得（1〜3月は翌年、4〜12月は年度開始年）
              const dataYear = m >= 4 ? currentFY : currentFY + 1;
              const evs = eventsForMonth(dataYear, m)
                .filter(ev => (isAdmin || !ev.hidden) && !isInAnyHoliday(ev.dateStr) && isCurrentFiscalYear(ev.dateStr));
              return (
                <View key={m} style={[styles.monthCard, { flex: 1, borderColor: termColor.border, backgroundColor: termColor.light }]}>
                  <Text style={[styles.monthCardLabel, { color: termColor.text }]}>{m}月</Text>
                  {evs.length === 0 ? (
                    <Text style={styles.noEventText}>イベントなし</Text>
                  ) : (
                    evs.map(ev => <EventChip key={ev.id} ev={ev} />)
                  )}
                </View>
              );
            })}
            {pair.length === 1 && <View style={{ flex: 1 }} />}
          </View>
        ))}
      </View>
    );
  };

  // ─── イベントチップレンダリング（共通） ─────────────────────
  const EventChip = ({ ev }: { ev: any }) => (
    <TouchableOpacity style={[styles.eventChip, ev.hidden && { opacity: 0.5 }]}
      onPress={() => openDetail(ev)} activeOpacity={0.8}>
      <View style={styles.eventChipImgWrap}>
        {ev.coverImage ? (
          <Image source={{ uri: ev.coverImage }} style={styles.eventCoverImgFull} resizeMode="cover" />
        ) : (
          <View style={[styles.eventCoverImgFull, { backgroundColor: '#E8E8E8', alignItems: 'center', justifyContent: 'center' }]}>
            {isAdmin && (
              <TouchableOpacity onPress={(e) => { e.stopPropagation?.(); pickEventCover(ev.id); }} style={{ alignItems: 'center' }}>
                <Ionicons name="camera-outline" size={22} color="#bbb" />
                <Text style={{ fontSize: 10, color: '#bbb', marginTop: 3 }}>画像追加</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
        {isAdmin && ev.coverImage && (
          <View style={styles.coverActionBtns}>
            <TouchableOpacity style={styles.coverActionBtn} onPress={(e) => { e.stopPropagation?.(); pickEventCover(ev.id); }}>
              <Ionicons name="camera-outline" size={13} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity style={[styles.coverActionBtn, { backgroundColor: 'rgba(220,50,50,0.75)' }]} onPress={(e) => { e.stopPropagation?.(); deleteEventCover(ev); }}>
              <Ionicons name="trash-outline" size={13} color="#fff" />
            </TouchableOpacity>
          </View>
        )}
        <View style={styles.eventChipGradient}>
          <Text style={styles.eventChipTitle} numberOfLines={2}>{ev.title}</Text>
          {ev.hidden && <Text style={styles.hiddenBadge}>非表示</Text>}
        </View>
      </View>
    </TouchableOpacity>
  );

  // ─── 長期休み月セクション ─────────────────────────────────
  const VacMonthSection = ({ vac, month }: { vac: VacTab; month: number }) => {
    const vc = VAC_COLORS[vac];
    const monthFlyers = flyers.filter(f => f.vacation === vac && f.month === month);
    const vacLabel = vc.label;
    const vacEvents = eventsForVacMonth(vacLabel, month).filter(ev => (isAdmin || !ev.hidden) && isCurrentFiscalYear(ev.dateStr));
    return (
      <View
        onLayout={e => { vacMonthRefs.current[`${vac}_${month}`] = e.nativeEvent.layout.y; }}
        style={[styles.vacSection, { borderColor: vc.border }]}
      >
        {/* 月ヘッダー + 詳細ボタン */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
          <Text style={[styles.vacMonthLabel, { color: vc.text, marginBottom: 0, flex: 1 }]}>{month}月</Text>
          {monthFlyers.map(flyer => (
            <View key={flyer.id} style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
              <TouchableOpacity style={[styles.flyerDetailBtn, { backgroundColor: vc.border }]} onPress={() => setFlyerPreview(flyer)}>
                <Ionicons name="document-text-outline" size={14} color="#fff" style={{ marginRight: 4 }} />
                <Text style={styles.flyerDetailBtnText}>詳細</Text>
              </TouchableOpacity>
              {isAdmin && (
                <>
                  <TouchableOpacity style={[styles.flyerDeleteBtn, { backgroundColor: '#E3F2FD', borderRadius: 8, padding: 6 }]} onPress={() => replaceFlyer(flyer)}>
                    <Ionicons name="camera-outline" size={15} color="#1565C0" />
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.flyerDeleteBtn, { padding: 6 }]} onPress={() => deleteFlyer(flyer)}>
                    <Ionicons name="trash-outline" size={15} color={COLORS.danger} />
                  </TouchableOpacity>
                </>
              )}
            </View>
          ))}
        </View>

        {/* 長期休み期間のイベント（年行事と同じカード形式・2列） */}
        {vacEvents.length > 0 && (
          <View style={{ marginBottom: 10 }}>
            <Text style={{ fontSize: 11, color: vc.text, fontWeight: 'bold', marginBottom: 6 }}>イベント</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {vacEvents.map(ev => (
                <View key={ev.id} style={{ width: '47%' }}>
                  <EventChip ev={ev} />
                </View>
              ))}
            </View>
          </View>
        )}

        {vacEvents.length === 0 && monthFlyers.length === 0 && (
          <Text style={styles.noEventText}>イベント・チラシなし</Text>
        )}

        {isAdmin && (
          <TouchableOpacity style={styles.uploadFlyerBtn} onPress={() => uploadFlyer(vac, month)}>
            <Ionicons name="cloud-upload-outline" size={18} color={vc.text} />
            <Text style={[styles.uploadFlyerBtnText, { color: vc.text }]}>チラシをアップロード</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  // ─── 詳細画面（インライン・アンマウントなし） ─────────────
  const detailPhotos = detailEvent
    ? (pastPhotos[detailEvent.id] || []).filter(p =>
        // fiscalYearが未設定の古いデータはそのまま表示、設定済みは前年度のみ
        p.fiscalYear === undefined || p.fiscalYear === currentFY - 1
      )
    : [];
  const detailDet = detailEvent ? details[detailEvent.id] : undefined;
  const DetailModal = (
    <Modal visible={detailOpen} animationType="none">
      {detailEvent ? (
        <SafeAreaView style={{ flex: 1, backgroundColor: '#FFF0F3' }}>
          {/* ヘッダー */}
          <View style={styles.detailHeader}>
            <TouchableOpacity onPress={() => setDetailOpen(false)}>
              <Ionicons name="chevron-back" size={24} color="#5D4037" />
            </TouchableOpacity>
            <Text style={styles.detailTitle} numberOfLines={1}>{detailEvent.title}</Text>
            {isAdmin && (
              <TouchableOpacity
                style={[styles.hiddenToggleBtn, detailEvent.hidden ? styles.hiddenToggleBtnHidden : styles.hiddenToggleBtnVisible]}
                onPress={() => toggleHidden(detailEvent)}
              >
                <Ionicons name={detailEvent.hidden ? 'eye-off' : 'eye'} size={15} color="#fff" />
                <Text style={{ fontSize: 11, marginLeft: 3, color: '#fff', fontWeight: 'bold' }}>
                  {detailEvent.hidden ? '非表示' : '表示中'}
                </Text>
              </TouchableOpacity>
            )}
            {isUser && (
              <TouchableOpacity
                style={[styles.joinBtn, myParticipations[detailEvent.id] === '参加' ? styles.joinBtnActive : styles.joinBtnInactive]}
                onPress={() => toggleParticipation(detailEvent.id)}
              >
                <Ionicons name={myParticipations[detailEvent.id] === '参加' ? 'checkmark-circle' : 'add-circle-outline'} size={15} color="#fff" />
                <Text style={{ fontSize: 11, marginLeft: 3, color: '#fff', fontWeight: 'bold' }}>
                  {myParticipations[detailEvent.id] === '参加' ? '参加中' : '参加する'}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {/* カバー画像 */}
          {detailEvent.coverImage && (
            <Image source={{ uri: detailEvent.coverImage }} style={styles.detailCover} resizeMode="cover" />
          )}

          <ScrollView contentContainerStyle={{ padding: 14, gap: 10 }}>

            {/* ── セクション①：説明・日時 */}
            <View style={[styles.section, { borderColor: '#D6EEFF', backgroundColor: '#EEF7FF' }]}>
              <TouchableOpacity style={[styles.sectionHeader, { backgroundColor: '#D6EEFF' }]} onPress={() => setSecDesc(!secDesc)}>
                <Ionicons name="document-text-outline" size={18} color="#4A90C4" />
                <Text style={[styles.sectionTitle, { color: '#3A7AAA' }]}>説明・日時</Text>
                <View style={{ flex: 1 }} />
                <Ionicons name={secDesc ? 'chevron-up' : 'chevron-down'} size={18} color="#4A90C4" />
              </TouchableOpacity>
              <View style={[styles.sectionBody, { borderColor: '#D6EEFF', backgroundColor: '#EEF7FF' }, !secDesc && { display: 'none' }]}>
                <Text style={styles.dateText}>{formatDateWithDay(detailEvent.dateStr)}</Text>
                {editDesc ? (
                  <View style={{ marginTop: 10 }}>
                    <RichEditor value={descDraft} onChange={setDescDraft} />
                    <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                      <TouchableOpacity style={[styles.saveBtn, { flex: 1 }]} onPress={() => saveDetail('description')} disabled={saving}>
                        <Text style={styles.saveBtnText}>{saving ? '保存中...' : '保存'}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.cancelBtn, { flex: 1 }]} onPress={() => setEditDesc(false)}>
                        <Text style={styles.cancelBtnText}>キャンセル</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : (
                  <View style={{ marginTop: 10 }}>
                    {detailDet?.description ? <RichText doc={detailDet.description} /> : <Text style={styles.emptyText}>説明はまだありません</Text>}
                    {isAdmin && (
                      <TouchableOpacity style={styles.editBtn} onPress={() => { setDescDraft(detailDet?.description || EMPTY_RICH); setEditDesc(true); }}>
                        <Ionicons name="pencil-outline" size={14} color={COLORS.primary} />
                        <Text style={styles.editBtnText}>編集</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
              </View>
            </View>

            {/* ── セクション②：持ち込み・参加費等 */}
            <View style={[styles.section, { borderColor: '#C8EFD4', backgroundColor: '#EEF9F2' }]}>
              <TouchableOpacity style={[styles.sectionHeader, { backgroundColor: '#C8EFD4' }]} onPress={() => setSecItems(!secItems)}>
                <Ionicons name="bag-outline" size={18} color="#4A9A6A" />
                <Text style={[styles.sectionTitle, { color: '#3A7A55' }]}>持ち込み・参加費等</Text>
                <View style={{ flex: 1 }} />
                <Ionicons name={secItems ? 'chevron-up' : 'chevron-down'} size={18} color="#4A9A6A" />
              </TouchableOpacity>
              <View style={[styles.sectionBody, { borderColor: '#C8EFD4', backgroundColor: '#EEF9F2' }, !secItems && { display: 'none' }]}>
                {editItems ? (
                  <View>
                    <RichEditor value={itemsDraft} onChange={setItemsDraft} />
                    <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                      <TouchableOpacity style={[styles.saveBtn, { flex: 1 }]} onPress={() => saveDetail('items')} disabled={saving}>
                        <Text style={styles.saveBtnText}>{saving ? '保存中...' : '保存'}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.cancelBtn, { flex: 1 }]} onPress={() => setEditItems(false)}>
                        <Text style={styles.cancelBtnText}>キャンセル</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : (
                  <View>
                    {detailDet?.items ? <RichText doc={detailDet.items} /> : <Text style={styles.emptyText}>情報はまだありません</Text>}
                    {isAdmin && (
                      <TouchableOpacity style={styles.editBtn} onPress={() => { setItemsDraft(detailDet?.items || EMPTY_RICH); setEditItems(true); }}>
                        <Ionicons name="pencil-outline" size={14} color={COLORS.primary} />
                        <Text style={styles.editBtnText}>編集</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
              </View>
            </View>

            {/* ── セクション③：去年の写真 */}
            <View style={[styles.section, { borderColor: '#E8D6F5', backgroundColor: '#F5EEFF' }]}>
              <TouchableOpacity style={[styles.sectionHeader, { backgroundColor: '#E8D6F5' }]} onPress={() => setSecPhotos(!secPhotos)}>
                <Ionicons name="images-outline" size={18} color="#8A5BB5" />
                <Text style={[styles.sectionTitle, { color: '#7A4A9A' }]}>去年の写真</Text>
                <View style={{ flex: 1 }} />
                <Text style={[styles.photoCount, { color: '#8A5BB5' }]}>{detailPhotos.length}枚</Text>
                <Ionicons name={secPhotos ? 'chevron-up' : 'chevron-down'} size={18} color="#8A5BB5" />
              </TouchableOpacity>
              <View style={[styles.sectionBody, { borderColor: '#E8D6F5', backgroundColor: '#F5EEFF' }, !secPhotos && { display: 'none' }]}>
                {isAdmin && (
                  <TouchableOpacity style={styles.uploadPhotoBtn} onPress={uploadPastPhoto}>
                    <Ionicons name="cloud-upload-outline" size={16} color={COLORS.primary} />
                    <Text style={styles.uploadPhotoBtnText}>写真をアップロード</Text>
                  </TouchableOpacity>
                )}
                {uploading && <ActivityIndicator size="small" color={COLORS.primary} style={{ margin: 8 }} />}
                {detailPhotos.length === 0 ? (
                  <Text style={styles.emptyText}>写真はまだありません</Text>
                ) : (
                  <View style={styles.photoGrid}>
                    {detailPhotos.map((p, idx) => (
                      <TouchableOpacity key={p.id} style={styles.photoThumbWrap} onPress={() => { setPreviewPhotos(detailPhotos); setPreviewIdx(idx); }}>
                        <Image source={{ uri: p.uri }} style={styles.photoThumb} />
                        {isAdmin && (
                          <TouchableOpacity style={styles.photoDeleteBtn} onPress={() => deletePastPhoto(p)}>
                            <Ionicons name="close-circle" size={18} color={COLORS.danger} />
                          </TouchableOpacity>
                        )}
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            </View>

            <View style={{ height: 40 }} />
          </ScrollView>
        </SafeAreaView>
      ) : null}
    </Modal>
  );

  // ─── メインレンダリング ───────────────────────────────────
  if (checking || !verified) return null;
  return (
    <SafeAreaView style={styles.container}>
      {/* ヘッダー */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color="#5D4037" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>イベント詳細</Text>
      </View>

      {/* メインタブ */}
      <View style={styles.mainTabRow}>
        <TouchableOpacity style={[styles.mainTab, mainTab === 'year' && styles.mainTabActive]} onPress={() => setMainTab('year')}>
          <Text style={[styles.mainTabText, mainTab === 'year' && styles.mainTabTextActive]}>年行事</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.mainTab, mainTab === 'vacation' && styles.mainTabActive]} onPress={() => setMainTab('vacation')}>
          <Text style={[styles.mainTabText, mainTab === 'vacation' && styles.mainTabTextActive]}>長期休み</Text>
        </TouchableOpacity>
        {(isAdmin || role === 'staff') && (
          <TouchableOpacity style={[styles.mainTab, mainTab === 'management' && styles.mainTabActive]} onPress={() => setMainTab('management')}>
            <Text style={[styles.mainTabText, mainTab === 'management' && styles.mainTabTextActive]}>イベント管理</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* ── 年行事タブ ── */}
      {mainTab === 'year' && (
        <View style={{ flex: 1 }}>
          {/* 学期ジャンプボタン */}
          <View style={styles.termJumpRow}>
            {([1, 2, 3] as const).map(t => (
              <TouchableOpacity key={t} style={[styles.termJumpBtn, { borderColor: TERM_COLORS[t].border, backgroundColor: TERM_COLORS[t].bg }]}
                onPress={() => {
                  const offset = termOffsets.current[t] || 0;
                  yearScrollRef.current?.scrollTo({ y: offset, animated: true });
                }}>
                <Text style={[styles.termJumpText, { color: TERM_COLORS[t].text }]}>{t}学期</Text>
              </TouchableOpacity>
            ))}
          </View>

          <ScrollView ref={yearScrollRef} contentContainerStyle={{ padding: 14 }}>
            {([1, 2, 3] as const).map(term => {
              const tc = TERM_COLORS[term];
              const months = term === 1 ? TERM1_MONTHS : term === 2 ? TERM2_MONTHS : TERM3_MONTHS;
              return (
                <View key={term}
                  onLayout={e => { termOffsets.current[term] = e.nativeEvent.layout.y; }}
                  style={[styles.termSection, { borderLeftColor: tc.border, backgroundColor: tc.bg }]}>
                  <Text style={[styles.termLabel, { color: tc.text }]}>{term}学期</Text>
                  <Text style={styles.termMonthRange}>
                    {months[0]}月 〜 {months[months.length - 1]}月
                  </Text>
                  <MonthPair months={months} termColor={tc} />
                </View>
              );
            })}
            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
      )}

      {/* ── 長期休みタブ ── */}
      {mainTab === 'vacation' && (
        <View style={{ flex: 1 }}>
          {/* 休み種別タブ */}
          <View style={styles.vacTabRow}>
            {(['summer', 'winter', 'spring'] as VacTab[]).map(v => {
              const vc = VAC_COLORS[v];
              return (
                <TouchableOpacity key={v}
                  style={[styles.vacTab, vacTab === v && { backgroundColor: vc.bg, borderBottomColor: vc.border }]}
                  onPress={() => setVacTab(v)}>
                  <Text style={[styles.vacTabText, vacTab === v && { color: vc.text, fontWeight: 'bold' }]}>{vc.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* 月ジャンプボタン */}
          <View style={styles.termJumpRow}>
            {(getVacMonths(VAC_COLORS[vacTab].label).length > 0 ? getVacMonths(VAC_COLORS[vacTab].label) : VAC_MONTHS[vacTab]).map(m => {
              const vc = VAC_COLORS[vacTab];
              return (
                <TouchableOpacity key={m}
                  style={[styles.termJumpBtn, { borderColor: vc.border, backgroundColor: vc.bg }]}
                  onPress={() => {
                    const offset = vacMonthRefs.current[`${vacTab}_${m}`] || 0;
                    vacScrollRef.current?.scrollTo({ y: offset, animated: true });
                  }}>
                  <Text style={[styles.termJumpText, { color: vc.text }]}>{m}月</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <ScrollView ref={vacScrollRef} contentContainerStyle={{ padding: 14 }}>
            {(getVacMonths(VAC_COLORS[vacTab].label).length > 0 ? getVacMonths(VAC_COLORS[vacTab].label) : VAC_MONTHS[vacTab]).map(m => <VacMonthSection key={m} vac={vacTab} month={m} />)}
            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
      )}

      {/* ── イベント管理タブ ── */}
      {mainTab === 'management' && (isAdmin || role === 'staff') && (
        <View style={{ flex: 1 }}>
          {/* 月ナビ */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 10, backgroundColor: '#fff', borderBottomWidth: 1, borderColor: '#EEE', gap: 16 }}>
            <TouchableOpacity onPress={() => setMgmtDate(new Date(mgmtDate.getFullYear(), mgmtDate.getMonth() - 1, 1))} style={{ padding: 6 }}>
              <Ionicons name="chevron-back" size={22} color={COLORS.primary} />
            </TouchableOpacity>
            <Text style={{ fontSize: 16, fontWeight: 'bold', color: '#333' }}>{mgmtDate.getFullYear()}年 {mgmtDate.getMonth() + 1}月</Text>
            <TouchableOpacity onPress={() => setMgmtDate(new Date(mgmtDate.getFullYear(), mgmtDate.getMonth() + 1, 1))} style={{ padding: 6 }}>
              <Ionicons name="chevron-forward" size={22} color={COLORS.primary} />
            </TouchableOpacity>
          </View>
          <ScrollView>
            {/* カレンダーグリッド */}
            <View style={{ padding: 10 }}>
              <View style={{ flexDirection: 'row', marginBottom: 4 }}>
                {['日','月','火','水','木','金','土'].map((d, i) => (
                  <Text key={i} style={{ flex: 1, textAlign: 'center', fontSize: 12, fontWeight: 'bold', color: i === 0 ? '#E53935' : i === 6 ? '#1E88E5' : '#555' }}>{d}</Text>
                ))}
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                {mgmtGenerateDays().map((item, idx) => {
                  if (!item) return <View key={`e${idx}`} style={{ width: '14.28%', aspectRatio: 1, padding: 2 }} />;
                  const ev = Object.values(mgmtEventsMap).find((e: any) => e.dateStr === item.dateStr);
                  const dow = new Date(item.dateStr).getDay();
                  const isHol = !!mgmtPublicHolidays[item.dateStr];
                  const color = (dow === 0 || isHol) ? '#E53935' : dow === 6 ? '#1E88E5' : '#333';
                  return (
                    <TouchableOpacity key={item.dateStr} onPress={() => mgmtOpenModal(item.dateStr)}
                      style={{ width: '14.28%', aspectRatio: 1, padding: 2 }}>
                      <View style={[{ flex: 1, borderRadius: 6, alignItems: 'center', justifyContent: 'flex-start', paddingTop: 3, borderWidth: 1, borderColor: '#EEE', backgroundColor: ev ? '#FFF8E1' : '#fff' }]}>
                        <Text style={{ fontSize: 12, color, fontWeight: 'bold' }}>{item.day}</Text>
                        {ev && <Text style={{ fontSize: 8, color: COLORS.primary, textAlign: 'center', marginTop: 1 }} numberOfLines={2}>{ev.title}</Text>}
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
            {/* イベント一覧 */}
            <View style={{ padding: 10, gap: 8 }}>
              <Text style={{ fontSize: 13, fontWeight: 'bold', color: '#888', marginBottom: 4 }}>この月のイベント</Text>
              {Object.values(mgmtEventsMap)
                .filter((e: any) => e.dateStr?.startsWith(`${mgmtDate.getFullYear()}-${String(mgmtDate.getMonth()+1).padStart(2,'0')}`))
                .sort((a: any, b: any) => a.dateStr.localeCompare(b.dateStr))
                .map((ev: any) => {
                  const parts = mgmtParticipants[ev.id] || [];
                  const attending = parts.filter((p: any) => p.status === '参加').length + (ev.externalParticipants?.length || 0);
                  return (
                    <TouchableOpacity key={ev.id} style={{ backgroundColor: '#fff', borderRadius: 10, padding: 12, borderLeftWidth: 4, borderLeftColor: COLORS.primary, shadowColor: '#000', shadowOpacity: 0.05, elevation: 2 }}
                      onPress={() => mgmtOpenModal(ev.dateStr)}>
                      <Text style={{ fontSize: 13, fontWeight: 'bold', color: '#333' }}>{ev.dateStr}　{ev.title}</Text>
                      <Text style={{ fontSize: 11, color: '#888', marginTop: 2 }}>参加 {attending}名</Text>
                    </TouchableOpacity>
                  );
                })
              }
              {Object.values(mgmtEventsMap).filter((e: any) => e.dateStr?.startsWith(`${mgmtDate.getFullYear()}-${String(mgmtDate.getMonth()+1).padStart(2,'0')}`)).length === 0 && (
                <Text style={{ color: '#bbb', textAlign: 'center', paddingVertical: 20 }}>この月のイベントはありません</Text>
              )}
            </View>
          </ScrollView>

          {/* イベント管理モーダル（タブ: イベント編集 / 参加者管理） */}
          <Modal visible={mgmtModalVisible} animationType="slide" transparent>
            <SafeAreaView style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
              <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, height: '92%' }}>

                {/* ヘッダー */}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', padding: 20, borderBottomWidth: 1, borderColor: '#EEE' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 17, fontWeight: 'bold', color: '#333' }}>
                      {(() => { const ev = Object.values(mgmtEventsMap).find((e: any) => e.dateStr === mgmtSelectedDate); return ev ? (ev as any).title : mgmtSelectedDate; })()}
                    </Text>
                    <Text style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{mgmtSelectedDate}</Text>
                  </View>
                  <TouchableOpacity onPress={() => setMgmtModalVisible(false)}>
                    <Ionicons name="close" size={28} color="#333" />
                  </TouchableOpacity>
                </View>

                {/* タブ */}
                <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderColor: '#EEE' }}>
                  {(['list', 'add'] as const).map((t) => {
                    const ev = Object.values(mgmtEventsMap).find((e: any) => e.dateStr === mgmtSelectedDate);
                    const parts = ev ? (mgmtParticipants[(ev as any).id] || []) : [];
                    const extCount = (ev as any)?.externalParticipants?.length || 0;
                    const total = parts.filter((p: any) => p.status === '参加').length + extCount;
                    const label = t === 'list' ? `参加者メンバー（${total}名）` : '新規追加';
                    return (
                      <TouchableOpacity key={t}
                        style={{ flex: 1, paddingVertical: 13, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: mgmtParticipantTab === t ? COLORS.primary : 'transparent' }}
                        onPress={() => setMgmtParticipantTab(t)}
                      >
                        <Text style={{ fontSize: 14, fontWeight: 'bold', color: mgmtParticipantTab === t ? COLORS.primary : '#888' }}>{label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* ── 参加者一覧タブ ── */}
                {mgmtParticipantTab === 'list' && (() => {
                  const ev = Object.values(mgmtEventsMap).find((e: any) => e.dateStr === mgmtSelectedDate);
                  const parts = ev ? (mgmtParticipants[(ev as any).id] || []) : [];
                  const attending = parts.filter((p: any) => p.status === '参加');
                  const extParts = (ev as any)?.externalParticipants || [];
                  return (
                    <ScrollView style={{ flex: 1, padding: 16 }}>
                      {/* イベント編集フォーム */}
                      <Text style={{ fontSize: 13, fontWeight: 'bold', color: '#555', marginBottom: 6 }}>イベント名</Text>
                      <TextInput style={{ borderWidth: 1, borderColor: '#E0E0E0', borderRadius: 8, padding: 10, marginBottom: 10, fontSize: 14 }}
                        value={mgmtTitle} onChangeText={setMgmtTitle} placeholder="イベントタイトル" placeholderTextColor="#C0C0C0" />
                      <Text style={{ fontSize: 13, fontWeight: 'bold', color: '#555', marginBottom: 6 }}>説明</Text>
                      <TextInput style={{ borderWidth: 1, borderColor: '#E0E0E0', borderRadius: 8, padding: 10, marginBottom: 12, fontSize: 14, height: 70 }}
                        value={mgmtDesc} onChangeText={setMgmtDesc} placeholder="説明（任意）" placeholderTextColor="#C0C0C0" multiline />
                      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 20 }}>
                        {ev && (
                          <TouchableOpacity style={{ flex: 1, padding: 11, backgroundColor: '#FFEBEE', borderRadius: 10, alignItems: 'center' }} onPress={mgmtDeleteEvent}>
                            <Text style={{ color: '#E53935', fontWeight: 'bold', fontSize: 13 }}>削除</Text>
                          </TouchableOpacity>
                        )}
                        <TouchableOpacity style={{ flex: 1, padding: 11, backgroundColor: '#F0F0F0', borderRadius: 10, alignItems: 'center' }} onPress={() => setMgmtModalVisible(false)}>
                          <Text style={{ color: '#555', fontWeight: 'bold', fontSize: 13 }}>キャンセル</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={{ flex: 2, padding: 11, backgroundColor: COLORS.primary, borderRadius: 10, alignItems: 'center' }} onPress={mgmtSaveEvent}>
                          <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 13 }}>保存</Text>
                        </TouchableOpacity>
                      </View>

                      {/* 参加者一覧 */}
                      <Text style={{ fontSize: 15, fontWeight: 'bold', color: '#333', marginBottom: 10 }}>学童メンバー（{attending.length}名）</Text>
                      {attending.length === 0
                        ? <Text style={{ color: '#aaa', fontStyle: 'italic', marginBottom: 8 }}>まだ登録がありません</Text>
                        : attending.map((p: any) => (
                          <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderColor: '#F5F5F5' }}>
                            <View style={{ flex: 1 }}>
                              <Text style={{ fontSize: 15, fontWeight: 'bold', color: '#333' }}>{p.childName}</Text>
                              {(p.childSchool || p.childGrade) && (
                                <Text style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{[p.childSchool, p.childGrade].filter(Boolean).join(' / ')}</Text>
                              )}
                            </View>
                            <TouchableOpacity onPress={() => mgmtRemoveMember(p.id)} style={{ padding: 6 }}>
                              <Ionicons name="trash-outline" size={18} color="#E53935" />
                            </TouchableOpacity>
                          </View>
                        ))
                      }
                      <Text style={{ fontSize: 15, fontWeight: 'bold', color: '#333', marginTop: 18, marginBottom: 10 }}>外部参加者（{extParts.length}名）</Text>
                      {extParts.length === 0
                        ? <Text style={{ color: '#aaa', fontStyle: 'italic', marginBottom: 8 }}>まだ登録がありません</Text>
                        : extParts.map((ext: any) => (
                          <View key={ext.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderColor: '#F5F5F5' }}>
                            <View style={{ flex: 1 }}>
                              <Text style={{ fontSize: 15, fontWeight: 'bold', color: '#333' }}>{ext.name}</Text>
                              {(ext.school || ext.grade) && (
                                <Text style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{[ext.school, ext.grade].filter(Boolean).join(' / ')}</Text>
                              )}
                            </View>
                            <TouchableOpacity onPress={() => mgmtRemoveExternal(ext.id)} style={{ padding: 6 }}>
                              <Ionicons name="trash-outline" size={18} color="#E53935" />
                            </TouchableOpacity>
                          </View>
                        ))
                      }
                      <View style={{ height: 40 }} />
                    </ScrollView>
                  );
                })()}

                {/* ── 新規追加タブ ── */}
                {mgmtParticipantTab === 'add' && (
                  <View style={{ flex: 1 }}>
                    {/* サブタブ */}
                    <View style={{ flexDirection: 'row', margin: 12, borderRadius: 10, backgroundColor: '#F2F2F2', padding: 3 }}>
                      {([['user', '利用者から追加'], ['external', '非利用者から追加']] as const).map(([key, label]) => (
                        <TouchableOpacity key={key}
                          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 8, borderRadius: 8,
                            ...(mgmtAddSubTab === key ? { backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 4, elevation: 2 } : {}) }}
                          onPress={() => setMgmtAddSubTab(key)}
                        >
                          <Ionicons name={key === 'user' ? 'people-outline' : 'person-add-outline'} size={14} color={mgmtAddSubTab === key ? COLORS.primary : '#888'} />
                          <Text style={{ fontSize: 13, fontWeight: 'bold', color: mgmtAddSubTab === key ? COLORS.primary : '#888' }}>{label}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>

                    {/* 利用者から追加 */}
                    {mgmtAddSubTab === 'user' && (() => {
                      const ev = Object.values(mgmtEventsMap).find((e: any) => e.dateStr === mgmtSelectedDate);
                      const currentParts = ev ? (mgmtParticipants[(ev as any).id] || []) : [];
                      const filtered = mgmtAllMembers.filter(m => {
                        const q = mgmtMemberSearch.trim();
                        return (!q || m.name.includes(q) || (m.nicknameKana || '').includes(q))
                          && (!mgmtFilterSchool || m.school === mgmtFilterSchool)
                          && (!mgmtFilterGrade || m.grade === mgmtFilterGrade);
                      });
                      return (
                        <View style={{ flex: 1 }}>
                          {/* 検索バー */}
                          <View style={{ flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginBottom: 8, borderWidth: 1, borderColor: '#E0E0E0', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: '#FAFAFA' }}>
                            <Ionicons name="search-outline" size={16} color="#aaa" style={{ marginRight: 6 }} />
                            <TextInput style={{ flex: 1, fontSize: 14, color: '#333' }} placeholder="名前・ニックネームで検索" placeholderTextColor="#C0C0C0"
                              value={mgmtMemberSearch} onChangeText={setMgmtMemberSearch} />
                            {mgmtMemberSearch.length > 0 && (
                              <TouchableOpacity onPress={() => setMgmtMemberSearch('')}>
                                <Ionicons name="close-circle" size={16} color="#aaa" />
                              </TouchableOpacity>
                            )}
                          </View>
                          {/* 学校フィルター */}
                          {mgmtAllSchools.length > 0 && (
                            <View style={{ marginHorizontal: 16, marginBottom: 6 }}>
                              <Text style={{ fontSize: 11, fontWeight: 'bold', color: '#888', marginBottom: 4 }}>学校</Text>
                              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                                <View style={{ flexDirection: 'row', gap: 6 }}>
                                  {['すべて', ...mgmtAllSchools].map(s => (
                                    <TouchableOpacity key={s}
                                      style={{ paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, borderWidth: 1,
                                        borderColor: (s === 'すべて' ? !mgmtFilterSchool : mgmtFilterSchool === s) ? COLORS.primary : '#DDD',
                                        backgroundColor: (s === 'すべて' ? !mgmtFilterSchool : mgmtFilterSchool === s) ? COLORS.primary : '#fff' }}
                                      onPress={() => setMgmtFilterSchool(s === 'すべて' ? '' : (mgmtFilterSchool === s ? '' : s))}
                                    >
                                      <Text style={{ fontSize: 12, fontWeight: 'bold', color: (s === 'すべて' ? !mgmtFilterSchool : mgmtFilterSchool === s) ? '#fff' : '#555' }}>{s}</Text>
                                    </TouchableOpacity>
                                  ))}
                                </View>
                              </ScrollView>
                            </View>
                          )}
                          {/* 学年フィルター */}
                          {mgmtAllGrades.length > 0 && (
                            <View style={{ marginHorizontal: 16, marginBottom: 8 }}>
                              <Text style={{ fontSize: 11, fontWeight: 'bold', color: '#888', marginBottom: 4 }}>学年</Text>
                              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                                <View style={{ flexDirection: 'row', gap: 6 }}>
                                  {['すべて', ...mgmtAllGrades].map(g => (
                                    <TouchableOpacity key={g}
                                      style={{ paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, borderWidth: 1,
                                        borderColor: (g === 'すべて' ? !mgmtFilterGrade : mgmtFilterGrade === g) ? COLORS.primary : '#DDD',
                                        backgroundColor: (g === 'すべて' ? !mgmtFilterGrade : mgmtFilterGrade === g) ? COLORS.primary : '#fff' }}
                                      onPress={() => setMgmtFilterGrade(g === 'すべて' ? '' : (mgmtFilterGrade === g ? '' : g))}
                                    >
                                      <Text style={{ fontSize: 12, fontWeight: 'bold', color: (g === 'すべて' ? !mgmtFilterGrade : mgmtFilterGrade === g) ? '#fff' : '#555' }}>{g}</Text>
                                    </TouchableOpacity>
                                  ))}
                                </View>
                              </ScrollView>
                            </View>
                          )}
                          {/* メンバーリスト */}
                          <ScrollView style={{ flex: 1, paddingHorizontal: 16 }}>
                            {filtered.length === 0
                              ? <Text style={{ color: '#aaa', textAlign: 'center', marginTop: 24 }}>該当するメンバーがいません</Text>
                              : filtered.map(member => {
                                const added = currentParts.some((p: any) => p.childName === member.name);
                                return (
                                  <TouchableOpacity key={member.id}
                                    style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderColor: '#F5F5F5', gap: 10, opacity: added ? 0.5 : 1 }}
                                    onPress={() => { if (!added) mgmtAddMember(member); }}
                                    disabled={added} activeOpacity={0.7}
                                  >
                                    <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: COLORS.primary + '20', alignItems: 'center', justifyContent: 'center' }}>
                                      <Text style={{ fontSize: 16, fontWeight: 'bold', color: COLORS.primary }}>{member.name.charAt(0)}</Text>
                                    </View>
                                    <View style={{ flex: 1 }}>
                                      <Text style={{ fontSize: 15, fontWeight: 'bold', color: added ? '#aaa' : '#333' }}>{member.name}</Text>
                                      {(member.school || member.grade) && (
                                        <Text style={{ fontSize: 12, color: '#888', marginTop: 1 }}>{[member.school, member.grade].filter(Boolean).join(' ・ ')}</Text>
                                      )}
                                    </View>
                                    {added
                                      ? <View style={{ backgroundColor: '#E0E0E0', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 }}><Text style={{ fontSize: 11, color: '#757575', fontWeight: 'bold' }}>追加済</Text></View>
                                      : <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="add" size={18} color="#fff" /></View>
                                    }
                                  </TouchableOpacity>
                                );
                              })
                            }
                            <View style={{ height: 40 }} />
                          </ScrollView>
                        </View>
                      );
                    })()}

                    {/* 非利用者から追加 */}
                    {mgmtAddSubTab === 'external' && (
                      <ScrollView style={{ flex: 1, padding: 16 }}>
                        <Text style={{ fontSize: 13, color: '#888', marginBottom: 12, lineHeight: 18 }}>学童に登録のない外部参加者を手動で追加できます。</Text>
                        <Text style={{ fontSize: 13, fontWeight: 'bold', color: '#555', marginBottom: 6 }}>氏名 *</Text>
                        <TextInput style={{ borderWidth: 1, borderColor: '#E0E0E0', borderRadius: 8, padding: 10, marginBottom: 10, fontSize: 14 }}
                          value={mgmtExtName} onChangeText={setMgmtExtName} placeholder="例: 田中 太郎" placeholderTextColor="#C0C0C0" />
                        <Text style={{ fontSize: 13, fontWeight: 'bold', color: '#555', marginBottom: 6 }}>学校名</Text>
                        <TextInput style={{ borderWidth: 1, borderColor: '#E0E0E0', borderRadius: 8, padding: 10, marginBottom: 10, fontSize: 14 }}
                          value={mgmtExtSchool} onChangeText={setMgmtExtSchool} placeholder="例: ○○小学校" placeholderTextColor="#C0C0C0" />
                        <Text style={{ fontSize: 13, fontWeight: 'bold', color: '#555', marginBottom: 6 }}>学年</Text>
                        <TextInput style={{ borderWidth: 1, borderColor: '#E0E0E0', borderRadius: 8, padding: 10, marginBottom: 20, fontSize: 14 }}
                          value={mgmtExtGrade} onChangeText={setMgmtExtGrade} placeholder="例: 小3" placeholderTextColor="#C0C0C0" />
                        <TouchableOpacity
                          style={{ flexDirection: 'row', padding: 14, backgroundColor: mgmtExtName.trim() ? COLORS.primary : '#CCC', borderRadius: 10, alignItems: 'center', justifyContent: 'center', gap: 6 }}
                          onPress={mgmtAddExternal} disabled={!mgmtExtName.trim()}
                        >
                          <Ionicons name="person-add-outline" size={16} color="#fff" />
                          <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 14 }}>外部参加者として追加</Text>
                        </TouchableOpacity>
                        <View style={{ height: 60 }} />
                      </ScrollView>
                    )}
                  </View>
                )}

              </View>
            </SafeAreaView>
          </Modal>
        </View>
      )}

      {/* 詳細モーダル */}
      {DetailModal}

      {/* 写真フルスクリーン */}
      <Modal visible={!!previewPhotos} transparent animationType="fade">
        <View style={styles.fsOverlay}>
          <TouchableOpacity style={styles.fsClose} onPress={() => setPreviewPhotos(null)}>
            <Ionicons name="close" size={28} color="#fff" />
          </TouchableOpacity>
          {previewPhotos && (
            <>
              <Image source={{ uri: previewPhotos[previewIdx].uri }} style={styles.fsImage} resizeMode="contain" />
              <View style={styles.fsNav}>
                <TouchableOpacity onPress={() => setPreviewIdx(i => Math.max(0, i - 1))} disabled={previewIdx === 0}>
                  <Ionicons name="chevron-back" size={32} color={previewIdx === 0 ? '#555' : '#fff'} />
                </TouchableOpacity>
                <Text style={{ color: '#fff' }}>{previewIdx + 1} / {previewPhotos.length}</Text>
                <TouchableOpacity onPress={() => setPreviewIdx(i => Math.min(previewPhotos.length - 1, i + 1))} disabled={previewIdx === previewPhotos.length - 1}>
                  <Ionicons name="chevron-forward" size={32} color={previewIdx === previewPhotos.length - 1 ? '#555' : '#fff'} />
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </Modal>

      {/* チラシプレビュー */}
      <Modal visible={!!flyerPreview} transparent animationType="fade">
        <View style={styles.fsOverlay}>
          <TouchableOpacity style={styles.fsClose} onPress={() => setFlyerPreview(null)}>
            <Ionicons name="close" size={28} color="#fff" />
          </TouchableOpacity>
          {flyerPreview && (
            <Image source={{ uri: flyerPreview.uri }} style={styles.fsImage} resizeMode="contain" />
          )}
        </View>
      </Modal>

      {/* アップロードオーバーレイ */}
      {uploading && (
        <View style={styles.uploadOverlay}>
          <ActivityIndicator size="large" color="#fff" />
          <Text style={{ color: '#fff', marginTop: 10 }}>アップロード中...</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

// ─── スタイル ────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F8F8' },

  // ヘッダー
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: '#AEE4F5', borderBottomLeftRadius: 16, borderBottomRightRadius: 16 },
  backBtn: { marginRight: 10 },
  headerTitle: { fontSize: 18, fontWeight: 'bold', color: '#5D4037' },

  // メインタブ
  mainTabRow: { flexDirection: 'row', backgroundColor: '#fff', borderBottomWidth: 1, borderColor: '#EEE' },
  mainTab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 12, gap: 6, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  mainTabActive: { borderBottomColor: COLORS.primary },
  mainTabText: { fontSize: 15, color: '#888', fontWeight: 'bold' },
  mainTabTextActive: { color: COLORS.primary },

  // 学期ジャンプ
  termJumpRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: '#fff', borderBottomWidth: 1, borderColor: '#EEE' },
  termJumpBtn: { flex: 1, paddingVertical: 9, borderRadius: 8, borderWidth: 1.5, alignItems: 'center' },
  termJumpText: { fontSize: 13, fontWeight: 'bold' },

  // 学期セクション
  termSection: { borderLeftWidth: 4, borderRadius: 12, padding: 12, marginBottom: 16 },
  termLabel: { fontSize: 18, fontWeight: 'bold', marginBottom: 2 },
  termMonthRange: { fontSize: 12, color: '#888', marginBottom: 10 },

  // 月カード
  monthCard: { borderWidth: 1.5, borderRadius: 12, padding: 10, minHeight: 80 },
  monthCardLabel: { fontSize: 14, fontWeight: 'bold', marginBottom: 8 },
  noEventText: { fontSize: 12, color: '#bbb', textAlign: 'center', paddingVertical: 10 },

  // イベントチップ
  eventChip: { borderRadius: 10, overflow: 'hidden', marginBottom: 6, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E0E0E0', shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
  eventChipHeader: { padding: 8 },
  eventCoverImgFull: { width: '100%', height: 130 },
  eventCoverPlaceholderFull: { width: '100%', height: 70, backgroundColor: '#F5F5F5', alignItems: 'center', justifyContent: 'center' },
  eventCoverImg: { width: 60, height: 60 },
  eventCoverPlaceholder: { width: 60, height: 60, backgroundColor: '#F5F5F5', alignItems: 'center', justifyContent: 'center' },
  eventChipInfo: { padding: 7, borderTopWidth: 1, borderColor: '#F0F0F0' },
  eventChipImgWrap: { position: 'relative' },
  eventChipGradient: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.28)', paddingHorizontal: 6, paddingVertical: 3 },
  eventChipOverlay: { padding: 6, backgroundColor: 'rgba(0,0,0,0.42)' },
  eventChipTitle: { fontSize: 10, fontWeight: '500', color: '#fff' },
  eventChipDate: { fontSize: 9, color: 'rgba(255,255,255,0.82)' },
  hiddenBadge: { fontSize: 10, color: '#ffcccc', fontWeight: 'bold', marginTop: 2 },
  hiddenToggleBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8, marginLeft: 6 },
  hiddenToggleBtnVisible: { backgroundColor: '#7BC67E' },
  hiddenToggleBtnHidden: { backgroundColor: COLORS.danger },
  joinBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, marginLeft: 6 },
  joinBtnInactive: { backgroundColor: COLORS.primary },
  joinBtnActive: { backgroundColor: '#4CAF50' },
  addCoverBtn: { position: 'absolute', top: 6, right: 6, flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.4)', paddingHorizontal: 6, paddingVertical: 3, borderRadius: 8 },
  coverActionBtns: { position: 'absolute', top: 5, right: 5, flexDirection: 'row', gap: 4 },
  coverActionBtn: { backgroundColor: 'rgba(0,0,0,0.5)', padding: 5, borderRadius: 6 },

  // 長期休みタブ
  vacTabRow: { flexDirection: 'row', backgroundColor: '#fff', borderBottomWidth: 1, borderColor: '#EEE' },
  vacTab: { flex: 1, alignItems: 'center', paddingVertical: 10, borderBottomWidth: 3, borderBottomColor: 'transparent' },
  vacTabText: { fontSize: 14, color: '#888', fontWeight: 'bold' },

  // 長期休みセクション
  vacSection: { borderWidth: 1.5, borderRadius: 12, padding: 12, marginBottom: 12, backgroundColor: '#fff' },
  vacMonthLabel: { fontSize: 16, fontWeight: 'bold', marginBottom: 10 },

  // チラシ
  flyerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 8 },
  flyerThumb: { width: 80, height: 56, borderRadius: 6, backgroundColor: '#F5F5F5' },
  flyerDetailBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  flyerDetailBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 13 },
  flyerDeleteBtn: { padding: 8 },
  uploadFlyerBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 10, borderWidth: 1.5, borderStyle: 'dashed', borderRadius: 10, justifyContent: 'center', marginTop: 4 },
  uploadFlyerBtnText: { fontWeight: 'bold', fontSize: 13 },

  // 詳細画面
  detailHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: '#AEE4F5', gap: 8 },
  detailTitle: { fontSize: 17, fontWeight: 'bold', color: '#5D4037', flex: 1 },
  detailCover: { width: '100%', height: 180, backgroundColor: '#EEE' },

  // セクション
  section: { borderRadius: 14, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 6, elevation: 3, borderWidth: 1 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 8 },
  sectionTitle: { fontSize: 15, fontWeight: 'bold', color: '#333' },
  sectionBody: { padding: 14, paddingTop: 12, borderTopWidth: 1 },
  dateText: { fontSize: 14, fontWeight: 'bold', color: '#5D4037', marginBottom: 6 },
  photoCount: { fontSize: 12, color: '#aaa', marginRight: 4 },
  emptyText: { color: '#bbb', fontSize: 13, textAlign: 'center', paddingVertical: 12 },
  editBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8, alignSelf: 'flex-end', padding: 6 },
  editBtnText: { color: COLORS.primary, fontSize: 13 },
  saveBtn: { backgroundColor: COLORS.primary, padding: 12, borderRadius: 10, alignItems: 'center' },
  saveBtnText: { color: '#fff', fontWeight: 'bold' },
  cancelBtn: { backgroundColor: '#F0F0F0', padding: 12, borderRadius: 10, alignItems: 'center' },
  cancelBtnText: { color: '#555', fontWeight: 'bold' },

  // 去年の写真
  uploadPhotoBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 10, borderWidth: 1.5, borderStyle: 'dashed', borderColor: COLORS.primary, borderRadius: 10, justifyContent: 'center', marginBottom: 10 },
  uploadPhotoBtnText: { color: COLORS.primary, fontWeight: 'bold', fontSize: 13 },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  photoThumbWrap: { position: 'relative' },
  photoThumb: { width: 90, height: 90, borderRadius: 8, backgroundColor: '#EEE' },
  photoDeleteBtn: { position: 'absolute', top: -6, right: -6, backgroundColor: '#fff', borderRadius: 10 },

  // フルスクリーン
  fsOverlay: { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
  fsClose: { position: 'absolute', top: 50, right: 20, zIndex: 10, padding: 8 },
  fsImage: { width: '100%', height: '80%' },
  fsNav: { flexDirection: 'row', alignItems: 'center', gap: 40, marginTop: 16 },

  // アップロードオーバーレイ
  uploadOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', zIndex: 999 },
});