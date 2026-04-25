import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  ImageBackground,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import {
  sendOtpRequest,
  verifyOtpRequest,
  emailPasswordAuthRequest,
  forgotPassword,
  setAuthToken,
  getUserProfile,
} from '../../services/api';

const loginBackground = require('../../assets/images/Login_image.webp');
const RESEND_COOLDOWN_SECONDS = 30;

function normalizeToIndianPhone(input: string) {
  const value = input.trim();
  if (!value) return '';

  if (value.startsWith('+')) {
    const sanitized = `+${value.slice(1).replace(/\D/g, '')}`;
    return sanitized;
  }

  const digits = value.replace(/\D/g, '');
  if (digits.length === 10) {
    return `+91${digits}`;
  }
  if (digits.length === 12 && digits.startsWith('91')) {
    return `+${digits}`;
  }

  return '';
}

export default function AuthScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Main mode
  const [mode, setMode] = useState<'phone' | 'email_password'>('phone');

  // Phone OTP flow
  const [phoneInput, setPhoneInput] = useState('');
  const [otpInput, setOtpInput] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [resendCountdown, setResendCountdown] = useState(0);

  // Email + Password flow
  const [emailInput, setEmailInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');

  // Forgot password flow
  const [forgotMode, setForgotMode] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotNewPassword, setForgotNewPassword] = useState('');
  const [forgotConfirmPassword, setForgotConfirmPassword] = useState('');

  // UI states
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState('');

  const normalizedPhone = useMemo(() => normalizeToIndianPhone(phoneInput), [phoneInput]);
  const normalizedEmail = useMemo(() => emailInput.trim().toLowerCase(), [emailInput]);

  const resetState = () => {
    setErrorText('');
    setOtpSent(false);
    setOtpInput('');
    setResendCountdown(0);
  };

  useEffect(() => {
    if (resendCountdown <= 0) return;

    const interval = setInterval(() => {
      setResendCountdown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);

    return () => clearInterval(interval);
  }, [resendCountdown]);

  const completeAuth = async (token: string) => {
    await AsyncStorage.setItem('token', token);
    setAuthToken(token);

    try {
      const profileRes = await getUserProfile();
      const onboardingCompleted = profileRes?.data?.onboardingCompleted;
      if (!onboardingCompleted) {
        router.replace('/auth/onboarding' as any);
        return;
      }
    } catch (_e) {
      // If profile fetch fails, proceed to tabs
    }

    router.replace('/(tabs)');
  };

  const onSendOtp = async () => {
    setErrorText('');

    if (!normalizedPhone || !/^\+91\d{10}$/.test(normalizedPhone)) {
      setErrorText('Enter a valid Indian phone number');
      return;
    }

    try {
      setLoading(true);
      await sendOtpRequest({ phone: normalizedPhone });
      setOtpSent(true);
      setResendCountdown(RESEND_COOLDOWN_SECONDS);
      Alert.alert('OTP sent', `A 6-digit OTP was sent to ${normalizedPhone}`);
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || 'Failed to send OTP';
      setErrorText(msg);
    } finally {
      setLoading(false);
    }
  };

  const onVerifyOtp = async () => {
    setErrorText('');

    if (!/^\d{6}$/.test(otpInput.trim())) {
      setErrorText('Enter a valid 6-digit OTP');
      return;
    }

    try {
      setLoading(true);
      const res = await verifyOtpRequest({ phone: normalizedPhone, otp: otpInput.trim() });
      const token = res.data?.token;
      if (!token) {
        setErrorText('No token returned from server');
        return;
      }
      await completeAuth(token);
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || 'OTP verification failed';
      setErrorText(msg);
    } finally {
      setLoading(false);
    }
  };

  const onEmailPasswordAuth = async () => {
    setErrorText('');

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setErrorText('Enter a valid email address');
      return;
    }

    if (passwordInput.length < 6) {
      setErrorText('Password must be at least 6 characters');
      return;
    }

    try {
      setLoading(true);
      const res = await emailPasswordAuthRequest({
        email: normalizedEmail,
        password: passwordInput,
      });
      const token = res.data?.token;
      if (!token) {
        setErrorText('No token returned from server');
        return;
      }
      await completeAuth(token);
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || 'Email login failed';
      setErrorText(msg);
    } finally {
      setLoading(false);
    }
  };

  const onForgotPassword = async () => {
    setErrorText('');

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(forgotEmail)) {
      setErrorText('Enter a valid email address');
      return;
    }

    if (forgotNewPassword.length < 6) {
      setErrorText('Password must be at least 6 characters');
      return;
    }

    if (forgotNewPassword !== forgotConfirmPassword) {
      setErrorText('Passwords do not match');
      return;
    }

    try {
      setLoading(true);
      await forgotPassword({
        email: forgotEmail,
        newPassword: forgotNewPassword,
      });
      Alert.alert('Success', 'Password reset successfully. Please log in with your new password.');
      setForgotMode(false);
      setMode('email_password');
      setForgotEmail('');
      setForgotNewPassword('');
      setForgotConfirmPassword('');
      setEmailInput('');
      setPasswordInput('');
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || 'Password reset failed';
      setErrorText(msg);
    } finally {
      setLoading(false);
    }
  };

  // ─── RENDER HELPERS ───────────────────────────────────

  const renderPhoneMode = () => {
    if (!otpSent) {
      return (
        <>
          {/* Phone Input with Flag */}
          <View style={styles.inputRow}>
            <Text style={styles.flagEmoji}>🇮🇳</Text>
            <Text style={styles.countryCode}>+91</Text>
            <View style={styles.inputDivider} />
            <TextInput
              placeholder="Enter your mobile number"
              placeholderTextColor="rgba(255,255,255,0.4)"
              keyboardType="phone-pad"
              value={phoneInput}
              onChangeText={setPhoneInput}
              style={styles.phoneTextInput}
              editable={!loading}
              maxLength={14}
            />
          </View>

          {/* Send OTP Button */}
          <TouchableOpacity
            onPress={onSendOtp}
            disabled={loading}
            style={[styles.primaryButton, loading && styles.buttonDisabled]}
          >
            {loading ? (
              <ActivityIndicator color="#000" />
            ) : (
              <Text style={styles.primaryButtonText}>Send OTP</Text>
            )}
          </TouchableOpacity>
        </>
      );
    }

    // OTP verification
    return (
      <>
        <TextInput
          value={otpInput}
          onChangeText={setOtpInput}
          keyboardType="number-pad"
          placeholder="Enter OTP"
          placeholderTextColor="rgba(255,255,255,0.4)"
          style={styles.otpInput}
          editable={!loading}
          maxLength={6}
        />

        <TouchableOpacity
          onPress={onVerifyOtp}
          disabled={loading}
          style={[styles.primaryButton, loading && styles.buttonDisabled]}
        >
          {loading ? (
            <ActivityIndicator color="#000" />
          ) : (
            <Text style={styles.primaryButtonText}>Verify OTP</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          onPress={onSendOtp}
          disabled={loading || resendCountdown > 0}
          style={styles.linkButton}
        >
          <Text
            style={[
              styles.linkText,
              (loading || resendCountdown > 0) && styles.linkTextDisabled,
            ]}
          >
            {resendCountdown > 0 ? `Resend OTP in ${resendCountdown}s` : 'Resend OTP'}
          </Text>
        </TouchableOpacity>
      </>
    );
  };

  const renderEmailMode = () => (
    <>
      <TextInput
        value={emailInput}
        onChangeText={setEmailInput}
        keyboardType="email-address"
        autoCapitalize="none"
        placeholder="Enter your email"
        placeholderTextColor="rgba(255,255,255,0.4)"
        style={styles.inputField}
        editable={!loading}
      />

      <TextInput
        value={passwordInput}
        onChangeText={setPasswordInput}
        secureTextEntry
        placeholder="Enter your password"
        placeholderTextColor="rgba(255,255,255,0.4)"
        style={styles.inputField}
        editable={!loading}
      />

      <TouchableOpacity
        style={[styles.primaryButton, loading && styles.buttonDisabled]}
        onPress={onEmailPasswordAuth}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#000" />
        ) : (
          <Text style={styles.primaryButtonText}>Continue</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        onPress={() => {
          setForgotMode(true);
          setErrorText('');
        }}
        style={styles.linkButton}
      >
        <Text style={styles.linkText}>Forgot password?</Text>
      </TouchableOpacity>
    </>
  );

  const renderForgotMode = () => (
    <>
      <Text style={styles.forgotTitle}>Reset Password</Text>

      <TextInput
        value={forgotEmail}
        onChangeText={setForgotEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        placeholder="Enter your email"
        placeholderTextColor="rgba(255,255,255,0.4)"
        style={styles.inputField}
        editable={!loading}
      />

      <TextInput
        value={forgotNewPassword}
        onChangeText={setForgotNewPassword}
        secureTextEntry
        placeholder="New password"
        placeholderTextColor="rgba(255,255,255,0.4)"
        style={styles.inputField}
        editable={!loading}
      />

      <TextInput
        value={forgotConfirmPassword}
        onChangeText={setForgotConfirmPassword}
        secureTextEntry
        placeholder="Confirm password"
        placeholderTextColor="rgba(255,255,255,0.4)"
        style={styles.inputField}
        editable={!loading}
      />

      <TouchableOpacity
        style={[styles.primaryButton, loading && styles.buttonDisabled]}
        onPress={onForgotPassword}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#000" />
        ) : (
          <Text style={styles.primaryButtonText}>Reset Password</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        onPress={() => {
          setForgotMode(false);
          setForgotEmail('');
          setForgotNewPassword('');
          setForgotConfirmPassword('');
          setErrorText('');
        }}
        style={styles.linkButton}
      >
        <Text style={styles.linkText}>Back to login</Text>
      </TouchableOpacity>

      {errorText ? <Text style={styles.errorText}>{errorText}</Text> : null}
    </>
  );

  // ─── MAIN RENDER ──────────────────────────────────────

  return (
    <SafeAreaView edges={['bottom']} style={styles.safeArea}>
      <StatusBar style="light" translucent backgroundColor="transparent" />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex1}
      >
        <View style={styles.flex1}>
          {/* FULL SCREEN BACKGROUND IMAGE */}
          <ImageBackground
            source={loginBackground}
            style={styles.flex1}
            resizeMode="cover"
          >
            {/* BOTTOM DARK GRADIENT */}
            <LinearGradient
              colors={[
                'rgba(0, 0, 0, 0)',
                'rgba(0, 0, 0, 0.78)',
                'rgba(0, 0, 0, 0.99)',
                'rgba(0, 0, 0, 1)',
              ]}
              locations={[0, 0.6, 0.99, 1]}
              style={StyleSheet.absoluteFillObject}
            />

            {/* TOP TAGLINES */}
            <View style={styles.topCopy}>
              {/* <Text style={styles.taglineSmall}>Life at its fullest</Text>
              <Text style={styles.taglineBold}>Mornings full of energy</Text> */}
            </View>

            {/* SPACER */}
            <ScrollView style={styles.flex1} showsVerticalScrollIndicator={false}>
              <View style={styles.topSpacer} />
            </ScrollView>
          </ImageBackground>

          {/* ─── FIXED BOTTOM PANEL ─── */}
          <View
            style={[
              styles.bottomPane,
              { paddingBottom: insets.bottom + 5 },
            ]}
          >
            {/* BRAND */}
            <Text style={styles.brand}>GetFit</Text>
            <Text style={styles.subtitle}>Sign in or Sign up</Text>

            {/* AUTH FORMS */}
            {!forgotMode ? (
              <>
                {mode === 'phone' ? renderPhoneMode() : renderEmailMode()}

                {/* Error */}
                {errorText ? <Text style={styles.errorText}>{errorText}</Text> : null}

                {/* DIVIDER */}
                <View style={styles.dividerRow}>
                  <View style={styles.dividerLine} />
                  <Text style={styles.dividerText}>Or sign in with</Text>
                  <View style={styles.dividerLine} />
                </View>

                {/* ─── SOCIAL BUTTONS ─── */}
                <View style={styles.socialRow}>

                  {/* Button 1: Email ↔ Phone toggle */}
                  <TouchableOpacity
                    style={styles.socialButton}
                    onPress={() => {
                      if (mode === 'phone') {
                        setMode('email_password');
                      } else {
                        setMode('phone');
                      }
                      resetState();
                    }}
                  >
                    <FontAwesome
                      name={mode === 'phone' ? 'envelope' : 'phone'}
                      size={24}
                      color="#fff"
                    />
                    <Text style={styles.socialLabel}>
                      {mode === 'phone' ? 'Email' : 'Phone'}
                    </Text>
                  </TouchableOpacity>

                  {/* Button 2: Google */}
                  <TouchableOpacity style={styles.socialButton}>
                    <Image
                      source={require('../../assets/icons/google.png')}
                      style={styles.socialIcon}
                    />
                    <Text style={styles.socialLabel}>Google</Text>
                  </TouchableOpacity>

                  {/* Button 3: Facebook */}
                  <TouchableOpacity style={styles.socialButtonFacebook}>
                    <FontAwesome name="facebook" size={24} color="#fff" />
                    <Text style={styles.socialLabel}>Facebook</Text>
                  </TouchableOpacity>

                </View>
              </>
            ) : (
              renderForgotMode()
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── STYLES ──────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#000',
  },
  flex1: {
    flex: 1,
  },

  // ─── TOP TAGLINES ─────────────────────────────────────
  topCopy: {
    paddingTop: 60,
    paddingHorizontal: 16,
  },
  taglineSmall: {
    color: '#fff',
    fontSize: 22,
    opacity: 0.7,
  },
  taglineBold: {
    color: '#fff',
    fontSize: 32,
    fontWeight: '700',
    marginTop: 4,
  },
  topSpacer: {
    height: 280,
  },

  // ─── BOTTOM PANEL ─────────────────────────────────────
  bottomPane: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
  },
  brand: {
    color: '#fff',
    fontSize: 32,
    fontWeight: '900',
    fontStyle: 'italic',
  },
  subtitle: {
    color: '#ccc',
    marginBottom: 15,
    fontSize: 18,
    fontWeight: '600',
  },

  // ─── PHONE INPUT ROW ─────────────────────────────────
  inputRow: {
    height: 55,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.1)',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  flagEmoji: {
    fontSize: 22,
    marginRight: 8,
  },
  countryCode: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  inputDivider: {
    width: 1,
    height: 22,
    backgroundColor: 'rgba(255,255,255,0.3)',
    marginHorizontal: 12,
  },
  phoneTextInput: {
    flex: 1,
    color: '#fff',
    fontSize: 16,
  },

  // ─── GENERAL INPUT FIELD ──────────────────────────────
  inputField: {
    height: 55,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 15,
    color: '#fff',
    fontSize: 16,
    marginBottom: 12,
  },

  // ─── OTP INPUT ────────────────────────────────────────
  otpInput: {
    height: 55,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 15,
    color: '#fff',
    fontSize: 22,
    letterSpacing: 6,
    textAlign: 'center',
    marginBottom: 12,
  },

  // ─── PRIMARY BUTTON ──────────────────────────────────
  primaryButton: {
    height: 55,
    backgroundColor: '#fff',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  primaryButtonText: {
    color: '#000',
    fontWeight: '700',
    fontSize: 16,
  },
  buttonDisabled: {
    opacity: 0.6,
  },

  // ─── LINKS ────────────────────────────────────────────
  linkButton: {
    alignSelf: 'center',
    marginTop: 2,
    marginBottom: 8,
    paddingVertical: 4,
  },
  linkText: {
    color: '#c7d2fe',
    fontSize: 14,
    fontWeight: '500',
  },
  linkTextDisabled: {
    opacity: 0.5,
  },

  // ─── DIVIDER ──────────────────────────────────────────
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 15,
    marginTop: 4,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#444',
  },
  dividerText: {
    marginHorizontal: 10,
    color: '#aaa',
    fontSize: 12,
  },

  // ─── SOCIAL BUTTONS ──────────────────────────────────
  socialRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 14,
  },
  socialButton: {
    width: 100,
    height: 75,
    backgroundColor: '#272828',
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
  },
  socialButtonFacebook: {
    width: 100,
    height: 75,
    backgroundColor: '#272828',
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
  },
  socialIcon: {
    width: 26,
    height: 26,
  },
  socialLabel: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },

  // ─── ERROR / FORGOT ──────────────────────────────────
  errorText: {
    color: '#fca5a5',
    marginTop: 6,
    marginBottom: 4,
    fontSize: 13,
    textAlign: 'center',
  },
  forgotTitle: {
    color: '#f3f4f6',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 14,
    textAlign: 'center',
  },
});
