import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Alert,
  TextInput,
  Switch,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import {
  getUserProfile,
  updateUserProfile,
  changeUserPassword,
  deleteUserAccount,
  setAuthToken,
} from '../../services/api';

export default function ProfileSettingsScreen() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Editable fields
  const [name, setName] = useState('');
  const [avatarUri, setAvatarUri] = useState('');
  const [avatarData, setAvatarData] = useState<string | null>(null);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);

  // Change password modal
  const [passwordModalVisible, setPasswordModalVisible] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const loadProfile = useCallback(async () => {
    try {
      const token = await AsyncStorage.getItem('token');
      if (token) setAuthToken(token);

      const res = await getUserProfile();
      const u = res.data;
      setUser(u);
      setName(u?.name || '');
      setAvatarUri(u?.avatar || '');
      setNotificationsEnabled(u?.notificationsEnabled !== false);
    } catch (err: any) {
      console.warn('Failed to load profile', err?.response?.data || err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      loadProfile();
    }, [loadProfile])
  );

  // ─── Save Profile ─────────────────────────────────────

  const onSave = async () => {
    setSaving(true);
    try {
      const payload: Record<string, any> = {
        name: name.trim(),
        notificationsEnabled,
      };
      if (avatarData) payload.avatar = avatarData;

      await updateUserProfile(payload);
      Alert.alert('Saved', 'Profile updated successfully');
      router.back();
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.message || 'Failed to update');
    } finally {
      setSaving(false);
    }
  };

  // ─── Pick Photo ───────────────────────────────────────

  const onPickPhoto = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Allow photo access to update your profile picture.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
        base64: true,
      });

      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      if (!asset.base64) {
        Alert.alert('Error', 'Unable to read image data.');
        return;
      }

      const dataUri = `data:image/jpeg;base64,${asset.base64}`;
      setAvatarUri(asset.uri);
      setAvatarData(dataUri);
    } catch (err) {
      Alert.alert('Error', 'Failed to pick image');
    }
  };

  // ─── Change Password ──────────────────────────────────

  const onChangePassword = async () => {
    if (!currentPassword) {
      Alert.alert('Error', 'Enter your current password');
      return;
    }
    if (newPassword.length < 6) {
      Alert.alert('Error', 'New password must be at least 6 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert('Error', 'Passwords do not match');
      return;
    }

    setChangingPassword(true);
    try {
      await changeUserPassword({ currentPassword, newPassword });
      Alert.alert('Success', 'Password changed successfully');
      setPasswordModalVisible(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.message || 'Failed to change password');
    } finally {
      setChangingPassword(false);
    }
  };

  // ─── Sign Out ─────────────────────────────────────────

  const onSignOut = () => {
    Alert.alert('Sign out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          await AsyncStorage.removeItem('token');
          setAuthToken(null);
          router.replace('/auth');
        },
      },
    ]);
  };

  // ─── Delete Account ───────────────────────────────────

  const onDeleteAccount = () => {
    Alert.alert(
      'Delete Account?',
      'This will permanently delete your data. This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              await deleteUserAccount();
              await AsyncStorage.removeItem('token');
              setAuthToken(null);
              router.replace('/auth');
            } catch (err: any) {
              Alert.alert('Error', err?.response?.data?.message || 'Failed to delete account');
            } finally {
              setDeleting(false);
            }
          },
        },
      ]
    );
  };

  // ─── Avatar Helper ────────────────────────────────────

  const getInitials = () => {
    const n = name || user?.name || '';
    return n.trim().charAt(0).toUpperCase() || '?';
  };

  const hasAvatar = !!(avatarUri && avatarUri.length > 0);

  // ─── Loading ──────────────────────────────────────────

  if (loading) {
    return (
      <SafeAreaView style={styles.page}>
        <View style={styles.center}>
          <ActivityIndicator color="#fff" size="large" />
        </View>
      </SafeAreaView>
    );
  }

  // ─── Render ───────────────────────────────────────────

  return (
    <SafeAreaView style={styles.page}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {/* ─── BACK HEADER ─── */}
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
              <FontAwesome name="chevron-left" size={16} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Settings</Text>
            <View style={{ width: 40 }} />
          </View>

          {/* ─── AVATAR SECTION ─── */}
          <View style={styles.avatarSection}>
            {hasAvatar ? (
              <Image source={{ uri: avatarUri }} style={styles.largeAvatar} />
            ) : (
              <View style={[styles.largeAvatar, styles.initialsAvatar]}>
                <Text style={styles.initialsText}>{getInitials()}</Text>
              </View>
            )}
            <TouchableOpacity style={styles.editPhotoButton} onPress={onPickPhoto}>
              <FontAwesome name="camera" size={14} color="#fff" style={{ marginRight: 8 }} />
              <Text style={styles.editPhotoText}>Edit Photo</Text>
            </TouchableOpacity>
          </View>

          {/* ─── USER INFO ─── */}
          <Text style={styles.sectionLabel}>Personal Info</Text>
          <View style={styles.infoCard}>
            {/* Name */}
            <View style={styles.infoRow}>
              <View style={styles.infoIconBg}>
                <FontAwesome name="user" size={16} color="#fff" />
              </View>
              <View style={styles.infoContent}>
                <Text style={styles.infoLabel}>Name</Text>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  style={styles.infoInput}
                  placeholderTextColor="#6B7280"
                  placeholder="Your name"
                />
              </View>
            </View>

            <View style={styles.infoDivider} />

            {/* Email */}
            <View style={styles.infoRow}>
              <View style={styles.infoIconBg}>
                <FontAwesome name="envelope" size={14} color="#fff" />
              </View>
              <View style={styles.infoContent}>
                <Text style={styles.infoLabel}>Email</Text>
                <Text style={styles.infoValue}>{user?.email || 'Not set'}</Text>
              </View>
            </View>

            <View style={styles.infoDivider} />

            {/* Phone */}
            <View style={styles.infoRow}>
              <View style={styles.infoIconBg}>
                <FontAwesome name="phone" size={16} color="#fff" />
              </View>
              <View style={styles.infoContent}>
                <Text style={styles.infoLabel}>Phone</Text>
                <Text style={styles.infoValue}>{user?.phone || 'Not set'}</Text>
              </View>
            </View>

            <View style={styles.infoDivider} />

            {/* Password */}
            <TouchableOpacity
              style={styles.infoRow}
              onPress={() => setPasswordModalVisible(true)}
            >
              <View style={styles.infoIconBg}>
                <FontAwesome name="lock" size={16} color="#fff" />
              </View>
              <View style={styles.infoContent}>
                <Text style={styles.infoLabel}>Password</Text>
                <Text style={styles.infoValue}>••••••••</Text>
              </View>
              <FontAwesome name="chevron-right" size={14} color="#6B7280" />
            </TouchableOpacity>
          </View>

          {/* ─── SETTINGS ─── */}
          <Text style={styles.sectionLabel}>Settings</Text>
          <View style={styles.infoCard}>
            {/* Notifications */}
            <View style={styles.infoRow}>
              <View style={styles.infoIconBg}>
                <FontAwesome name="bell" size={16} color="#fff" />
              </View>
              <View style={[styles.infoContent, { flexDirection: 'row', alignItems: 'center' }]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.infoLabel}>Notifications</Text>
                  <Text style={styles.infoSubtext}>
                    {notificationsEnabled ? 'Enabled' : 'Disabled'}
                  </Text>
                </View>
                <Switch
                  value={notificationsEnabled}
                  onValueChange={setNotificationsEnabled}
                  trackColor={{ false: '#3A3A3A', true: '#34D399' }}
                  thumbColor="#fff"
                />
              </View>
            </View>

            <View style={styles.infoDivider} />

            {/* Privacy Policy */}
            <TouchableOpacity
              style={styles.infoRow}
              onPress={() => Linking.openURL('https://getfit.app/privacy')}
            >
              <View style={styles.infoIconBg}>
                <FontAwesome name="shield" size={16} color="#fff" />
              </View>
              <View style={styles.infoContent}>
                <Text style={styles.infoLabel}>Privacy Policy</Text>
              </View>
              <FontAwesome name="external-link" size={14} color="#6B7280" />
            </TouchableOpacity>
          </View>

          {/* ─── SAVE BUTTON ─── */}
          <TouchableOpacity
            style={styles.saveButton}
            onPress={onSave}
            disabled={saving}
            activeOpacity={0.8}
          >
            {saving ? (
              <ActivityIndicator color="#000" />
            ) : (
              <Text style={styles.saveButtonText}>Save Changes</Text>
            )}
          </TouchableOpacity>

          {/* ─── SIGN OUT ─── */}
          <TouchableOpacity style={styles.signOutButton} onPress={onSignOut} activeOpacity={0.8}>
            <FontAwesome name="sign-out" size={18} color="#F87171" style={{ marginRight: 10 }} />
            <Text style={styles.signOutText}>Sign Out</Text>
          </TouchableOpacity>

          {/* ─── DELETE ACCOUNT ─── */}
          <TouchableOpacity
            style={styles.deleteButton}
            onPress={onDeleteAccount}
            disabled={deleting}
            activeOpacity={0.8}
          >
            {deleting ? (
              <ActivityIndicator color="#DC2626" />
            ) : (
              <>
                <FontAwesome name="trash" size={16} color="#DC2626" style={{ marginRight: 10 }} />
                <Text style={styles.deleteButtonText}>Delete My Account</Text>
              </>
            )}
          </TouchableOpacity>

          <View style={{ height: 30 }} />
        </ScrollView>
      </KeyboardAvoidingView>

      {/* ─── CHANGE PASSWORD MODAL ─── */}
      <Modal
        visible={passwordModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setPasswordModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Change Password</Text>
                <TouchableOpacity onPress={() => setPasswordModalVisible(false)}>
                  <FontAwesome name="times" size={20} color="#fff" />
                </TouchableOpacity>
              </View>

              <Text style={styles.modalLabel}>Current Password</Text>
              <TextInput
                value={currentPassword}
                onChangeText={setCurrentPassword}
                secureTextEntry
                placeholder="Enter current password"
                placeholderTextColor="#6B7280"
                style={styles.modalInput}
              />

              <Text style={styles.modalLabel}>New Password</Text>
              <TextInput
                value={newPassword}
                onChangeText={setNewPassword}
                secureTextEntry
                placeholder="Enter new password"
                placeholderTextColor="#6B7280"
                style={styles.modalInput}
              />

              <Text style={styles.modalLabel}>Confirm Password</Text>
              <TextInput
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry
                placeholder="Confirm new password"
                placeholderTextColor="#6B7280"
                style={styles.modalInput}
              />

              <TouchableOpacity
                style={styles.modalSaveButton}
                onPress={onChangePassword}
                disabled={changingPassword}
              >
                {changingPassword ? (
                  <ActivityIndicator color="#000" />
                ) : (
                  <Text style={styles.modalSaveButtonText}>Change Password</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

// ─── STYLES ─────────────────────────────────────────────

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: '#0A0A0A',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollContent: {
    paddingHorizontal: 20,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 8,
    paddingBottom: 20,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
  },

  // Avatar Section
  avatarSection: {
    alignItems: 'center',
    marginBottom: 32,
  },
  largeAvatar: {
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: '#2D2D2D',
    borderWidth: 3,
    borderColor: '#3A3A3A',
    marginBottom: 14,
  },
  editPhotoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  editPhotoText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },

  // Section
  sectionLabel: {
    color: '#9CA3AF',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 10,
  },

  // Info Card
  infoCard: {
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    marginBottom: 24,
    overflow: 'hidden',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  infoIconBg: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#2D2D2D',
    justifyContent: 'center',
    alignItems: 'center',
  },
  infoContent: {
    flex: 1,
    marginLeft: 14,
  },
  infoLabel: {
    color: '#9CA3AF',
    fontSize: 12,
    fontWeight: '600',
  },
  infoValue: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginTop: 2,
  },
  infoInput: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginTop: 2,
    padding: 0,
  },
  infoSubtext: {
    color: '#6B7280',
    fontSize: 13,
    marginTop: 2,
  },
  infoDivider: {
    height: 1,
    backgroundColor: '#2A2A2A',
    marginHorizontal: 16,
  },

  // Save Button
  saveButton: {
    backgroundColor: '#fff',
    borderRadius: 14,
    height: 52,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  saveButtonText: {
    color: '#000',
    fontSize: 16,
    fontWeight: '700',
  },

  // Sign Out
  signOutButton: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 16,
    borderRadius: 14,
    backgroundColor: 'rgba(248,113,113,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(248,113,113,0.2)',
  },
  signOutText: {
    color: '#F87171',
    fontSize: 16,
    fontWeight: '700',
  },

  // Delete Account
  deleteButton: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 16,
    borderRadius: 14,
    backgroundColor: 'rgba(220,38,38,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(220,38,38,0.15)',
    marginTop: 12,
  },
  deleteButtonText: {
    color: '#DC2626',
    fontSize: 15,
    fontWeight: '700',
  },

  // Initials Avatar
  initialsAvatar: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#2D2D2D',
  },
  initialsText: {
    color: '#fff',
    fontSize: 40,
    fontWeight: '700',
  },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#1A1A1A',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  modalTitle: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '700',
  },
  modalLabel: {
    color: '#9CA3AF',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
    marginTop: 12,
  },
  modalInput: {
    backgroundColor: '#242424',
    borderRadius: 12,
    padding: 14,
    color: '#fff',
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#3A3A3A',
  },
  modalSaveButton: {
    backgroundColor: '#fff',
    borderRadius: 12,
    height: 50,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 24,
    marginBottom: 16,
  },
  modalSaveButtonText: {
    color: '#000',
    fontSize: 16,
    fontWeight: '700',
  },
});
