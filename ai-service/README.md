# GetFit AI Service

Python FastAPI microservice powering all AI features: chatbot, diet planning, video analysis, and real-time pose detection.

## Architecture

```
ai-service/
├── app/
│   ├── main.py              # FastAPI entrypoint
│   ├── core/
│   │   ├── config.py        # Environment settings
│   │   └── llm.py           # Ollama LLM client
│   ├── routers/
│   │   ├── health.py        # GET /health
│   │   ├── chat.py          # POST /chat/completions
│   │   ├── diet.py          # POST /diet/generate
│   │   ├── video.py         # POST /video/analyze, GET /video/result/{id}
│   │   └── pose.py          # POST /pose/analyze
│   └── models/
│       └── schemas.py       # Pydantic request/response models
├── Dockerfile
├── requirements.txt
└── .env.example
```

## Local Setup (Windows)

### 1. Install Ollama
Download and install from https://ollama.com/download
Then pull the model:
```bash
ollama pull qwen3:14b
```
> Requires ~10GB disk space and a GPU with 10GB+ VRAM for best performance.

### 2. Create Python virtual environment
```bash
cd ai-service
python -m venv venv
venv\Scripts\activate          # Windows
pip install -r requirements.txt
```

### 3. Create .env file
```bash
copy .env.example .env
```

### 4. Run the service
```bash
uvicorn app.main:app --host 0.0.0.0 --port 8100 --reload
```

### 5. Verify
- Open http://localhost:8100/docs for Swagger UI
- Check health: http://localhost:8100/health

## Docker Setup
```bash
# From project root (GetFit/)
docker-compose up -d
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Service + LLM health check |
| POST | `/chat/completions` | AI chatbot conversation |
| POST | `/diet/generate` | Generate personalized diet plan |
| POST | `/video/analyze` | Queue video for form analysis |
| GET | `/video/result/{job_id}` | Poll video analysis results |
| POST | `/pose/analyze` | Analyze single-frame pose keypoints |

## Connecting from Node.js Backend
The Express backend communicates via `Backend/services/aiClient.js`:
```javascript
import { chatCompletion, generateAIDietPlan } from '../services/aiClient.js';
```
Set `AI_SERVICE_URL=http://localhost:8100` in your Backend `.env`.
