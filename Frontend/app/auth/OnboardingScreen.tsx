import React, { useState, useRef, useCallback, useMemo } from 'react';
import {
  Alert,
  Animated,
  Dimensions,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ActivityIndicator,
} from 'react-native';
import * as Haptics from 'expo-haptics';

import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { saveOnboarding, setAuthToken } from '../../services/api';
import { HealthKitService } from '../../services/fitness/HealthKitService';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ─── All Countries ─────────────────────────────────────
const COUNTRIES = [
  'Afghanistan','Albania','Algeria','Andorra','Angola','Antigua and Barbuda','Argentina','Armenia','Australia','Austria',
  'Azerbaijan','Bahamas','Bahrain','Bangladesh','Barbados','Belarus','Belgium','Belize','Benin','Bhutan',
  'Bolivia','Bosnia and Herzegovina','Botswana','Brazil','Brunei','Bulgaria','Burkina Faso','Burundi','Cabo Verde','Cambodia',
  'Cameroon','Canada','Central African Republic','Chad','Chile','China','Colombia','Comoros','Congo','Costa Rica',
  'Croatia','Cuba','Cyprus','Czech Republic','Denmark','Djibouti','Dominica','Dominican Republic','East Timor','Ecuador',
  'Egypt','El Salvador','Equatorial Guinea','Eritrea','Estonia','Eswatini','Ethiopia','Fiji','Finland','France',
  'Gabon','Gambia','Georgia','Germany','Ghana','Greece','Grenada','Guatemala','Guinea','Guinea-Bissau',
  'Guyana','Haiti','Honduras','Hungary','Iceland','India','Indonesia','Iran','Iraq','Ireland',
  'Israel','Italy','Ivory Coast','Jamaica','Japan','Jordan','Kazakhstan','Kenya','Kiribati','Kosovo',
  'Kuwait','Kyrgyzstan','Laos','Latvia','Lebanon','Lesotho','Liberia','Libya','Liechtenstein','Lithuania',
  'Luxembourg','Madagascar','Malawi','Malaysia','Maldives','Mali','Malta','Marshall Islands','Mauritania','Mauritius',
  'Mexico','Micronesia','Moldova','Monaco','Mongolia','Montenegro','Morocco','Mozambique','Myanmar','Namibia',
  'Nauru','Nepal','Netherlands','New Zealand','Nicaragua','Niger','Nigeria','North Korea','North Macedonia','Norway',
  'Oman','Pakistan','Palau','Palestine','Panama','Papua New Guinea','Paraguay','Peru','Philippines','Poland',
  'Portugal','Qatar','Romania','Russia','Rwanda','Saint Kitts and Nevis','Saint Lucia','Saint Vincent and the Grenadines',
  'Samoa','San Marino','Sao Tome and Principe','Saudi Arabia','Senegal','Serbia','Seychelles','Sierra Leone','Singapore',
  'Slovakia','Slovenia','Solomon Islands','Somalia','South Africa','South Korea','South Sudan','Spain','Sri Lanka','Sudan',
  'Suriname','Sweden','Switzerland','Syria','Taiwan','Tajikistan','Tanzania','Thailand','Togo','Tonga',
  'Trinidad and Tobago','Tunisia','Turkey','Turkmenistan','Tuvalu','Uganda','Ukraine','United Arab Emirates',
  'United Kingdom','United States','Uruguay','Uzbekistan','Vanuatu','Vatican City','Venezuela','Vietnam','Yemen','Zambia','Zimbabwe',
];

// ─── Step Definitions ──────────────────────────────────

interface StepConfig {
  key: string;
  title: string;
  subtitle: string;
  type: 'text' | 'number' | 'select' | 'health' | 'country';
  placeholder?: string;
  options?: { label: string; value: string; icon: string }[];
  keyboardType?: 'default' | 'numeric';
  suffix?: string;
}

