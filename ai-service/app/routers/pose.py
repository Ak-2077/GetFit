import math
from fastapi import APIRouter
from app.models.schemas import PoseAnalysisRequest, PoseAnalysisResponse

router = APIRouter()

# ── Joint angle calculation ──

def calc_angle(a: list[float], b: list[float], c: list[float]) -> float:
    """Angle at point b formed by a-b-c, in degrees."""
    ba = [a[0] - b[0], a[1] - b[1]]
    bc = [c[0] - b[0], c[1] - b[1]]
    dot = ba[0] * bc[0] + ba[1] * bc[1]
    mag_ba = math.sqrt(ba[0] ** 2 + ba[1] ** 2) + 1e-6
    mag_bc = math.sqrt(bc[0] ** 2 + bc[1] ** 2) + 1e-6
    cosine = max(-1.0, min(1.0, dot / (mag_ba * mag_bc)))
    return math.degrees(math.acos(cosine))


# COCO 17-keypoint indices
NOSE, L_EYE, R_EYE, L_EAR, R_EAR = 0, 1, 2, 3, 4
L_SHOULDER, R_SHOULDER = 5, 6
L_ELBOW, R_ELBOW = 7, 8
L_WRIST, R_WRIST = 9, 10
L_HIP, R_HIP = 11, 12
L_KNEE, R_KNEE = 13, 14
L_ANKLE, R_ANKLE = 15, 16

# ── Form rules per exercise ──

FORM_RULES = {
    "squat": {
        "joints": {
            "left_knee": (L_HIP, L_KNEE, L_ANKLE),
            "right_knee": (R_HIP, R_KNEE, R_ANKLE),
            "left_hip": (L_SHOULDER, L_HIP, L_KNEE),
            "right_hip": (R_SHOULDER, R_HIP, R_KNEE),
        },
        "checks": [
            {"joint": "left_knee", "condition": "< 70", "issue": "Knees going too deep", "fix": "Stop at 90° knee angle"},
            {"joint": "left_hip", "condition": "< 45", "issue": "Leaning too far forward", "fix": "Keep chest up and core braced"},
        ],
    },
    "pushup": {
        "joints": {
            "left_elbow": (L_SHOULDER, L_ELBOW, L_WRIST),
            "left_hip": (L_SHOULDER, L_HIP, L_KNEE),
        },
        "checks": [
            {"joint": "left_hip", "condition": "< 160", "issue": "Hips sagging", "fix": "Engage core, keep body in a straight line"},
            {"joint": "left_hip", "condition": "> 190", "issue": "Hips too high", "fix": "Lower hips to align with shoulders and ankles"},
        ],
    },
    "bicep_curl": {
        "joints": {
            "left_elbow": (L_SHOULDER, L_ELBOW, L_WRIST),
            "right_elbow": (R_SHOULDER, R_ELBOW, R_WRIST),
        },
        "checks": [
            {"joint": "left_elbow", "condition": "< 30", "issue": "Not full contraction", "fix": "Curl the weight all the way up"},
        ],
    },
}


def evaluate_form(keypoints: list[list[float]], exercise_type: str) -> PoseAnalysisResponse:
    """Rule-based form analysis from a single frame of 17 COCO keypoints."""
    rules = FORM_RULES.get(exercise_type)
    if not rules or len(keypoints) < 17:
        return PoseAnalysisResponse(form_score=0.0, issues=["Unknown exercise or insufficient keypoints"], corrections=[], joint_angles={})

    # Calculate joint angles
    angles = {}
    for name, (a_idx, b_idx, c_idx) in rules["joints"].items():
        kp = keypoints
        angles[name] = round(calc_angle(kp[a_idx], kp[b_idx], kp[c_idx]), 1)

    # Check form rules
    issues = []
    corrections = []
    for check in rules["checks"]:
        angle_val = angles.get(check["joint"], 0)
        cond = check["condition"]
        triggered = False
        if cond.startswith("< "):
            triggered = angle_val < float(cond[2:])
        elif cond.startswith("> "):
            triggered = angle_val > float(cond[2:])
        if triggered:
            issues.append(check["issue"])
            corrections.append(check["fix"])

    # Score: 100 = perfect, deduct per issue
    score = max(0, 100 - len(issues) * 25)

    return PoseAnalysisResponse(form_score=score, issues=issues, corrections=corrections, joint_angles=angles)


@router.post("/analyze", response_model=PoseAnalysisResponse)
async def analyze_pose(request: PoseAnalysisRequest):
    """Analyze a single frame of keypoints for form correctness."""
    exercise = request.exercise_type or "squat"
    return evaluate_form(request.keypoints, exercise)
