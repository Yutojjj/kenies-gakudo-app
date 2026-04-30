import React, { useState } from 'react';
import { FlatList, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { COLORS } from '../constants/theme';

interface Props {
  visible: boolean;
  title: string;
  items: string[];
  allowEdit?: boolean;
  onClose: () => void;
  onSelect: (item: string) => void;
  onAdd?: (item: string) => void;
  onDelete?: (item: string) => void;
}

export default function EditablePickerModal({ visible, title, items, allowEdit = true, onClose, onSelect, onAdd, onDelete }: Props) {
  const [newItem, setNewItem] = useState('');

  const handleAdd = () => {
    if (newItem.trim() !== '' && onAdd) {
      onAdd(newItem.trim());
      setNewItem('');
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={styles.content}>
          <Text style={styles.title}>{title}を選択</Text>
          <FlatList
            data={items}
            keyExtractor={(item, index) => index.toString()}
            style={{ maxHeight: 300 }}
            renderItem={({ item }) => (
              <View style={styles.listItem}>
                <TouchableOpacity style={styles.selectBtn} onPress={() => onSelect(item)}>
                  <Text style={styles.itemText}>{item}</Text>
                </TouchableOpacity>
                {allowEdit && onDelete && (
                  <TouchableOpacity style={styles.deleteBtn} onPress={() => onDelete(item)}>
                    <Text style={styles.deleteText}>削除</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          />
          {allowEdit && onAdd && (
            <View style={styles.addArea}>
              <TextInput
                style={styles.input}
                placeholder="新しい項目を追加"
                value={newItem}
                onChangeText={setNewItem}
              />
              <TouchableOpacity style={styles.addBtn} onPress={handleAdd}>
                <Text style={styles.btnTextWhite}>追加</Text>
              </TouchableOpacity>
            </View>
          )}
          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <Text style={styles.btnTextDark}>閉じる</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 },
  content: { backgroundColor: COLORS.white, borderRadius: 12, padding: 24, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 10, elevation: 5 },
  title: { fontSize: 18, fontWeight: 'bold', color: COLORS.text, marginBottom: 16, textAlign: 'center' },
  listItem: { flexDirection: 'row', borderBottomWidth: 1, borderColor: COLORS.border, paddingVertical: 12, alignItems: 'center' },
  selectBtn: { flex: 1 },
  itemText: { fontSize: 16, color: COLORS.text },
  deleteBtn: { paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#FFF0F0', borderRadius: 4 },
  deleteText: { color: COLORS.danger, fontSize: 12, fontWeight: 'bold' },
  addArea: { flexDirection: 'row', marginTop: 16, gap: 8 },
  input: { flex: 1, borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, paddingHorizontal: 12, color: COLORS.text },
  addBtn: { backgroundColor: COLORS.primary, paddingHorizontal: 16, justifyContent: 'center', borderRadius: 8 },
  btnTextWhite: { color: COLORS.white, fontWeight: 'bold' },
  closeBtn: { marginTop: 24, alignItems: 'center', paddingVertical: 12, backgroundColor: COLORS.background, borderRadius: 8 },
  btnTextDark: { color: COLORS.text, fontWeight: 'bold' }
});