import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, Image, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getMe, setAuthToken, updateProfile } from '../../services/api';
import * as ImagePicker from 'expo-image-picker';


export default function EditProfile() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [height, setHeight] = useState('');
  const [weight, setWeight] = useState('');
  const [goal, setGoal] = useState('');
  const [activityLevel, setActivityLevel] = useState('');
  const [avatarUri, setAvatarUri] = useState('');
  const [avatarData, setAvatarData] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const token = await AsyncStorage.getItem('token');
        if (token) setAuthToken(token);

        const res = await getMe();
        if (!mounted) return;
        const user = res?.data?.user || res?.data || {};
        setName(String(user?.name || ''));
        setHeight(String(user?.height || ''));
        setWeight(String(user?.weight || ''));
        setGoal(String(user?.goal || ''));
        setActivityLevel(String(user?.activityLevel || ''));
        setAvatarUri(String(user?.avatar || ''));
      } catch (err: any) {
        Alert.alert('Error', err?.response?.data?.message || 'Failed to load profile');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const onSave = async () => {
    try {
      const token = await AsyncStorage.getItem('token');
      if (token) setAuthToken(token);

      const payload: Record<string, string> = { name, height, weight, goal, activityLevel };
      if (avatarData) payload.avatar = avatarData;
      const res = await updateProfile(payload);
      Alert.alert('Saved', 'Profile updated');
      router.back();
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.message || 'Failed to update');
    }
  };

  const onPickPhoto = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Allow photo access to update your profile picture.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
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

  if (loading) return <View style={{ flex: 1, backgroundColor: '#0A0A0A', justifyContent: 'center', alignItems: 'center' }}><ActivityIndicator size="large" color="#1FA463" /></View>;

  return (
    <View style={styles.page}>
      <Text style={styles.header}>Edit Profile</Text>

      <View style={styles.avatarRow}>
        {avatarUri ? (
          <Image source={{ uri: avatarUri }} style={styles.avatar} />
        ) : (
          <View style={styles.avatarPlaceholder}>
            <Text style={styles.avatarPlaceholderText}>Add</Text>
          </View>
        )}
        <TouchableOpacity style={styles.photoButton} onPress={onPickPhoto}>
          <Text style={styles.photoButtonText}>Change photo</Text>
        </TouchableOpacity>
      </View>

      <TextInput placeholder="Full name" value={name} onChangeText={setName} style={styles.input} placeholderTextColor="#BDBDBD" />
      <TextInput placeholder="Height (e.g. 178 cm)" value={height} onChangeText={setHeight} style={styles.input} placeholderTextColor="#BDBDBD" />
      <TextInput placeholder="Weight (e.g. 75 kg)" value={weight} onChangeText={setWeight} style={styles.input} placeholderTextColor="#BDBDBD" />
      <TextInput placeholder="Goal (e.g. Lose fat)" value={goal} onChangeText={setGoal} style={styles.input} placeholderTextColor="#BDBDBD" />
      <TextInput placeholder="Activity level" value={activityLevel} onChangeText={setActivityLevel} style={styles.input} placeholderTextColor="#BDBDBD" />

      <TouchableOpacity style={styles.primary} onPress={onSave}>
        <Text style={styles.primaryText}>Save</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#0A0A0A', padding: 20 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0A0A0A' },
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
  avatarRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  avatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#222' },
  avatarPlaceholder: { width: 72, height: 72, borderRadius: 36, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' },
  avatarPlaceholderText: { color: '#BDBDBD', fontSize: 14 },
  photoButton: { marginLeft: 14, paddingVertical: 10, paddingHorizontal: 14, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 10 },
  photoButtonText: { color: '#fff', fontWeight: '600' },
});
