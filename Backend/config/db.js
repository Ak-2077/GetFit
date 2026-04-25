import mongoose from 'mongoose';
import dns from 'node:dns';

const ensureUserIndexes = async () => {
    const users = mongoose.connection.collection('users');
    const indexes = await users.indexes();

    const isSingleFieldKey = (idx, field) => {
        const keys = Object.keys(idx.key || {});
        return keys.length === 1 && keys[0] === field;
    };

    for (const idx of indexes) {
        if (idx.name === '_id_') continue;

        const emailIndexConflict =
            isSingleFieldKey(idx, 'email') && idx.name !== 'email_1';
        const phoneIndexConflict =
            isSingleFieldKey(idx, 'phone') && idx.name !== 'phone_1';

        if (emailIndexConflict || phoneIndexConflict) {
            await users.dropIndex(idx.name);
        }
    }

    const refreshedIndexes = await users.indexes();
    const emailIndex = refreshedIndexes.find((idx) => idx.name === 'email_1');
    const phoneIndex = refreshedIndexes.find((idx) => idx.name === 'phone_1');

    const hasProperPartial = (idx, field) =>
        idx &&
        idx.unique === true &&
        idx.partialFilterExpression &&
        idx.partialFilterExpression[field] &&
        idx.partialFilterExpression[field].$type === 'string';

    if (emailIndex && !hasProperPartial(emailIndex, 'email')) {
        await users.dropIndex('email_1');
    }

    if (phoneIndex && !hasProperPartial(phoneIndex, 'phone')) {
        await users.dropIndex('phone_1');
    }

    await users.createIndex(
        { email: 1 },
        {
            name: 'email_1',
            unique: true,
            partialFilterExpression: { email: { $type: 'string' } },
        }
    );

    await users.createIndex(
        { phone: 1 },
        {
            name: 'phone_1',
            unique: true,
            partialFilterExpression: { phone: { $type: 'string' } },
        }
    );
};

const ensureResolvableDns = () => {
    const currentServers = dns.getServers();
    const localhostOnly =
        currentServers.length === 0 ||
        currentServers.every((server) => server === '127.0.0.1' || server === '::1');

    if (!localhostOnly) return;

    const fallbackServers = (process.env.DNS_SERVERS || '1.1.1.1,8.8.8.8')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);

    if (!fallbackServers.length) return;

    try {
        dns.setServers(fallbackServers);
        console.warn(
            `Local DNS resolver is unavailable. Using fallback DNS servers: ${fallbackServers.join(', ')}`
        );
    } catch (error) {
        console.warn('Failed to apply fallback DNS servers:', error.message);
    }
};

const connectDB = async () => {
    try {
        ensureResolvableDns();
        await mongoose.connect(process.env.MONGO_URI);
        await ensureUserIndexes();
        console.log('MongoDB connected successfully');
    } catch (error) {
        console.error('MongoDB connection failed:', error.message);
        process.exit(1);
    }
};

export default connectDB;