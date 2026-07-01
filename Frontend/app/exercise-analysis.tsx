import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView,
  AppState,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import {
  uploadExerciseVideo,
  submitExerciseAnalysis,
  getExerciseAnalysisStatus,
  getExerciseAnalysisResult,
  submitExerciseAnalysisCorrection,
  cancelExerciseAnalysis,
} from '../services/api';
import ExerciseAnalysisProgress, { JobState, labelForState } from '../components/ExerciseAnalysisProgress';
import ExerciseAnalysisResult, { AnalysisResult } from '../components/ExerciseAnalysisResult';

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

const POLL_INTERVAL_MS = 1500;
// Persisted key for the active analysis job so a restart can resume/reconcile it.
const ACTIVE_JOB_KEY = '@getfit/active_analysis_job';
// Client-side ceiling on how long we keep polling before surfacing a friendly
// timeout (the server queue is left untouched). Generous to allow real analysis.
const ANALYSIS_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// ── Video requirements (mirror the AI service / backend limits) ──
// AI config: MIN_DURATION_SEC=2, MAX_DURATION_SEC=60, MAX_SIZE_BYTES=200 MiB,
// SUPPORTED_FORMATS=[mp4, mov]. Backend upload cap = 200 MB.
const MIN_DURATION_SEC = 2;
const MAX_DURATION_SEC = 60;
const MAX_SIZE_BYTES = 200 * 1024 * 1024; // 200 MB

type Phase = 'select' | 'uploading' | 'submitting' | 'analyzing' | 'result';

type VideoMeta = {
  uri: string;
  name: string;
  type: string;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  sizeBytes: number | null;
};

