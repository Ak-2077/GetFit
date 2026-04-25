import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { changePassword } from '../../services/api';

export default function ChangePassword() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const onSave = async () => {
    if (!currentPassword || !newPassword) {
      Alert.alert('Missing fields', 'Please fill both fields');
      return;
    }
    try {
      await changePassword({ currentPassword, newPassword });
      Alert.alert('Success', 'Password updated');
      router.back();
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.message || 'Failed to change password');
    }
  };

  return (
    <View style={styles.page}>
      <Text style={styles.header}>Change Password</Text>
      <TextInput placeholder="Current password" value={currentPassword} onChangeText={setCurrentPassword} secureTextEntry style={styles.input} placeholderTextColor="#BDBDBD" />
      <TextInput placeholder="New password" value={newPassword} onChangeText={setNewPassword} secureTextEntry style={styles.input} placeholderTextColor="#BDBDBD" />

      <TouchableOpacity style={styles.primary} onPress={onSave}>
        <Text style={styles.primaryText}>Change password</Text>
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
