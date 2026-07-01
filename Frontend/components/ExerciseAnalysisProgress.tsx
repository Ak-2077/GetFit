import React, { useEffect, useRef } from 'react';
import { View, Text, ActivityIndicator, Animated } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';

// ═══ THEME (matches scan.tsx / food-details.tsx conventions) ═══
const C = {
  bg: '#050505',
  card: 'rgba(25,25,25,1)',
  cardBorder: 'rgba(255,255,255,0.06)',
  glass: 'rgba(20,22,24,0.92)',
  accent: '#1FA463',
  accentDim: 'rgba(31,164,99,0.14)',
  text: '#F4F6F5',
  subtext: 'rgba(255,255,255,0.62)',
  muted: 'rgba(255,255,255,0.4)',
  border: 'rgba(255,255,255,0.06)',
  red: '#FF6B6B',
};

// ═══ Job lifecycle states (Req 19 / design JobState enum) ═══
export type JobState =
  | 'queued'
  | 'validating'
  | 'extracting_frames'
  | 'frame_quality'
  | 'selecting_keyframes'
  | 'detecting_exercise'
  | 'extracting_pose'
  | 'building_timeline'
  | 'biomechanics'
  | 'reasoning'
  | 'generating_feedback'
  | 'cleaning_up'
  | 'completed'
  | 'failed'
  | 'cancelled';

// ═══ Human-readable label map (Req 20.3) ═══
// Mirrors design.md PROGRESS_LABELS. States without a dedicated label
// (frame_quality, reasoning) fold into the surrounding visible stage.
export const PROGRESS_LABELS: Partial<Record<JobState, string>> = {
  queued: 'Uploading',
  validating: 'Validating',
  extracting_frames: 'Extracting Frames',
  selecting_keyframes: 'Selecting Key Frames',
  detecting_exercise: 'Detecting Exercise',
  extracting_pose: 'Extracting Pose',
  building_timeline: 'Building Timeline',
  biomechanics: 'Computing Biomechanics',
  generating_feedback: 'Generating Feedback',
  cleaning_up: 'Cleaning Temporary Files',
  completed: 'Complete',
};

// Ordered set of labels shown to the End_User (Req 20.3 ordering).
export const PROGRESS_STAGES: string[] = [
  'Uploading',
  'Validating',
  'Extracting Frames',
  'Selecting Key Frames',
  'Detecting Exercise',
  'Extracting Pose',
  'Building Timeline',
  'Computing Biomechanics',
  'Generating Feedback',
  'Cleaning Temporary Files',
  'Complete',
];

// Ordering used to resolve which stages are "done" vs "active".
const STATE_ORDER: JobState[] = [
  'queued',
  'validating',
  'extracting_frames',
  'frame_quality',
  'selecting_keyframes',
  'detecting_exercise',
  'extracting_pose',
  'building_timeline',
  'biomechanics',
  'reasoning',
  'generating_feedback',
  'cleaning_up',
  'completed',
];

// Resolve the visible label for a job state, falling back to the nearest
// preceding labelled state so transient states still show meaningful text.
export function labelForState(state?: JobState | string | null): string {
  if (!state) return 'Uploading';
  const s = state as JobState;
  if (PROGRESS_LABELS[s]) return PROGRESS_LABELS[s] as string;
  // Walk backwards from this state to the nearest labelled state.
  const idx = STATE_ORDER.indexOf(s);
  if (idx >= 0) {
    for (let i = idx; i >= 0; i--) {
      const label = PROGRESS_LABELS[STATE_ORDER[i]];
      if (label) return label;
    }
  }
  return 'Uploading';
}

// Index of the current label within PROGRESS_STAGES (for done/active rendering).
function currentStageIndex(state?: JobState | string | null): number {
  const label = labelForState(state);
  return Math.max(0, PROGRESS_STAGES.indexOf(label));
}

// ═══ Single stage row ═══
function StageRow({
  label,
  index,
  isActive,
  isDone,
}: {
  label: string;
  index: number;
  isActive: boolean;
  isDone: boolean;
}) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 350,
      delay: Math.min(index * 60, 360),
      useNativeDriver: true,
    }).start();
  }, []);

  return (
    <Animated.View
      style={{ opacity: fadeAnim, flexDirection: 'row', alignItems: 'center', marginBottom: 14, gap: 12 }}
    >
      <View
        style={{
          width: 28,
          height: 28,
          borderRadius: 14,
          backgroundColor: isDone ? C.accent : isActive ? C.accentDim : 'rgba(255,255,255,0.04)',
          justifyContent: 'center',
          alignItems: 'center',
          borderWidth: isActive ? 2 : 0,
          borderColor: C.accent,
        }}
      >
        {isDone ? (
          <FontAwesome name="check" size={12} color="#000" />
        ) : isActive ? (
          <ActivityIndicator size="small" color={C.accent} />
        ) : (
          <Text style={{ color: C.muted, fontSize: 11, fontWeight: '700' }}>{index + 1}</Text>
        )}
      </View>
      <Text
        style={{
          color: isDone ? C.accent : isActive ? C.text : C.muted,
          fontSize: 14,
          fontWeight: isDone || isActive ? '700' : '500',
        }}
      >
        {label}
      </Text>
    </Animated.View>
  );
}

