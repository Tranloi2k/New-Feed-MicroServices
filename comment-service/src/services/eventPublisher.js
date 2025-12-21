import amqp from "amqplib";

let channel = null;

export async function initEventPublisher() {
  try {
    const connection = await amqp.connect(
      process.env.RABBITMQ_URL || "amqp://admin:admin@localhost:5672"
    );
    channel = await connection.createChannel();
    
    await channel.assertExchange("comments", "topic", { durable: true });
    
    console.log("✅ RabbitMQ event publisher initialized");
  } catch (error) {
    console.error("❌ RabbitMQ publisher failed:", error.message);
    // Retry connection after 5 seconds
    setTimeout(initEventPublisher, 5000);
  }
}

export async function publishEvent(eventType, data) {
  if (!channel) {
    console.error("❌ RabbitMQ channel not initialized");
    return;
  }

  try {
    const event = {
      eventType,
      data,
      timestamp: new Date().toISOString(),
    };

    channel.publish(
      "comments",
      eventType,
      Buffer.from(JSON.stringify(event)),
      { persistent: true }
    );

    console.log(`📤 Published event: ${eventType}`);
  } catch (error) {
    console.error("Error publishing event:", error);
  }
}
