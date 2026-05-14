import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Dimensions,
  Image,
  Keyboard,
  Platform,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
  ActivityIndicator,
} from 'react-native';
import { Video, ResizeMode } from 'expo-av';

import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import * as AppleAuthentication from 'expo-apple-authentication';
import {
  sendOtpRequest,
  verifyOtpRequest,
  emailPasswordAuthRequest,
  forgotPassword,
  googleLoginRequest,
  appleLoginRequest,
  setAuthToken,
  getUserProfile,
} from '../../services/api';

// Warm up browser for faster OAuth popup
WebBrowser.maybeCompleteAuthSession();

const loginVideo = require('../../assets/images/AILogin.mp4');
const RESEND_COOLDOWN_SECONDS = 30;
const { height: SCREEN_HEIGHT } = Dimensions.get('window');

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
  const phoneInputRef = useRef<TextInput>(null);

  // ─── ANIMATION VALUES ─────────────────────────────────
  const focusAnim = useRef(new Animated.Value(0)).current;  // 0 = hero, 1 = focused
  const overlayAnim = useRef(new Animated.Value(0)).current;

  // ─── STATE ────────────────────────────────────────────
  const [isFocusedState, setIsFocusedState] = useState(false);
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

  // ─── GOOGLE AUTH ─────────────────────────────────────
  // Only configure the platform-specific clientId we have. Otherwise
  // expo-auth-session throws "Client Id property `androidClientId` must
  // be defined" on Android builds without an Android OAuth client.
  const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
  const androidClientId = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID;

  const googleAuthAvailable =
    Platform.OS === 'ios'
      ? !!iosClientId
      : Platform.OS === 'android'
        ? !!androidClientId
        : !!webClientId;

  // Pass a harmless placeholder for any missing platform clientId so the
  // hook's invariant check (`Client Id property X must be defined`) passes.
  // The real sign-in call is gated by googleAuthAvailable below.
  const PLACEHOLDER = 'unconfigured.apps.googleusercontent.com';
  const [googleRequest, googleResponse, googlePromptAsync] = Google.useIdTokenAuthRequest({
    iosClientId: iosClientId || PLACEHOLDER,
    androidClientId: androidClientId || PLACEHOLDER,
    webClientId: webClientId || PLACEHOLDER,
    redirectUri: 'host.exp.exponent:/oauth2redirect/google',
  });

  useEffect(() => {
    if (googleResponse?.type === 'success') {
      const { id_token } = googleResponse.params;
      if (id_token) {
        handleGoogleLogin(id_token);
      }
    } else if (googleResponse?.type === 'error') {
      setErrorText('Google sign in failed. Please try again.');
    }
  }, [googleResponse]);

  const handleGoogleLogin = async (idToken: string) => {
    try {
      setLoading(true);
      setErrorText('');
      const res = await googleLoginRequest({ idToken });
      const token = res.data?.token;
      if (!token) {
        setErrorText('No token returned from server');
        return;
      }
      await completeAuth(token);
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || 'Google login failed';
      setErrorText(msg);
    } finally {
      setLoading(false);
    }
  };

  // ─── APPLE AUTH ──────────────────────────────────────
  const handleAppleLogin = async () => {
    try {
      setLoading(true);
      setErrorText('');
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });

      if (!credential.identityToken) {
        setErrorText('Apple sign in failed: no identity token');
        return;
      }

      const res = await appleLoginRequest({
        identityToken: credential.identityToken,
        email: credential.email,
        fullName: credential.fullName,
        user: credential.user,
      });

      const token = res.data?.token;
      if (!token) {
        setErrorText('No token returned from server');
        return;
      }
      await completeAuth(token);
    } catch (err: any) {
      if (err.code === 'ERR_REQUEST_CANCELED') {
        // User cancelled — do nothing
        return;
      }
      const msg = err?.response?.data?.message || err?.message || 'Apple sign in failed';
      setErrorText(msg);
    } finally {
      setLoading(false);
    }
  };

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

  // ─── ANIMATION HANDLERS ───────────────────────────────

  const enterFocusedState = () => {
    setIsFocusedState(true);
    Animated.parallel([
      Animated.spring(focusAnim, {
        toValue: 1,
        tension: 65,
        friction: 11,
        useNativeDriver: true,
      }),
      Animated.timing(overlayAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start(() => {
      // Auto-focus the input after animation completes
      setTimeout(() => {
        phoneInputRef.current?.focus();
      }, 100);
    });
  };

  const exitFocusedState = () => {
    Keyboard.dismiss();
    Animated.parallel([
      Animated.spring(focusAnim, {
        toValue: 0,
        tension: 65,
        friction: 11,
        useNativeDriver: true,
      }),
      Animated.timing(overlayAnim, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setIsFocusedState(false);
    });
  };

  // ─── AUTH LOGIC ───────────────────────────────────────

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

  // ─── ANIMATED INTERPOLATIONS ──────────────────────────

  // Hero content slides up and fades out
  const heroTranslateY = focusAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -SCREEN_HEIGHT * 0.35],
  });
  const heroOpacity = focusAnim.interpolate({
    inputRange: [0, 0.5],
    outputRange: [1, 0],
  });

  // Dark overlay fades in
  const overlayOpacity = overlayAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 0.92],
  });

  // Dynamic: move bottom-anchored content up to land at (insets.top + 24)
  // Content height is ~430px. From flex-end, its top sits at:
  //   SCREEN_HEIGHT - 430 - insets.bottom - 10
  // We want it at insets.top + 24, so:
  const focusedOffset = -(SCREEN_HEIGHT - insets.top - insets.bottom - 430 - 34);
  const panelTranslateY = focusAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, focusedOffset],
  });

  // ─── RENDER PHONE MODE ────────────────────────────────

  const renderPhoneInput = () => {
    if (!otpSent) {
      return (
        <>
          {/* Phone Input with Flag */}
          <View style={{
            height: 55,
            borderRadius: 14,
            backgroundColor: isFocusedState ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.1)',
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 14,
            marginBottom: 12,
            borderWidth: isFocusedState ? 1 : 0,
            borderColor: 'rgba(255,255,255,0.15)',
          }}>
            <Text style={{ fontSize: 22, marginRight: 8 }}>🇮🇳</Text>
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '600' }}>+91</Text>
            <View style={{
              width: 1,
              height: 22,
              backgroundColor: 'rgba(255,255,255,0.3)',
              marginHorizontal: 12,
            }} />
            <TextInput
              ref={phoneInputRef}
              placeholder="Enter your mobile number"
              placeholderTextColor="rgba(255,255,255,0.4)"
              keyboardType="phone-pad"
              value={phoneInput}
              onChangeText={setPhoneInput}
              style={{
                flex: 1,
                color: '#fff',
                fontSize: 16,
              }}
              editable={!loading}
              maxLength={14}
              onFocus={() => {
                if (!isFocusedState) enterFocusedState();
              }}
              returnKeyType="done"
            />
          </View>

          {/* Send OTP */}
          <TouchableOpacity
            onPress={onSendOtp}
            disabled={loading}
            activeOpacity={0.85}
            style={{
              height: 55,
              backgroundColor: '#fff',
              borderRadius: 14,
              justifyContent: 'center',
              alignItems: 'center',
              marginBottom: 12,
              opacity: loading ? 0.6 : 1,
            }}
          >
            {loading ? (
              <ActivityIndicator size="small" color="#000" />
            ) : (
              <Text style={{ color: '#000', fontWeight: '700', fontSize: 16 }}>Send OTP</Text>
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
          style={{
            height: 55,
            borderRadius: 14,
            backgroundColor: 'rgba(255,255,255,0.12)',
            paddingHorizontal: 15,
            color: '#fff',
            fontSize: 22,
            letterSpacing: 6,
            textAlign: 'center',
            marginBottom: 12,
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.15)',
          }}
          editable={!loading}
          maxLength={6}
          autoFocus
        />

        <TouchableOpacity
          onPress={onVerifyOtp}
          disabled={loading}
          activeOpacity={0.85}
          style={{
            height: 55,
            backgroundColor: '#fff',
            borderRadius: 14,
            justifyContent: 'center',
            alignItems: 'center',
            marginBottom: 12,
            opacity: loading ? 0.6 : 1,
          }}
        >
          {loading ? (
            <ActivityIndicator size="small" color="#000" />
          ) : (
            <Text style={{ color: '#000', fontWeight: '700', fontSize: 16 }}>Verify OTP</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          onPress={onSendOtp}
          disabled={loading || resendCountdown > 0}
          style={{ alignSelf: 'center', marginTop: 2, marginBottom: 8, paddingVertical: 4 }}
        >
          <Text style={{
            color: '#c7d2fe',
            fontSize: 14,
            fontWeight: '500',
            opacity: (loading || resendCountdown > 0) ? 0.5 : 1,
          }}>
            {resendCountdown > 0 ? `Resend OTP in ${resendCountdown}s` : 'Resend OTP'}
          </Text>
        </TouchableOpacity>
      </>
    );
  };

  // ─── RENDER EMAIL MODE ────────────────────────────────

  const renderEmailInput = () => (
    <>
      <TextInput
        value={emailInput}
        onChangeText={setEmailInput}
        keyboardType="email-address"
        autoCapitalize="none"
        placeholder="Enter your email"
        placeholderTextColor="rgba(255,255,255,0.4)"
        style={{
          height: 55,
          borderRadius: 14,
          backgroundColor: 'rgba(255,255,255,0.12)',
          paddingHorizontal: 15,
          color: '#fff',
          fontSize: 16,
          marginBottom: 12,
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.15)',
        }}
        editable={!loading}
        onFocus={() => {
          if (!isFocusedState) enterFocusedState();
        }}
      />

      <TextInput
        value={passwordInput}
        onChangeText={setPasswordInput}
        secureTextEntry
        placeholder="Enter your password"
        placeholderTextColor="rgba(255,255,255,0.4)"
        style={{
          height: 55,
          borderRadius: 14,
          backgroundColor: 'rgba(255,255,255,0.12)',
          paddingHorizontal: 15,
          color: '#fff',
          fontSize: 16,
          marginBottom: 12,
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.15)',
        }}
        editable={!loading}
      />

      <TouchableOpacity
        onPress={onEmailPasswordAuth}
        disabled={loading}
        activeOpacity={0.85}
        style={{
          height: 55,
          backgroundColor: '#fff',
          borderRadius: 14,
          justifyContent: 'center',
          alignItems: 'center',
          marginBottom: 12,
          opacity: loading ? 0.6 : 1,
        }}
      >
        {loading ? (
          <ActivityIndicator size="small" color="#000" />
        ) : (
          <Text style={{ color: '#000', fontWeight: '700', fontSize: 16 }}>Continue</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        onPress={() => {
          setForgotMode(true);
          setErrorText('');
        }}
        style={{ alignSelf: 'center', marginTop: 2, marginBottom: 8, paddingVertical: 4 }}
      >
        <Text style={{ color: '#c7d2fe', fontSize: 14, fontWeight: '500' }}>
          Forgot password?
        </Text>
      </TouchableOpacity>
    </>
  );

  // ─── RENDER FORGOT MODE ───────────────────────────────

  const renderForgotMode = () => (
    <>
      <Text style={{
        color: '#f3f4f6',
        fontSize: 16,
        fontWeight: '600',
        marginBottom: 14,
        textAlign: 'center',
      }}>
        Reset Password
      </Text>

      <TextInput
        value={forgotEmail}
        onChangeText={setForgotEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        placeholder="Enter your email"
        placeholderTextColor="rgba(255,255,255,0.4)"
        style={{
          height: 55,
          borderRadius: 14,
          backgroundColor: 'rgba(255,255,255,0.12)',
          paddingHorizontal: 15,
          color: '#fff',
          fontSize: 16,
          marginBottom: 12,
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.15)',
        }}
        editable={!loading}
      />

      <TextInput
        value={forgotNewPassword}
        onChangeText={setForgotNewPassword}
        secureTextEntry
        placeholder="New password"
        placeholderTextColor="rgba(255,255,255,0.4)"
        style={{
          height: 55,
          borderRadius: 14,
          backgroundColor: 'rgba(255,255,255,0.12)',
          paddingHorizontal: 15,
          color: '#fff',
          fontSize: 16,
          marginBottom: 12,
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.15)',
        }}
        editable={!loading}
      />

      <TextInput
        value={forgotConfirmPassword}
        onChangeText={setForgotConfirmPassword}
        secureTextEntry
        placeholder="Confirm password"
        placeholderTextColor="rgba(255,255,255,0.4)"
        style={{
          height: 55,
          borderRadius: 14,
          backgroundColor: 'rgba(255,255,255,0.12)',
          paddingHorizontal: 15,
          color: '#fff',
          fontSize: 16,
          marginBottom: 12,
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.15)',
        }}
        editable={!loading}
      />

      <TouchableOpacity
        onPress={onForgotPassword}
        disabled={loading}
        activeOpacity={0.85}
        style={{
          height: 55,
          backgroundColor: '#fff',
          borderRadius: 14,
          justifyContent: 'center',
          alignItems: 'center',
          marginBottom: 12,
          opacity: loading ? 0.6 : 1,
        }}
      >
        {loading ? (
          <ActivityIndicator size="small" color="#000" />
        ) : (
          <Text style={{ color: '#000', fontWeight: '700', fontSize: 16 }}>Reset Password</Text>
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
        style={{ alignSelf: 'center', marginTop: 2, marginBottom: 8, paddingVertical: 4 }}
      >
        <Text style={{ color: '#c7d2fe', fontSize: 14, fontWeight: '500' }}>Back to login</Text>
      </TouchableOpacity>

      {errorText ? (
        <Text style={{ color: '#fca5a5', marginTop: 6, marginBottom: 4, fontSize: 13, textAlign: 'center' }}>
          {errorText}
        </Text>
      ) : null}
    </>
  );

  // ─── SOCIAL BUTTONS ───────────────────────────────────

  const renderSocialButtons = () => (
    <>
      {/* Divider */}
      <View style={{
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 15,
        marginTop: 4,
      }}>
        <View style={{ flex: 1, height: 1, backgroundColor: '#444' }} />
        <Text style={{ marginHorizontal: 10, color: '#aaa', fontSize: 12 }}>Or sign in with</Text>
        <View style={{ flex: 1, height: 1, backgroundColor: '#444' }} />
      </View>

      {/* Social Row */}
      <View style={{
        flexDirection: 'row',
        justifyContent: 'center',
        gap: 14,
      }}>
        {/* Email / Phone toggle */}
        <TouchableOpacity
          style={{
            width: 100,
            height: 75,
            backgroundColor: '#272828',
            borderRadius: 16,
            justifyContent: 'center',
            alignItems: 'center',
            gap: 6,
          }}
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
          <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>
            {mode === 'phone' ? 'Email' : 'Phone'}
          </Text>
        </TouchableOpacity>

        {/* Google */}
        <TouchableOpacity
          style={{
            width: 100,
            height: 75,
            backgroundColor: '#272828',
            borderRadius: 16,
            justifyContent: 'center',
            alignItems: 'center',
            gap: 6,
            opacity: loading ? 0.5 : 1,
          }}
          disabled={loading || !googleRequest || !googleAuthAvailable}
          onPress={() => {
            if (!googleAuthAvailable) {
              setErrorText(
                Platform.OS === 'android'
                  ? 'Google sign-in is not configured for Android yet. Please use phone or email.'
                  : 'Google sign-in is not configured. Please use phone or email.'
              );
              return;
            }
            googlePromptAsync();
          }}
        >
          <Image
            source={require('../../assets/icons/google.png')}
            style={{ width: 26, height: 26 }}
          />
          <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>Google</Text>
        </TouchableOpacity>

        {/* Apple (iOS only) */}
        {Platform.OS === 'ios' && (
          <TouchableOpacity
            style={{
              width: 100,
              height: 75,
              backgroundColor: '#272828',
              borderRadius: 16,
              justifyContent: 'center',
              alignItems: 'center',
              gap: 6,
              opacity: loading ? 0.5 : 1,
            }}
            disabled={loading}
            onPress={handleAppleLogin}
          >
            <FontAwesome name="apple" size={26} color="#fff" />
            <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>Apple</Text>
          </TouchableOpacity>
        )}
      </View>
    </>
  );

  // ─── MAIN RENDER ──────────────────────────────────────

  return (
    <SafeAreaView edges={['bottom']} style={{ flex: 1, backgroundColor: '#000' }}>
      <StatusBar style="light" translucent backgroundColor="transparent" />

      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <View style={{ flex: 1 }}>

          {/* ═══ BACKGROUND VIDEO (Hero) ═══ */}
          <Animated.View style={{
            ...({ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } as any),
            transform: [{ translateY: heroTranslateY }],
            opacity: heroOpacity,
          }}>
            <Video
              source={loginVideo}
              style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
              resizeMode={ResizeMode.COVER}
              shouldPlay
              isLooping
              isMuted
            />
            {/* Bottom gradient */}
            <LinearGradient
              colors={[
                'rgba(0, 0, 0, 0)',
                'rgba(0, 0, 0, 0.78)',
                'rgba(0, 0, 0, 0.99)',
                'rgba(0, 0, 0, 1)',
              ]}
              locations={[0, 0.6, 0.99, 1]}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
              }}
            />
          </Animated.View>

          {/* ═══ DARK OVERLAY (appears on focus) ═══ */}
          <Animated.View
            pointerEvents="none"
            style={{
              ...({ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } as any),
              backgroundColor: '#000',
              opacity: overlayOpacity,
              zIndex: 1,
            }}
          />

          {/* ═══ CONTENT LAYER ═══ */}
          <View style={{
            flex: 1,
            justifyContent: 'flex-end',
            zIndex: 2,
          }}>
            <Animated.View style={{
              paddingHorizontal: 20,
              paddingBottom: insets.bottom + 10,
              transform: [{ translateY: panelTranslateY }],
            }}>

              {/* ─── BACK BUTTON (visible in focused state) ─── */}
              {isFocusedState && (
                <TouchableOpacity
                  onPress={exitFocusedState}
                  activeOpacity={0.7}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    marginBottom: 20,
                    alignSelf: 'flex-start',
                    paddingVertical: 6,
                    paddingHorizontal: 2,
                  }}
                >
                  <FontAwesome name="chevron-left" size={14} color="rgba(255,255,255,0.7)" />
                  <Text style={{
                    color: 'rgba(255,255,255,0.7)',
                    fontSize: 14,
                    fontWeight: '500',
                    marginLeft: 8,
                  }}>
                    Back
                  </Text>
                </TouchableOpacity>
              )}

              {/* ─── BRAND ─── */}
              <Text style={{
                color: '#fff',
                fontSize: isFocusedState ? 26 : 32,
                fontWeight: '900',
                fontStyle: 'italic',
              }}>
                GetFit
              </Text>
              <Text style={{
                color: '#ccc',
                marginBottom: 15,
                fontSize: isFocusedState ? 15 : 18,
                fontWeight: '600',
              }}>
                Sign in or Sign up
              </Text>

              {/* ─── AUTH FORMS ─── */}
              {!forgotMode ? (
                <>
                  {mode === 'phone' ? renderPhoneInput() : renderEmailInput()}

                  {/* Error */}
                  {errorText ? (
                    <Text style={{
                      color: '#fca5a5',
                      marginTop: 6,
                      marginBottom: 4,
                      fontSize: 13,
                      textAlign: 'center',
                    }}>
                      {errorText}
                    </Text>
                  ) : null}

                  {/* Social Buttons */}
                  {renderSocialButtons()}
                </>
              ) : (
                renderForgotMode()
              )}
            </Animated.View>
          </View>
        </View>
      </TouchableWithoutFeedback>
    </SafeAreaView>
  );
}
