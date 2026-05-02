import Notification from '../models/notification.js';

export const getNotifications = async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const notifications = await Notification.find({ userId })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    return res.status(200).json({ notifications });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch notifications', error: error.message });
  }
};

export const getUnreadCount = async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const count = await Notification.countDocuments({ userId, isRead: false });
    return res.status(200).json({ count });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch unread count', error: error.message });
  }
};

export const markAsRead = async (req, res) => {
  try {
    const userId = req.userId;
    const { id } = req.params;

    const notification = await Notification.findOneAndUpdate(
      { _id: id, userId },
      { isRead: true },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({ message: 'Notification not found' });
    }

    return res.status(200).json({ notification });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to mark as read', error: error.message });
  }
};

export const markAllAsRead = async (req, res) => {
  try {
    const userId = req.userId;
    await Notification.updateMany({ userId, isRead: false }, { isRead: true });
    return res.status(200).json({ message: 'All notifications marked as read' });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to mark all as read', error: error.message });
  }
};

// Helper to create notifications from other controllers
export const createNotification = async (userId, message, type = 'info') => {
  try {
    const notification = new Notification({ userId, message, type });
    await notification.save();
    return notification;
  } catch (error) {
    console.warn('Failed to create notification:', error.message);
    return null;
  }
};
