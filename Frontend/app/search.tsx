import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Keyboard } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { globalSearch } from '../services/api';
import GFLoader from '../components/GFLoader';

const C = {
  bg: '#060D09', card: '#0F1A13', cardBorder: 'rgba(31,164,99,0.12)', accent: '#1FA463',
  white: '#F0F0F0', label: 'rgba(255,255,255,0.50)', muted: 'rgba(255,255,255,0.30)',
  burnColor: '#FF6B6B',
};

const CATS: { key: string; label: string; icon: any; color: string }[] = [
  { key: 'foods', label: 'Foods', icon: 'fast-food-outline', color: '#1FA463' },
  { key: 'exercises', label: 'Exercises', icon: 'barbell-outline', color: '#FF6B6B' },
  { key: 'workouts', label: 'Workouts', icon: 'fitness-outline', color: '#60A5FA' },
  { key: 'nutrition', label: 'Nutrition', icon: 'leaf-outline', color: '#FFA500' },
];

export default function SearchScreen() {
  const router = useRouter();
  const inputRef = useRef<TextInput>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const timer = useRef<any>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 200);
  }, []);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const q = query.trim();
    if (q.length < 2) { setResults(null); return; }
    timer.current = setTimeout(async () => {
      try {
        setLoading(true);
        const res = await globalSearch(q);
        setResults(res.data);
      } catch { setResults(null); }
      finally { setLoading(false); }
    }, 300);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [query]);

  const hasResults = results && (
    results.foods?.length || results.exercises?.length ||
    results.workouts?.length || results.nutrition?.length
  );

  const onFoodPress = (f: any) => {
    Keyboard.dismiss();
    router.push(`/food-details?id=${f._id}` as any);
  };
  const onExercisePress = () => {
    Keyboard.dismiss();
    router.push('/home-workout' as any);
  };
  const onWorkoutPress = (w: any) => {
    Keyboard.dismiss();
    router.push(`/home-workout-player?mode=home&bodyPart=${w.bodyPart}` as any);
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <SafeAreaView style={{ flex: 1 }}>
        {/* Search bar */}
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12, gap: 10 }}>
          <TouchableOpacity onPress={() => router.back()} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: C.card, borderWidth: 1, borderColor: C.cardBorder, justifyContent: 'center', alignItems: 'center' }}>
            <Ionicons name="chevron-back" size={20} color={C.white} />
          </TouchableOpacity>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.cardBorder, paddingHorizontal: 14, height: 46 }}>
            <Ionicons name="search-outline" size={18} color={C.muted} />
            <TextInput
              ref={inputRef}
              style={{ flex: 1, color: C.white, fontSize: 15, marginLeft: 10, paddingVertical: 0 }}
              placeholder="Search workouts, food, exercises..."
              placeholderTextColor={C.muted}
              value={query}
              onChangeText={setQuery}
              returnKeyType="search"
            />
            {query.length > 0 && (
              <TouchableOpacity onPress={() => setQuery('')}>
                <Ionicons name="close-circle" size={18} color={C.muted} />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Body */}
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          {/* Empty state */}
          {query.trim().length < 2 && !loading && (
            <View style={{ alignItems: 'center', marginTop: 60 }}>
              <Ionicons name="search" size={48} color="rgba(255,255,255,0.06)" />
              <Text style={{ color: C.muted, fontSize: 15, marginTop: 16 }}>Search for anything</Text>
              <Text style={{ color: C.muted, fontSize: 12, marginTop: 4 }}>Workouts, foods, exercises, nutrition</Text>

              {/* Quick categories */}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 30, justifyContent: 'center' }}>
                {CATS.map((cat) => (
                  <TouchableOpacity key={cat.key} onPress={() => setQuery(cat.label.toLowerCase())}
                    style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.cardBorder, paddingHorizontal: 14, paddingVertical: 10, gap: 8 }}>
                    <Ionicons name={cat.icon} size={16} color={cat.color} />
                    <Text style={{ color: C.white, fontSize: 13, fontWeight: '600' }}>{cat.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {/* Loading */}
          {loading && (
            <View style={{ alignItems: 'center', marginTop: 60 }}>
              <GFLoader fullScreen={false} size={32} />
              <Text style={{ color: C.muted, fontSize: 13, marginTop: 12 }}>Searching...</Text>
            </View>
          )}

          {/* No results */}
          {!loading && query.trim().length >= 2 && !hasResults && (
            <View style={{ alignItems: 'center', marginTop: 60 }}>
              <Ionicons name="search-outline" size={40} color="rgba(255,255,255,0.08)" />
              <Text style={{ color: C.label, fontSize: 15, marginTop: 12 }}>No results for "{query}"</Text>
              <Text style={{ color: C.muted, fontSize: 12, marginTop: 4 }}>Try a different keyword</Text>
            </View>
          )}

          {/* Results */}
          {!loading && hasResults && (
            <>
              {/* Foods */}
              {results.foods?.length > 0 && (
                <View style={{ marginBottom: 20 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                    <Ionicons name="fast-food-outline" size={16} color={C.accent} />
                    <Text style={{ color: C.label, fontSize: 11, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' }}>Foods ({results.foods.length})</Text>
                  </View>
                  {results.foods.map((f: any) => (
                    <TouchableOpacity key={f._id} onPress={() => onFoodPress(f)}
                      style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.cardBorder, padding: 14, marginBottom: 8 }}>
                      <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(31,164,99,0.1)', justifyContent: 'center', alignItems: 'center', marginRight: 12 }}>
                        <Ionicons name="fast-food-outline" size={18} color={C.accent} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: C.white, fontSize: 14, fontWeight: '600' }}>{f.name}</Text>
                        {f.brand && <Text style={{ color: C.muted, fontSize: 11, marginTop: 2 }}>{f.brand}</Text>}
                      </View>
                      <Text style={{ color: C.accent, fontSize: 13, fontWeight: '700' }}>{f.calories} kcal</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {/* Exercises */}
              {results.exercises?.length > 0 && (
                <View style={{ marginBottom: 20 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                    <Ionicons name="barbell-outline" size={16} color={C.burnColor} />
                    <Text style={{ color: C.label, fontSize: 11, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' }}>Exercises ({results.exercises.length})</Text>
                  </View>
                  {results.exercises.map((e: any, i: number) => (
                    <TouchableOpacity key={i} onPress={onExercisePress}
                      style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.cardBorder, padding: 14, marginBottom: 8 }}>
                      <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(255,107,107,0.1)', justifyContent: 'center', alignItems: 'center', marginRight: 12 }}>
                        <Ionicons name="barbell-outline" size={18} color={C.burnColor} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: C.white, fontSize: 14, fontWeight: '600' }}>{e.name}</Text>
                        <Text style={{ color: C.muted, fontSize: 11, marginTop: 2 }}>{e.muscle} • {e.difficulty}</Text>
                      </View>
                      <Text style={{ color: C.burnColor, fontSize: 12 }}>{e.caloriesPer10Min} kcal/10m</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {/* Workouts */}
              {results.workouts?.length > 0 && (
                <View style={{ marginBottom: 20 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                    <Ionicons name="fitness-outline" size={16} color="#60A5FA" />
                    <Text style={{ color: C.label, fontSize: 11, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' }}>Workouts ({results.workouts.length})</Text>
                  </View>
                  {results.workouts.map((w: any, i: number) => (
                    <TouchableOpacity key={i} onPress={() => onWorkoutPress(w)}
                      style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.cardBorder, padding: 14, marginBottom: 8 }}>
                      <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(96,165,250,0.1)', justifyContent: 'center', alignItems: 'center', marginRight: 12 }}>
                        <Ionicons name="fitness-outline" size={18} color="#60A5FA" />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: C.white, fontSize: 14, fontWeight: '600' }}>{w.name}</Text>
                        <Text style={{ color: C.muted, fontSize: 11, marginTop: 2 }}>{w.exercises} exercises</Text>
                      </View>
                      <Text style={{ color: C.muted, fontSize: 12 }}>{w.duration}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {/* Nutrition */}
              {results.nutrition?.length > 0 && (
                <View style={{ marginBottom: 20 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                    <Ionicons name="leaf-outline" size={16} color="#FFA500" />
                    <Text style={{ color: C.label, fontSize: 11, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' }}>Nutrition ({results.nutrition.length})</Text>
                  </View>
                  {results.nutrition.map((n: any, i: number) => (
                    <View key={i} style={{ backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.cardBorder, padding: 14, marginBottom: 8 }}>
                      <Text style={{ color: C.white, fontSize: 14, fontWeight: '600', marginBottom: 8 }}>{n.name}</Text>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        {[{ l: 'Calories', v: n.calories, u: 'kcal', c: C.accent }, { l: 'Protein', v: n.protein, u: 'g', c: '#60A5FA' }, { l: 'Carbs', v: n.carbs, u: 'g', c: '#FFA500' }, { l: 'Fat', v: n.fat, u: 'g', c: '#FF6B6B' }].map((m) => (
                          <View key={m.l} style={{ alignItems: 'center' }}>
                            <Text style={{ color: m.c, fontSize: 14, fontWeight: '700' }}>{m.v}{m.u}</Text>
                            <Text style={{ color: C.muted, fontSize: 9, marginTop: 2 }}>{m.l}</Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
