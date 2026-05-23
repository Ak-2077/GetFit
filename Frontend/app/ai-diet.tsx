import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, ScrollView, TextInput, Dimensions, Alert, Animated, Easing } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { generateAIDiet, setAuthToken } from '../services/api';

const { width } = Dimensions.get('window');
const C = {
  bg: '#000000', card: '#121212', cardAlt: '#1A1A1A', border: 'rgba(255,255,255,0.06)',
  accent: '#1FA463', accentDim: 'rgba(31,164,99,0.12)', white: '#F0F0F0',
  label: 'rgba(255,255,255,0.50)', muted: 'rgba(255,255,255,0.30)', gold: '#C8A84E',
  red: '#FF6B6B', blue: '#60A5FA',
};

// ── Questionnaire Options ──
const GOALS = [
  { key: 'lose', icon: 'flame', label: 'Lose Fat', desc: 'Calorie deficit', color: '#FF6B6B' },
  { key: 'maintain', icon: 'shield-checkmark', label: 'Maintain', desc: 'Stay balanced', color: '#60A5FA' },
  { key: 'gain', icon: 'trending-up', label: 'Build Muscle', desc: 'Calorie surplus', color: '#1FA463' },
];
const MEAL_COUNTS = [3, 4, 5, 6];
const CUISINES = [
  { key: 'indian', label: 'Indian', emoji: '🇮🇳' },
  { key: 'continental', label: 'Continental', emoji: '🌍' },
  { key: 'asian', label: 'Asian', emoji: '🥢' },
  { key: 'mediterranean', label: 'Mediterranean', emoji: '🫒' },
  { key: 'mixed', label: 'Mixed', emoji: '🍽️' },
];
const COOKING_TIMES = [
  { key: 'minimal', label: 'Quick & Easy', desc: 'No-cook / 10 min', icon: 'flash' },
  { key: 'moderate', label: 'Moderate', desc: '20-30 min prep', icon: 'time' },
  { key: 'elaborate', label: 'Full Cooking', desc: 'Proper meals', icon: 'restaurant' },
];
const BUDGETS = [
  { key: 'low', label: 'Budget', desc: 'Affordable staples', icon: 'wallet' },
  { key: 'medium', label: 'Balanced', desc: 'Mix of items', icon: 'card' },
  { key: 'high', label: 'Premium', desc: 'Best ingredients', icon: 'diamond' },
];
const ALLERGY_OPTIONS = ['Dairy', 'Gluten', 'Nuts', 'Eggs', 'Soy', 'Shellfish', 'Lactose'];
const HEALTH_OPTIONS = ['Diabetes', 'High BP', 'PCOD/PCOS', 'Thyroid', 'Cholesterol', 'IBS'];

const STEPS = ['goal', 'meals', 'cuisine', 'cooking', 'budget', 'restrictions'] as const;
type Step = typeof STEPS[number];

