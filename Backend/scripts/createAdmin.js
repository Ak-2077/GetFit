import dotenv from 'dotenv';
import connectDB from '../config/db.js';
import User from '../models/user.js';

dotenv.config();

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  args.forEach(a => {
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      out[k] = v;
    }
  });
  return out;
}

(async () => {
  const args = parseArgs();
  const name = args.name || process.env.ADMIN_NAME;
  const phone = args.phone || process.env.ADMIN_PHONE;

  if (!phone) {
    console.error('Usage: node scripts/createAdmin.js --phone=+919876543210 [--name="Admin Name"]\nOr set ADMIN_PHONE in your .env');
    process.exit(1);
  }

  await connectDB();

  try {
    let user = await User.findOne({ phone });

    if (user) {
      user.role = 'admin';
      user.name = name || user.name;
      await user.save();
      console.log(`Updated existing user ${phone} to admin.`);
    } else {
      user = await User.create({ name: name || 'Admin', phone, role: 'admin' });
      console.log(`Created admin user ${phone}.`);
    }

    process.exit(0);
  } catch (err) {
    console.error('Error creating admin user:', err.message);
    process.exit(1);
  }
})();
