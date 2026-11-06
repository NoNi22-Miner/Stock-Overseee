import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Button, Card, Field, styles } from '../components/ui';
import { addCategory, deleteCategory, listCategories, renameCategory } from '../lib/api';
import { useRole } from '../lib/auth';
import { can } from '../lib/roles';
import { colors } from '../lib/theme';
import type { Category } from '../lib/types';

/** Team Leader / Oversee: add, rename and delete product categories. */
export default function CategoriesScreen() {
  const manage = can.manageProducts(useRole());
  const [categories, setCategories] = useState<Category[]>([]);
  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    listCategories()
      .then(setCategories)
      .catch((e) => Alert.alert('Error', e.message));
  }, []);
  useFocusEffect(load);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
      load();
      return true;
    } catch (e) {
      Alert.alert('Could not save', (e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  function remove(c: Category) {
    Alert.alert('Delete category?', `Products in "${c.name}" will become Uncategorized.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => run(() => deleteCategory(c.id)) },
    ]);
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.pad} keyboardShouldPersistTaps="handled">
      {manage && (
        <Card style={{ gap: 10 }}>
          <Field
            label="New category"
            value={newName}
            onChangeText={setNewName}
            placeholder="e.g. Steel Pipe"
            maxLength={60}
            onSubmitEditing={() => newName.trim() && run(() => addCategory(newName)).then((ok) => ok && setNewName(''))}
          />
          <Button
            title="Add category"
            onPress={() => run(() => addCategory(newName)).then((ok) => ok && setNewName(''))}
            disabled={!newName.trim() || busy}
          />
        </Card>
      )}

      {categories.length === 0 && <Text style={styles.empty}>No categories yet.</Text>}
      {categories.map((c) =>
        editing === c.id ? (
          <Card key={c.id} style={{ gap: 8 }}>
            <TextInput style={styles.input} value={editName} onChangeText={setEditName} autoFocus maxLength={60} />
            <View style={styles.row}>
              <Button
                title="Save"
                style={{ flex: 1 }}
                onPress={() => run(() => renameCategory(c.id, editName)).then((ok) => ok && setEditing(null))}
                disabled={!editName.trim() || busy}
              />
              <Button
                title="Cancel"
                variant="outline"
                color={colors.muted}
                style={{ flex: 1 }}
                onPress={() => setEditing(null)}
              />
            </View>
          </Card>
        ) : (
          <Card key={c.id} style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={[styles.title, { flex: 1 }]}>{c.name}</Text>
            {manage && (
              <View style={[styles.row, { gap: 16 }]}>
                <Pressable
                  onPress={() => {
                    setEditing(c.id);
                    setEditName(c.name);
                  }}
                  hitSlop={8}
                >
                  <Text style={{ color: colors.primary, fontWeight: '600' }}>Rename</Text>
                </Pressable>
                <Pressable onPress={() => remove(c)} hitSlop={8}>
                  <Text style={{ color: colors.out, fontWeight: '600' }}>Delete</Text>
                </Pressable>
              </View>
            )}
          </Card>
        ),
      )}
    </ScrollView>
  );
}