// ── Formatting helpers ──
const fmtBytes = (b: number | null | undefined) => {
  if (b == null || !Number.isFinite(b)) return null;
  if (b >= 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  if (b >= 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${b} B`;
};
const fmtDuration = (s: number | null) => {
  if (s == null || !Number.isFinite(s)) return null;
  const total = Math.round(s);
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
};
const estAnalysisSec = (durationSec: number | null) => {
  const base = durationSec && Number.isFinite(durationSec) ? durationSec * 6 : 40;
  return Math.max(20, Math.min(120, Math.round(base)));
};

// ── Friendly error mapping for known backend codes / messages ──
function friendlyError(code?: string | null, message?: string | null): string {
  const key = (code || '').toUpperCase();
  const map: Record<string, string> = {
    NETWORK_ERROR: 'Network problem. Check your connection and try again.',
    UPLOAD_TIMEOUT: 'The upload timed out. Move to a stronger connection and retry.',
    UPLOAD_FAILED: 'We could not upload your video. Please try again.',
    VIDEO_TOO_LARGE: 'That video is too large. Record a shorter clip (under ~60s) and retry.',
    UNSUPPORTED_MEDIA_TYPE: 'That video format is not supported. Record in MP4/MOV.',
    UNSUPPORTED_FORMAT: 'That video format is not supported. Record in MP4/MOV.',
    UNSUPPORTED_CODEC: 'That video codec is not supported. Try recording again.',
    CORRUPTED_VIDEO: 'The video appears corrupted. Please record again.',
    VIDEO_TOO_SHORT: 'The clip is too short. Record at least a couple of seconds.',
    VIDEO_TOO_LONG: 'The clip is too long. Keep it under 60 seconds.',
    BODY_NOT_VISIBLE: 'We could not clearly see your body. Frame your whole body and retry.',
    BODY_CROPPED: 'Your body was cut off. Step back so your whole body is in frame.',
    CAMERA_TOO_DARK: 'The recording is too dark. Record in brighter, even lighting.',
    CAMERA_SHAKING: 'The camera was too shaky. Prop your phone on a stable surface.',
    POOR_LIGHTING: 'Lighting was too poor to analyze. Record in a brighter space.',
    MULTIPLE_PEOPLE: 'More than one person was detected. Make sure only you are in frame.',
    NOT_EXERCISE_VIDEO: 'This does not look like an exercise video. Please record your set.',
    EXERCISE_NOT_RECOGNIZED: 'We could not recognize the exercise. Add a hint and retry.',
    LOW_CONFIDENCE: 'Confidence was too low for a reliable analysis. Re-record with a clear side view in good lighting.',
    POSE_ENGINE_UNAVAILABLE: 'The analysis engine is busy right now. Please try again shortly.',
    RETRY_EXHAUSTED: 'The service is temporarily unavailable. Please try again shortly.',
    RECOVERY_EXHAUSTED: 'Analysis could not complete due to a processing error. Please retry.',
    INVALID_POSE: 'We could not track a valid body pose. Record a clear, full-body side view.',
    INTEGRITY_MISMATCH: 'The uploaded video failed an integrity check. Please record and upload again.',
    JOB_CANCELLED: 'Analysis was cancelled.',
    CANCELLED: 'Analysis was cancelled.',
    QUEUE_TIMEOUT: 'Analysis is taking longer than expected. Please try again in a moment.',
    WORKER_UNAVAILABLE: 'The analysis engine is unavailable right now. Please try again shortly.',
  };
  if (map[key]) return map[key];
  if (message && message.trim()) return message;
  return 'Something went wrong. Please try again.';
}

// ── Rich failure descriptor: title + reason + actionable tips per code ──
function describeFailure(
  code?: string | null,
  message?: string | null
): { title: string; message: string; tips: string[] } {
  const key = (code || '').toUpperCase();
  const detail = friendlyError(code, message);

  const table: Record<string, { title: string; tips: string[] }> = {
    NOT_EXERCISE_VIDEO: {
      title: "That doesn't look like a workout",
      tips: [
        'Upload a video of yourself actually performing an exercise.',
        'Make sure a person is clearly visible doing the movement.',
      ],
    },
    EXERCISE_NOT_RECOGNIZED: {
      title: "We couldn't recognize the exercise",
      tips: [
        'Type the exercise name in the hint field (e.g. "Squat").',
        'Record the full movement from start to finish.',
        'Use a clear side-on angle so the motion is visible.',
      ],
    },
    BODY_NOT_VISIBLE: {
      title: 'We couldn\'t see your body',
      tips: [
        'Frame your whole body head-to-toe in the shot.',
        'Step back so nothing is cut off.',
        'Record against a clear background in good light.',
      ],
    },
    BODY_CROPPED: {
      title: 'Your body was cut off',
      tips: [
        'Step back so your entire body is in frame.',
        'Prop the phone up to capture the full movement.',
      ],
    },
    CAMERA_TOO_DARK: {
      title: 'The video is too dark',
      tips: [
        'Record in a brighter, evenly lit room.',
        'Avoid strong backlight (windows behind you).',
      ],
    },
    CAMERA_SHAKING: {
      title: 'The camera was too shaky',
      tips: [
        'Prop your phone on a stable surface or tripod.',
        "Don't hold the phone while performing the set.",
      ],
    },
    POOR_LIGHTING: {
      title: 'Lighting was too poor',
      tips: ['Record in a brighter space with even lighting.'],
    },
    MULTIPLE_PEOPLE: {
      title: 'More than one person detected',
      tips: [
        'Make sure only you are in the frame.',
        'Clear the background of other people.',
      ],
    },
    LOW_CONFIDENCE: {
      title: 'Not enough detail to analyze',
      tips: [
        'Record a clear side view of the full movement.',
        'Use good, even lighting.',
        'Keep the whole body in frame for every rep.',
      ],
    },
    INVALID_POSE: {
      title: "We couldn't track your body",
      tips: [
        'Record a clear, full-body side view.',
        'Make sure the movement is fully visible.',
      ],
    },
    VIDEO_TOO_SHORT: {
      title: 'The clip is too short',
      tips: ['Record at least a few seconds covering a full rep.'],
    },
    VIDEO_TOO_LONG: {
      title: 'The clip is too long',
      tips: ['Keep it under 60 seconds — one set is enough.'],
    },
    VIDEO_TOO_LARGE: {
      title: 'The video is too large',
      tips: ['Record a shorter clip (under ~60s) and try again.'],
    },
    UNSUPPORTED_CODEC: {
      title: 'Unsupported video format',
      tips: ['Record with the in-app camera (MP4/MOV).'],
    },
    UNSUPPORTED_FORMAT: {
      title: 'Unsupported video format',
      tips: ['Record with the in-app camera (MP4/MOV).'],
    },
    CORRUPTED_VIDEO: {
      title: 'The video looks corrupted',
      tips: ['Please record the clip again and retry.'],
    },
    INTEGRITY_MISMATCH: {
      title: 'Upload got corrupted',
      tips: ['Record or pick the video again and re-upload.'],
    },
    QUEUE_TIMEOUT: {
      title: 'This is taking longer than expected',
      tips: ['Check your connection and try again in a moment.'],
    },
    WORKER_UNAVAILABLE: {
      title: 'The analysis engine is busy',
      tips: ['Please try again in a little while.'],
    },
    POSE_ENGINE_UNAVAILABLE: {
      title: 'The analysis engine is busy',
      tips: ['Please try again in a little while.'],
    },
    NETWORK_ERROR: {
      title: 'Network problem',
      tips: ['Check your connection and try again.'],
    },
  };

  const entry = table[key];
  return {
    title: entry?.title || "We couldn't analyze this video",
    message: detail,
    tips: entry?.tips || [
      'Record a clear, full-body side view of your set.',
      'Use good lighting and keep the phone steady.',
    ],
  };
}

export default function ExerciseAnalysisScreen() {
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>('select');
  const [video, setVideo] = useState<VideoMeta | null>(null);
  const [exerciseHint, setExerciseHint] = useState('');

  // Upload progress
  const [uploadPct, setUploadPct] = useState(0);
  const [uploadedBytes, setUploadedBytes] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);
  const cancelUploadRef = useRef<null | (() => void)>(null);
  const canceledRef = useRef(false);

  const [jobId, setJobId] = useState<string | null>(null);
  const [jobState, setJobState] = useState<JobState | null>(null);
  const [progressLabel, setProgressLabel] = useState<string | null>(null);
  const [percent, setPercent] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorTitle, setErrorTitle] = useState<string | null>(null);
  const [errorTips, setErrorTips] = useState<string[] | null>(null);

  const [result, setResult] = useState<AnalysisResult | null>(null);

  // Correction form state
  const [correctionVisible, setCorrectionVisible] = useState(false);
  const [correctedExercise, setCorrectedExercise] = useState('');
  const [correctionNote, setCorrectionNote] = useState('');
  const [submittingCorrection, setSubmittingCorrection] = useState(false);
  const [correctionDone, setCorrectionDone] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);
  // Guards against duplicate Analyze taps / concurrent submissions.
  const busyRef = useRef(false);
  // When the current analysis (polling) started — drives ETA + client timeout.
  const analysisStartRef = useRef<number | null>(null);
  const [analysisStartMs, setAnalysisStartMs] = useState<number | null>(null);
  // A 1s ticking clock (only while analyzing) so the ETA counts down live.
  const [nowMs, setNowMs] = useState<number>(Date.now());

  // Persist / clear the active job id so an app restart can reconcile it.
  const persistActiveJob = useCallback(async (id: string | null) => {
    try {
      if (id) await AsyncStorage.setItem(ACTIVE_JOB_KEY, JSON.stringify({ jobId: id, startedAt: Date.now() }));
      else await AsyncStorage.removeItem(ACTIVE_JOB_KEY);
    } catch {}
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (pollRef.current) clearInterval(pollRef.current);
      if (cancelUploadRef.current) cancelUploadRef.current();
    };
  }, []);

  const haptic = (type: 'light' | 'success' | 'error') => {
    try {
      if (type === 'light') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      else if (type === 'success') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      else Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } catch {}
  };

  const goBackSafe = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/calories');
  };

  const assetToMeta = (asset: ImagePicker.ImagePickerAsset): VideoMeta => {
    const uri = asset.uri;
    const guessedName = uri.split('/').pop() || 'workout.mp4';
    const isMov = /\.mov$/i.test(guessedName);
    return {
      uri,
      name: isMov ? 'workout.mov' : 'workout.mp4',
      type: isMov ? 'video/quicktime' : 'video/mp4',
      durationSec: asset.duration != null ? asset.duration / 1000 : null,
      width: asset.width ?? null,
      height: asset.height ?? null,
      sizeBytes: (asset as any).fileSize ?? null,
    };
  };

  // ── 1. Select / record a workout video ──
  const recordVideo = async () => {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission needed', 'Camera access is required to record a workout video.');
        return;
      }
      const res = await ImagePicker.launchCameraAsync({
        mediaTypes: ['videos'],
        videoMaxDuration: 60,
        quality: 0.7,
      });
      if (!res.canceled && res.assets?.[0]?.uri) {
        haptic('light');
        setVideo(assetToMeta(res.assets[0]));
        setErrorMessage(null);
      }
    } catch {
      Alert.alert('Error', 'Could not open the camera.');
    }
  };

  const pickVideo = async () => {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['videos'],
        quality: 0.7,
      });
      if (!res.canceled && res.assets?.[0]?.uri) {
        haptic('light');
        setVideo(assetToMeta(res.assets[0]));
        setErrorMessage(null);
      }
    } catch {
      Alert.alert('Error', 'Could not open the video library.');
    }
  };

  // ── 2. Upload → receive videoUrl → submit → receive jobId → poll ──
  const handleAnalyze = async () => {
    if (!video) {
      Alert.alert('No video', 'Please record or select a workout video first.');
      return;
    }
    // Duplicate-tap guard: ignore taps while an upload/submit is already running.
    if (busyRef.current) return;

    // Pre-flight checks against the known limits so the user gets instant
    // feedback instead of waiting for a server-side rejection.
    if (video.durationSec != null && Number.isFinite(video.durationSec)) {
      if (video.durationSec < MIN_DURATION_SEC) {
        setErrorMessage(`That clip is too short. Record at least ${MIN_DURATION_SEC} seconds.`);
        return;
      }
      if (video.durationSec > MAX_DURATION_SEC + 0.5) {
        setErrorMessage(`That clip is too long. Keep it under ${MAX_DURATION_SEC} seconds.`);
        return;
      }
    }
    if (video.sizeBytes != null && video.sizeBytes > MAX_SIZE_BYTES) {
      setErrorMessage('That video is too large (max 200 MB). Record a shorter clip and retry.');
      return;
    }

    busyRef.current = true;
    setErrorMessage(null);
    setErrorTitle(null);
    setErrorTips(null);
    canceledRef.current = false;
    setUploadPct(0);
    setUploadedBytes(0);
    setTotalBytes(video.sizeBytes || 0);
    setPhase('uploading');
    haptic('light');

    // Step 1: upload the recorded video to temporary server storage.
    let videoUrl: string | null = null;
    let videoSha256: string | null = null;
    try {
      const uploaded = await uploadExerciseVideo(video.uri, {
        name: video.name,
        type: video.type,
        onProgress: (loaded: number, total: number) => {
          if (!mountedRef.current) return;
          setUploadedBytes(loaded);
          if (total) {
            setTotalBytes(total);
            setUploadPct(Math.max(0, Math.min(100, Math.round((loaded / total) * 100))));
          }
        },
        registerCancel: (cancel: () => void) => {
          cancelUploadRef.current = cancel;
        },
      } as any);
      videoUrl = uploaded?.videoUrl || null;
      videoSha256 = uploaded?.sha256 || null;
    } catch (e: any) {
      if (canceledRef.current || e?.code === 'UPLOAD_CANCELED') {
        // User canceled — return quietly to the select phase.
        busyRef.current = false;
        setPhase('select');
        return;
      }
      haptic('error');
      setErrorMessage(friendlyError(e?.code, e?.message));
      busyRef.current = false;
      setPhase('select');
      return;
    } finally {
      cancelUploadRef.current = null;
    }

    if (!videoUrl) {
      setErrorMessage('Upload succeeded but no video URL was returned. Please retry.');
      busyRef.current = false;
      setPhase('select');
      return;
    }

    // Step 2: submit the analysis with the SERVER url (never a file:// uri).
    setPhase('submitting');
    try {
      const res = await submitExerciseAnalysis(videoUrl, (exerciseHint.trim() || null) as any, videoSha256 as any);
      const id = res?.data?.jobId || res?.data?.job_id;
      if (!id) {
        setErrorMessage('The server did not return a job id.');
        busyRef.current = false;
        setPhase('select');
        return;
      }
      setJobId(id);
      setJobState('queued');
      setProgressLabel(labelForState('queued'));
      setPercent(0);
      setPhase('analyzing');
      persistActiveJob(id);
      startPolling(id);
    } catch (e: any) {
      haptic('error');
      setErrorMessage(friendlyError(e?.response?.data?.code, e?.response?.data?.message || 'Failed to submit the video for analysis.'));
      setPhase('select');
    } finally {
      busyRef.current = false;
    }
  };

  const cancelUpload = () => {
    canceledRef.current = true;
    if (cancelUploadRef.current) cancelUploadRef.current();
    setPhase('select');
  };

  // ── 3. Poll status until terminal, then fetch the result ──
  const startPolling = useCallback((id: string, startedAt?: number) => {
    if (pollRef.current) clearInterval(pollRef.current);
    const start = startedAt ?? Date.now();
    analysisStartRef.current = start;
    setAnalysisStartMs(start);

    const tick = async () => {
      // Client-side timeout: stop polling and surface a friendly message. The
      // server-side queue is left untouched (it may still finish); the user can
      // retry. We also proactively cancel the server job to free resources.
      if (analysisStartRef.current && Date.now() - analysisStartRef.current > ANALYSIS_TIMEOUT_MS) {
        if (pollRef.current) clearInterval(pollRef.current);
        try { await cancelExerciseAnalysis(id); } catch {}
        if (!mountedRef.current) return;
        haptic('error');
        const info = describeFailure('QUEUE_TIMEOUT');
        setErrorTitle(info.title);
        setErrorTips(info.tips);
        setErrorMessage(info.message);
        persistActiveJob(null);
        return;
      }

      try {
        const res = await getExerciseAnalysisStatus(id);
        const data = res?.data || {};
        const state: JobState = (data.jobState || data.state || data.progress?.state) as JobState;
        const label = data.progress?.label || data.label || labelForState(state);
        const pct = data.progress?.percent ?? data.percent ?? null;

        if (!mountedRef.current) return;
        if (state) setJobState(state);
        if (label) setProgressLabel(label);
        setPercent(pct);

        if (state === 'cancelled') {
          if (pollRef.current) clearInterval(pollRef.current);
          persistActiveJob(null);
          // A cancellation is a user action, not an error — return to select.
          setPhase('select');
          return;
        }

        if (state === 'failed') {
          const code = data.error?.code || data.errorCode;
          const msg = data.error?.message || data.errorMessage;
          const info = describeFailure(code, msg);
          haptic('error');
          setErrorTitle(info.title);
          setErrorTips(info.tips);
          setErrorMessage(info.message);
          if (pollRef.current) clearInterval(pollRef.current);
          persistActiveJob(null);
          return;
        }

        if (state === 'completed') {
          if (pollRef.current) clearInterval(pollRef.current);
          persistActiveJob(null);
          await fetchResult(id);
        }
      } catch (e: any) {
        if (e?.response?.status && e.response.status >= 400 && e.response.status !== 404) {
          if (!mountedRef.current) return;
          setErrorMessage(friendlyError(e?.response?.data?.code, 'Lost connection while checking progress.'));
          if (pollRef.current) clearInterval(pollRef.current);
          persistActiveJob(null);
        }
      }
    };

    tick();
    pollRef.current = setInterval(tick, POLL_INTERVAL_MS);
  }, [persistActiveJob]);

  const fetchResult = useCallback(async (id: string) => {
    try {
      const res = await getExerciseAnalysisResult(id);
      const data = res?.data?.result || res?.data?.analysisResult || res?.data;
      if (!mountedRef.current) return;
      if (data && (data.exercise_id || data.exerciseId || data.overall_score != null || data.overallScore != null)) {
        haptic('success');
        setResult(data);
        setPhase('result');
      } else {
        setErrorMessage('Analysis completed but the result could not be loaded.');
      }
    } catch (e: any) {
      if (!mountedRef.current) return;
      setErrorMessage(friendlyError(e?.response?.data?.code, e?.response?.data?.message || 'Failed to load the analysis result.'));
    }
  }, []);

  // ── Cancel an in-flight analysis (runtime reliability) ──
  const handleCancelAnalysis = async () => {
    const id = jobId;
    if (pollRef.current) clearInterval(pollRef.current);
    haptic('light');
    if (id) {
      try { await cancelExerciseAnalysis(id); } catch {}
    }
    await persistActiveJob(null);
    if (!mountedRef.current) return;
    setPhase('select');
    setJobId(null);
    setJobState(null);
    setProgressLabel(null);
    setPercent(null);
    analysisStartRef.current = null;
    setAnalysisStartMs(null);
  };

  // ── Resume an existing job (foreground / restart recovery) ──
  const resumeJob = useCallback(async (id: string, startedAt?: number) => {
    try {
      const res = await getExerciseAnalysisStatus(id);
      const data = res?.data || {};
      const state: JobState = (data.jobState || data.state || data.progress?.state) as JobState;
      if (!mountedRef.current) return;

      if (state === 'completed') {
        setPhase('analyzing');
        setJobId(id);
        await fetchResult(id);
        await persistActiveJob(null);
        return;
      }
      if (state === 'failed' || state === 'cancelled') {
        // Terminal already — clear the stale active job without alarming the user.
        await persistActiveJob(null);
        return;
      }
      // Still in flight — resume polling and progress UI.
      setJobId(id);
      setJobState(state || 'queued');
      setProgressLabel(data.progress?.label || labelForState(state));
      setPercent(data.progress?.percent ?? null);
      setPhase('analyzing');
      startPolling(id, startedAt);
    } catch {
      // Job unknown/expired on the server — drop the stale reference.
      await persistActiveJob(null);
    }
  }, [fetchResult, persistActiveJob, startPolling]);

  // On mount, reconcile any persisted active job (app restart recovery).
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(ACTIVE_JOB_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (parsed?.jobId) await resumeJob(parsed.jobId, parsed.startedAt);
      } catch {}
    })();
  }, [resumeJob]);

  // On app foreground, resume polling for an active job (background recovery).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return;
      // Only resume if we have an active job and are not already polling.
      if (jobId && phase === 'analyzing' && !errorMessage && !pollRef.current) {
        startPolling(jobId, analysisStartRef.current ?? undefined);
      }
    });
    return () => sub.remove();
  }, [jobId, phase, errorMessage, startPolling]);

  // Tick a 1s clock only while analyzing (drives the live ETA countdown).
  useEffect(() => {
    if (phase !== 'analyzing' || errorMessage) return;
    setNowMs(Date.now());
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [phase, errorMessage]);
  const handleSubmitCorrection = async () => {
    const note = correctionNote.trim();
    const corrected = correctedExercise.trim();
    if (!note && !corrected) {
      Alert.alert('Empty correction', 'Add a note or a corrected exercise before submitting.');
      return;
    }
    const id = (result as any)?._id || (result as any)?.id || jobId;
    if (!id) {
      Alert.alert('Error', 'Missing analysis id for this correction.');
      return;
    }
    try {
      setSubmittingCorrection(true);
      await submitExerciseAnalysisCorrection(String(id), {
        correctedExerciseId: corrected || undefined,
        note: note || undefined,
      });
      setCorrectionDone(true);
      setCorrectionVisible(false);
      setCorrectedExercise('');
      setCorrectionNote('');
      Alert.alert('Thanks', 'Your correction was submitted.');
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.message || 'Failed to submit the correction.');
    } finally {
      setSubmittingCorrection(false);
    }
  };

  const reset = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (cancelUploadRef.current) cancelUploadRef.current();
    persistActiveJob(null);
    busyRef.current = false;
    analysisStartRef.current = null;
    setAnalysisStartMs(null);
    setPhase('select');
    setVideo(null);
    setExerciseHint('');
    setUploadPct(0);
    setUploadedBytes(0);
    setTotalBytes(0);
    setJobId(null);
    setJobState(null);
    setProgressLabel(null);
    setPercent(null);
    setErrorMessage(null);
    setErrorTitle(null);
    setErrorTips(null);
    setResult(null);
    setCorrectionVisible(false);
    setCorrectedExercise('');
    setCorrectionNote('');
    setCorrectionDone(false);
  };

  const inputStyle = {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: C.text,
    fontSize: 14,
  } as const;

  const metaChips: string[] = [];
  if (video) {
    const d = fmtDuration(video.durationSec);
    if (d) metaChips.push(d);
    if (video.width && video.height) metaChips.push(`${video.width}×${video.height}`);
    const sz = fmtBytes(video.sizeBytes);
    if (sz) metaChips.push(sz);
    metaChips.push(`~${estAnalysisSec(video.durationSec)}s analysis`);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ position: 'absolute', top: -60, right: -60, width: 280, height: 280, borderRadius: 140, backgroundColor: 'rgba(0,230,118,0.06)' }} />

      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 }}>
        <TouchableOpacity
          onPress={goBackSafe}
          activeOpacity={0.7}
          style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: C.card, borderWidth: 1, borderColor: C.cardBorder, justifyContent: 'center', alignItems: 'center' }}
        >
          <FontAwesome name="chevron-left" size={14} color={C.text} />
        </TouchableOpacity>
        <Text style={{ color: C.text, fontSize: 18, fontWeight: '800', letterSpacing: -0.3 }}>Form Analysis</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
          {/* ═══ PHASE: SELECT ═══ */}
          {phase === 'select' && (
            <View style={{ backgroundColor: C.card, borderRadius: 18, borderWidth: 1, borderColor: C.cardBorder, padding: 20 }}>
              <Text style={{ color: C.text, fontSize: 16, fontWeight: '800', marginBottom: 6 }}>Analyze your lift</Text>
              <Text style={{ color: C.subtext, fontSize: 13, lineHeight: 19, marginBottom: 16 }}>
                Record or select a short video of your set. We upload it securely, analyze your form with AI, and delete the video from our servers right after.
              </Text>

              {/* ── Video requirements ── */}
              <View style={{ backgroundColor: C.glass, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 12, marginBottom: 14 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <FontAwesome name="info-circle" size={13} color={C.accent} />
                  <Text style={{ color: C.text, fontSize: 12, fontWeight: '700' }}>For best results</Text>
                </View>
                {[
                  'Length: 2–60 seconds (one full set)',
                  'Format: MP4 or MOV · up to 200 MB',
                  'Frame your whole body, side-on view',
                  'Good, even lighting · keep the phone steady',
                  'Only you in frame — no other people',
                ].map((req, i) => (
                  <View key={i} style={{ flexDirection: 'row', gap: 8, marginBottom: i === 4 ? 0 : 5 }}>
                    <FontAwesome name="check" size={11} color={C.accent} style={{ marginTop: 2 }} />
                    <Text style={{ color: C.subtext, fontSize: 12, flex: 1, lineHeight: 16 }}>{req}</Text>
                  </View>
                ))}
              </View>

              {video ? (
                <View style={{ backgroundColor: C.glass, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 12, marginBottom: 14 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <FontAwesome name="film" size={16} color={C.accent} />
                    <Text style={{ color: C.text, fontSize: 13, fontWeight: '700', flex: 1 }} numberOfLines={1}>
                      Video ready
                    </Text>
                    <TouchableOpacity onPress={() => setVideo(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <FontAwesome name="times-circle" size={16} color={C.muted} />
                    </TouchableOpacity>
                  </View>
                  {metaChips.length > 0 ? (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                      {metaChips.map((chip, i) => (
                        <View key={i} style={{ backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 }}>
                          <Text style={{ color: C.subtext, fontSize: 11, fontWeight: '600' }}>{chip}</Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
              ) : (
                <View style={{ flexDirection: 'row', gap: 10, marginBottom: 14 }}>
                  <TouchableOpacity
                    onPress={recordVideo}
                    activeOpacity={0.8}
                    style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: C.accentDim, borderRadius: 14, paddingVertical: 18, borderWidth: 1, borderColor: 'rgba(31,164,99,0.35)' }}
                  >
                    <FontAwesome name="video-camera" size={20} color={C.accent} />
                    <Text style={{ color: C.accent, fontSize: 13, fontWeight: '700' }}>Record</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={pickVideo}
                    activeOpacity={0.8}
                    style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: C.glass, borderRadius: 14, paddingVertical: 18, borderWidth: 1, borderColor: C.border }}
                  >
                    <FontAwesome name="folder-open" size={20} color={C.text} />
                    <Text style={{ color: C.text, fontSize: 13, fontWeight: '700' }}>Choose</Text>
                  </TouchableOpacity>
                </View>
              )}

              <Text style={{ color: C.subtext, fontSize: 11, fontWeight: '700', letterSpacing: 0.3, marginBottom: 8 }}>
                EXERCISE (OPTIONAL)
              </Text>
              <TextInput
                style={inputStyle}
                value={exerciseHint}
                onChangeText={setExerciseHint}
                placeholder="e.g. Barbell Squat"
                placeholderTextColor={C.muted}
              />

              {errorMessage ? (
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 12, backgroundColor: 'rgba(255,107,107,0.1)', borderRadius: 10, padding: 10 }}>
                  <FontAwesome name="exclamation-circle" size={14} color={C.red} style={{ marginTop: 1 }} />
                  <Text style={{ color: C.red, fontSize: 12, flex: 1, lineHeight: 17 }}>{errorMessage}</Text>
                </View>
              ) : null}

              <TouchableOpacity
                onPress={handleAnalyze}
                disabled={!video}
                activeOpacity={0.8}
                style={{ marginTop: 18, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, borderRadius: 16, paddingVertical: 16, backgroundColor: video ? C.accent : 'rgba(255,255,255,0.08)' }}
              >
                <FontAwesome name="bolt" size={16} color={video ? '#000' : C.muted} />
                <Text style={{ color: video ? '#000' : C.muted, fontSize: 15, fontWeight: '800' }}>Analyze Form</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* ═══ PHASE: UPLOADING ═══ */}
          {phase === 'uploading' && (
            <View style={{ backgroundColor: C.card, borderRadius: 18, borderWidth: 1, borderColor: C.cardBorder, padding: 20 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                <FontAwesome name="cloud-upload" size={16} color={C.accent} />
                <Text style={{ color: C.text, fontSize: 16, fontWeight: '800' }}>Uploading video</Text>
              </View>
              <Text style={{ color: C.muted, fontSize: 12, marginBottom: 16 }}>
                {uploadPct}%{totalBytes ? ` · ${fmtBytes(uploadedBytes)} / ${fmtBytes(totalBytes)}` : ''}
              </Text>
              <View style={{ height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.06)', overflow: 'hidden', marginBottom: 18 }}>
                <View style={{ height: '100%', width: `${uploadPct}%`, backgroundColor: C.accent, borderRadius: 4 }} />
              </View>
              <TouchableOpacity
                onPress={cancelUpload}
                activeOpacity={0.8}
                style={{ alignItems: 'center', borderRadius: 14, paddingVertical: 13, backgroundColor: C.glass, borderWidth: 1, borderColor: C.border }}
              >
                <Text style={{ color: C.text, fontSize: 14, fontWeight: '700' }}>Cancel Upload</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* ═══ PHASE: SUBMITTING ═══ */}
          {phase === 'submitting' && (
            <View style={{ backgroundColor: C.card, borderRadius: 18, borderWidth: 1, borderColor: C.cardBorder, padding: 20, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <ActivityIndicator size="small" color={C.accent} />
              <Text style={{ color: C.text, fontSize: 15, fontWeight: '700' }}>Queuing your analysis…</Text>
            </View>
          )}

          {/* ═══ PHASE: ANALYZING (progress polling) ═══ */}
          {phase === 'analyzing' && (
            <>
              <ExerciseAnalysisProgress
                jobState={jobState}
                label={progressLabel}
                percent={percent}
                errorMessage={errorMessage}
                errorTitle={errorTitle}
                errorTips={errorTips}
                etaSeconds={(() => {
                  if (errorMessage || analysisStartMs == null || percent == null) return null;
                  const pctNorm = percent <= 1 ? percent * 100 : percent;
                  if (pctNorm < 5) return null;
                  const elapsed = Math.max(0, (nowMs - analysisStartMs) / 1000);
                  const total = elapsed / (pctNorm / 100);
                  return Math.max(0, Math.round(total - elapsed));
                })()}
              />
              {errorMessage ? (
                <TouchableOpacity
                  onPress={reset}
                  activeOpacity={0.8}
                  style={{ marginTop: 16, alignItems: 'center', borderRadius: 14, paddingVertical: 14, backgroundColor: C.card, borderWidth: 1, borderColor: C.cardBorder }}
                >
                  <Text style={{ color: C.text, fontSize: 14, fontWeight: '700' }}>Try Again</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  onPress={handleCancelAnalysis}
                  activeOpacity={0.8}
                  style={{ marginTop: 16, alignItems: 'center', borderRadius: 14, paddingVertical: 14, backgroundColor: C.glass, borderWidth: 1, borderColor: C.border }}
                >
                  <Text style={{ color: C.text, fontSize: 14, fontWeight: '700' }}>Cancel Analysis</Text>
                </TouchableOpacity>
              )}
            </>
          )}

          {/* ═══ PHASE: RESULT ═══ */}
          {phase === 'result' && result && (
            <>
              <ExerciseAnalysisResult result={result} />

              {/* ── Correction submission (Req 13.3) ── */}
              <View style={{ marginTop: 14, backgroundColor: C.card, borderRadius: 18, borderWidth: 1, borderColor: C.cardBorder, padding: 16 }}>
                {correctionDone ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <FontAwesome name="check-circle" size={16} color={C.accent} />
                    <Text style={{ color: C.accent, fontSize: 13, fontWeight: '700' }}>Correction submitted</Text>
                  </View>
                ) : !correctionVisible ? (
                  <TouchableOpacity
                    onPress={() => setCorrectionVisible(true)}
                    activeOpacity={0.8}
                    style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                  >
                    <FontAwesome name="pencil" size={13} color={C.subtext} />
                    <Text style={{ color: C.subtext, fontSize: 13, fontWeight: '700' }}>
                      Something look wrong? Submit a correction
                    </Text>
                  </TouchableOpacity>
                ) : (
                  <View>
                    <Text style={{ color: C.text, fontSize: 15, fontWeight: '800', marginBottom: 10 }}>Submit a correction</Text>
                    <Text style={{ color: C.subtext, fontSize: 11, fontWeight: '700', letterSpacing: 0.3, marginBottom: 6 }}>
                      CORRECTED EXERCISE (OPTIONAL)
                    </Text>
                    <TextInput
                      style={inputStyle}
                      value={correctedExercise}
                      onChangeText={setCorrectedExercise}
                      placeholder="e.g. Front Squat"
                      placeholderTextColor={C.muted}
                    />
                    <Text style={{ color: C.subtext, fontSize: 11, fontWeight: '700', letterSpacing: 0.3, marginTop: 12, marginBottom: 6 }}>
                      NOTE
                    </Text>
                    <TextInput
                      style={[inputStyle, { minHeight: 72, textAlignVertical: 'top' }]}
                      value={correctionNote}
                      onChangeText={setCorrectionNote}
                      placeholder="What was inaccurate?"
                      placeholderTextColor={C.muted}
                      multiline
                    />
                    <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
                      <TouchableOpacity
                        onPress={() => setCorrectionVisible(false)}
                        activeOpacity={0.8}
                        style={{ flex: 1, alignItems: 'center', borderRadius: 14, paddingVertical: 13, backgroundColor: C.glass, borderWidth: 1, borderColor: C.border }}
                      >
                        <Text style={{ color: C.text, fontSize: 14, fontWeight: '700' }}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={handleSubmitCorrection}
                        disabled={submittingCorrection}
                        activeOpacity={0.8}
                        style={{ flex: 1, alignItems: 'center', borderRadius: 14, paddingVertical: 13, backgroundColor: C.accent }}
                      >
                        <Text style={{ color: '#000', fontSize: 14, fontWeight: '800' }}>
                          {submittingCorrection ? 'Sending...' : 'Submit'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </View>

              <TouchableOpacity
                onPress={reset}
                activeOpacity={0.8}
                style={{ marginTop: 14, alignItems: 'center', borderRadius: 16, paddingVertical: 15, backgroundColor: C.card, borderWidth: 1, borderColor: C.cardBorder }}
              >
                <Text style={{ color: C.text, fontSize: 14, fontWeight: '700' }}>Analyze Another</Text>
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
