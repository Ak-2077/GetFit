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
import caloriesRoute from './routes/caloriesRoute.js';
import stepsRoute from './routes/stepsRoute.js';
import featureRoute from './routes/featureRoute.js';
import searchRoute from './routes/searchRoute.js';
import bmiRoute from './routes/bmiRoute.js';
import notificationRoute from './routes/notificationRoute.js';
import bmbRoute from './routes/bmbRoute.js';
import dietRoute from './routes/dietRoute.js';
import workoutPlanRoute from './routes/workoutPlanRoute.js';
import subscriptionRoute from './routes/subscriptionRoute.js';
import exerciseRoute from './routes/exerciseRoute.js';

app.use('/api/auth', authRoute);
app.use('/api/food', foodRoute);
app.use('/api/foods', foodRoute);
app.use('/api/burn', burnRoute);
app.use('/api/calories', caloriesRoute);
app.use('/api/steps', stepsRoute);
app.use('/api/ai', aiRoute);
app.use('/api/workout', workoutRoute);
app.use('/api/user', userRoute);
app.use('/api/features', featureRoute);
app.use('/api/search', searchRoute);
app.use('/api/bmi', bmiRoute);
app.use('/api/notifications', notificationRoute);
app.use('/api/bmb', bmbRoute);
app.use('/api/diet', dietRoute);
app.use('/api/workout-plan', workoutPlanRoute);
app.use('/api/subscription', subscriptionRoute);
app.use('/api/exercises', exerciseRoute);

app.get("/", (req, res) => {
    res.send("Welcome to GetFit!");
});
const port = process.env.PORT || 5000;

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});