export type ExerciseAnalysisProgressProps = {
  jobState?: JobState | string | null;
  // Human-readable label sent by the backend Progress_Service (Req 20.3).
  label?: string | null;
  // Optional completion percent in [0,1] or [0,100] (Req 20.6).
  percent?: number | null;
  errorMessage?: string | null;
  // Optional richer failure presentation.
  errorTitle?: string | null;
  errorTips?: string[] | null;
  // Optional estimated remaining time in seconds (shown when available).
  etaSeconds?: number | null;
};

// Format a remaining-seconds estimate into a compact human string.
function fmtEta(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `~${s}s remaining`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem > 0 ? `~${m}m ${rem}s remaining` : `~${m}m remaining`;
}

// ═══ Progress view ═══
// Polls are driven by the parent; this component renders the current state.
export default function ExerciseAnalysisProgress({
  jobState,
  label,
  percent,
  errorMessage,
  errorTitle,
  errorTips,
  etaSeconds,
}: ExerciseAnalysisProgressProps) {
  const isFailed = jobState === 'failed' || !!errorMessage;
  const activeIndex = currentStageIndex(jobState);
  // Prefer the backend-provided label; fall back to local mapping.
  const headline = label || labelForState(jobState);

  // Normalize percent to 0-100 for the bar.
  const pct =
    percent == null
      ? null
      : percent <= 1
      ? Math.round(percent * 100)
      : Math.round(percent);

  if (isFailed) {
    const tips = errorTips && errorTips.length > 0 ? errorTips : null;
    return (
      <View
        style={{
          backgroundColor: C.card,
          borderRadius: 18,
          borderWidth: 1,
          borderColor: 'rgba(255,107,107,0.35)',
          padding: 20,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <FontAwesome name="exclamation-triangle" size={16} color={C.red} />
          <Text style={{ color: C.red, fontSize: 15, fontWeight: '800', flex: 1 }}>
            {errorTitle || "We couldn't analyze this video"}
          </Text>
        </View>
        <Text style={{ color: C.subtext, fontSize: 13, lineHeight: 19 }}>
          {errorMessage || 'The analysis could not be completed. Please try again.'}
        </Text>

        {tips ? (
          <View style={{ marginTop: 14, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 12, padding: 12 }}>
            <Text style={{ color: C.text, fontSize: 12, fontWeight: '700', marginBottom: 8 }}>
              How to fix it
            </Text>
            {tips.map((tip, i) => (
              <View key={i} style={{ flexDirection: 'row', gap: 8, marginBottom: i === tips.length - 1 ? 0 : 6 }}>
                <FontAwesome name="check-circle" size={12} color={C.accent} style={{ marginTop: 2 }} />
                <Text style={{ color: C.subtext, fontSize: 12, flex: 1, lineHeight: 17 }}>{tip}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View
      style={{
        backgroundColor: C.card,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: C.cardBorder,
        padding: 20,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <ActivityIndicator size="small" color={C.accent} />
        <Text style={{ color: C.text, fontSize: 16, fontWeight: '800' }}>{headline}</Text>
      </View>
      <Text style={{ color: C.muted, fontSize: 12, marginBottom: 16 }}>
        Analyzing your lift{pct != null ? ` · ${pct}%` : ''}
        {etaSeconds != null ? ` · ${fmtEta(etaSeconds)}` : ''}
      </Text>

      {pct != null ? (
        <View
          style={{
            height: 6,
            borderRadius: 3,
            backgroundColor: 'rgba(255,255,255,0.06)',
            overflow: 'hidden',
            marginBottom: 18,
          }}
        >
          <View style={{ height: '100%', width: `${pct}%`, backgroundColor: C.accent, borderRadius: 3 }} />
        </View>
      ) : null}

      {PROGRESS_STAGES.map((stage, idx) => (
        <StageRow
          key={stage}
          label={stage}
          index={idx}
          isActive={idx === activeIndex && jobState !== 'completed'}
          isDone={idx < activeIndex || jobState === 'completed'}
        />
      ))}
    </View>
  );
}
