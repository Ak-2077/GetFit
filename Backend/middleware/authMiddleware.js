import jwt from 'jsonwebtoken';
import User from '../models/user.js';

export default async function auth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || req.headers.Authorization;
    if (!authHeader) return res.status(401).json({ message: 'No token provided' });

    const parts = authHeader.split(' ');
    const token = parts.length === 2 ? parts[1] : parts[0];

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded || !decoded.id) return res.status(401).json({ message: 'Invalid token' });

    // attach user id and user to request for downstream handlers
    req.userId = decoded.id;
    req.user = await User.findById(decoded.id).select('-password');
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Unauthorized', error: error.message });
  }
}
