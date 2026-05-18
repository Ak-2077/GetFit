import React, { useCallback, useState } from 'react';
import {
  View, Text, Image, TouchableOpacity, ScrollView,
  Alert, TextInput, Switch, Modal, KeyboardAvoidingView, Platform, Linking, ActivityIndicator,
} from 'react-native';
import * as Location from 'expo-location';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import {
  getUserProfile, updateUserProfile, changeUserPassword,
  deleteUserAccount, setAuthToken, sendProfileEmailOtp, verifyProfileEmailOtp,
} from '../../services/api';
import { LinearGradient } from 'expo-linear-gradient';


const C = {
  bg: '#050505', card: 'rgba(25,25,25,1)', border: 'rgba(70,130,90,0.18)',
  accent: '#1FA463', glow: '#A6F7C2', gold: '#C8A84E',
  white: '#F0F0F0', label: 'rgba(255,255,255,0.50)', muted: 'rgba(255,255,255,0.30)',
  input: 'rgba(35,35,35,1)', divider: 'rgba(255,255,255,0.04)',
};

function DarkCard({ children, style }: any) {
  return <View style={{ backgroundColor: C.card, borderRadius: 18, borderWidth: 1, borderColor: C.border, overflow: 'hidden', ...style }}>{children}</View>;
}

const VIBGYOR: [string, string, ...string[]] = ['#8B00FF', '#4B0082', '#0000FF', '#00FF00', '#FFFF00', '#FF7F00', '#FF0000'];

function getSubLabel(plan: string) {
  if (plan === 'pro') return 'AI Trainer Pro';
  if (plan === 'pro_plus') return 'AI Trainer Pro Plus';
  return 'Free Plan';
}

function getAvatarBorder(plan: string) {
  if (plan === 'pro') return { borderColor: '#6A0DAD', shadowColor: '#6A0DAD', shadowOpacity: 0.4, shadowRadius: 12 };
  if (plan === 'pro_plus') return { borderColor: '#FF0000', shadowColor: '#FFD700', shadowOpacity: 0.5, shadowRadius: 14 };
  return { borderColor: 'rgba(180,180,180,0.3)', shadowColor: 'transparent', shadowOpacity: 0, shadowRadius: 0 };
}

function SettingsRow({ icon, label, value, onPress, right, last }: any) {
  const content = (
    <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16 }}>
      <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: 'rgba(31,164,99,0.12)', justifyContent: 'center', alignItems: 'center' }}>
        <FontAwesome name={icon} size={15} color={C.accent} />
      </View>
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text style={{ fontSize: 14, fontWeight: '600', color: C.white }}>{label}</Text>
        {value ? <Text style={{ fontSize: 12, color: C.label, marginTop: 1 }}>{value}</Text> : null}
      </View>
      {right || (onPress ? <FontAwesome name="chevron-right" size={12} color={C.muted} /> : null)}
    </View>
  );
  return (
    <>
      {onPress ? <TouchableOpacity onPress={onPress} activeOpacity={0.7}>{content}</TouchableOpacity> : content}
      {!last && <View style={{ height: 1, backgroundColor: C.divider, marginHorizontal: 16 }} />}
    </>
  );
}