export default function AIDietScreen() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('goal');
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [loadProgress, setLoadProgress] = useState(0);
  const progressAnim = useRef(new Animated.Value(0)).current;

  // Questionnaire state
  const [goal, setGoal] = useState('');
  const [mealsPerDay, setMealsPerDay] = useState(4);
  const [cuisine, setCuisine] = useState('indian');
  const [cookingTime, setCookingTime] = useState('moderate');
  const [budget, setBudget] = useState('medium');
  const [allergies, setAllergies] = useState<string[]>([]);
  const [healthConditions, setHealthConditions] = useState<string[]>([]);
  const [notes, setNotes] = useState('');

  useEffect(() => {
    (async () => {
      const token = await AsyncStorage.getItem('token');
      if (token) setAuthToken(token);
    })();
  }, []);

  const stepIndex = STEPS.indexOf(step);
  const progress = (stepIndex + 1) / STEPS.length;

  const canProceed = () => {
    if (step === 'goal') return !!goal;
    return true;
  };

  const nextStep = () => {
    const idx = STEPS.indexOf(step);
    if (idx < STEPS.length - 1) setStep(STEPS[idx + 1]);
    else handleGenerate();
  };

  const prevStep = () => {
    const idx = STEPS.indexOf(step);
    if (idx > 0) setStep(STEPS[idx - 1]);
    else router.back();
  };

  const toggleItem = (list: string[], setList: (v: string[]) => void, item: string) => {
    setList(list.includes(item) ? list.filter(i => i !== item) : [...list, item]);
  };

  const [error, setError] = useState('');

  const progressTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const startProgressAnimation = () => {
    // Clear any existing timers
    progressTimers.current.forEach(t => clearTimeout(t));
    progressTimers.current = [];

    setLoadProgress(0);
    progressAnim.setValue(0);

    // Simulate realistic loading stages
    const stages = [
      { target: 15, delay: 300 },
      { target: 30, delay: 1200 },
      { target: 45, delay: 2500 },
      { target: 60, delay: 4000 },
      { target: 72, delay: 6000 },
      { target: 85, delay: 8500 },
      { target: 92, delay: 11000 },
      { target: 95, delay: 14000 },
    ];

    stages.forEach(({ target, delay }) => {
      const timer = setTimeout(() => {
        setLoadProgress(target);
        Animated.timing(progressAnim, {
          toValue: target,
          duration: 800,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: false,
        }).start();
      }, delay);
      progressTimers.current.push(timer);
    });
  };

  const completeProgress = (callback: () => void) => {
    progressTimers.current.forEach(t => clearTimeout(t));
    progressTimers.current = [];
    setLoadProgress(100);
    Animated.timing(progressAnim, {
      toValue: 100,
      duration: 400,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start(() => {
      setTimeout(callback, 300);
    });
  };

  const handleGenerate = async () => {
    setGenerating(true);
    setError('');
    startProgressAnimation();
    try {
      const res = await generateAIDiet({
        goal, mealsPerDay, cuisine, cookingTime, budget,
        allergies, healthConditions, additionalNotes: notes,
      });
      completeProgress(() => {
        setResult(res.data);
        setGenerating(false);
      });
    } catch (e: any) {
      progressTimers.current.forEach(t => clearTimeout(t));
      progressTimers.current = [];
      const msg = e?.response?.data?.message || e?.message || 'Something went wrong';
      console.warn('Diet generation error:', msg, e?.response?.status);
      setError(msg);
      setGenerating(false);
      Alert.alert('Generation Failed', `${msg}\n\nPlease try again.`, [
        { text: 'Retry', onPress: () => handleGenerate() },
        { text: 'Back', onPress: () => setStep('restrictions'), style: 'cancel' },
      ]);
    }
  };

  // ── Loading Screen ──
  const CIRCLE_SIZE = 140;
  const STROKE_WIDTH = 8;
  const RADIUS = (CIRCLE_SIZE - STROKE_WIDTH) / 2;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

  const getLoadingMessage = () => {
    if (loadProgress < 20) return 'Analyzing your profile...';
    if (loadProgress < 45) return 'Calculating macros & calories...';
    if (loadProgress < 65) return `Building ${cuisine} meal options...`;
    if (loadProgress < 85) return 'Optimizing your meal plan...';
    if (loadProgress < 100) return 'Finalizing your diet plan...';
    return 'Done!';
  };

  if (generating) {
    const strokeDashoffset = CIRCUMFERENCE - (CIRCUMFERENCE * loadProgress) / 100;
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, justifyContent: 'center', alignItems: 'center' }}>
        {/* Circular Progress Ring */}
        <View style={{ width: CIRCLE_SIZE, height: CIRCLE_SIZE, justifyContent: 'center', alignItems: 'center', marginBottom: 28 }}>
          <Svg width={CIRCLE_SIZE} height={CIRCLE_SIZE} style={{ transform: [{ rotate: '-90deg' }] }}>
            {/* Background circle */}
            <Circle
              cx={CIRCLE_SIZE / 2}
              cy={CIRCLE_SIZE / 2}
              r={RADIUS}
              stroke="rgba(255,255,255,0.08)"
              strokeWidth={STROKE_WIDTH}
              fill="transparent"
            />
            {/* Progress circle */}
            <Circle
              cx={CIRCLE_SIZE / 2}
              cy={CIRCLE_SIZE / 2}
              r={RADIUS}
              stroke={C.accent}
              strokeWidth={STROKE_WIDTH}
              fill="transparent"
              strokeDasharray={`${CIRCUMFERENCE}`}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
            />
          </Svg>
          {/* Percentage text in center */}
          <View style={{ position: 'absolute', justifyContent: 'center', alignItems: 'center' }}>
            <Text style={{ color: C.white, fontSize: 32, fontWeight: '800' }}>{loadProgress}%</Text>
          </View>
        </View>

        <Text style={{ color: C.white, fontSize: 18, fontWeight: '700', marginBottom: 8 }}>Generating Your Plan</Text>
        <Text style={{ color: C.label, fontSize: 13, textAlign: 'center', paddingHorizontal: 40, marginBottom: 4 }}>
          {getLoadingMessage()}
        </Text>
      </View>
    );
  }

  // ── Result Screen ──
  if (result) {
    const plan = result.plan;
    const goalCal = result.goalCalories || result.totalCalories || 2000;
    const macros = plan?.macros;
    return (
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <SafeAreaView style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}>
            {/* Header */}
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 8, paddingBottom: 16 }}>
              <TouchableOpacity onPress={() => { setResult(null); setStep('goal'); }} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: C.card, justifyContent: 'center', alignItems: 'center', marginRight: 14, borderWidth: 1, borderColor: C.border }}>
                <Ionicons name="chevron-back" size={20} color={C.white} />
              </TouchableOpacity>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 20, fontWeight: '800', color: C.white }}>Your AI Diet Plan</Text>
                <Text style={{ fontSize: 12, color: C.label, marginTop: 2 }}>Personalized for {result.userName}</Text>
              </View>
              <View style={{ backgroundColor: C.accentDim, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 }}>
                <Text style={{ color: C.accent, fontSize: 10, fontWeight: '700' }}>AI</Text>
              </View>
            </View>

            {/* Tags */}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
              <View style={{ backgroundColor: C.accentDim, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 }}>
                <Text style={{ color: C.accent, fontSize: 11, fontWeight: '700' }}>{result.dietPreference}</Text>
              </View>
              <View style={{ backgroundColor: 'rgba(96,165,250,0.12)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 }}>
                <Text style={{ color: C.blue, fontSize: 11, fontWeight: '700' }}>{cuisine}</Text>
              </View>
              <View style={{ backgroundColor: 'rgba(200,168,78,0.12)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 }}>
                <Text style={{ color: C.gold, fontSize: 11, fontWeight: '700' }}>{goal}</Text>
              </View>
            </View>

            {/* Summary Card */}
            <View style={{ backgroundColor: C.card, borderRadius: 18, borderWidth: 1, borderColor: C.border, padding: 16, marginBottom: 16, flexDirection: 'row', justifyContent: 'space-around' }}>
              <View style={{ alignItems: 'center' }}><Text style={{ color: C.accent, fontSize: 22, fontWeight: '800' }}>{plan?.totalCalories || result.totalCalories}</Text><Text style={{ color: C.muted, fontSize: 10 }}>Total kcal</Text></View>
              <View style={{ width: 1, backgroundColor: 'rgba(255,255,255,0.06)' }} />
              <View style={{ alignItems: 'center' }}><Text style={{ color: C.gold, fontSize: 22, fontWeight: '800' }}>{goalCal}</Text><Text style={{ color: C.muted, fontSize: 10 }}>Target</Text></View>
              <View style={{ width: 1, backgroundColor: 'rgba(255,255,255,0.06)' }} />
              <View style={{ alignItems: 'center' }}><Text style={{ color: C.white, fontSize: 22, fontWeight: '800' }}>{plan?.mealsCount || mealsPerDay}</Text><Text style={{ color: C.muted, fontSize: 10 }}>Meals</Text></View>
            </View>

            {/* Macros Bar */}
            {macros && (
              <View style={{ backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 14, marginBottom: 16, flexDirection: 'row', justifyContent: 'space-around' }}>
                <View style={{ alignItems: 'center' }}><Text style={{ color: '#FF6B6B', fontSize: 18, fontWeight: '800' }}>{macros.protein}g</Text><Text style={{ color: C.muted, fontSize: 10 }}>Protein</Text></View>
                <View style={{ alignItems: 'center' }}><Text style={{ color: '#FFB74D', fontSize: 18, fontWeight: '800' }}>{macros.carbs}g</Text><Text style={{ color: C.muted, fontSize: 10 }}>Carbs</Text></View>
                <View style={{ alignItems: 'center' }}><Text style={{ color: '#60A5FA', fontSize: 18, fontWeight: '800' }}>{macros.fat}g</Text><Text style={{ color: C.muted, fontSize: 10 }}>Fat</Text></View>
              </View>
            )}

            {/* Title */}
            <Text style={{ fontSize: 16, fontWeight: '800', color: C.white, marginBottom: 4 }}>{plan?.title}</Text>
            <Text style={{ fontSize: 12, color: C.label, marginBottom: 16 }}>{plan?.description}</Text>

            {/* Meals */}
            {plan?.meals?.map((meal: any, i: number) => (
              <View key={i} style={{ backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 16, marginBottom: 12 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: C.white, fontSize: 14, fontWeight: '700' }}>{meal.name || meal.time}</Text>
                    {meal.time && meal.name && <Text style={{ color: C.muted, fontSize: 11, marginTop: 2 }}>{meal.time}</Text>}
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    {meal.prepTime && <Text style={{ color: C.muted, fontSize: 10 }}>{meal.prepTime}</Text>}
                    <View style={{ backgroundColor: C.accentDim, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 }}>
                      <Text style={{ color: C.accent, fontSize: 11, fontWeight: '700' }}>{meal.total} kcal</Text>
                    </View>
                  </View>
                </View>
                {meal.items?.map((item: string, j: number) => (
                  <View key={j} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                    <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: C.accent, marginRight: 10 }} />
                    <Text style={{ color: C.label, fontSize: 12, flex: 1 }}>{item}</Text>
                  </View>
                ))}
                {meal.macros && (
                  <View style={{ flexDirection: 'row', gap: 12, marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: C.border }}>
                    <Text style={{ color: '#FF6B6B', fontSize: 10, fontWeight: '600' }}>P: {meal.macros.protein}g</Text>
                    <Text style={{ color: '#FFB74D', fontSize: 10, fontWeight: '600' }}>C: {meal.macros.carbs}g</Text>
                    <Text style={{ color: '#60A5FA', fontSize: 10, fontWeight: '600' }}>F: {meal.macros.fat}g</Text>
                  </View>
                )}
              </View>
            ))}

            {/* Tips */}
            {plan?.tips?.length > 0 && (
              <View style={{ backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 16, marginBottom: 12 }}>
                <Text style={{ color: C.accent, fontSize: 13, fontWeight: '700', marginBottom: 10 }}>Nutrition Tips</Text>
                {plan.tips.map((tip: string, i: number) => (
                  <View key={i} style={{ flexDirection: 'row', marginBottom: 6 }}>
                    <Ionicons name="checkmark-circle" size={14} color={C.accent} style={{ marginRight: 8, marginTop: 1 }} />
                    <Text style={{ color: C.label, fontSize: 12, flex: 1 }}>{tip}</Text>
                  </View>
                ))}
              </View>
            )}

            {/* Water */}
            {plan?.waterIntake && (
              <View style={{ backgroundColor: 'rgba(96,165,250,0.08)', borderRadius: 14, padding: 14, flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
                <Ionicons name="water" size={20} color={C.blue} style={{ marginRight: 10 }} />
                <Text style={{ color: C.blue, fontSize: 13, fontWeight: '600' }}>Daily water: {plan.waterIntake}</Text>
              </View>
            )}

            {/* Regenerate */}
            <TouchableOpacity onPress={() => { setResult(null); setStep('goal'); }} style={{ backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 14, alignItems: 'center', marginTop: 8 }}>
              <Text style={{ color: C.accent, fontSize: 14, fontWeight: '700' }}>Generate New Plan</Text>
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      </View>
    );
  }

  // ── Questionnaire ──
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <SafeAreaView style={{ flex: 1 }}>
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 }}>
          <TouchableOpacity onPress={prevStep} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: C.card, justifyContent: 'center', alignItems: 'center', marginRight: 14, borderWidth: 1, borderColor: C.border }}>
            <Ionicons name="chevron-back" size={20} color={C.white} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 18, fontWeight: '800', color: C.white }}>AI Diet Plan</Text>
            <Text style={{ fontSize: 11, color: C.label }}>Step {stepIndex + 1} of {STEPS.length}</Text>
          </View>
        </View>

        {/* Progress Bar */}
        <View style={{ height: 3, backgroundColor: C.card, marginHorizontal: 20, borderRadius: 2, marginBottom: 20 }}>
          <View style={{ height: 3, backgroundColor: C.accent, borderRadius: 2, width: `${progress * 100}%` }} />
        </View>

        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 100 }} showsVerticalScrollIndicator={false}>
          {/* STEP: Goal */}
          {step === 'goal' && (
            <View>
              <Text style={{ fontSize: 22, fontWeight: '800', color: C.white, marginBottom: 6 }}>What's your goal?</Text>
              <Text style={{ fontSize: 13, color: C.label, marginBottom: 24 }}>This determines your calorie target and macro split.</Text>
              {GOALS.map(g => (
                <TouchableOpacity key={g.key} onPress={() => setGoal(g.key)} activeOpacity={0.7}
                  style={{ backgroundColor: goal === g.key ? `${g.color}15` : C.card, borderRadius: 16, padding: 18, marginBottom: 12, borderWidth: 1.5, borderColor: goal === g.key ? g.color : C.border, flexDirection: 'row', alignItems: 'center' }}>
                  <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: `${g.color}20`, justifyContent: 'center', alignItems: 'center', marginRight: 14 }}>
                    <Ionicons name={g.icon as any} size={22} color={g.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: C.white, fontSize: 16, fontWeight: '700' }}>{g.label}</Text>
                    <Text style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>{g.desc}</Text>
                  </View>
                  {goal === g.key && <Ionicons name="checkmark-circle" size={22} color={g.color} />}
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* STEP: Meals per day */}
          {step === 'meals' && (
            <View>
              <Text style={{ fontSize: 22, fontWeight: '800', color: C.white, marginBottom: 6 }}>Meals per day?</Text>
              <Text style={{ fontSize: 13, color: C.label, marginBottom: 24 }}>How many times do you prefer to eat?</Text>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                {MEAL_COUNTS.map(n => (
                  <TouchableOpacity key={n} onPress={() => setMealsPerDay(n)} activeOpacity={0.7}
                    style={{ flex: 1, backgroundColor: mealsPerDay === n ? C.accentDim : C.card, borderRadius: 16, paddingVertical: 24, alignItems: 'center', borderWidth: 1.5, borderColor: mealsPerDay === n ? C.accent : C.border }}>
                    <Text style={{ fontSize: 28, fontWeight: '800', color: mealsPerDay === n ? C.accent : C.white }}>{n}</Text>
                    <Text style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>meals</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {/* STEP: Cuisine */}
          {step === 'cuisine' && (
            <View>
              <Text style={{ fontSize: 22, fontWeight: '800', color: C.white, marginBottom: 6 }}>Cuisine preference?</Text>
              <Text style={{ fontSize: 13, color: C.label, marginBottom: 24 }}>We'll use foods from this cuisine style.</Text>
              {CUISINES.map(c => (
                <TouchableOpacity key={c.key} onPress={() => setCuisine(c.key)} activeOpacity={0.7}
                  style={{ backgroundColor: cuisine === c.key ? C.accentDim : C.card, borderRadius: 14, padding: 16, marginBottom: 10, borderWidth: 1.5, borderColor: cuisine === c.key ? C.accent : C.border, flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={{ fontSize: 24, marginRight: 14 }}>{c.emoji}</Text>
                  <Text style={{ color: C.white, fontSize: 15, fontWeight: '600', flex: 1 }}>{c.label}</Text>
                  {cuisine === c.key && <Ionicons name="checkmark-circle" size={20} color={C.accent} />}
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* STEP: Cooking Time */}
          {step === 'cooking' && (
            <View>
              <Text style={{ fontSize: 22, fontWeight: '800', color: C.white, marginBottom: 6 }}>Cooking preference?</Text>
              <Text style={{ fontSize: 13, color: C.label, marginBottom: 24 }}>How much time can you spend cooking?</Text>
              {COOKING_TIMES.map(ct => (
                <TouchableOpacity key={ct.key} onPress={() => setCookingTime(ct.key)} activeOpacity={0.7}
                  style={{ backgroundColor: cookingTime === ct.key ? C.accentDim : C.card, borderRadius: 16, padding: 18, marginBottom: 12, borderWidth: 1.5, borderColor: cookingTime === ct.key ? C.accent : C.border, flexDirection: 'row', alignItems: 'center' }}>
                  <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: cookingTime === ct.key ? C.accentDim : 'rgba(255,255,255,0.04)', justifyContent: 'center', alignItems: 'center', marginRight: 14 }}>
                    <Ionicons name={ct.icon as any} size={20} color={cookingTime === ct.key ? C.accent : C.muted} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: C.white, fontSize: 15, fontWeight: '700' }}>{ct.label}</Text>
                    <Text style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>{ct.desc}</Text>
                  </View>
                  {cookingTime === ct.key && <Ionicons name="checkmark-circle" size={20} color={C.accent} />}
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* STEP: Budget */}
          {step === 'budget' && (
            <View>
              <Text style={{ fontSize: 22, fontWeight: '800', color: C.white, marginBottom: 6 }}>Food budget?</Text>
              <Text style={{ fontSize: 13, color: C.label, marginBottom: 24 }}>We'll pick ingredients that match your budget.</Text>
              {BUDGETS.map(b => (
                <TouchableOpacity key={b.key} onPress={() => setBudget(b.key)} activeOpacity={0.7}
                  style={{ backgroundColor: budget === b.key ? C.accentDim : C.card, borderRadius: 16, padding: 18, marginBottom: 12, borderWidth: 1.5, borderColor: budget === b.key ? C.accent : C.border, flexDirection: 'row', alignItems: 'center' }}>
                  <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: budget === b.key ? C.accentDim : 'rgba(255,255,255,0.04)', justifyContent: 'center', alignItems: 'center', marginRight: 14 }}>
                    <Ionicons name={b.icon as any} size={20} color={budget === b.key ? C.accent : C.muted} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: C.white, fontSize: 15, fontWeight: '700' }}>{b.label}</Text>
                    <Text style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>{b.desc}</Text>
                  </View>
                  {budget === b.key && <Ionicons name="checkmark-circle" size={20} color={C.accent} />}
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* STEP: Restrictions */}
          {step === 'restrictions' && (
            <View>
              <Text style={{ fontSize: 22, fontWeight: '800', color: C.white, marginBottom: 6 }}>Any restrictions?</Text>
              <Text style={{ fontSize: 13, color: C.label, marginBottom: 20 }}>Select allergies or health conditions (optional).</Text>

              <Text style={{ color: C.accent, fontSize: 12, fontWeight: '700', letterSpacing: 1, marginBottom: 10 }}>ALLERGIES</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
                {ALLERGY_OPTIONS.map(a => (
                  <TouchableOpacity key={a} onPress={() => toggleItem(allergies, setAllergies, a)}
                    style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: allergies.includes(a) ? 'rgba(255,107,107,0.15)' : C.card, borderWidth: 1, borderColor: allergies.includes(a) ? C.red : C.border }}>
                    <Text style={{ color: allergies.includes(a) ? C.red : C.label, fontSize: 13, fontWeight: '600' }}>{a}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={{ color: C.accent, fontSize: 12, fontWeight: '700', letterSpacing: 1, marginBottom: 10 }}>HEALTH CONDITIONS</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
                {HEALTH_OPTIONS.map(h => (
                  <TouchableOpacity key={h} onPress={() => toggleItem(healthConditions, setHealthConditions, h)}
                    style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: healthConditions.includes(h) ? 'rgba(96,165,250,0.15)' : C.card, borderWidth: 1, borderColor: healthConditions.includes(h) ? C.blue : C.border }}>
                    <Text style={{ color: healthConditions.includes(h) ? C.blue : C.label, fontSize: 13, fontWeight: '600' }}>{h}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={{ color: C.accent, fontSize: 12, fontWeight: '700', letterSpacing: 1, marginBottom: 10 }}>ADDITIONAL NOTES</Text>
              <TextInput
                value={notes} onChangeText={setNotes}
                placeholder="e.g. I skip breakfast, prefer high protein..."
                placeholderTextColor={C.muted}
                multiline
                style={{ backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: 14, color: C.white, fontSize: 13, minHeight: 80, textAlignVertical: 'top' }}
              />
            </View>
          )}
        </ScrollView>

        {/* Bottom Button */}
        <View style={{ paddingHorizontal: 20, paddingBottom: 16, paddingTop: 8, backgroundColor: C.bg }}>
          <TouchableOpacity onPress={nextStep} disabled={!canProceed()} activeOpacity={0.8}
            style={{ backgroundColor: canProceed() ? C.accent : 'rgba(31,164,99,0.3)', borderRadius: 16, paddingVertical: 16, alignItems: 'center', flexDirection: 'row', justifyContent: 'center' }}>
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '800' }}>
              {step === 'restrictions' ? 'Generate AI Diet Plan' : 'Continue'}
            </Text>
            <Ionicons name={step === 'restrictions' ? 'sparkles' : 'arrow-forward'} size={18} color="#fff" style={{ marginLeft: 8 }} />
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
}
