import React from 'react';
import { View, Text } from 'react-native';
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
  orange: '#FFB74D',
  blue: '#42A5F5',
  green: '#66BB6A',
  purple: '#AB47BC',
  cyan: '#26C6DA',
};

// The Analysis_Result can arrive in either the AI-service flat (snake_case)
// shape or the persisted Mongoose nested shape. This type is intentionally
// permissive so the component can normalize either form.
export type AnalysisResult = Record<string, any>;

// ── Normalization helpers (resilient to both shapes) ──
const firstDefined = (...vals: any[]) => vals.find((v) => v !== undefined && v !== null);

const asList = (v: any): string[] => {
  if (Array.isArray(v)) return v.filter((x) => x != null).map((x) => String(x));
  if (v == null || v === '') return [];
  return [String(v)];
};

const asNumber = (v: any): number | null => {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

// Format a 0..1 or 0..100 score into a 0..100 display number.
const toScore100 = (v: any): number | null => {
  const n = asNumber(v);
  if (n == null) return null;
  return n <= 1 ? Math.round(n * 100) : Math.round(n);
};

// Average a dict of joint/ROM values into a single representative score.
const avgDict = (d: any): number | null => {
  if (!d || typeof d !== 'object') return asNumber(d);
  const nums = Object.values(d)
    .map((x) => asNumber(x))
    .filter((x): x is number => x != null);
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
};

function normalize(result: AnalysisResult) {
  const scores = result.scores || {};
  const feedback = result.feedback || {};

  return {
    exerciseId: firstDefined(result.exercise_id, result.exerciseId) ?? 'Exercise',
    analysisDate: firstDefined(result.analysis_date, result.analysisDate, result.createdAt),

    overallScore: toScore100(firstDefined(result.overall_score, result.overallScore)),
    movementScore: toScore100(firstDefined(result.movement_score, scores.movement, scores.movementScore)),
    rangeOfMotion: toScore100(
      avgDict(firstDefined(result.range_of_motion, scores.rangeOfMotion, scores.range_of_motion))
    ),
    tempo: toScore100(firstDefined(result.tempo, scores.tempo)),
    stability: toScore100(firstDefined(result.stability, scores.stability)),
    symmetry: toScore100(firstDefined(result.symmetry, scores.symmetry)),
    jointAlignment: toScore100(
      avgDict(firstDefined(result.joint_alignment, scores.jointAlignment, scores.joint_alignment))
    ),

    strengths: asList(firstDefined(result.strengths, feedback.strengths)),
    mistakes: asList(firstDefined(result.mistakes, feedback.mistakes)),
    corrections: asList(firstDefined(result.corrections, feedback.corrections)),
    safetyWarnings: asList(firstDefined(result.safety_warnings, feedback.safetyWarnings, feedback.safety_warnings)),
    improvementTips: asList(firstDefined(result.improvement_tips, feedback.improvementTips, feedback.improvement_tips)),
    trainingAdvice: asList(firstDefined(result.training_advice, feedback.trainingAdvice, feedback.training_advice)),

    overallConfidence: asNumber(firstDefined(result.overall_confidence, result.overallConfidence)),
    lowConfidence: !!firstDefined(result.low_confidence, result.lowConfidence),
  };
}

// Color a score by quality band.
function scoreColor(score: number | null): string {
  if (score == null) return C.muted;
  if (score >= 80) return C.accent;
  if (score >= 60) return C.cyan;
  if (score >= 40) return C.orange;
  return C.red;
}

// ═══ Score tile ═══
function ScoreTile({ label, value }: { label: string; value: number | null }) {
  const color = scoreColor(value);
  return (
    <View
      style={{
        width: '48%',
        backgroundColor: C.glass,
        borderRadius: 16,
        padding: 14,
        marginBottom: 10,
        borderWidth: 1,
        borderColor: C.cardBorder,
      }}
    >
      <Text style={{ color: C.subtext, fontSize: 12, fontWeight: '600' }}>{label}</Text>
      <Text style={{ color, fontSize: 24, fontWeight: '800', letterSpacing: -0.5, marginTop: 6 }}>
        {value != null ? value : '—'}
      </Text>
      <Text style={{ color: C.muted, fontSize: 10, marginTop: 2, fontWeight: '500' }}>/ 100</Text>
    </View>
  );
}

// ═══ Qualitative feedback section (list of strings) ═══
function FeedbackSection({
  title,
  icon,
  color,
  items,
}: {
  title: string;
  icon: any;
  color: string;
  items: string[];
}) {
  if (!items.length) return null;
  return (
    <View
      style={{
        marginTop: 14,
        backgroundColor: C.card,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: C.cardBorder,
        padding: 16,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10, gap: 8 }}>
        <View
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            backgroundColor: 'rgba(255,255,255,0.05)',
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <FontAwesome name={icon} size={12} color={color} />
        </View>
        <Text style={{ color: C.text, fontSize: 15, fontWeight: '800' }}>{title}</Text>
      </View>
      {items.map((item, idx) => (
        <View key={idx} style={{ flexDirection: 'row', gap: 8, marginBottom: idx < items.length - 1 ? 8 : 0 }}>
          <FontAwesome name="circle" size={6} color={color} style={{ marginTop: 6 }} />
          <Text style={{ color: C.subtext, fontSize: 13, lineHeight: 19, flex: 1 }}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

export type ExerciseAnalysisResultProps = {
  result: AnalysisResult;
};

// ═══ Result view — renders all Requirement 11 fields + low-confidence statement (Req 18.4) ═══
export default function ExerciseAnalysisResult({ result }: ExerciseAnalysisResultProps) {
  const r = normalize(result);
  const confidencePct = r.overallConfidence != null
    ? r.overallConfidence <= 1
      ? Math.round(r.overallConfidence * 100)
      : Math.round(r.overallConfidence)
    : null;

  return (
    <View>
      {/* ═══ LOW-CONFIDENCE STATEMENT (Req 11.4 / 18.4) ═══ */}
      {r.lowConfidence ? (
        <View
          style={{
            backgroundColor: 'rgba(255,183,77,0.12)',
            borderRadius: 16,
            borderWidth: 1,
            borderColor: 'rgba(255,183,77,0.4)',
            padding: 14,
            marginBottom: 14,
            flexDirection: 'row',
            gap: 10,
          }}
        >
          <FontAwesome name="exclamation-circle" size={16} color={C.orange} style={{ marginTop: 2 }} />
          <Text style={{ color: C.orange, fontSize: 13, fontWeight: '600', lineHeight: 19, flex: 1 }}>
            This analysis has low confidence{confidencePct != null ? ` (${confidencePct}%)` : ''} and may be
            inaccurate. Treat the results below as approximate guidance rather than a precise assessment.
          </Text>
        </View>
      ) : null}

      {/* ═══ OVERALL SCORE ═══ */}
      <View
        style={{
          backgroundColor: C.card,
          borderRadius: 18,
          borderWidth: 1,
          borderColor: C.cardBorder,
          padding: 20,
          alignItems: 'center',
        }}
      >
        <Text style={{ color: C.subtext, fontSize: 12, fontWeight: '700', letterSpacing: 0.5 }}>
          OVERALL SCORE
        </Text>
        <Text
          style={{
            color: scoreColor(r.overallScore),
            fontSize: 56,
            fontWeight: '900',
            letterSpacing: -2,
            marginTop: 4,
          }}
        >
          {r.overallScore != null ? r.overallScore : '—'}
        </Text>
        <Text style={{ color: C.muted, fontSize: 12 }}>out of 100</Text>
        {confidencePct != null ? (
          <Text style={{ color: C.muted, fontSize: 11, marginTop: 6 }}>
            Overall confidence: {confidencePct}%
          </Text>
        ) : null}
      </View>

      {/* ═══ SCORE BREAKDOWN (Req 11.1) ═══ */}
      <View
        style={{
          marginTop: 14,
          backgroundColor: C.card,
          borderRadius: 18,
          borderWidth: 1,
          borderColor: C.cardBorder,
          padding: 16,
        }}
      >
        <Text style={{ color: C.text, fontSize: 15, fontWeight: '800', marginBottom: 12 }}>
          Score Breakdown
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
          <ScoreTile label="Movement" value={r.movementScore} />
          <ScoreTile label="Range of Motion" value={r.rangeOfMotion} />
          <ScoreTile label="Tempo" value={r.tempo} />
          <ScoreTile label="Stability" value={r.stability} />
          <ScoreTile label="Symmetry" value={r.symmetry} />
          <ScoreTile label="Joint Alignment" value={r.jointAlignment} />
        </View>
      </View>

      {/* ═══ QUALITATIVE FEEDBACK (Req 11.2) ═══ */}
      <FeedbackSection title="Strengths" icon="thumbs-up" color={C.accent} items={r.strengths} />
      <FeedbackSection title="Mistakes" icon="times-circle" color={C.red} items={r.mistakes} />
      <FeedbackSection title="Corrections" icon="wrench" color={C.blue} items={r.corrections} />
      <FeedbackSection
        title="Safety Warnings"
        icon="exclamation-triangle"
        color={C.orange}
        items={r.safetyWarnings}
      />
      <FeedbackSection title="Improvement Tips" icon="lightbulb-o" color={C.cyan} items={r.improvementTips} />
      <FeedbackSection title="Training Advice" icon="graduation-cap" color={C.purple} items={r.trainingAdvice} />
    </View>
  );
}
