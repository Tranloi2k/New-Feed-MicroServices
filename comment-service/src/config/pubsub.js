import { RedisPubSub } from 'graphql-redis-subscriptions';
import Redis from 'ioredis';

// Redis PubSub configuration for GraphQL Subscriptions
// Uses separate Redis connections for publisher and subscriber
// Production-ready: Scales across multiple service instances

const redisOptions = {
    host: process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT),
    password: process.env.REDIS_PASSWORD,
    retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        console.log(`[Redis PubSub] Retry attempt ${times}, waiting ${delay}ms`);
        return delay;
    },
    maxRetriesPerRequest: null, // Important for PubSub - don't limit retries
    enableReadyCheck: true,
    enableOfflineQueue: true,
    // Use DB 2 for subscriptions (separate from cache DB 1)
    db: 2,
};

// Connection event handlers
const handleConnection = (type, redis) => {
    redis.on('connect', () => {
        console.log(`✅ [Redis PubSub ${type}] Connected to ${redisOptions.host}:${redisOptions.port}`);
    });

    redis.on('ready', () => {
        console.log(`✅ [Redis PubSub ${type}] Ready for operations`);
    });

    redis.on('error', (err) => {
        console.error(`❌ [Redis PubSub ${type}] Error:`, err.message);
    });

    redis.on('reconnecting', () => {
        console.log(`🔄 [Redis PubSub ${type}] Reconnecting...`);
    });
};

// Create separate Redis connections for publisher and subscriber
const publisher = new Redis(redisOptions);
const subscriber = new Redis(redisOptions);

// Attach event handlers
handleConnection('Publisher', publisher);
handleConnection('Subscriber', subscriber);

// Create Redis PubSub instance
const pubsub = new RedisPubSub({
    publisher,
    subscriber,
    // Optional: Add serializer/deserializer for complex objects
    messageEventName: 'message', // Default
    pmessageEventName: 'pmessage', // Default
});

// Event channels - Using namespaced keys for clarity
export const COMMENT_EVENTS = {
    COMMENT_ADDED: 'COMMENT_ADDED',
    COMMENT_UPDATED: 'COMMENT_UPDATED',
    COMMENT_DELETED: 'COMMENT_DELETED',
};

// Graceful shutdown
export const closePubSub = async () => {
    console.log('🔌 [Redis PubSub] Closing connections...');
    try {
        await publisher.quit();
        await subscriber.quit();
        console.log('✅ [Redis PubSub] Connections closed gracefully');
    } catch (error) {
        console.error('❌ [Redis PubSub] Error closing connections:', error);
        publisher.disconnect();
        subscriber.disconnect();
    }
};

console.log('🚀 [Redis PubSub] Initializing for GraphQL Subscriptions...');

export default pubsub;
