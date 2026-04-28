import React from 'react';
import { View, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function AITrainerScreen() {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f1f0ec' }}>
      <View style={{
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 30,
      }}>
        <View style={{
          width: 80,
          height: 80,
          borderRadius: 40,
          backgroundColor: '#dcfce7',
          justifyContent: 'center',
          alignItems: 'center',
          marginBottom: 20,
          shadowColor: '#22c55e',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.2,
          shadowRadius: 12,
          elevation: 6,
        }}>
          <Text style={{ fontSize: 36 }}>🤖</Text>
        </View>
        <Text style={{
          fontSize: 24,
          fontWeight: '800',
          color: '#111111',
          marginBottom: 8,
        }}>
          AI Trainer
        </Text>
        <Text style={{
          fontSize: 14,
          color: '#666666',
          textAlign: 'center',
          lineHeight: 21,
        }}>
          Your personal AI-powered fitness coach.{'\n'}Coming soon!
        </Text>
      </View>
    </SafeAreaView>
  );
}
