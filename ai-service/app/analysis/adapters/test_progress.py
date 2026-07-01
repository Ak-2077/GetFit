"""
Property-based tests for the Progress_Service
(app/analysis/adapters/progress.py).

Covers design Property 24 — "Progress label mapping and latest-event recency"
— using Hypothesis with a minimum of 100 iterations.

Validates: Requirements 20.1, 20.3, 20.4, 20.5
"""

import asyncio

from hypothesis import given, settings
from hypothesis import strategies as st

from app.analysis.adapters.progress import (
    PROGRESS_TRANSPORT_NAMES,
    Progress_Service,
)
from app.analysis.jobs import PROGRESS_LABELS, JobState


# ── Generators ───────────────────────────────────────────────────────────
# A publish is a (job_id, JobState) pair. Job ids are drawn from a small pool
# so that sequences realistically interleave multiple jobs and exercise the
# "latest wins per job" behavior. Every JobState (including completed) is
# reachable so the label mapping is fully covered.

_JOB_IDS = st.sampled_from(["job-a", "job-b", "job-c", "job-d"])
_STATES = st.sampled_from(list(JobState))
_PUBLISH = st.tuples(_JOB_IDS, _STATES)
# Non-empty sequences of publishes so there is always a "most recent" event.
_PUBLISH_SEQUENCES = st.lists(_PUBLISH, min_size=1, max_size=40)
_TRANSPORTS = st.sampled_from(PROGRESS_TRANSPORT_NAMES)


def _expected_label(state: JobState) -> str:
    """Oracle for the human-readable label, independent of the service.

    Labels are sourced from PROGRESS_LABELS (Req 20.3); states without a
    surfaced label fall back to the raw state value so the label is always
    non-empty. `completed` maps to "Complete" (Req 20.5).
    """
    return PROGRESS_LABELS.get(state, state.value)


# ── Property 24 ────────────────────────────────────────────────────────────
# Feature: ai-exercise-analysis, Property 24: Progress label mapping and
# latest-event recency — a published ProgressEvent carries the correct
# human-readable label for its JobState (completed -> "Complete"); latest(job)
# returns the most recently published event for that job; and the mapping holds
# identically across every registered transport (poll/push/both).
@given(transport=_TRANSPORTS, publishes=_PUBLISH_SEQUENCES)
@settings(max_examples=200)
def test_progress_label_mapping_and_latest_recency(transport, publishes):
    async def scenario():
        service = Progress_Service(active_transport=transport)

        # Track the most recently published state per job as the oracle for
        # latest-event recency (Req 20.4).
        last_state_by_job: dict[str, JobState] = {}

        for job_id, state in publishes:
            event = await service.publish(job_id, state)
            last_state_by_job[job_id] = state

            # The published event carries the correct bounded fields and the
            # label derived from PROGRESS_LABELS (Req 20.1, 20.3, 20.5).
            assert event.job_id == job_id
            assert event.state == state
            assert event.label == _expected_label(state)
            if state is JobState.completed:
                assert event.label == "Complete"

        # latest(job) returns the most recently published event for each job,
        # and jobs are tracked independently (Req 20.4).
        for job_id, expected_state in last_state_by_job.items():
            current = await service.latest(job_id)
            assert current is not None
            assert current.job_id == job_id
            assert current.state == expected_state
            assert current.label == _expected_label(expected_state)

        # A job that was never published has no latest event.
        assert await service.latest("never-published") is None

    asyncio.run(scenario())
