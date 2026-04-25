import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  ScrollView,
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

// ─── THEME ──────────────────────────────────────────────
const THEME = {
  bg: '#f1f0ec',
  card: '#ffffff',
  textPrimary: '#111111',
  textSecondary: '#666666',
  accent: '#22c55e',
  accentLight: '#dcfce7',
  border: 'rgba(0,0,0,0.05)',
};

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
      <SafeAreaView style={{ flex: 1, backgroundColor: THEME.bg }}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator color={THEME.accent} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  // ─── Render ───────────────────────────────────────────

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: THEME.bg }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
        >
          {/* ─── HEADER ─── */}
          <View style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingTop: 8,
            paddingBottom: 8,
          }}>
            <TouchableOpacity
              onPress={() => router.back()}
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                backgroundColor: THEME.card,
                justifyContent: 'center',
                alignItems: 'center',
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.06,
                shadowRadius: 6,
                elevation: 2,
              }}
            >
              <FontAwesome name="chevron-left" size={14} color={THEME.textPrimary} />
            </TouchableOpacity>
            <Text style={{
              fontSize: 20,
              fontWeight: '700',
              color: THEME.textPrimary,
            }}>
              Settings
            </Text>
            <View style={{ width: 40 }} />
          </View>

          {/* ─── AVATAR SECTION ─── */}
          <View style={{ alignItems: 'center', marginTop: 16, marginBottom: 28 }}>
            {/* Glow ring */}
            <View style={{
              width: 110,
              height: 110,
              borderRadius: 55,
              justifyContent: 'center',
              alignItems: 'center',
              backgroundColor: THEME.card,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.08,
              shadowRadius: 16,
              elevation: 6,
              borderWidth: 3,
              borderColor: 'rgba(0,0,0,0.04)',
            }}>
              {hasAvatar ? (
                <Image
                  source={{ uri: avatarUri }}
                  style={{ width: 98, height: 98, borderRadius: 49 }}
                />
              ) : (
                <View style={{
                  width: 98,
                  height: 98,
                  borderRadius: 49,
                  backgroundColor: THEME.accentLight,
                  justifyContent: 'center',
                  alignItems: 'center',
                }}>
                  <Text style={{
                    fontSize: 42,
                    fontWeight: '700',
                    color: THEME.accent,
                  }}>
                    {getInitials()}
                  </Text>
                </View>
              )}
            </View>

            <TouchableOpacity
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                marginTop: 12,
                paddingVertical: 6,
                paddingHorizontal: 14,
                borderRadius: 16,
                backgroundColor: THEME.card,
                borderWidth: 1,
                borderColor: THEME.border,
              }}
              onPress={onPickPhoto}
            >
              <FontAwesome name="camera" size={12} color={THEME.textSecondary} style={{ marginRight: 6 }} />
              <Text style={{
                fontSize: 13,
                fontWeight: '600',
                color: THEME.textPrimary,
              }}>
                Edit Photo
              </Text>
            </TouchableOpacity>
          </View>

          {/* ─── PERSONAL INFO ─── */}
          <Text style={{
            fontSize: 12,
            fontWeight: '700',
            color: THEME.textSecondary,
            textTransform: 'uppercase',
            letterSpacing: 1,
            marginBottom: 10,
          }}>
            Personal Info
          </Text>

          <View style={{
            backgroundColor: THEME.card,
            borderRadius: 18,
            borderWidth: 1,
            borderColor: THEME.border,
            overflow: 'hidden',
            marginBottom: 24,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.03,
            shadowRadius: 8,
            elevation: 2,
          }}>
            {/* Name */}
            <View style={{
              flexDirection: 'row',
              alignItems: 'center',
              padding: 16,
            }}>
              <View style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                backgroundColor: '#f3f4f6',
                justifyContent: 'center',
                alignItems: 'center',
              }}>
                <FontAwesome name="user" size={16} color={THEME.textSecondary} />
              </View>
              <View style={{ flex: 1, marginLeft: 14 }}>
                <Text style={{
                  fontSize: 12,
                  fontWeight: '600',
                  color: THEME.textSecondary,
                }}>
                  Name
                </Text>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  style={{
                    color: THEME.textPrimary,
                    fontSize: 16,
                    fontWeight: '600',
                    marginTop: 2,
                    padding: 0,
                  }}
                  placeholderTextColor="#aaa"
                  placeholder="Your name"
                />
              </View>
            </View>

            <View style={{ height: 1, backgroundColor: 'rgba(0,0,0,0.04)', marginHorizontal: 16 }} />

            {/* Email */}
            <View style={{
              flexDirection: 'row',
              alignItems: 'center',
              padding: 16,
            }}>
              <View style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                backgroundColor: '#f3f4f6',
                justifyContent: 'center',
                alignItems: 'center',
              }}>
                <FontAwesome name="envelope" size={14} color={THEME.textSecondary} />
              </View>
              <View style={{ flex: 1, marginLeft: 14 }}>
                <Text style={{
                  fontSize: 12,
                  fontWeight: '600',
                  color: THEME.textSecondary,
                }}>
                  Email
                </Text>
                <Text style={{
                  color: THEME.textPrimary,
                  fontSize: 16,
                  fontWeight: '600',
                  marginTop: 2,
                }}>
                  {user?.email || 'Not set'}
                </Text>
              </View>
            </View>

            <View style={{ height: 1, backgroundColor: 'rgba(0,0,0,0.04)', marginHorizontal: 16 }} />

            {/* Phone + Password side by side */}
            <TouchableOpacity
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                padding: 16,
              }}
              onPress={() => setPasswordModalVisible(true)}
              activeOpacity={0.7}
            >
              <View style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                backgroundColor: '#f3f4f6',
                justifyContent: 'center',
                alignItems: 'center',
              }}>
                <FontAwesome name="phone" size={16} color={THEME.textSecondary} />
              </View>
              <View style={{ flex: 1, marginLeft: 14 }}>
                <Text style={{
                  fontSize: 12,
                  fontWeight: '600',
                  color: THEME.textSecondary,
                }}>
                  Phone
                </Text>
                <Text style={{
                  color: THEME.textPrimary,
                  fontSize: 16,
                  fontWeight: '600',
                  marginTop: 2,
                }}>
                  {user?.phone || 'Not set'}
                </Text>
              </View>

              {/* Password column */}
              <View style={{ marginRight: 8 }}>
                <Text style={{
                  fontSize: 12,
                  fontWeight: '600',
                  color: THEME.textSecondary,
                }}>
                  Password
                </Text>
                <Text style={{
                  color: THEME.textPrimary,
                  fontSize: 16,
                  fontWeight: '600',
                  marginTop: 2,
                }}>
                  ••••••••
                </Text>
              </View>
              <FontAwesome name="chevron-right" size={12} color="#ccc" />
            </TouchableOpacity>
          </View>

          {/* ─── SECURITY INFO ─── */}
          <View style={{
            backgroundColor: THEME.card,
            borderRadius: 18,
            borderWidth: 1,
            borderColor: THEME.border,
            padding: 16,
            flexDirection: 'row',
            alignItems: 'center',
            marginBottom: 24,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.03,
            shadowRadius: 8,
            elevation: 2,
          }}>
            <View style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              backgroundColor: '#dbeafe',
              justifyContent: 'center',
              alignItems: 'center',
            }}>
              <FontAwesome name="shield" size={16} color="#3b82f6" />
            </View>
            <View style={{ flex: 1, marginLeft: 14 }}>
              <Text style={{
                fontSize: 14,
                fontWeight: '700',
                color: THEME.textPrimary,
              }}>
                Security
              </Text>
              <Text style={{
                fontSize: 12,
                color: THEME.textSecondary,
                marginTop: 2,
                lineHeight: 17,
              }}>
                Two-factor authentication (2FA) is authentically monitored.
              </Text>
            </View>
          </View>

          {/* ─── SETTINGS ─── */}
          <Text style={{
            fontSize: 12,
            fontWeight: '700',
            color: THEME.textSecondary,
            textTransform: 'uppercase',
            letterSpacing: 1,
            marginBottom: 10,
          }}>
            Settings
          </Text>

          <View style={{
            backgroundColor: THEME.card,
            borderRadius: 18,
            borderWidth: 1,
            borderColor: THEME.border,
            overflow: 'hidden',
            marginBottom: 24,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.03,
            shadowRadius: 8,
            elevation: 2,
          }}>
            {/* Notifications */}
            <View style={{
              flexDirection: 'row',
              alignItems: 'center',
              padding: 16,
            }}>
              <View style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                backgroundColor: '#f3f4f6',
                justifyContent: 'center',
                alignItems: 'center',
              }}>
                <FontAwesome name="bell" size={16} color={THEME.textSecondary} />
              </View>
              <View style={{
                flex: 1,
                marginLeft: 14,
                flexDirection: 'row',
                alignItems: 'center',
              }}>
                <Text style={{
                  flex: 1,
                  fontSize: 15,
                  fontWeight: '600',
                  color: THEME.textPrimary,
                }}>
                  Notifications
                </Text>
                <Switch
                  value={notificationsEnabled}
                  onValueChange={setNotificationsEnabled}
                  trackColor={{ false: '#e5e7eb', true: '#22c55e' }}
                  thumbColor="#fff"
                />
              </View>
            </View>

            <View style={{ height: 1, backgroundColor: 'rgba(0,0,0,0.04)', marginHorizontal: 16 }} />

            {/* Privacy Policy */}
            <TouchableOpacity
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                padding: 16,
              }}
              onPress={() => Linking.openURL('https://getfit.app/privacy')}
              activeOpacity={0.7}
            >
              <View style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                backgroundColor: '#f3f4f6',
                justifyContent: 'center',
                alignItems: 'center',
              }}>
                <FontAwesome name="shield" size={16} color={THEME.textSecondary} />
              </View>
              <Text style={{
                flex: 1,
                marginLeft: 14,
                fontSize: 15,
                fontWeight: '600',
                color: THEME.textPrimary,
              }}>
                Privacy Policy
              </Text>
              <FontAwesome name="external-link" size={14} color="#ccc" />
            </TouchableOpacity>
          </View>

          {/* ─── ACTION BUTTONS ─── */}
          <View style={{
            flexDirection: 'row',
            gap: 12,
            marginBottom: 12,
          }}>
            {/* Save Changes */}
            <TouchableOpacity
              style={{
                flex: 1,
                backgroundColor: THEME.card,
                borderRadius: 14,
                height: 50,
                justifyContent: 'center',
                alignItems: 'center',
                borderWidth: 1,
                borderColor: THEME.border,
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.04,
                shadowRadius: 6,
                elevation: 2,
              }}
              onPress={onSave}
              disabled={saving}
              activeOpacity={0.8}
            >
              {saving ? (
                <ActivityIndicator color={THEME.textPrimary} />
              ) : (
                <Text style={{
                  color: THEME.textPrimary,
                  fontSize: 15,
                  fontWeight: '700',
                }}>
                  Save Changes
                </Text>
              )}
            </TouchableOpacity>

            {/* Sign Out */}
            <TouchableOpacity
              style={{
                flex: 1,
                backgroundColor: THEME.card,
                borderRadius: 14,
                height: 50,
                flexDirection: 'row',
                justifyContent: 'center',
                alignItems: 'center',
                borderWidth: 1,
                borderColor: THEME.border,
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.04,
                shadowRadius: 6,
                elevation: 2,
              }}
              onPress={onSignOut}
              activeOpacity={0.8}
            >
              <FontAwesome name="sign-out" size={16} color={THEME.textPrimary} style={{ marginRight: 8 }} />
              <Text style={{
                color: THEME.textPrimary,
                fontSize: 15,
                fontWeight: '700',
              }}>
                Sign Out
              </Text>
            </TouchableOpacity>
          </View>

          {/* Delete Account */}
          <TouchableOpacity
            style={{
              backgroundColor: THEME.card,
              borderRadius: 14,
              height: 50,
              flexDirection: 'row',
              justifyContent: 'center',
              alignItems: 'center',
              borderWidth: 1,
              borderColor: 'rgba(220,38,38,0.12)',
              marginBottom: 20,
            }}
            onPress={onDeleteAccount}
            disabled={deleting}
            activeOpacity={0.8}
          >
            {deleting ? (
              <ActivityIndicator color="#DC2626" />
            ) : (
              <>
                <FontAwesome name="trash" size={14} color="#DC2626" style={{ marginRight: 8 }} />
                <Text style={{
                  color: '#DC2626',
                  fontSize: 15,
                  fontWeight: '700',
                }}>
                  Delete My Account
                </Text>
              </>
            )}
          </TouchableOpacity>

          <View style={{ height: 20 }} />
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
          <View style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.4)',
            justifyContent: 'flex-end',
          }}>
            <View style={{
              backgroundColor: THEME.card,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              padding: 24,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: -4 },
              shadowOpacity: 0.1,
              shadowRadius: 16,
              elevation: 10,
            }}>
              <View style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 24,
              }}>
                <Text style={{
                  color: THEME.textPrimary,
                  fontSize: 22,
                  fontWeight: '700',
                }}>
                  Change Password
                </Text>
                <TouchableOpacity onPress={() => setPasswordModalVisible(false)}>
                  <FontAwesome name="times" size={20} color={THEME.textSecondary} />
                </TouchableOpacity>
              </View>

              <Text style={{
                color: THEME.textSecondary,
                fontSize: 13,
                fontWeight: '600',
                marginBottom: 8,
              }}>
                Current Password
              </Text>
              <TextInput
                value={currentPassword}
                onChangeText={setCurrentPassword}
                secureTextEntry
                placeholder="Enter current password"
                placeholderTextColor="#bbb"
                style={{
                  backgroundColor: '#f5f5f4',
                  borderRadius: 12,
                  padding: 14,
                  color: THEME.textPrimary,
                  fontSize: 16,
                  borderWidth: 1,
                  borderColor: 'rgba(0,0,0,0.06)',
                }}
              />

              <Text style={{
                color: THEME.textSecondary,
                fontSize: 13,
                fontWeight: '600',
                marginBottom: 8,
                marginTop: 14,
              }}>
                New Password
              </Text>
              <TextInput
                value={newPassword}
                onChangeText={setNewPassword}
                secureTextEntry
                placeholder="Enter new password"
                placeholderTextColor="#bbb"
                style={{
                  backgroundColor: '#f5f5f4',
                  borderRadius: 12,
                  padding: 14,
                  color: THEME.textPrimary,
                  fontSize: 16,
                  borderWidth: 1,
                  borderColor: 'rgba(0,0,0,0.06)',
                }}
              />

              <Text style={{
                color: THEME.textSecondary,
                fontSize: 13,
                fontWeight: '600',
                marginBottom: 8,
                marginTop: 14,
              }}>
                Confirm Password
              </Text>
              <TextInput
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry
                placeholder="Confirm new password"
                placeholderTextColor="#bbb"
                style={{
                  backgroundColor: '#f5f5f4',
                  borderRadius: 12,
                  padding: 14,
                  color: THEME.textPrimary,
                  fontSize: 16,
                  borderWidth: 1,
                  borderColor: 'rgba(0,0,0,0.06)',
                }}
              />

              <TouchableOpacity
                style={{
                  backgroundColor: THEME.accent,
                  borderRadius: 12,
                  height: 50,
                  justifyContent: 'center',
                  alignItems: 'center',
                  marginTop: 24,
                  marginBottom: 16,
                }}
                onPress={onChangePassword}
                disabled={changingPassword}
              >
                {changingPassword ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={{
                    color: '#fff',
                    fontSize: 16,
                    fontWeight: '700',
                  }}>
                    Change Password
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}
