import AdminMetric from '../models/adminMetric.js';

// ═══════════════════════════════════════════════════════════════════════════
// adminAnalyticsController — Admin Analytics Dashboard data + access control
// (Req 46).
//
// requireAdmin reuses the existing JWT auth (authMiddleware sets req.userId and
// req.user); it authorizes only administrators. Non-admins are denied access
// and receive NO metrics (Req 46.4). The metrics endpoint returns aggregate-
// only values (Req 46.2) drawn from the SEPARATE adminMetrics collection, which
// stores no per-user records and no user-identifiable information (Req 46.5,
// 46.6). Unavailable metric values are surfaced as explicit indicators while
// all available metrics are still returned (Req 46.7).
// ═══════════════════════════════════════════════════════════════════════════

/** Aggregate metric keys presented on the dashboard (Req 46.1). */
const METRIC_KEYS = [
  'averageProcessingTimeMs',
  'averageConfidence',
  'queueLength',
  'workerUtilization',
  'gpuUtilization',
  'failureRate',
  'cameraIssueFrequency',
  'retryCount',
  'exercisePopularity',
  'modelUsage',
];

/**
 * requireAdmin — authorization middleware, layered AFTER the existing `auth`
 * middleware so req.user is already populated. Treats an `isAdmin` flag or a
 * `role === 'admin'` on req.user as administrator. Denies everyone else with
 * 403 and no metrics (Req 46.4).
 */
export const requireAdmin = (req, res, next) => {
  const user = req.user;
  const isAdmin = user && (user.isAdmin === true || user.role === 'admin');

  if (!isAdmin) {
    // Deny access and present no metrics (Req 46.4).
    return res.status(403).json({ code: 'ADMIN_REQUIRED', message: 'Administrator access required' });
  }
  return next();
};

/**
 * GET /api/admin/analytics/metrics
 * Present every collected aggregate metric from the latest aggregation window
 * (Req 46.2). Any metric absent for the current window is returned with an
 * `{ available: false }` indicator while all available metrics are still
 * presented (Req 46.7).
 */
export const getMetrics = async (req, res) => {
  try {
    // Latest completed aggregation window (aggregate-only; no per-user data).
    const latest = await AdminMetric.findOne({}).sort({ windowEnd: -1 }).lean();

    const metrics = {};
    for (const key of METRIC_KEYS) {
      const value = latest ? latest[key] : undefined;
      if (value === undefined || value === null) {
        // Metric unavailable for this window — surface an indicator (Req 46.7).
        metrics[key] = { available: false };
      } else {
        metrics[key] = { available: true, value };
      }
    }

    return res.json({
      windowStart: latest?.windowStart ?? null,
      windowEnd: latest?.windowEnd ?? null,
      metrics,
    });
  } catch (error) {
    return res.status(500).json({ code: 'METRICS_UNAVAILABLE', message: error.message });
  }
};
