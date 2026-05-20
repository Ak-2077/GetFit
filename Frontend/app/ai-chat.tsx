import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  KeyboardAvoidingView, Platform, ActivityIndicator, Keyboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { sendChatMessage, streamChatMessage, submitChatFeedback, endChatSession, setAuthToken } from '../services/api';

const C = {
  bg: '#000000',
  card: '#121212',
  border: 'rgba(255,255,255,0.06)',
  accent: '#1FA463',
  accentDim: 'rgba(31,164,99,0.12)',
  white: '#F0F0F0',
  label: 'rgba(255,255,255,0.50)',
  muted: 'rgba(255,255,255,0.30)',
  userBubble: '#1FA463',
  aiBubble: '#1A1A1A',
};

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  index?: number;
  feedback?: 'positive' | 'negative' | null;
  streaming?: boolean;
}

const SUGGESTIONS = [
  'Build a chest workout for mass',
  'Create a 7-day diet plan',
  'How to fix squat form?',
  'Best exercises for abs',
];

// Strip markdown formatting from AI responses
function stripMarkdown(text: string): string {
  return text
    .replace(/#{1,6}\s?/g, '')        // headings
    .replace(/\*\*(.*?)\*\*/g, '$1')  // bold
    .replace(/\*(.*?)\*/g, '$1')      // italic
    .replace(/`{1,3}(.*?)`{1,3}/gs, '$1') // code
    .replace(/^[-*]\s/gm, '• ')       // bullet points → clean dot
    .replace(/^---+$/gm, '')          // horizontal rules
    .replace(/\n{3,}/g, '\n\n')       // excess newlines
    .trim();
}

export default function AIChatScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ initialMessage?: string; sessionId?: string }>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(params.sessionId || null);
  const flatListRef = useRef<FlatList>(null);
  const sessionIdRef = useRef<string | null>(params.sessionId || null);
  const streamAbortRef = useRef<{ abort: () => void } | null>(null);
  const streamContentRef = useRef('');

  useEffect(() => {
    (async () => {
      const token = await AsyncStorage.getItem('token');
      if (token) setAuthToken(token);
    })();
  }, []);

  useEffect(() => {
    if (params.initialMessage) {
      handleSend(params.initialMessage);
    }
  }, []);

  const handleSendRegular = useCallback(async (msg: string, aiMsgId: string) => {
    setLoading(true);
    try {
      const res = await sendChatMessage(msg, sessionId as any);
      const data = res.data;

      if (data.sessionId) {
        setSessionId(data.sessionId);
        sessionIdRef.current = data.sessionId;
      }

      const aiMsg: Message = {
        id: aiMsgId,
        role: 'assistant',
        content: stripMarkdown(data.reply),
        timestamp: new Date(),
        feedback: null,
      };
      setMessages(prev => {
        const updated = [...prev, aiMsg];
        return updated.map((m, i) => ({ ...m, index: i }));
      });
    } catch (error: any) {
      const errMsg: Message = {
        id: aiMsgId,
        role: 'assistant',
        content: error?.response?.data?.message || 'Sorry, something went wrong. Please try again.',
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errMsg]);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  const handleSend = useCallback(async (text?: string) => {
    const msg = (text || input).trim();
    if (!msg || loading || streaming) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: msg,
      timestamp: new Date(),
    };

    const aiMsgId = (Date.now() + 1).toString();
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    Keyboard.dismiss();

    // Try streaming first — only works in web/environments with ReadableStream
    const canStream = typeof globalThis !== 'undefined' && typeof (globalThis as any).ReadableStream !== 'undefined';

    if (canStream) {
      setStreaming(true);
      streamContentRef.current = '';

      // Add empty streaming AI message
      const streamingMsg: Message = {
        id: aiMsgId,
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        streaming: true,
        feedback: null,
      };
      setMessages(prev => [...prev, streamingMsg]);

      streamAbortRef.current = (streamChatMessage as any)(msg, sessionId, {
        onToken: (token: string) => {
          streamContentRef.current += token;
          const current = streamContentRef.current;
          setMessages(prev =>
            prev.map(m => m.id === aiMsgId ? { ...m, content: stripMarkdown(current) } : m)
          );
        },
        onMeta: (meta: any) => {
          if (meta.sessionId) {
            setSessionId(meta.sessionId);
            sessionIdRef.current = meta.sessionId;
          }
        },
        onDone: (sid: string) => {
          if (sid) {
            setSessionId(sid);
            sessionIdRef.current = sid;
          }
          setMessages(prev =>
            prev.map((m, i) => m.id === aiMsgId
              ? { ...m, streaming: false, index: i }
              : { ...m, index: i }
            )
          );
          setStreaming(false);
          streamAbortRef.current = null;
        },
        onError: (err: string) => {
          // If streaming failed with empty content, fall back to regular
          if (!streamContentRef.current) {
            setMessages(prev => prev.filter(m => m.id !== aiMsgId));
            setStreaming(false);
            handleSendRegular(msg, aiMsgId);
          } else {
            setMessages(prev =>
              prev.map((m, i) => m.id === aiMsgId
                ? { ...m, streaming: false, index: i }
                : { ...m, index: i }
              )
            );
            setStreaming(false);
          }
        },
      });
    } else {
      handleSendRegular(msg, aiMsgId);
    }
  }, [input, loading, streaming, sessionId, handleSendRegular]);

  // Handle thumbs up/down
  const handleFeedback = useCallback(async (msgIndex: number, isPositive: boolean) => {
    setMessages(prev => prev.map(m =>
      m.index === msgIndex ? { ...m, feedback: isPositive ? 'positive' : 'negative' } : m
    ));
    try {
      await submitChatFeedback(sessionId, msgIndex, isPositive);
    } catch (_) { /* non-critical */ }
  }, [sessionId]);

  // Summarize session when leaving
  useEffect(() => {
    return () => {
      if (sessionIdRef.current && messages.length >= 2) {
        endChatSession(sessionIdRef.current).catch(() => {});
      }
    };
  }, [messages.length]);

  const renderMessage = ({ item }: { item: Message }) => {
    const isUser = item.role === 'user';
    return (
      <View style={{
        alignSelf: isUser ? 'flex-end' : 'flex-start',
        maxWidth: '80%',
        marginBottom: 12,
        marginHorizontal: 16,
      }}>
        {!isUser && (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
            <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: C.accentDim, justifyContent: 'center', alignItems: 'center', marginRight: 8 }}>
              <Ionicons name="sparkles" size={12} color={C.accent} />
            </View>
            <Text style={{ fontSize: 11, fontWeight: '700', color: C.accent }}>AI Coach</Text>
          </View>
        )}
        <View style={{
          backgroundColor: isUser ? C.userBubble : C.aiBubble,
          borderRadius: 18,
          borderTopRightRadius: isUser ? 4 : 18,
          borderTopLeftRadius: isUser ? 18 : 4,
          paddingHorizontal: 16,
          paddingVertical: 12,
        }}>
          <Text style={{
            fontSize: 14,
            color: isUser ? '#fff' : C.white,
            lineHeight: 20,
          }}>
            {item.content}
          </Text>
        </View>

        {/* Feedback row for AI messages */}
        {!isUser && (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6, marginHorizontal: 4 }}>
            <Text style={{ fontSize: 10, color: C.muted, flex: 1 }}>
              {item.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </Text>
            {item.feedback ? (
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Ionicons
                  name={item.feedback === 'positive' ? 'thumbs-up' : 'thumbs-down'}
                  size={12}
                  color={item.feedback === 'positive' ? C.accent : '#FF6B6B'}
                />
                <Text style={{ fontSize: 10, color: C.muted, marginLeft: 4 }}>
                  {item.feedback === 'positive' ? 'Helpful' : 'Not helpful'}
                </Text>
              </View>
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <TouchableOpacity onPress={() => handleFeedback(item.index!, true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="thumbs-up-outline" size={14} color={C.muted} />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => handleFeedback(item.index!, false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="thumbs-down-outline" size={14} color={C.muted} />
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        {/* Timestamp for user messages */}
        {isUser && (
          <Text style={{
            fontSize: 10,
            color: C.muted,
            marginTop: 4,
            alignSelf: 'flex-end',
            marginHorizontal: 4,
          }}>
            {item.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </Text>
        )}
      </View>
    );
  };

  const renderEmpty = () => (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 }}>
      <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: C.accentDim, justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}>
        <Ionicons name="sparkles" size={28} color={C.accent} />
      </View>
      <Text style={{ fontSize: 20, fontWeight: '800', color: C.white, textAlign: 'center', marginBottom: 8 }}>
        AI Fitness Coach
      </Text>
      <Text style={{ fontSize: 13, color: C.label, textAlign: 'center', lineHeight: 20, marginBottom: 28 }}>
        Ask me anything about workouts, nutrition, form correction, or get personalized plans.
      </Text>

      <View style={{ width: '100%' }}>
        {SUGGESTIONS.map((s, i) => (
          <TouchableOpacity
            key={i}
            onPress={() => handleSend(s)}
            activeOpacity={0.7}
            style={{
              backgroundColor: C.card,
              borderRadius: 14,
              paddingHorizontal: 16,
              paddingVertical: 13,
              marginBottom: 8,
              borderWidth: 1,
              borderColor: C.border,
              flexDirection: 'row',
              alignItems: 'center',
            }}
          >
            <Ionicons name="chatbubble-outline" size={16} color={C.accent} style={{ marginRight: 12 }} />
            <Text style={{ fontSize: 13, color: C.white, flex: 1 }}>{s}</Text>
            <Ionicons name="arrow-forward" size={14} color={C.muted} />
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <SafeAreaView style={{ flex: 1 }}>
        {/* Header */}
        <View style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 16,
          paddingVertical: 12,
          borderBottomWidth: 1,
          borderBottomColor: C.border,
        }}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: C.card, justifyContent: 'center', alignItems: 'center', marginRight: 12 }}
          >
            <Ionicons name="chevron-back" size={20} color={C.white} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 17, fontWeight: '800', color: C.white }}>AI Coach</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: C.accent, marginRight: 6 }} />
              <Text style={{ fontSize: 11, color: C.accent }}>Online • qwen3:14b</Text>
            </View>
          </View>
          <TouchableOpacity
            onPress={() => { setMessages([]); setSessionId(null); }}
            style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: C.card, justifyContent: 'center', alignItems: 'center' }}
          >
            <Ionicons name="add-outline" size={22} color={C.white} />
          </TouchableOpacity>
        </View>

        {/* Messages */}
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={0}
        >
          <FlatList
            ref={flatListRef}
            data={messages}
            keyExtractor={(item) => item.id}
            renderItem={renderMessage}
            ListEmptyComponent={renderEmpty}
            contentContainerStyle={{ flexGrow: 1, paddingTop: 16, paddingBottom: 8 }}
            onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
          />

          {/* Typing / streaming indicator */}
          {(loading || (streaming && !streamContentRef.current)) && (
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 8 }}>
              <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: C.accentDim, justifyContent: 'center', alignItems: 'center', marginRight: 8 }}>
                <Ionicons name="sparkles" size={12} color={C.accent} />
              </View>
              <ActivityIndicator size="small" color={C.accent} />
              <Text style={{ fontSize: 12, color: C.muted, marginLeft: 8 }}>
                {streaming ? 'Connecting...' : 'Thinking...'}
              </Text>
            </View>
          )}

          {/* Input */}
          <View style={{
            flexDirection: 'row',
            alignItems: 'flex-end',
            paddingHorizontal: 12,
            paddingVertical: 10,
            borderTopWidth: 1,
            borderTopColor: C.border,
            backgroundColor: C.bg,
          }}>
            <View style={{
              flex: 1,
              flexDirection: 'row',
              alignItems: 'flex-end',
              backgroundColor: C.card,
              borderRadius: 20,
              paddingHorizontal: 16,
              paddingVertical: Platform.OS === 'ios' ? 10 : 6,
              borderWidth: 1,
              borderColor: C.border,
              minHeight: 44,
              maxHeight: 120,
            }}>
              <TextInput
                value={input}
                onChangeText={setInput}
                placeholder="Message AI Coach..."
                placeholderTextColor={C.muted}
                style={{ flex: 1, fontSize: 14, color: C.white, maxHeight: 100 }}
                multiline
                editable={!loading && !streaming}
                onSubmitEditing={() => handleSend()}
                returnKeyType="send"
              />
            </View>
            <TouchableOpacity
              onPress={() => handleSend()}
              disabled={!input.trim() || loading || streaming}
              style={{
                width: 44,
                height: 44,
                borderRadius: 22,
                backgroundColor: input.trim() ? C.accent : C.card,
                justifyContent: 'center',
                alignItems: 'center',
                marginLeft: 8,
              }}
            >
              <Ionicons name="send" size={18} color={input.trim() ? '#fff' : C.muted} />
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}
