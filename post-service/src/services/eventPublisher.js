import amqp from "amqplib";

let channel = null;

async function getChannel() {
  if (channel) return channel;

  try {
    const connection = await amqp.connect(
      process.env.RABBITMQ_URL
    );
    channel = await connection.createChannel();
    await channel.assertExchange("posts", "topic", { durable: true });
    console.log("✅ RabbitMQ connected (Publisher)");
    return channel;
  } catch (error) {
    console.error("❌ RabbitMQ connection failed:", error.message);
    return null;
  }
}

export async function publishEvent(eventType, data) {
  try {
    const ch = await getChannel();
    if (!ch) {
      console.warn("RabbitMQ not available, skipping event publish");
      return;
    }

    const message = JSON.stringify({
      eventType,
      data,
      timestamp: new Date().toISOString(),
    });

    ch.publish("posts", eventType, Buffer.from(message));
    console.log(`📤 Published event: ${eventType}`);
  } catch (error) {
    console.error("Error publishing event:", error);
  }
}
