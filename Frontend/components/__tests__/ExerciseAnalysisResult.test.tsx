import React from 'react';
import { render } from '@testing-library/react-native';
import ExerciseAnalysisResult, { AnalysisResult } from '../ExerciseAnalysisResult';
import ExerciseAnalysisProgress, {
  PROGRESS_STAGES,
  PROGRESS_LABELS,
  labelForState,
} from '../ExerciseAnalysisProgress';

// A representative, fully-populated Analysis_Result covering every
// Requirement 11 score field and feedback field, plus low-confidence (Req 18.4).
const fullResult: AnalysisResult = {
  exercise_id: 'barbell_back_squat',
  overall_score: 0.82,
  movement_score: 0.78,
  range_of_motion: { knee: 0.9, hip: 0.7 },
  tempo: 0.65,
  stability: 0.74,
  symmetry: 0.88,
  joint_alignment: { knee: 0.6, ankle: 0.8 },
  strengths: ['Good depth on the squat', 'Stable torso throughout'],
  mistakes: ['Knees cave inward at the bottom'],
  corrections: ['Drive knees outward during the ascent'],
  safety_warnings: ['Lower back rounds under heavy load'],
  improvement_tips: ['Add tempo squats to build control'],
  training_advice: ['Reduce load by 10% and focus on form'],
  overall_confidence: 0.4,
  low_confidence: true,
};

describe('ExerciseAnalysisResult — Requirement 11 rendering', () => {
  it('renders all Requirement 11.1 score labels and the overall score value', () => {
    const { getByText } = render(<ExerciseAnalysisResult result={fullResult} />);

    // Req 11.1: score fields
    expect(getByText('OVERALL SCORE')).toBeTruthy();
    expect(getByText('Score Breakdown')).toBeTruthy();
    expect(getByText('Movement')).toBeTruthy();
    expect(getByText('Range of Motion')).toBeTruthy();
    expect(getByText('Tempo')).toBeTruthy();
    expect(getByText('Stability')).toBeTruthy();
    expect(getByText('Symmetry')).toBeTruthy();
    expect(getByText('Joint Alignment')).toBeTruthy();

    // Overall score value: 0.82 -> 82 (0..1 normalized to 0..100)
    expect(getByText('82')).toBeTruthy();
  });

  it('renders all Requirement 11.2 feedback section titles and their items', () => {
    const { getByText } = render(<ExerciseAnalysisResult result={fullResult} />);

    // Req 11.2: feedback section titles
    expect(getByText('Strengths')).toBeTruthy();
    expect(getByText('Mistakes')).toBeTruthy();
    expect(getByText('Corrections')).toBeTruthy();
    expect(getByText('Safety Warnings')).toBeTruthy();
    expect(getByText('Improvement Tips')).toBeTruthy();
    expect(getByText('Training Advice')).toBeTruthy();

    // Feedback values render
    expect(getByText('Good depth on the squat')).toBeTruthy();
    expect(getByText('Stable torso throughout')).toBeTruthy();
    expect(getByText('Knees cave inward at the bottom')).toBeTruthy();
    expect(getByText('Drive knees outward during the ascent')).toBeTruthy();
    expect(getByText('Lower back rounds under heavy load')).toBeTruthy();
    expect(getByText('Add tempo squats to build control')).toBeTruthy();
    expect(getByText('Reduce load by 10% and focus on form')).toBeTruthy();
  });

  it('renders the explicit low-confidence statement when low_confidence is set (Req 18.4)', () => {
    const { getByText } = render(<ExerciseAnalysisResult result={fullResult} />);

    expect(
      getByText(/low confidence.*may be\s+inaccurate/is)
    ).toBeTruthy();
    // Includes the confidence percentage (0.4 -> 40%)
    expect(getByText(/\(40%\)/)).toBeTruthy();
  });

  it('does NOT render the low-confidence statement when low_confidence is absent', () => {
    const { queryByText } = render(
      <ExerciseAnalysisResult result={{ ...fullResult, low_confidence: false }} />
    );

    expect(queryByText(/low confidence/i)).toBeNull();
  });

  it('renders the nested (camelCase / scores) shape just as the flat shape', () => {
    const nested: AnalysisResult = {
      exerciseId: 'deadlift',
      overallScore: 91,
      scores: {
        movement: 88,
        rangeOfMotion: { hip: 90 },
        tempo: 70,
        stability: 85,
        symmetry: 92,
        jointAlignment: { spine: 80 },
      },
      feedback: {
        strengths: ['Strong lockout'],
        mistakes: ['Bar drifts forward'],
        corrections: ['Keep the bar over midfoot'],
        safetyWarnings: ['Watch spinal flexion'],
        improvementTips: ['Brace harder before the pull'],
        trainingAdvice: ['Practice paused deadlifts'],
      },
    };

    const { getByText } = render(<ExerciseAnalysisResult result={nested} />);
    expect(getByText('91')).toBeTruthy();
    expect(getByText('Movement')).toBeTruthy();
    expect(getByText('Strong lockout')).toBeTruthy();
    expect(getByText('Practice paused deadlifts')).toBeTruthy();
  });
});

describe('ExerciseAnalysisProgress — Requirement 20.3 progress labels', () => {
  it('renders every ordered progress label (Req 20.3)', () => {
    const { getAllByText } = render(<ExerciseAnalysisProgress jobState="extracting_pose" />);

    // Each stage label appears as a stage row; the active stage label may also
    // appear in the headline, so assert at least one occurrence of each.
    PROGRESS_STAGES.forEach((stage) => {
      expect(getAllByText(stage).length).toBeGreaterThanOrEqual(1);
    });
  });

  it('exposes a label for each labelled job state and maps states to labels', () => {
    expect(PROGRESS_LABELS.queued).toBe('Uploading');
    expect(PROGRESS_LABELS.completed).toBe('Complete');
    // Transient/unlabelled states fall back to the nearest preceding label.
    expect(labelForState('reasoning')).toBe('Computing Biomechanics');
    expect(labelForState('frame_quality')).toBe('Extracting Frames');
    expect(labelForState(undefined)).toBe('Uploading');
  });

  it('renders the backend-provided headline label when supplied', () => {
    const { getAllByText } = render(
      <ExerciseAnalysisProgress jobState="biomechanics" label="Computing Biomechanics" />
    );
    // Headline + matching stage row both show the label.
    expect(getAllByText('Computing Biomechanics').length).toBeGreaterThanOrEqual(1);
  });
});
