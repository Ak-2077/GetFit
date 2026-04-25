const buildFallbackActivityGoal = (user) => {
  const goal = user?.goal;
  const activityPreference = user?.activityPreference || 'mixed cardio and strength';
  const steps = Number(user?.steps || 0);
  const nextStepTarget = Math.max(6000, Math.min(12000, steps + 1000));

  if (goal === 'lose_fat') {
    return {
      title: 'Fat-Loss Activity Goal',
      summary: 'Prioritize daily movement and sustainable cardio to support a steady calorie deficit.',
      stepGoal: nextStepTarget,
      goals: [
        `Reach ${nextStepTarget} steps daily with short walking breaks.`,
        'Do 30 minutes moderate cardio at least 5 days weekly.',
        `Include 2 strength sessions weekly focused on ${activityPreference}.`,
        'Track consistency weekly and increase effort by 5 to 10 percent.',
      ],
    };
  }

  if (goal === 'gain_muscle') {
    const muscleStepGoal = Math.max(6000, Math.min(9000, nextStepTarget));
    return {
      title: 'Muscle-Gain Activity Goal',
      summary: 'Center training on progressive overload and keep activity balanced for recovery.',
      stepGoal: muscleStepGoal,
      goals: [
        'Train strength 4 to 5 sessions weekly with progressive overload.',
        `Add 2 light cardio sessions weekly in ${activityPreference} style.`,
        `Keep daily steps around ${muscleStepGoal} for recovery balance.`,
        'Log sets and reps weekly, then increase load gradually.',
      ],
    };
  }

  const maintenanceStepGoal = Math.max(7000, Math.min(10000, nextStepTarget));
  return {
    title: 'Maintenance Activity Goal',
    summary: 'Maintain a balanced routine with consistent movement and mixed-intensity training.',
    stepGoal: maintenanceStepGoal,
    goals: [
      `Maintain ${maintenanceStepGoal} steps daily for baseline activity.`,
      'Schedule 3 strength sessions weekly to preserve muscle mass.',
      `Add 2 cardio sessions weekly, based on ${activityPreference}.`,
      'Keep one full rest day weekly and track energy levels.',
    ],
  };
};

export const generateActivityGoal = async (req, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    if (!user.goal) {
      return res.status(400).json({ message: 'Set a profile goal first to generate AI activity goals' });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      const fallback = buildFallbackActivityGoal(user);
      return res.json({ ...fallback, source: 'fallback', reason: 'OPENAI_API_KEY missing' });
    }

    const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

    const prompt = `You are a fitness coach.
Create practical activity goals for this user profile:
- Goal: ${user.goal}
- Current weight: ${user.weight || 'unknown'}
- Target weight: ${user.targetWeight || 'unknown'}
- Timeline weeks: ${user.goalTimelineWeeks || 'unknown'}
- Activity preference: ${user.activityPreference || 'unknown'}
- Diet preference: ${user.dietPreference || 'unknown'}
- Activity level: ${user.activityLevel || 'unknown'}
- Daily steps currently: ${user.steps || 0}

Return strict JSON only with this shape:
{
  "title": "short title",
  "summary": "1 short sentence",
  "stepGoal": 8500,
  "goals": ["bullet 1", "bullet 2", "bullet 3", "bullet 4"]
}
Rules:
- goals array must have exactly 4 items
- each goal max 16 words
- stepGoal must be a number between 6000 and 12000
- no markdown`;

    if (typeof fetch !== 'function') {
      const fallback = buildFallbackActivityGoal(user);
      return res.json({ ...fallback, source: 'fallback', reason: 'fetch unavailable in runtime' });
    }

    let openaiResponse;
    try {
      openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          temperature: 0.6,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: 'You are a precise fitness planning assistant.' },
            { role: 'user', content: prompt },
          ],
        }),
      });
    } catch (networkError) {
      const fallback = buildFallbackActivityGoal(user);
      return res.json({ ...fallback, source: 'fallback', reason: `OpenAI network error: ${networkError.message}` });
    }

    if (!openaiResponse.ok) {
      const fallback = buildFallbackActivityGoal(user);
      const errorText = await openaiResponse.text();
      return res.json({
        ...fallback,
        source: 'fallback',
        reason: 'OpenAI request failed',
        openaiStatus: openaiResponse.status,
        openaiError: errorText,
      });
    }

    const data = await openaiResponse.json();
    const content = data?.choices?.[0]?.message?.content || '{}';

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      parsed = { title: 'AI Activity Goal', summary: 'Could not parse AI response.', goals: [] };
    }

    const fallback = buildFallbackActivityGoal(user);
    const parsedGoals = Array.isArray(parsed.goals) ? parsed.goals.slice(0, 4) : [];
    const goals = parsedGoals.length === 4 ? parsedGoals : fallback.goals;
    const parsedStepGoal = Number(parsed.stepGoal);
    const stepGoal = Number.isFinite(parsedStepGoal) ? Math.max(6000, Math.min(12000, Math.round(parsedStepGoal))) : fallback.stepGoal;

    return res.json({
      title: parsed.title || 'AI Activity Goal',
      summary: parsed.summary || 'Generated from your profile goal.',
      stepGoal,
      goals,
      model,
      source: 'openai',
    });
  } catch (error) {
    const fallback = buildFallbackActivityGoal(req.user || {});
    return res.json({
      ...fallback,
      source: 'fallback',
      reason: `Unhandled server error: ${error.message}`,
    });
  }
};
