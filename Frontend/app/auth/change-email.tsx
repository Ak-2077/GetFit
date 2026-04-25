import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { changeEmail } from '../../services/api';

export default function ChangeEmail() {
  const router = useRouter();
  const [newEmail, setNewEmail] = useState('');
  const [password, setPassword] = useState('');

  const onSave = async () => {
    if (!newEmail || !password) {
      Alert.alert('Missing fields', 'Please fill both fields');
      return;
    }
    try {
      await changeEmail({ newEmail, password });
      Alert.alert('Success', 'Email updated');
      router.back();
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.message || 'Failed to change email');
    }
  };

  return (
    <View style={styles.page}>
      <Text style={styles.header}>Change Email</Text>
      <TextInput placeholder="New email" value={newEmail} onChangeText={setNewEmail} autoCapitalize="none" keyboardType="email-address" style={styles.input} placeholderTextColor="#BDBDBD" />
      <TextInput placeholder="Password" value={password} onChangeText={setPassword} secureTextEntry style={styles.input} placeholderTextColor="#BDBDBD" />

      <TouchableOpacity style={styles.primary} onPress={onSave}>
        <Text style={styles.primaryText}>Change email</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#0A0A0A', padding: 20 },
  header: { color: '#fff', fontSize: 24, fontWeight: '700', marginBottom: 16 },
  input: {
    height: 50,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 12,
    paddingHorizontal: 14,
    color: '#fff',
    marginBottom: 12,
  },
  primary: { height: 50, backgroundColor: '#000', borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  primaryText: { color: '#fff', fontWeight: '700' },
});
