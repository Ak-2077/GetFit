import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import connectDB from './config/db.js';

dotenv.config();
connectDB();

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Request logger — helps debug routing issues
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

import authRoute from './routes/authRoutes.js';
import foodRoute from './routes/foodRoute.js';
import burnRoute from './routes/burnRoute.js';
import aiRoute from './routes/aiRoute.js';
import workoutRoute from './routes/workoutRoute.js';
import userRoute from './routes/userRoute.js';

app.use('/api/auth', authRoute);
app.use('/api/food', foodRoute);
app.use('/api/burn', burnRoute);
app.use('/api/ai', aiRoute);
app.use('/api/workout', workoutRoute);
app.use('/api/user', userRoute);

app.get("/", (req, res) => {
    res.send("Welcome to AiFit!");
});
const port = process.env.PORT || 5000;

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});