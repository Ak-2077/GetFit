import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { forgotPassword } from '../../services/api';
import FontAwesome from '@expo/vector-icons/FontAwesome';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const onSubmit = async () => {
    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedEmail || !newPassword || !confirmPassword) {
      Alert.alert('Missing fields', 'Please fill all fields');
      return;
    }

    if (newPassword.length < 6) {
      Alert.alert('Weak password', 'New password must be at least 6 characters');
      return;
    }

    if (newPassword !== confirmPassword) {
      Alert.alert('Password mismatch', 'Passwords do not match');
      return;
    }

    try {
      await forgotPassword({ email: normalizedEmail, newPassword });
      Alert.alert('Success', 'Password reset successful. Please sign in.');
      router.replace('/auth');
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || 'Password reset failed';
      Alert.alert('Reset failed', msg);
    }
  };

  return (
    <View style={styles.page}>
      <View style={styles.card}>
        <Text style={styles.header}>Reset password</Text>
        <Text style={styles.sub}>Enter your email and set a new password</Text>

        <TextInput
          placeholder="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          style={styles.inputApple}
          placeholderTextColor="#BDBDBD"
        />

        <View style={styles.passwordRow}>
          <TextInput
            placeholder="New password"
            value={newPassword}
            onChangeText={setNewPassword}
            secureTextEntry={!showPassword}
            style={[styles.inputApple, { flex: 1 }]}
            placeholderTextColor="#BDBDBD"
          />
          <TouchableOpacity onPress={() => setShowPassword((s) => !s)} style={styles.eyeButton}>
            <FontAwesome name={showPassword ? 'eye' : 'eye-slash'} size={18} color="#BDBDBD" />
          </TouchableOpacity>
        </View>

        <TextInput
          placeholder="Confirm new password"
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          secureTextEntry={!showPassword}
          style={styles.inputApple}
          placeholderTextColor="#BDBDBD"
        />

        <TouchableOpacity style={styles.primary} onPress={onSubmit}>
          <Text style={styles.primaryText}>Reset password</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.backButton} onPress={() => router.replace('/auth')}>
          <Text style={styles.backText}>Back to sign in</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#0A0A0A', justifyContent: 'center', padding: 20 },
  card: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 14,
    padding: 20,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 10,
  },
  header: { color: '#fff', fontSize: 28, fontWeight: '700', marginBottom: 6 },
  sub: { color: '#BDBDBD', marginBottom: 16 },
  inputApple: {
    height: 50,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 12,
    paddingHorizontal: 14,
    color: '#fff',
    marginBottom: 12,
  },
  passwordRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  eyeButton: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginLeft: 8,
  },
  primary: {
    height: 50,
    backgroundColor: '#000',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  primaryText: { color: '#fff', fontWeight: '700' },
  backButton: {
    marginTop: 14,
    alignItems: 'center',
  },
  backText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});