export default function ProfileSettingsScreen() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [avatarUri, setAvatarUri] = useState('');
  const [avatarData, setAvatarData] = useState<string | null>(null);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [passwordModalVisible, setPasswordModalVisible] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Email verification
  const [emailModalVisible, setEmailModalVisible] = useState(false);
  const [emailInput, setEmailInput] = useState('');
  const [emailOtp, setEmailOtp] = useState('');
  const [emailStep, setEmailStep] = useState<'enter'|'otp'>('enter');
  const [emailSending, setEmailSending] = useState(false);
  const [emailVerifying, setEmailVerifying] = useState(false);
  // Fitness prefs picker
  const [pickerModal, setPickerModal] = useState<{type: 'level'|'diet', current: string} | null>(null);
  const [pickerSaving, setPickerSaving] = useState(false);
  // Location tracking
  const [locationEnabled, setLocationEnabled] = useState(false);
  const [locationPermStatus, setLocationPermStatus] = useState<'granted'|'denied'|'undetermined'>('undetermined');

  const loadProfile = useCallback(async () => {
    try {
      const token = await AsyncStorage.getItem('token');
      if (token) setAuthToken(token);
      const res = await getUserProfile();
      const u = res.data;
      setUser(u); setName(u?.name || ''); setAvatarUri(u?.avatar || '');
      setNotificationsEnabled(u?.notificationsEnabled !== false);
    } catch (err: any) {
      console.warn('Failed to load profile', err?.response?.data || err.message);
    } finally { setLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => {
    setLoading(true);
    loadProfile();
    // Load location tracking state
    (async () => {
      try {
        const enabled = await AsyncStorage.getItem('locationTrackingEnabled');
        setLocationEnabled(enabled === 'true');
        const { status } = await Location.getForegroundPermissionsAsync();
        setLocationPermStatus(status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'undetermined');
      } catch { /* ignore */ }
    })();
  }, [loadProfile]));

  const enableLocationTracking = useCallback(async () => {
    const { status, canAskAgain } = await Location.getForegroundPermissionsAsync();

    if (status === 'granted') {
      setLocationEnabled(true);
      setLocationPermStatus('granted');
      await AsyncStorage.setItem('locationTrackingEnabled', 'true');
      await AsyncStorage.setItem('locationPermissionRequested', 'true');
      return;
    }

    if (!canAskAgain) {
      setLocationPermStatus('denied');
      Alert.alert(
        'Permission Required',
        'Location permission was denied. Open Settings to enable it.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Settings', onPress: () => Linking.openSettings() },
        ]
      );
      return;
    }

    const { status: newStatus } = await Location.requestForegroundPermissionsAsync();
    if (newStatus === 'granted') {
      setLocationEnabled(true);
      setLocationPermStatus('granted');
      await AsyncStorage.setItem('locationTrackingEnabled', 'true');
      await AsyncStorage.setItem('locationPermissionRequested', 'true');
      return;
    }

    setLocationPermStatus('denied');
    Alert.alert('Permission Required', 'Location permission is needed for step tracking.');
  }, []);

  const onSave = async () => {
    setSaving(true);
    try {
      const payload: any = { name: name.trim(), notificationsEnabled };
      if (avatarData) payload.avatar = avatarData;
      await updateUserProfile(payload);
      Alert.alert('Saved', 'Profile updated successfully');
      router.back();
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.message || 'Failed to update');
    } finally { setSaving(false); }
  };

  const onPickPhoto = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') { Alert.alert('Permission needed', 'Allow photo access to update your profile picture.'); return; }
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.8, base64: true });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      if (!asset.base64) { Alert.alert('Error', 'Unable to read image data.'); return; }
      setAvatarUri(asset.uri);
      setAvatarData(`data:image/jpeg;base64,${asset.base64}`);
    } catch { Alert.alert('Error', 'Failed to pick image'); }
  };

  const onChangePassword = async () => {
    if (!currentPassword) { Alert.alert('Error', 'Enter your current password'); return; }
    if (newPassword.length < 6) { Alert.alert('Error', 'New password must be at least 6 characters'); return; }
    if (newPassword !== confirmPassword) { Alert.alert('Error', 'Passwords do not match'); return; }
    setChangingPassword(true);
    try {
      await changeUserPassword({ currentPassword, newPassword });
      Alert.alert('Success', 'Password changed successfully');
      setPasswordModalVisible(false); setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.message || 'Failed to change password');
    } finally { setChangingPassword(false); }
  };

  const onSignOut = () => {
    Alert.alert('Sign out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: async () => { await AsyncStorage.removeItem('token'); setAuthToken(null); router.replace('/auth'); } },
    ]);
  };

  const onDeleteAccount = () => {
    Alert.alert('Delete Account?', 'This will permanently delete your data. This action cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        setDeleting(true);
        try { await deleteUserAccount(); await AsyncStorage.removeItem('token'); setAuthToken(null); router.replace('/auth'); }
        catch (err: any) { Alert.alert('Error', err?.response?.data?.message || 'Failed to delete account'); }
        finally { setDeleting(false); }
      }},
    ]);
  };

  // Email OTP
  const onSendEmailOtp = async () => {
    if (!emailInput.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput.trim())) { Alert.alert('Error', 'Enter a valid email'); return; }
    setEmailSending(true);
    try {
      await sendProfileEmailOtp({ email: emailInput.trim().toLowerCase() });
      setEmailStep('otp');
    } catch (err: any) { Alert.alert('Error', err?.response?.data?.message || 'Failed to send OTP'); }
    finally { setEmailSending(false); }
  };

  const onVerifyEmailOtp = async () => {
    if (emailOtp.length !== 6) { Alert.alert('Error', 'Enter the 6-digit code'); return; }
    setEmailVerifying(true);
    try {
      const res = await verifyProfileEmailOtp({ email: emailInput.trim().toLowerCase(), otp: emailOtp });
      setUser(res.data?.user || { ...user, email: emailInput.trim().toLowerCase(), emailVerified: true });
      setEmailModalVisible(false); setEmailInput(''); setEmailOtp(''); setEmailStep('enter');
      Alert.alert('Success', 'Email verified!');
    } catch (err: any) { Alert.alert('Error', err?.response?.data?.message || 'Verification failed'); }
    finally { setEmailVerifying(false); }
  };

  // Fitness pref change
  const onPickerSelect = async (value: string) => {
    if (!pickerModal) return;
    setPickerSaving(true);
    try {
      const payload: any = {};
      if (pickerModal.type === 'level') payload.level = value;
      else payload.dietPreference = value;
      const res = await updateUserProfile(payload);
      setUser(res.data?.user || { ...user, ...payload });
      setPickerModal(null);
    } catch (err: any) { Alert.alert('Error', err?.response?.data?.message || 'Failed to update'); }
    finally { setPickerSaving(false); }
  };

  const getInitials = () => (name || user?.name || '').trim().charAt(0).toUpperCase() || '?';
  const hasAvatar = !!(avatarUri && avatarUri.length > 0);

  if (loading) {
    return <View style={{ flex: 1, backgroundColor: '#050505', justifyContent: 'center', alignItems: 'center' }}><ActivityIndicator size="large" color="#1FA463" /></View>;
  }

  const levelLabel = (l: string) => l === 'beginner' ? 'Beginner' : l === 'intermediate' ? 'Intermediate' : l === 'advanced' ? 'Advanced' : '—';
  const dietLabel = (d: string) => d === 'veg' ? 'Vegetarian' : d === 'non_veg' ? 'Non-Veg' : '—';

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ position: 'absolute', top: -60, right: -60, width: 280, height: 280, borderRadius: 140, backgroundColor: 'rgba(31,164,99,0.06)' }} />
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

            {/* HEADER */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8, paddingBottom: 8 }}>
              <TouchableOpacity onPress={() => router.back()} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, justifyContent: 'center', alignItems: 'center' }}>
                <FontAwesome name="chevron-left" size={14} color={C.white} />
              </TouchableOpacity>
              <Text style={{ fontSize: 20, fontWeight: '700', color: C.white }}>Settings</Text>
              <View style={{ width: 40 }} />
            </View>

            {/* AVATAR with subscription-based border */}
            <View style={{ alignItems: 'center', marginTop: 16, marginBottom: 24 }}>
              {user?.subscriptionPlan === 'pro_plus' ? (
                <LinearGradient colors={VIBGYOR} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                  style={{ width: 104, height: 104, borderRadius: 52, justifyContent: 'center', alignItems: 'center' }}>
                  <View style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: C.bg, justifyContent: 'center', alignItems: 'center' }}>
                    {hasAvatar ? (
                      <Image source={{ uri: avatarUri }} style={{ width: 90, height: 90, borderRadius: 45 }} />
                    ) : (
                      <View style={{ width: 90, height: 90, borderRadius: 45, backgroundColor: 'rgba(31,164,99,0.12)', justifyContent: 'center', alignItems: 'center' }}>
                        <Text style={{ fontSize: 38, fontWeight: '700', color: C.accent }}>{getInitials()}</Text>
                      </View>
                    )}
                  </View>
                </LinearGradient>
              ) : (
                <View style={{ width: 100, height: 100, borderRadius: 50, borderWidth: 2.5, ...getAvatarBorder(user?.subscriptionPlan || 'free'), justifyContent: 'center', alignItems: 'center', shadowOffset: { width: 0, height: 0 }, elevation: 4 }}>
                  {hasAvatar ? (
                    <Image source={{ uri: avatarUri }} style={{ width: 90, height: 90, borderRadius: 45 }} />
                  ) : (
                    <View style={{ width: 90, height: 90, borderRadius: 45, backgroundColor: 'rgba(31,164,99,0.12)', justifyContent: 'center', alignItems: 'center' }}>
                      <Text style={{ fontSize: 38, fontWeight: '700', color: C.accent }}>{getInitials()}</Text>
                    </View>
                  )}
                </View>
              )}
              <TouchableOpacity onPress={onPickPhoto} style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10, paddingVertical: 6, paddingHorizontal: 14, borderRadius: 14, backgroundColor: C.card, borderWidth: 1, borderColor: C.border }}>
                <FontAwesome name="camera" size={12} color={C.label} style={{ marginRight: 6 }} />
                <Text style={{ fontSize: 13, fontWeight: '600', color: C.white }}>Edit Photo</Text>
              </TouchableOpacity>
              <Text style={{ fontSize: 18, fontWeight: '700', color: C.white, marginTop: 10 }}>{name || '—'}</Text>
              {user?.email ? <Text style={{ fontSize: 13, color: C.label, marginTop: 2 }}>{user.email}</Text> : null}
              {user?.subscriptionPlan && user.subscriptionPlan !== 'free' && (
                <LinearGradient
                  colors={user.subscriptionPlan === 'pro_plus' ? ['#8B00FF', '#FF0000'] : ['#6A0DAD', '#9B59B6']}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                  style={{ paddingHorizontal: 12, paddingVertical: 4, borderRadius: 8, marginTop: 8 }}>
                  <Text style={{ fontSize: 10, fontWeight: '800', color: '#fff' }}>{user.subscriptionPlan === 'pro_plus' ? 'Pro+ Elite' : 'Pro Member'}</Text>
                </LinearGradient>
              )}
            </View>

            {/* ACCOUNT */}
            <Text style={{ fontSize: 12, fontWeight: '700', color: C.label, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 10 }}>Account</Text>
            <DarkCard style={{ marginBottom: 20 }}>
              {/* Name */}
              <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16 }}>
                <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: 'rgba(31,164,99,0.12)', justifyContent: 'center', alignItems: 'center' }}>
                  <FontAwesome name="user" size={15} color={C.accent} />
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={{ fontSize: 11, color: C.label }}>Name</Text>
                  <TextInput value={name} onChangeText={setName} style={{ color: C.white, fontSize: 15, fontWeight: '600', marginTop: 1, padding: 0 }} placeholderTextColor={C.muted} placeholder="Your name" />
                </View>
              </View>
              <View style={{ height: 1, backgroundColor: C.divider, marginHorizontal: 16 }} />

              {/* Email */}
              <SettingsRow icon="envelope" label="Email"
                value={user?.email ? (user.emailVerified ? `${user.email}` : user.email) : 'Add email'}
                onPress={user?.email && user?.emailVerified ? undefined : () => { setEmailInput(user?.email || ''); setEmailStep('enter'); setEmailOtp(''); setEmailModalVisible(true); }}
                right={user?.email && user?.emailVerified ? (
                  <View style={{ backgroundColor: 'rgba(31,164,99,0.15)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 }}>
                    <Text style={{ fontSize: 10, fontWeight: '700', color: C.accent }}>Verified ✓</Text>
                  </View>
                ) : undefined}
              />

              {/* Password */}
              <SettingsRow icon="lock" label="Change Password" value="••••••••" onPress={() => setPasswordModalVisible(true)} />

              {/* Notifications */}
              <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16 }}>
                <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: 'rgba(31,164,99,0.12)', justifyContent: 'center', alignItems: 'center' }}>
                  <FontAwesome name="bell" size={15} color={C.accent} />
                </View>
                <Text style={{ flex: 1, marginLeft: 12, fontSize: 14, fontWeight: '600', color: C.white }}>Notifications</Text>
                <Switch value={notificationsEnabled} onValueChange={setNotificationsEnabled} trackColor={{ false: '#333', true: C.accent }} thumbColor="#fff" />
              </View>
            </DarkCard>

            {/* FITNESS PREFERENCES */}
            <Text style={{ fontSize: 12, fontWeight: '700', color: C.label, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 10 }}>Fitness Preferences</Text>
            <DarkCard style={{ marginBottom: 20 }}>
              <SettingsRow icon="signal" label="Training Level" value={levelLabel(user?.level)} onPress={() => setPickerModal({ type: 'level', current: user?.level || '' })} />
              <SettingsRow icon="leaf" label="Diet Type" value={dietLabel(user?.dietPreference)} onPress={() => setPickerModal({ type: 'diet', current: user?.dietPreference || '' })} last />
            </DarkCard>

            {/* LOCATION TRACKING */}
            <Text style={{ fontSize: 12, fontWeight: '700', color: C.label, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 10 }}>Location Tracking</Text>
            <DarkCard style={{ marginBottom: 20 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16 }}>
                <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: 'rgba(31,164,99,0.12)', justifyContent: 'center', alignItems: 'center' }}>
                  <FontAwesome name="map-marker" size={15} color={C.accent} />
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: C.white }}>Location Tracking</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3, gap: 6 }}>
                    <View style={{
                      width: 7, height: 7, borderRadius: 4,
                      backgroundColor: locationPermStatus === 'granted' ? '#22C55E' : locationPermStatus === 'denied' ? '#EF4444' : '#EAB308',
                    }} />
                    <Text style={{ fontSize: 11, color: C.label }}>
                      {locationPermStatus === 'granted' ? 'Permission Granted' : locationPermStatus === 'denied' ? 'Permission Denied' : 'Not Requested'}
                    </Text>
                  </View>
                </View>
                <Switch
                  value={locationEnabled}
                  onValueChange={async (val) => {
                    if (val) {
                      Alert.alert(
                        'Enable Location Tracking',
                        'GetFit will request location access so it can track steps and calorie burn.',
                        [
                          { text: 'Cancel', style: 'cancel', onPress: () => setLocationEnabled(false) },
                          { text: 'Enable', onPress: () => { void enableLocationTracking(); } },
                        ]
                      );
                    } else {
                      setLocationEnabled(false);
                      await AsyncStorage.setItem('locationTrackingEnabled', 'false');
                      await AsyncStorage.removeItem('locationPermissionRequested');
                    }
                  }}
                  trackColor={{ false: '#333', true: C.accent }}
                  thumbColor="#fff"
                />
              </View>
            </DarkCard>

            {/* ── SUBSCRIPTION (single tappable row → /upgrade) ── */}
            {/* This is the ONE place users manage subscriptions. Tapping opens
                the Upgrade screen where they can buy, cancel, or restore. */}
            <Text style={{ fontSize: 12, fontWeight: '700', color: C.label, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 10 }}>Subscription</Text>
            <DarkCard style={{ marginBottom: 20, overflow: 'hidden' }}>
              {(() => {
                const plan = user?.subscriptionPlan || 'free';
                const isProPlus = plan === 'pro_plus';
                const isPro = plan === 'pro';
                const isPremium = isPro || isProPlus;

                // Sub-line: "Manage plan" for premium, "Unlock all features" for free.
                const subLine = isPremium ? 'Tap to manage, upgrade or cancel' : 'Unlock all premium features';

                // Right-side CTA pill
                const ctaLabel = isProPlus ? 'Manage' : isPro ? 'Manage' : 'Upgrade';
                const ctaBg = isPremium ? 'rgba(255,255,255,0.06)' : '#6A0DAD';
                const ctaColor = isPremium ? C.white : '#fff';

                const Inner = (
                  <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16 }}>
                    {/* Icon — varies by tier */}
                    {isProPlus ? (
                      <LinearGradient
                        colors={VIBGYOR.slice(0, 3) as [string, string, ...string[]]}
                        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                        style={{ width: 36, height: 36, borderRadius: 10, justifyContent: 'center', alignItems: 'center' }}
                      >
                        <FontAwesome name="diamond" size={14} color="#fff" />
                      </LinearGradient>
                    ) : isPro ? (
                      <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: 'rgba(106,13,173,0.20)', justifyContent: 'center', alignItems: 'center' }}>
                        <FontAwesome name="star" size={14} color="#9B59B6" />
                      </View>
                    ) : (
                      <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: 'rgba(200,168,78,0.12)', justifyContent: 'center', alignItems: 'center' }}>
                        <FontAwesome name="star-o" size={14} color={C.gold} />
                      </View>
                    )}

                    {/* Plan label + sub-line */}
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={{ fontSize: 14, fontWeight: '700', color: C.white }}>{getSubLabel(plan)}</Text>
                      <Text style={{ fontSize: 11, color: C.label, marginTop: 2 }}>{subLine}</Text>
                    </View>

                    {/* Right-side pill */}
                    <View style={{ backgroundColor: ctaBg, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10 }}>
                      <Text style={{ color: ctaColor, fontSize: 11, fontWeight: '700' }}>{ctaLabel}</Text>
                    </View>
                  </View>
                );

                // Pro+ gets the soft VIBGYOR background; Pro gets purple tint;
                // Free is plain.
                if (isProPlus) {
                  return (
                    <TouchableOpacity activeOpacity={0.8} onPress={() => router.push('/upgrade' as any)}>
                      <LinearGradient colors={['rgba(139,0,255,0.12)', 'rgba(255,0,0,0.06)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
                        {Inner}
                      </LinearGradient>
                    </TouchableOpacity>
                  );
                }
                if (isPro) {
                  return (
                    <TouchableOpacity activeOpacity={0.8} onPress={() => router.push('/upgrade' as any)}>
                      <LinearGradient colors={['rgba(106,13,173,0.12)', 'rgba(106,13,173,0.04)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
                        {Inner}
                      </LinearGradient>
                    </TouchableOpacity>
                  );
                }
                return (
                  <TouchableOpacity activeOpacity={0.8} onPress={() => router.push('/upgrade' as any)}>
                    {Inner}
                  </TouchableOpacity>
                );
              })()}
            </DarkCard>

            {/* APP */}
            <Text style={{ fontSize: 12, fontWeight: '700', color: C.label, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 10 }}>App</Text>
            <DarkCard style={{ marginBottom: 20 }}>
              <SettingsRow icon="shield" label="Privacy Policy" onPress={() => Linking.openURL('https://getfit.app/privacy')} />
              <SettingsRow icon="trash" label="Delete My Account" onPress={onDeleteAccount}
                right={deleting ? <ActivityIndicator size="small" color="#DC2626" /> : <FontAwesome name="chevron-right" size={12} color="#DC2626" />} />
              <SettingsRow icon="sign-out" label="Sign Out" onPress={onSignOut} last />
            </DarkCard>

            {/* SAVE */}
            <TouchableOpacity onPress={onSave} disabled={saving} activeOpacity={0.85} style={{ backgroundColor: C.accent, borderRadius: 14, height: 50, justifyContent: 'center', alignItems: 'center', marginBottom: 20 }}>
              {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>Save Changes</Text>}
            </TouchableOpacity>

          </ScrollView>
        </KeyboardAvoidingView>

        {/* PASSWORD MODAL */}
        <Modal visible={passwordModalVisible} animationType="slide" transparent onRequestClose={() => setPasswordModalVisible(false)}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
            <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}>
              <View style={{ backgroundColor: C.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, borderWidth: 1, borderColor: C.border }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                  <Text style={{ color: C.white, fontSize: 20, fontWeight: '700' }}>Change Password</Text>
                  <TouchableOpacity onPress={() => setPasswordModalVisible(false)}><FontAwesome name="times" size={20} color={C.label} /></TouchableOpacity>
                </View>
                {['Current Password', 'New Password', 'Confirm Password'].map((lbl, i) => (
                  <View key={lbl}>
                    <Text style={{ color: C.label, fontSize: 12, fontWeight: '600', marginBottom: 6, marginTop: i > 0 ? 12 : 0 }}>{lbl}</Text>
                    <TextInput
                      value={i === 0 ? currentPassword : i === 1 ? newPassword : confirmPassword}
                      onChangeText={i === 0 ? setCurrentPassword : i === 1 ? setNewPassword : setConfirmPassword}
                      secureTextEntry placeholder={`Enter ${lbl.toLowerCase()}`} placeholderTextColor={C.muted}
                      style={{ backgroundColor: C.input, borderRadius: 12, padding: 14, color: C.white, fontSize: 15, borderWidth: 1, borderColor: C.border }}
                    />
                  </View>
                ))}
                <TouchableOpacity onPress={onChangePassword} disabled={changingPassword} style={{ backgroundColor: C.accent, borderRadius: 12, height: 48, justifyContent: 'center', alignItems: 'center', marginTop: 20 }}>
                  {changingPassword ? <ActivityIndicator size="small" color="#fff" /> : <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>Change Password</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        {/* EMAIL VERIFY MODAL */}
        <Modal visible={emailModalVisible} animationType="slide" transparent onRequestClose={() => setEmailModalVisible(false)}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
            <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}>
              <View style={{ backgroundColor: C.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, borderWidth: 1, borderColor: C.border }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                  <Text style={{ color: C.white, fontSize: 20, fontWeight: '700' }}>{emailStep === 'enter' ? 'Add Email' : 'Verify Email'}</Text>
                  <TouchableOpacity onPress={() => setEmailModalVisible(false)}><FontAwesome name="times" size={20} color={C.label} /></TouchableOpacity>
                </View>
                {emailStep === 'enter' ? (
                  <>
                    <Text style={{ color: C.label, fontSize: 12, fontWeight: '600', marginBottom: 6 }}>Email Address</Text>
                    <TextInput value={emailInput} onChangeText={setEmailInput} keyboardType="email-address" autoCapitalize="none" placeholder="you@example.com" placeholderTextColor={C.muted}
                      style={{ backgroundColor: C.input, borderRadius: 12, padding: 14, color: C.white, fontSize: 15, borderWidth: 1, borderColor: C.border }} />
                    <TouchableOpacity onPress={onSendEmailOtp} disabled={emailSending} style={{ backgroundColor: C.accent, borderRadius: 12, height: 48, justifyContent: 'center', alignItems: 'center', marginTop: 16 }}>
                      {emailSending ? <ActivityIndicator size="small" color="#fff" /> : <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>Send Verification Code</Text>}
                    </TouchableOpacity>
                  </>
                ) : (
                  <>
                    <Text style={{ color: C.label, fontSize: 13, marginBottom: 12 }}>Enter the 6-digit code sent to {emailInput}</Text>
                    <TextInput value={emailOtp} onChangeText={setEmailOtp} keyboardType="number-pad" maxLength={6} placeholder="000000" placeholderTextColor={C.muted}
                      style={{ backgroundColor: C.input, borderRadius: 12, padding: 14, color: C.white, fontSize: 22, fontWeight: '700', letterSpacing: 8, textAlign: 'center', borderWidth: 1, borderColor: C.border }} />
                    <TouchableOpacity onPress={onVerifyEmailOtp} disabled={emailVerifying} style={{ backgroundColor: C.accent, borderRadius: 12, height: 48, justifyContent: 'center', alignItems: 'center', marginTop: 16 }}>
                      {emailVerifying ? <ActivityIndicator size="small" color="#fff" /> : <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>Verify</Text>}
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => { setEmailStep('enter'); setEmailOtp(''); }} style={{ marginTop: 12, alignItems: 'center' }}>
                      <Text style={{ color: C.accent, fontSize: 13 }}>Resend code</Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        {/* FITNESS PICKER MODAL */}
        <Modal visible={!!pickerModal} animationType="slide" transparent onRequestClose={() => setPickerModal(null)}>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}>
            <View style={{ backgroundColor: C.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, borderWidth: 1, borderColor: C.border }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <Text style={{ color: C.white, fontSize: 20, fontWeight: '700' }}>{pickerModal?.type === 'level' ? 'Training Level' : 'Diet Type'}</Text>
                <TouchableOpacity onPress={() => setPickerModal(null)}><FontAwesome name="times" size={20} color={C.label} /></TouchableOpacity>
              </View>
              {pickerSaving ? (
                <ActivityIndicator size="small" color="#1FA463" />
              ) : (
                (pickerModal?.type === 'level'
                  ? [{ key: 'beginner', label: 'Beginner' }, { key: 'intermediate', label: 'Intermediate' }, { key: 'advanced', label: 'Advanced' }]
                  : [{ key: 'veg', label: 'Vegetarian' }, { key: 'non_veg', label: 'Non-Veg' }]
                ).map((opt) => (
                  <TouchableOpacity key={opt.key} onPress={() => onPickerSelect(opt.key)} activeOpacity={0.7}
                    style={{ flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: 14, backgroundColor: pickerModal?.current === opt.key ? 'rgba(31,164,99,0.15)' : 'transparent', marginBottom: 6, borderWidth: 1, borderColor: pickerModal?.current === opt.key ? C.border : 'transparent' }}>
                    <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: pickerModal?.current === opt.key ? C.accent : C.muted, justifyContent: 'center', alignItems: 'center', marginRight: 12 }}>
                      {pickerModal?.current === opt.key && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: C.accent }} />}
                    </View>
                    <Text style={{ fontSize: 16, fontWeight: '600', color: C.white }}>{opt.label}</Text>
                  </TouchableOpacity>
                ))
              )}
            </View>
          </View>
        </Modal>

      </SafeAreaView>
    </View>
  );
}
