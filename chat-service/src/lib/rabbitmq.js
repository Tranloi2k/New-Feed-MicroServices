import "dotenv/config";
import amqp from "amqplib";

let connection;
let channel;
let connecting;

export async function getRabbitChannel() {
  if (channel) return channel;
  if (connecting) return connecting;
  connecting = (async () => {
    connection = await amqp.connect(process.env.RABBITMQ_URL);
    connection.on("error", () => {});
    connection.on("close", () => {
      connection = undefined;
      channel = undefined;
    });
    channel = await connection.createConfirmChannel();
    await channel.assertExchange("chat", "topic", { durable: true });
    return channel;
  })();
  try {
    return await connecting;
  } finally {
    connecting = undefined;
  }
}