const STEPS: StepConfig[] = [
  {
    key: 'name',
    title: "What's your name?",
    subtitle: 'Let us know what to call you',
    type: 'text',
    placeholder: 'Enter your name',
    keyboardType: 'default',
  },
  {
    key: 'country',
    title: 'Where are you from?',
    subtitle: 'Select your country',
    type: 'country',
    placeholder: 'Search country…',
  },
  {
    key: 'weight',
    title: 'What is your weight?',
    subtitle: 'This helps us personalize your plan',
    type: 'number',
    placeholder: 'e.g. 70',
    keyboardType: 'numeric',
    suffix: 'kg',
  },
  {
    key: 'height',
    title: 'What is your height?',
    subtitle: 'We use this to calculate your metrics',
    type: 'number',
    placeholder: 'e.g. 175',
    keyboardType: 'numeric',
    suffix: 'cm',
  },
  {
    key: 'age',
    title: 'How old are you?',
    subtitle: 'Age helps us tailor recommendations',
    type: 'number',
    placeholder: 'e.g. 25',
    keyboardType: 'numeric',
    suffix: 'years',
  },
  {
    key: 'gender',
    title: 'What is your gender?',
    subtitle: 'This affects calorie calculations',
    type: 'select',
    options: [
      { label: 'Male', value: 'male', icon: 'mars' },
      { label: 'Female', value: 'female', icon: 'venus' },
      { label: 'Other', value: 'other', icon: 'genderless' },
    ],
  },
  {
    key: 'goal',
    title: 'What is your goal?',
    subtitle: 'Pick your primary fitness objective',
    type: 'select',
    options: [
      { label: 'Lose Weight', value: 'lose', icon: 'arrow-down' },
      { label: 'Maintain', value: 'maintain', icon: 'balance-scale' },
      { label: 'Gain Weight', value: 'gain', icon: 'arrow-up' },
    ],
  },
  {
    key: 'diet',
    title: 'What is your diet?',
    subtitle: 'We\'ll suggest meals accordingly',
    type: 'select',
    options: [
      { label: 'Vegetarian', value: 'veg', icon: 'leaf' },
      { label: 'Non-Vegetarian', value: 'non_veg', icon: 'cutlery' },
    ],
  },
  {
    key: 'level',
    title: 'What is your fitness level?',
    subtitle: 'Be honest — we\'ll match your workouts',
    type: 'select',
    options: [
      { label: 'Beginner', value: 'beginner', icon: 'star-o' },
      { label: 'Intermediate', value: 'intermediate', icon: 'star-half-full' },
      { label: 'Advanced', value: 'advanced', icon: 'star' },
    ],
  },
];

// Append a final iOS-only HealthKit authorization step.
// Android users don't see it (Health Connect onboarding lives elsewhere).
if (Platform.OS === 'ios') {
  STEPS.push({
    key: 'healthkit',
    title: 'Connect Apple Health',
    subtitle:
      'Connect your health data to GetFit for seamless syncing and personalized insights.',
    type: 'health',
  });
}

const TOTAL_STEPS = STEPS.length;

// ─── Main Component ────────────────────────────────────

export default function OnboardingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [currentStep, setCurrentStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [countrySearch, setCountrySearch] = useState('');

  // Animations
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const slideAnim = useRef(new Animated.Value(0)).current;

  const step = STEPS[currentStep];
  const currentValue = answers[step.key] || '';

  // Filtered countries for search
  const filteredCountries = useMemo(() => {
    if (!countrySearch.trim()) return COUNTRIES;
    const q = countrySearch.toLowerCase();
    return COUNTRIES.filter((c) => c.toLowerCase().includes(q));
  }, [countrySearch]);

  // ─── Validation ────────────────────────────────────

  const isStepValid = useCallback((): boolean => {
    const val = answers[STEPS[currentStep].key] || '';
    const s = STEPS[currentStep];

    if (s.type === 'text') {
      return val.trim().length >= 2;
    }

    if (s.type === 'number') {
      const num = Number(val);
      if (isNaN(num) || num <= 0) return false;
      if (s.key === 'weight') return num >= 20 && num <= 500;
      if (s.key === 'height') return num >= 50 && num <= 300;
      if (s.key === 'age') return num >= 10 && num <= 120 && Number.isInteger(num);
      return true;
    }

    if (s.type === 'select') {
      return val.length > 0;
    }

    if (s.type === 'country') {
      return val.length > 0;
    }

    if (s.type === 'health') {
      // Health step has its own action buttons — Next button is hidden,
      // so the validity check is irrelevant. Treat as always valid.
      return true;
    }

    return false;
  }, [currentStep, answers]);

  // ─── Animations ────────────────────────────────────

  const animateTransition = (direction: 'forward' | 'back', callback: () => void) => {
    const exitValue = direction === 'forward' ? -SCREEN_WIDTH : SCREEN_WIDTH;
    const enterValue = direction === 'forward' ? SCREEN_WIDTH : -SCREEN_WIDTH;

    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: exitValue,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start(() => {
      callback();
      slideAnim.setValue(enterValue);
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.spring(slideAnim, {
          toValue: 0,
          useNativeDriver: true,
          tension: 80,
          friction: 12,
        }),
      ]).start();
    });
  };

  // ─── Handlers ──────────────────────────────────────

  const handleNext = () => {
    if (!isStepValid()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    if (currentStep < TOTAL_STEPS - 1) {
      animateTransition('forward', () => {
        setCurrentStep((prev) => prev + 1);
        setCountrySearch('');
        setErrorText('');
      });
    } else {
      handleSubmit();
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      animateTransition('back', () => {
        setCurrentStep((prev) => prev - 1);
        setCountrySearch('');
        setErrorText('');
      });
    }
  };

  const handleSkip = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert(
      'Skip Onboarding?',
      'You can complete your profile later from settings.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Skip',
          onPress: () => {
            router.replace('/(tabs)');
          },
        },
      ]
    );
  };

  const handleSubmit = async () => {
    setErrorText('');
    setLoading(true);

    try {
      // Ensure auth token is set before API call
      const token = await AsyncStorage.getItem('token');
      if (token) setAuthToken(token);
      await saveOnboarding({
        name: answers.name?.trim(),
        country: answers.country,
        weight: answers.weight,
        height: answers.height,
        age: Number(answers.age),
        gender: answers.gender,
        goal: answers.goal,
        diet: answers.diet,
        level: answers.level,
      });
      router.replace('/(tabs)');
    } catch (err: any) {
      const msg =
        err?.response?.data?.message || err?.message || 'Failed to save profile';
      setErrorText(msg);
    } finally {
      setLoading(false);
    }
  };

  /**
   * iOS-only: trigger the native HealthKit authorization sheet, then
   * proceed to submit the onboarding answers regardless of the user's
   * choice (granting permission is optional). We don't block submission
   * on the result because Apple's API doesn't reliably return whether
   * the user accepted or declined.
   */
  const handleAuthorizeHealth = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setLoading(true);
    try {
      // This call triggers the iOS HealthKit permissions popup.
      await HealthKitService.initialize();
    } catch (e) {
      // Even if HK throws, continue submitting — onboarding shouldn't
      // fail because of an optional integration.
      console.warn('[Onboarding] HealthKit initialize failed:', e);
    }
    await handleSubmit();
  };

  const handleSkipHealth = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    handleSubmit();
  };

  const updateAnswer = (value: string) => {
    Haptics.selectionAsync();
    setAnswers((prev) => ({ ...prev, [step.key]: value }));
  };

  // ─── Render Input ──────────────────────────────────

  const renderInput = () => {
    if (step.type === 'text' || step.type === 'number') {
      return (
        <View style={styles.inputContainer}>
          <TextInput
            value={currentValue}
            onChangeText={updateAnswer}
            placeholder={step.placeholder}
            placeholderTextColor="rgba(255,255,255,0.3)"
            keyboardType={step.keyboardType}
            style={styles.textInput}
            autoFocus
          />
          {step.suffix ? (
            <Text style={styles.suffixText}>{step.suffix}</Text>
          ) : null}
        </View>
      );
    }

    if (step.type === 'country') {
      return (
        <View style={styles.countryContainer}>
          <View style={styles.inputContainer}>
            <FontAwesome name="search" size={16} color="rgba(255,255,255,0.3)" style={{ marginRight: 10 }} />
            <TextInput
              value={countrySearch}
              onChangeText={setCountrySearch}
              placeholder={step.placeholder}
              placeholderTextColor="rgba(255,255,255,0.3)"
              style={styles.textInput}
              autoFocus
            />
            {countrySearch.length > 0 && (
              <TouchableOpacity onPress={() => setCountrySearch('')}>
                <FontAwesome name="times-circle" size={18} color="rgba(255,255,255,0.4)" />
              </TouchableOpacity>
            )}
          </View>

          {currentValue ? (
            <View style={styles.selectedCountryBadge}>
              <FontAwesome name="globe" size={14} color="#fff" style={{ marginRight: 8 }} />
              <Text style={styles.selectedCountryText}>{currentValue}</Text>
              <TouchableOpacity onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); updateAnswer(''); }}>
                <FontAwesome name="times" size={14} color="rgba(255,255,255,0.6)" style={{ marginLeft: 8 }} />
              </TouchableOpacity>
            </View>
          ) : null}

          <FlatList
            data={filteredCountries}
            keyExtractor={(item) => item}
            keyboardShouldPersistTaps="handled"
            style={styles.countryList}
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => {
              const isSelected = currentValue === item;
              return (
                <TouchableOpacity
                  style={[styles.countryRow, isSelected && styles.countryRowSelected]}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    updateAnswer(item);
                    setCountrySearch('');
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.countryRowText, isSelected && styles.countryRowTextSelected]}>{item}</Text>
                  {isSelected && (
                    <View style={styles.checkCircle}>
                      <FontAwesome name="check" size={12} color="#000" />
                    </View>
                  )}
                </TouchableOpacity>
              );
            }}
            ListEmptyComponent={
              <Text style={styles.noResultsText}>No countries found</Text>
            }
          />
        </View>
      );
    }

    if (step.type === 'health') {
      return (
        <View style={styles.healthScreen}>
          {/* Two-icon hero — your app logo + Apple Health heart */}
          <View style={styles.healthIconRow}>
            <View style={styles.healthIconBox}>
              <FontAwesome name="bolt" size={36} color="#fff" />
            </View>
            <FontAwesome
              name="exchange"
              size={22}
              color="rgba(255,255,255,0.5)"
              style={styles.healthIconArrow}
            />
            <View style={[styles.healthIconBox, styles.healthIconBoxLight]}>
              <FontAwesome name="heart" size={36} color="#fb6675" />
            </View>
          </View>
        </View>
      );
    }

    if (step.type === 'select' && step.options) {
      return (
        <View style={styles.optionsContainer}>
          {step.options.map((option) => {
            const isSelected = currentValue === option.value;
            return (
              <TouchableOpacity
                key={option.value}
                style={[
                  styles.optionCard,
                  isSelected && styles.optionCardSelected,
                ]}
                onPress={() => updateAnswer(option.value)}
                activeOpacity={0.7}
              >
                <FontAwesome
                  name={option.icon as any}
                  size={24}
                  color={isSelected ? '#fff' : 'rgba(255,255,255,0.5)'}
                  style={styles.optionIcon}
                />
                <Text
                  style={[
                    styles.optionLabel,
                    isSelected && styles.optionLabelSelected,
                  ]}
                >
                  {option.label}
                </Text>
                {isSelected && (
                  <View style={styles.checkCircle}>
                    <FontAwesome name="check" size={12} color="#000" />
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      );
    }

    return null;
  };

  // ─── Progress Bar ──────────────────────────────────

  const progress = (currentStep + 1) / TOTAL_STEPS;

  // ─── Main Render ───────────────────────────────────

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex1}
      >
        <View style={[styles.container, { paddingBottom: insets.bottom + 16 }]}>
          {/* ─── HEADER ─── */}
          <View style={styles.header}>
            {/* Back button */}
            {currentStep > 0 ? (
              <TouchableOpacity onPress={handleBack} style={styles.backButton}>
                <FontAwesome name="chevron-left" size={18} color="#fff" />
              </TouchableOpacity>
            ) : (
              <View style={styles.backButtonPlaceholder} />
            )}

            {/* Step counter */}
            <Text style={styles.stepCounter}>
              {currentStep + 1} of {TOTAL_STEPS}
            </Text>

            {/* Skip */}
            <TouchableOpacity onPress={handleSkip}>
              <Text style={styles.skipText}>Skip</Text>
            </TouchableOpacity>
          </View>

          {/* ─── PROGRESS BAR ─── */}
          <View style={styles.progressBarBg}>
            <View style={[styles.progressBarFill, { width: `${progress * 100}%` }]} />
          </View>

          {/* ─── STEP CONTENT ─── */}
          <Animated.View
            style={[
              styles.contentArea,
              {
                opacity: fadeAnim,
                transform: [{ translateX: slideAnim }],
              },
            ]}
          >
            <Text style={styles.stepTitle}>{step.title}</Text>
            <Text style={styles.stepSubtitle}>{step.subtitle}</Text>

            <View style={styles.inputArea}>
              {renderInput()}
            </View>
          </Animated.View>

          {/* ─── ERROR ─── */}
          {errorText ? (
            <Text style={styles.errorText}>{errorText}</Text>
          ) : null}

          {/* ─── BOTTOM ACTIONS ─── */}
          <View style={styles.bottomActions}>
            {step.type === 'health' ? (
              <>
                {/* Authorize — triggers iOS HealthKit permission sheet */}
                <TouchableOpacity
                  onPress={handleAuthorizeHealth}
                  disabled={loading}
                  style={[styles.authorizeButton, loading && styles.nextButtonDisabled]}
                  activeOpacity={0.85}
                >
                  {loading ? (
                    <ActivityIndicator size="small" color="#000" />
                  ) : (
                    <Text style={styles.authorizeButtonText}>Authorize</Text>
                  )}
                </TouchableOpacity>

                {/* Not now — skip without authorizing */}
                <TouchableOpacity
                  onPress={handleSkipHealth}
                  disabled={loading}
                  style={styles.notNowLink}
                  activeOpacity={0.6}
                >
                  <Text style={styles.notNowText}>Not now</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                {/* Skip & connect Health App */}
                {currentStep === 0 && (
                  <TouchableOpacity onPress={handleSkip} style={styles.healthAppLink}>
                    <FontAwesome name="heartbeat" size={16} color="#888" style={{ marginRight: 8 }} />
                    <Text style={styles.healthAppText}>Skip and connect Health App</Text>
                  </TouchableOpacity>
                )}

                {/* Next / Complete Button */}
                <TouchableOpacity
                  onPress={handleNext}
                  disabled={!isStepValid() || loading}
                  style={[
                    styles.nextButton,
                    (!isStepValid() || loading) && styles.nextButtonDisabled,
                  ]}
                  activeOpacity={0.8}
                >
                  {loading ? (
                    <ActivityIndicator size="small" color="#000" />
                  ) : (
                    <Text style={styles.nextButtonText}>
                      {currentStep === TOTAL_STEPS - 1 ? 'Complete' : 'Next'}
                    </Text>
                  )}
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── STYLES ────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#000',
  },
  flex1: {
    flex: 1,
  },
  container: {
    flex: 1,
    paddingHorizontal: 20,
  },

  // ─── Header ───────────────────────────────────────
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 8,
    paddingBottom: 12,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  backButtonPlaceholder: {
    width: 40,
    height: 40,
  },
  stepCounter: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 14,
    fontWeight: '600',
  },
  skipText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 14,
    fontWeight: '600',
  },

  // ─── Progress Bar ─────────────────────────────────
  progressBarBg: {
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 2,
    marginBottom: 40,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#fff',
    borderRadius: 2,
  },

  // ─── Content Area ─────────────────────────────────
  contentArea: {
    flex: 1,
  },
  stepTitle: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 8,
  },
  stepSubtitle: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 16,
    marginBottom: 32,
    lineHeight: 22,
  },
  inputArea: {
    flex: 1,
  },

  // ─── Text / Number Input ──────────────────────────
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 60,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 18,
  },
  textInput: {
    flex: 1,
    color: '#fff',
    fontSize: 18,
    height: '100%',
  },
  suffixText: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 16,
    marginLeft: 8,
    fontWeight: '600',
  },

  // ─── Select Options ───────────────────────────────
  optionsContainer: {
    gap: 12,
  },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 64,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 18,
  },
  optionCardSelected: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderColor: '#fff',
  },
  optionIcon: {
    width: 30,
    textAlign: 'center',
    marginRight: 14,
  },
  optionLabel: {
    flex: 1,
    color: 'rgba(255,255,255,0.6)',
    fontSize: 17,
    fontWeight: '600',
  },
  optionLabelSelected: {
    color: '#fff',
  },
  checkCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
  },

  // ─── Country Picker ───────────────────────────────
  countryContainer: {
    flex: 1,
  },
  selectedCountryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginTop: 12,
    marginBottom: 4,
  },
  selectedCountryText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  countryList: {
    flex: 1,
    marginTop: 8,
  },
  countryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 52,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 16,
    marginBottom: 6,
  },
  countryRowSelected: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderColor: '#fff',
  },
  countryRowText: {
    flex: 1,
    color: 'rgba(255,255,255,0.6)',
    fontSize: 16,
    fontWeight: '500',
  },
  countryRowTextSelected: {
    color: '#fff',
    fontWeight: '600',
  },
  noResultsText: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 15,
    textAlign: 'center',
    marginTop: 24,
  },

  // ─── Bottom Area ──────────────────────────────────
  bottomActions: {
    paddingTop: 12,
  },
  healthAppLink: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 12,
    marginBottom: 8,
  },
  healthAppText: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 14,
    fontWeight: '500',
  },
  nextButton: {
    height: 56,
    backgroundColor: '#fff',
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  nextButtonDisabled: {
    opacity: 0.3,
  },
  nextButtonText: {
    color: '#000',
    fontSize: 17,
    fontWeight: '700',
  },

  // ─── Error ────────────────────────────────────────
  errorText: {
    color: '#fca5a5',
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 8,
  },

  // ─── HealthKit Step ───────────────────────────────
  healthScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 40,
  },
  healthIconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  healthIconBox: {
    width: 88,
    height: 88,
    borderRadius: 22,
    backgroundColor: '#3a2c4a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  healthIconBoxLight: {
    backgroundColor: '#fff',
  },
  healthIconArrow: {
    marginHorizontal: 4,
  },
  authorizeButton: {
    height: 56,
    backgroundColor: '#e9d8ff',
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  authorizeButtonText: {
    color: '#1a1a1a',
    fontSize: 17,
    fontWeight: '700',
  },
  notNowLink: {
    paddingVertical: 10,
    alignItems: 'center',
  },
  notNowText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 14,
    fontWeight: '500',
    textDecorationLine: 'underline',
  },
});
